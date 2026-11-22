"""Decisions API latency check: ONE client, 6 calls in a row in the same process.

    uv run python scripts/check_decisions.py

Calls, run twice in this order: a, b, c, a, b, c
  (a) 1 noul question, text only
  (b) the firewall's real request (backend/firewall_decisions.py) from backend/rules.json:
      every probe + firewall_action + attack_severity, text only
  (c) the same as (b) plus one image: the first file in eval/golden/ (png/jpg), or a small
      generated test PNG if there is none
The first call pays for client set-up, DNS, TLS and auth (cold). The p50 is over the warm
calls (2 to 6), which is what the firewall sees after the startup warm-up. It uses the same
shared client as the firewall (backend/gemini.py beta_client, v1beta) and doesn't change
FIREWALL_BACKEND or any config.
"""
from __future__ import annotations

import asyncio
import statistics
import struct
import sys
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import config, gemini  # noqa: E402
from app import firewall_decisions as fw  # noqa: E402
from app.rules import RuleStore  # noqa: E402
from app.schemas import Claims, Intent, Media, ToolCall  # noqa: E402

CALL_TIMEOUT_S = 30  # measure the real latency, not the firewall deadline
SCRATCH = ROOT / "runs" / "check_decisions"


def _test_png(path: Path, size: int = 64) -> Path:
    """A small valid PNG (red/blue gradient), no Pillow needed."""
    raw = b"".join(b"\x00" + bytes(c for x in range(size) for c in (x * 4 % 256, 40, y * 4 % 256))
                   for y in range(size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return path


def _image() -> Media:
    golden = ROOT / "eval" / "golden"
    found = sorted([*golden.glob("*.png"), *golden.glob("*.jpg"), *golden.glob("*.jpeg")]) if golden.exists() else []
    path = found[0] if found else _test_png(SCRATCH / "test.png")
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return Media(kind="image", path=str(path), mime=mime)


def _requests() -> dict[str, tuple[dict, list[str] | None, str]]:
    rules = RuleStore(str(ROOT / "app" / "rules.json")).current()
    intent = Intent(text="buy one pack of trail mix under $25", budget=25)
    product = {"id": "gid://shopify/Product/1", "title": "Trail Mix Snack Pack (1 pack)",
               "variants": [{"id": "gid://shopify/ProductVariant/9", "price": {"amount": 1999, "currency": "USD"}}]}
    call = ToolCall(name="create_cart", arguments={"shop": "example.myshopify.com", "cart": {
        "line_items": [{"item": {"id": "gid://shopify/ProductVariant/9"}, "quantity": 1}]}})
    claims = Claims(visible_text=["Trail Mix"], pack_count_claim=1, brand_claims=[], audio_transcript=None,
                    instructions_detected=False)
    probes = fw.active_probes(rules, product)
    ids = [p.id for p in probes]
    img = _image()
    a = {"input": [{"type": "text", "text": "USER_INTENT:\nbuy one water bottle under $25\n\n"
                                            "PROPOSED_TOOL_CALL:\ncreate_cart quantity=50\n"}],
         "questions": {"quantity_exceeds_intent": {
             "type": "noul", "instructions": "Does PROPOSED_TOOL_CALL buy more units than USER_INTENT asked for?"}}}
    b = fw._build_decisions_request(intent, [], product, call, claims, probes)
    c = fw._build_decisions_request(intent, [img], product, call, claims, probes)
    return {
        "a": (a, None, "1 noul, text"),
        "b": (b, ids, f"{len(b['questions'])} questions, text"),
        "c": (c, ids, f"{len(c['questions'])} questions + image {Path(img.path).name}"),
    }


async def main() -> int:
    print(f"model={config.MODELS['firewall']} api_version=v1beta key_set={bool(config.GEMINI_API_KEY)} "
          f"firewall_timeout_ms={config.THRESHOLDS['firewall_timeout_ms']}")
    reqs = _requests()
    results: list[tuple[int, str, float, bool]] = []
    for i, kind in enumerate(["a", "b", "c", "a", "b", "c"], start=1):
        request, ids, label = reqs[kind]
        t0 = time.perf_counter()
        try:
            raw = await fw._call_decisions(request, CALL_TIMEOUT_S)  # the shared, cached v1beta client
            ms = (time.perf_counter() - t0) * 1000
            if ids is None:
                a = (fw._field(raw, "answers") or {}).get("quantity_exceeds_intent")
                detail = f"noul={fw._field(a, 'noul')}"
            else:
                s = fw._parse_decisions_response(raw, ids)  # same validation as the firewall
                top = max(s.probe_p, key=s.probe_p.get)
                detail = (f"P(approve)={s.action_probs['approve_checkout']:.2f} severity={s.severity} "
                          f"top_probe={top}:{s.probe_p[top]:.2f}")
            ok = True
        except Exception as e:  # print exactly what came back
            ms = (time.perf_counter() - t0) * 1000
            detail = f"ERROR {type(e).__name__}"
            for attr in ("status_code", "body"):
                if getattr(e, attr, None) is not None:
                    detail += f" {attr}={str(getattr(e, attr))[:500]}"
            detail += f" {str(e)[:500]}"
            ok = False
        within = "-" if not ok else ("ok" if ms <= config.THRESHOLDS["firewall_timeout_ms"] else "OVER TIMEOUT")
        print(f"{i}. ({kind}) {label:<40} {ms:7.0f} ms  {within:<12} {'cold' if i == 1 else 'warm'}  {detail}")
        results.append((i, kind, ms, ok))

    warm = [ms for i, _, ms, ok in results if i > 1 and ok]
    if warm:
        print(f"\nwarm p50 (calls 2-6, {len(warm)} ok): {statistics.median(warm):.0f} ms   "
              f"cold call 1: {results[0][2]:.0f} ms")
        for kind in "abc":
            ks = [ms for i, k, ms, ok in results if i > 1 and k == kind and ok]
            if ks:
                print(f"  ({kind}) warm p50: {statistics.median(ks):.0f} ms over {len(ks)} call(s)")
    return 0 if all(ok for *_, ok in results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
