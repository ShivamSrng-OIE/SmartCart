"""Generate CartTrap's golden tuning images with Nano Banana (Gemini image model).

OUR OWN test attacks against OUR OWN shopping agent, for tuning on eval/golden/ only
(never eval/cases/). Cases live in scripts/golden_cases.py. Writes the images plus
eval/golden/manifest.json (request, budget, product, proposed call, expected verdict).

    uv run python scripts/make_golden.py                 # all 30
    uv run python scripts/make_golden.py --only sticky_note promo_banner
    uv run python scripts/make_golden.py --skip-existing # only missing images
    uv run python scripts/make_golden.py --offline       # Pillow only, no API

Nano Banana only returns JPEG, so .png files are converted. If a generation fails or is
refused, a plain Pillow image is drawn instead and the manifest says so.
Always LOOK at the images: image models misspell text, and an attack whose text is
unreadable is not testing what it claims to test.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from golden_cases import ALL_CASES as CASES, PRODUCTS  # noqa: E402  (golden + holdout)

OUT = ROOT / "eval" / "golden"
SUFFIX = (" No watermark, no logos of real brands, no extra captions. Render the quoted text exactly, letter for letter, "
          "as real printed or handwritten text on the object. Photorealistic, like a real unedited photo.")


def _client():
    from google import genai
    from backend import config
    if not config.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=config.GEMINI_API_KEY), config.MODELS["imagegen"]


def nano_banana(client, model: str, case: dict) -> bytes:
    res = client.interactions.create(
        model=model,
        input=case["prompt"] + SUFFIX,
        response_format={"type": "image", "mime_type": "image/jpeg", "aspect_ratio": case.get("aspect", "4:3"), "image_size": case.get("size", "1K")},
    )
    img = getattr(res, "output_image", None)
    if img is None or not getattr(img, "data", None):
        raise RuntimeError("no image in response (possibly refused)")
    return base64.b64decode(img.data)


def pillow_fallback(case: dict, path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    W, H = 1024, 768
    dark = case["id"] == "benign_blurry"
    img = Image.new("RGB", (W, H), (40, 40, 48) if dark else (214, 214, 210))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([300, 160, 724, 680], radius=24, fill=(90, 95, 105) if dark else (196, 168, 128))
    if case["text"]:
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", 28)
        except OSError:
            font = ImageFont.load_default()
        label = Image.new("RGBA", (420, 200), (250, 250, 245, 255))
        ImageDraw.Draw(label).multiline_text((16, 18), case["text"], fill=(25, 25, 25), font=font, spacing=8)
        label = label.rotate(-5, expand=True, fillcolor=(0, 0, 0, 0))
        img.paste(label, (300, 330), label)
    if case.get("blur"):
        img = img.filter(ImageFilter.GaussianBlur(case["blur"]))
    img.save(path, quality=88)


def save(data: bytes, path: Path) -> None:
    if path.suffix == ".png":
        from PIL import Image
        Image.open(io.BytesIO(data)).convert("RGB").save(path, format="PNG")
    else:
        path.write_bytes(data)


def make(case: dict, client, model, offline: bool) -> tuple[dict, str]:
    path = OUT / case["file"]
    gen, err, t0 = "nano_banana", None, time.perf_counter()
    if offline or client is None:
        gen = "pillow_fallback"
        pillow_fallback(case, path)
    else:
        try:
            save(nano_banana(client, model, case), path)
        except Exception as e:  # never leave a hole in the set
            gen, err = "pillow_fallback", f"{type(e).__name__}: {str(e)[:160]}"
            pillow_fallback(case, path)
    ms = int((time.perf_counter() - t0) * 1000)
    entry = {k: case[k] for k in ("id", "file", "label", "expect", "ideal", "request", "budget", "call",
                                  "vector", "categories", "audio_script")}
    entry["product"] = PRODUCTS[case["product"]]
    entry["visible_text"] = case["text"]
    entry["holdout"] = bool(case.get("holdout"))
    entry.update(generator=gen, model=(model if gen == "nano_banana" else None))
    line = f"{case['file']:<30} {case['label']:<7} {gen:<16} {ms:>6} ms" + (f"   ({err})" if err else "")
    return entry, line


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="case ids to (re)generate")
    ap.add_argument("--skip-existing", action="store_true", help="only generate images that don't exist yet")
    ap.add_argument("--offline", action="store_true", help="skip the API, draw Pillow images")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    todo = [c for c in CASES if (not args.only or c["id"] in args.only)
            and not (args.skip_existing and (OUT / c["file"]).exists())]
    client = model = None
    if not args.offline:
        try:
            client, model = _client()
            print(f"model={model}  generating {len(todo)} image(s), about 15 s each, {args.workers} at a time")
        except Exception as e:
            print(f"API unavailable ({e}); using Pillow fallback")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda c: make(c, client, model, args.offline), todo))
    for _, line in results:
        print(line)

    # Manifest always lists every case that has an image; entries not regenerated this run are kept.
    mpath = OUT / "manifest.json"
    old = {}
    if mpath.exists():
        old = {e["id"]: e for e in json.loads(mpath.read_text(encoding="utf-8")).get("cases", [])}
    new = {e["id"]: e for e, _ in results}
    entries = []
    for c in CASES:
        if c["id"] in new:
            entries.append(new[c["id"]])
        elif c["id"] in old and (OUT / c["file"]).exists() and "product" in old[c["id"]]:
            entries.append(old[c["id"]])
    mpath.write_text(json.dumps({"note": "Golden TUNING set. Never copy into eval/cases/.", "cases": entries},
                                indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    known = {c["file"] for c in CASES} | {"manifest.json"}
    stale = sorted(p.name for p in OUT.iterdir()
                   if p.is_file() and p.name not in known and not p.name.startswith("results"))
    fallbacks = [e["id"] for e, _ in results if e["generator"] != "nano_banana"]
    print(f"\nwrote {len(results)} image(s); manifest has {len(entries)}/{len(CASES)} cases")
    if fallbacks:
        print("Pillow fallback used for: " + ", ".join(fallbacks) + "  (rerun with --only to retry)")
    if stale:
        print("Old files not in the set (safe to delete): " + ", ".join(stale))
    print("Now LOOK at the images. Attack text must be readable and spelled right; benign_blurry must have no text.")


if __name__ == "__main__":
    main()
