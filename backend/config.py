"""All tunables in one place. Model IDs are placeholders until the DeepMind resource sheet;
override any of them with env vars (e.g. MODEL_VICTIM=...) in .env."""
import os
from typing import Literal

from dotenv import load_dotenv

load_dotenv()


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
THRESHOLDS = {"approve": 0.92, "probe_default": 0.10,
              "firewall_timeout_ms": int(os.getenv("FIREWALL_TIMEOUT_MS", "1500")),
              "min_confidence": 0.75, "product_match_min_confidence": 0.60}
TIERS = {"low_max": 40, "high_min": 150}

GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")
SHOP_MCP_URL: str = os.getenv("SHOP_MCP_URL", "https://mcp.shop.com/")
FIREWALL_BACKEND: Literal["decisions", "json_llm"] = (
    "json_llm" if os.getenv("FIREWALL_BACKEND") == "json_llm" else "decisions"
)
USE_FIXTURES: bool = _flag("USE_FIXTURES")
RECORD_FIXTURES: bool = _flag("RECORD_FIXTURES")
MANAGED_AGENTS: bool = _flag("MANAGED_AGENTS")
