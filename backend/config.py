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
        "imagegen": "nano-banana-2.1",
    }.items()
}

THRESHOLDS = {"approve": 0.92, "probe_default": 0.10, "firewall_timeout_ms": 1500}
TIERS = {"low_max": 40, "high_min": 150}

GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")
SHOP_MCP_URL: str = os.getenv("SHOP_MCP_URL", "https://mcp.shop.com/")
FIREWALL_BACKEND: Literal["decisions", "json_llm"] = (
    "json_llm" if os.getenv("FIREWALL_BACKEND") == "json_llm" else "decisions"
)
USE_FIXTURES: bool = _flag("USE_FIXTURES")
RECORD_FIXTURES: bool = _flag("RECORD_FIXTURES")
MANAGED_AGENTS: bool = _flag("MANAGED_AGENTS")
