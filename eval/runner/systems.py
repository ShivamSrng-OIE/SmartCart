"""Adapt Task 5 and C7 to scoreable traces. All Shop IO belongs to ShopMCP."""

import mimetypes
import random
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Protocol


ROOT = Path(__file__).resolve().parents[2]
SEED = 0


def backend_module(name):
    full_name = f"backend.{name}"
    try:
        return import_module(full_name)
    except ModuleNotFoundError as exc:
        if exc.name not in {"backend", full_name}:
            raise
        return None


@dataclass
class Trace:
    calls: list
    verdicts: list
    products: dict


class GuardedResult(Protocol):
    approved_calls: list
    blocked_call: object | None
    verdicts: list
    product_json: dict | None


class RunGuarded(Protocol):
    async def __call__(self, intent, media, product_ref, bus, run_id, shop, rules) -> GuardedResult: ...


async def fake_guarded(intent, media, product_ref, bus, run_id, shop, rules):
    """C7's fixed hard block for wiring checks. No product or model inference."""
    return SimpleNamespace(
        approved_calls=[], blocked_call=SimpleNamespace(name="create_checkout", arguments={}),
        verdicts=[SimpleNamespace(action="hard_block_quarantine", latency_ms=0, error=None)],
        product_json=None,
    )


class EvalBus:
    def emit(self, event):
        """The returned calls and verdicts supply eval's trace, so skip the arena log."""


def load_media(paths, case_dir):
    from backend.schemas import Media

    media = []
    for name in paths:
        path = Path(name)
        if not path.is_absolute():
            local = case_dir / path
            path = local if local.exists() else ROOT / path
        mime = mimetypes.guess_type(path.name)[0]
        if mime == "application/pdf":
            kind = "pdf"
        elif mime and mime.split("/")[0] in {"image", "audio", "video"}:
            kind = mime.split("/")[0]
        else:
            raise ValueError(f"unsupported media type: {name}")
        media.append(Media(kind=kind, path=str(path), mime=mime))
    return media


class Systems:
    def __init__(self, systems, case_dir):
        self.case_dir = case_dir
        self.adapters = {}
        if any(system != "carttrap" for system in systems):
            module = backend_module("victim_hydrogen")
            self.victim = module.run_victim if module else None
            for system in systems:
                if system != "carttrap":
                    self.adapters[system] = "run_victim" if self.victim else "unavailable"
        if "carttrap" in systems:
            module = backend_module("guarded_shopper")
            self.guarded: RunGuarded = module.run_guarded if module else fake_guarded
            self.adapters["carttrap"] = "run_guarded" if module else "fake_guarded"

    async def __call__(self, system, case):
        if system != "carttrap" and self.victim is None:
            raise RuntimeError("backend.victim_hydrogen.run_victim is unavailable")

        # Stable per pair across scheduling, filters and resume.
        rng = random.Random(f"{SEED}/{case['id']}/{system}")
        run_id = f"eval_{rng.getrandbits(128):032x}"
        if system == "carttrap" and self.guarded is fake_guarded:
            result = await self.guarded(None, [], case.get("product_id"), EvalBus(), run_id, None, None)
            return Trace([result.blocked_call], result.verdicts, {})

        from backend.config import SHOP_MCP_URL
        from backend.intent import parse_intent
        from backend.shop_mcp import ShopMCP

        shop = ShopMCP(SHOP_MCP_URL, use_fixtures=True, record=False, dry_run=True)
        product_ref = case.get("product_id")
        args = (parse_intent(case["user_request"], case.get("budget")),
                load_media(case["media"], self.case_dir), product_ref, EvalBus(), run_id, shop)
        products = {}
        verdicts = []
        if system == "carttrap":
            from backend.rules import RuleStore

            result = await self.guarded(*args, rules=RuleStore(str(ROOT / "backend/rules.json")))
            calls = list(result.approved_calls)
            if result.blocked_call is not None:
                calls.append(result.blocked_call)
            verdicts = result.verdicts
            for verdict in verdicts:
                if verdict.error:
                    raise RuntimeError(f"firewall error: {verdict.error}")
            if result.product_json:
                product = result.product_json
                products[product.get("id") or product.get("product_id") or product_ref] = product
        else:
            mode = "raw" if system == "baseline" else "hardened"
            calls = await self.victim(*args, mode=mode)

        for call in calls:
            if call.name in {"create_cart", "update_cart"}:
                for line in call.arguments.get("lines", []):
                    ref = line.get("product_id", line.get("variant_id"))
                    if ref and ref not in products:
                        products[ref] = await shop.get_product(ref)
                    if not ref or not products[ref] or products[ref].get("price") is None:
                        raise ValueError(f"missing product price in Shop fixture for {ref}")
        return Trace(calls, verdicts, products)
