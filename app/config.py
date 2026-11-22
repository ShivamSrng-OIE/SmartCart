"""All tunables in one place. Model IDs are placeholders until the DeepMind resource sheet;
override any of them with env vars (e.g. MODEL_VICTIM=...) in .env."""
import os
from typing import Literal

from dotenv import load_dotenv

from app.paths import BACKEND, ENV_FILE

load_dotenv(ENV_FILE)  # backend/.env first, then a repo-root .env for older setups
load_dotenv(BACKEND.parent / ".env")


def _flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes"}


MODELS: dict[str, str] = {
    role: os.getenv(f"MODEL_{role.upper()}", default)
    for role, default in {
        "victim": "gemini-4-hydrogen",
        "perception": "gemini-4-argon",
        "firewall": "gemini-decision-1",
        "defender": "gemini-4-neon",
        "redteam": "gemini-4-carbon",
        "imagegen": "gemini-nano-banana-2.1",
    }.items()
}

# json_llm firewall fallback (architecture decision 1): a fast Gemini 4 model via the
# Interactions API. gemini-decision-1 only serves the Decisions API, so it can't be reused here.
FIREWALL_JSON_LLM_MODEL: str = os.getenv("MODEL_FIREWALL_JSON_LLM", MODELS["perception"])

# FIREWALL_TIMEOUT_MS tunes the firewall deadline without a code change (fail-closed after it).
# Default 2500 (was 1500): holdout p95 was 1414 ms and 2 of 12 calls timed out at 1500.
# approve / probe thresholds tuned on eval/golden with scripts/sweep_thresholds.py (Nov 21):
# hard-category probes 0.50, pack_lie/privacy/promo 0.65 (set per probe in rules.json).
THRESHOLDS = {"approve": 0.86, "probe_default": 0.50,
              "firewall_timeout_ms": int(os.getenv("FIREWALL_TIMEOUT_MS", "2500")),
              "min_confidence": 0.75, "product_match_min_confidence": 0.60}
TIERS = {"low_max": 40, "high_min": 150}

# How images go to the firewall (and camera product match). Argon perception always uses
# ultra_high at full size. FIREWALL_IMAGE_MAX_PX > 0 downscales the long side before sending
# (0 = send as is). high + 1024 px measured fastest on eval/golden with no detection loss
# (p50 764 / p95 1493 ms vs 880 / 1746 for ultra_high full size, 3 runs x 30 cases).
FIREWALL_IMAGE_RESOLUTION: str = os.getenv("FIREWALL_IMAGE_RESOLUTION", "high")
FIREWALL_IMAGE_MAX_PX: int = int(os.getenv("FIREWALL_IMAGE_MAX_PX", "1024"))

GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")
OPENROUTER_API_KEY: str | None = os.getenv("OPENROUTER_API_KEY")
# Which model provider runs the agents: "gemini" or "openrouter". The Settings page can switch it
# at runtime (app/llm/settings.py); this is only the starting value.
LLM_PROVIDER: str = (os.getenv("LLM_PROVIDER") or ("gemini" if GEMINI_API_KEY and not OPENROUTER_API_KEY else "openrouter")).lower()
# Free OpenRouter models are much slower than the hackathon Gemini endpoints, so the firewall gets
# a longer deadline there. It still fails closed when the deadline passes.
OPENROUTER_FIREWALL_TIMEOUT_MS: int = int(os.getenv("OPENROUTER_FIREWALL_TIMEOUT_MS", "45000"))
# The merchant portal's demo login (fictional local warehouse). Override in backend/.env.
MERCHANT_USERNAME: str = os.getenv("MERCHANT_USERNAME", "warehouse")
MERCHANT_PASSWORD: str = os.getenv("MERCHANT_PASSWORD", "warehouse-demo")
SHOP_MCP_URL: str = os.getenv("SHOP_MCP_URL", "https://mcp.shop.com/")
FIREWALL_BACKEND: Literal["decisions", "json_llm"] = (
    "json_llm" if os.getenv("FIREWALL_BACKEND") == "json_llm" else "decisions"
)
USE_FIXTURES: bool = _flag("USE_FIXTURES")
RECORD_FIXTURES: bool = _flag("RECORD_FIXTURES")
MANAGED_AGENTS: bool = _flag("MANAGED_AGENTS")
# The shopper also finds the local warehouse listings (some fraudulent) when it searches. On by default.
WAREHOUSE_IN_AGENT: bool = _flag("WAREHOUSE_IN_AGENT", "1")
