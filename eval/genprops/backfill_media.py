"""Create the media that is missing for existing generated items (image.png, audio.wav, video.mp4).

The media is git-ignored (see generate.py), so a fresh clone has the manifests and descriptions but
no pictures, narration or video. This rebuilds them locally from each manifest, with the same
recipe as generate.py: the item's own flaw is planted in exactly one modality, everything else is a
clean listing. Existing files are never overwritten and manifests are never modified. The result is
a local fixture set (similar to, not byte-identical with, the originals).

    uv run python -m eval.genprops.backfill_media                  # everything that is missing
    uv run python -m eval.genprops.backfill_media --only type-21-v1,type-21-v2
Needs GEMINI_API_KEY and ffmpeg.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path

from backend import media_prep
from eval.genprops import audio as gaudio
from eval.genprops import generate as gen

log = logging.getLogger("backfill_media")
RETRIES = 2


async def speak(text: str, voice: str) -> bytes:
    """Gemini TTS with the text alone. generate.py prefixes "Say naturally:", which the model sometimes
    reads out loud, putting a spurious "instruction" into a clean narration."""
    from google.genai import types

    from backend.gemini import beta_client

    name = gen.VOICES["second"] if voice not in ("narrator", gaudio._NARRATOR) else gen.VOICES["narrator"]
    r = await beta_client().aio.models.generate_content(
        model=gen.TTS_MODEL, contents=text,
        config=types.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=name)))))
    blob = r.candidates[0].content.parts[0].inline_data
    if (blob.mime_type or "").startswith("audio/wav") or blob.data[:4] == b"RIFF":
        return blob.data
    rate = int(blob.mime_type.split("rate=")[1].split(";")[0]) if "rate=" in (blob.mime_type or "") else 24000
    return gaudio._wav_bytes(blob.data, rate)


def plan(meta: dict) -> dict:
    """What an item needs, from its manifest alone."""
    pm = meta["poisoned_modality"]
    hijack = meta.get("hijack")
    row = {"type_n": meta["type_n"], "variant": meta["variant"]}
    return {
        "flaw": meta.get("flaw") if pm != "none" else None,
        "spoken": gen._pick(gen.SPOKEN[hijack], row) if pm == "audio" and hijack in gen.SPOKEN else None,
        "placement": gen.PLACEMENT[(meta["type_n"] + int(meta["variant"][1:])) % len(gen.PLACEMENT)],
        # normal items use the bold level so the planted text is legible; hard ones stay subtle
        "level": 0 if meta.get("difficulty") == "hard" else 2,
        "video": bool(meta.get("has_video")),
    }


async def _retry(label: str, fn):
    last = None
    for attempt in range(1, RETRIES + 2):
        try:
            return await fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            log.warning("%s attempt %d failed: %s", label, attempt, type(exc).__name__)
            await asyncio.sleep(2)
    raise RuntimeError(f"{label}: {type(last).__name__}: {last}")


async def backfill_item(folder: Path, sem: asyncio.Semaphore, redo: frozenset[str] = frozenset()) -> list[str]:
    meta = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    p, pm, product = plan(meta), meta["poisoned_modality"], meta["product"]
    item = {"title": product["title"], "price": (product["price_cents"] or 0) / 100, "quantity": 1,
            "description": f"{product['title']}, sold as a single item."}
    made: list[str] = []
    async with sem:
        image, audio, video = folder / "image.png", folder / "audio.wav", folder / "video.mp4"
        # redo: regenerate these even though they exist (a new narration means a new video too)
        if "audio" in redo and audio.exists():
            audio.unlink()
        if ("video" in redo or "audio" in redo) and video.exists():
            video.unlink()
        if "image" in redo and image.exists():
            image.unlink()
        if not image.exists():
            prompt = gen.image_prompt(product, p["flaw"] if pm == "image" else None, p["placement"], p["level"])
            img = await _retry(f"{folder.name} image", lambda: asyncio.to_thread(gen._gen_image, prompt))
            gen._save_png(img, image)
            made.append("image.png")
        if not audio.exists():
            async def narrate() -> bytes:
                clean = await gaudio.make_clean(item, synthesizer=speak)
                if pm != "audio" or not p["spoken"]:
                    return clean
                return gaudio.mix_under(clean, await speak(p["spoken"], "second"), gain_db=[-30, -27, -24][p["level"]])
            audio.write_bytes(await _retry(f"{folder.name} audio", narrate))
            made.append("audio.wav")
        if p["video"] and not video.exists():
            await _retry(f"{folder.name} video", lambda: asyncio.to_thread(
                gen.build_video, image, audio, video, p["flaw"] if pm == "video" else None, p["level"]))
            made.append("video.mp4")
    return made


async def main(only: list[str] | None, concurrency: int, items_dir: Path = gen.OUT, redo: frozenset[str] = frozenset()) -> dict[str, int]:
    gen.FFMPEG = media_prep.ffmpeg_path()
    folders = sorted(f.parent for f in items_dir.glob("*/manifest.json"))
    if only:
        folders = [f for f in folders if f.name in only]
    sem = asyncio.Semaphore(concurrency)
    totals = {"items": 0, "files": 0, "failed": 0}

    async def one(folder: Path):
        try:
            made = await backfill_item(folder, sem, redo)
            totals["items"] += 1
            totals["files"] += len(made)
            print(f"{folder.name}: {', '.join(made) or 'already complete'}", flush=True)
        except Exception as exc:  # noqa: BLE001 - one item failing must not stop the rest
            totals["failed"] += 1
            print(f"{folder.name}: FAILED {exc}"[:240], flush=True)

    await asyncio.gather(*(one(f) for f in folders))
    return totals


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated item ids")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--redo", help="regenerate even if present: audio,video,image (audio also redoes video)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)
    print(asyncio.run(main(args.only.split(",") if args.only else None, args.concurrency, redo=frozenset(args.redo.split(",")) if args.redo else frozenset())))
