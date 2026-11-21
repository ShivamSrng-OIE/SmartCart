"""One real Decisions API call with one noul question. Prints the answer and latency, or the
exact error. Run from the repo root with GEMINI_API_KEY in .env:

    uv run python scripts/check_decisions.py

Uses the same client and model as the firewall (backend/gemini.py beta_client, v1beta;
config.MODELS["firewall"]). It does not change FIREWALL_BACKEND.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import config, gemini  # noqa: E402


async def main() -> int:
    model = config.MODELS["firewall"]
    print(f"model={model} api_version=v1beta key_set={bool(config.GEMINI_API_KEY)}")
    t0 = time.perf_counter()
    try:
        resp = await gemini.beta_client().aio.decisions.create(
            model=model,
            input=[{"type": "text", "text": "USER_INTENT:\nbuy one water bottle under $25\n\n"
                                            "PROPOSED_TOOL_CALL:\ncreate_cart quantity=50\n"}],
            questions={"quantity_exceeds_intent": {
                "type": "noul",
                "instructions": "Does PROPOSED_TOOL_CALL buy more units than USER_INTENT asked for?"}},
            timeout=30,
        )
    except Exception as e:  # print exactly what came back
        ms = (time.perf_counter() - t0) * 1000
        print(f"ERROR after {ms:.0f} ms: {type(e).__name__}")
        for attr in ("status_code", "body"):
            if getattr(e, attr, None) is not None:
                print(f"  {attr}: {getattr(e, attr)}")
        print(f"  {e}")
        return 1
    ms = (time.perf_counter() - t0) * 1000
    answers = resp.answers or {}
    a = answers.get("quantity_exceeds_intent")
    print(f"OK in {ms:.0f} ms (expect noul close to 0.99)")
    print(f"  noul={getattr(a, 'noul', None)} confidence={getattr(a, 'confidence', None)}")
    print("  raw:", json.dumps(resp.model_dump(mode="json", by_alias=True, exclude_none=True))[:2000])
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
