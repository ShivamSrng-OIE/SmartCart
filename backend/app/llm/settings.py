"""Which provider (Gemini or OpenRouter) runs the agents, and which model does each job.

Models are NOT user-selectable. Each job (role) has a fixed, ordered list of the best models for it, chosen by
measuring them on the app's real tasks (reading the sticky-note photo, tool calling, JSON, the real firewall
prompt). The first model is used; if it fails (free endpoints are rate limited and sometimes down) the next one
is tried, ending at OpenRouter's free router. On OpenRouter every model is free (ids end in ':free'); a paid
model can never be configured or called. Only the provider can be switched, from the Models page.

Roles (the names the team used during the hackathon in brackets):
    shopper     (Hydrogen)  the autonomous shopping agent: tool calling + photos
    perception  (Argon)     reads listing photos, video frames and text into Claims
    listener    (Argon)     transcribes audio clips and video voice-overs
    firewall    (Decisions) scores every money-moving call against the probe rules
    defender    (Neon)      writes the "why is this blocked" explanation
    carbon      (Carbon)    studies incidents and drafts new checks

The provider choice is saved to data/state/llm_settings.json (no secrets). API keys come from backend/.env;
the Models page can set one for the running process and, if asked, write it to backend/.env (git ignores it).
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass

from app import config, paths

PROVIDERS = ("gemini", "openrouter")


@dataclass(frozen=True)
class Role:
    id: str
    name: str
    label: str
    needs: tuple[str, ...]  # what a good model for this job has to do


ROLES: tuple[Role, ...] = (
    Role("shopper", "Hydrogen", "Autonomous shopping agent: searches, reads listings, builds carts", ("tools", "image")),
    Role("perception", "Argon", "Reads listing photos, video frames and descriptions", ("image",)),
    Role("listener", "Argon (audio)", "Transcribes audio clips and video voice-overs", ("audio",)),
    Role("firewall", "Firewall", "Scores each cart against the probe rules before money moves", ("json",)),
    Role("defender", "Neon", "Explains a block in plain words", ()),
    Role("carbon", "Carbon", "Studies incidents and drafts new checks", ("json",)),
)
ROLE_IDS = tuple(r.id for r in ROLES)

ROUTER = "openrouter/free"  # OpenRouter's own router across free models: the last resort for every job

# Free OpenRouter models per job, best first. Measured with a real key (see docs/models.md):
#  - nemotron-3.5-super-vl: reads the photo and flags the instruction, calls tools, returns JSON, in 1-3 s
#  - particle-1: the only free model that passed the real firewall prompt (blocked the poisoned listing,
#    approved the clean one); also reads photos
#  - nemotron-3-ultra: the strongest text model, clear plain-language explanations
#  - nemotron-3-nano-omni: the only free model that accepts audio
OPENROUTER_CHAINS: dict[str, tuple[str, ...]] = {
    "shopper": ("nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
                "google/gemma-4-31b-it:free", "nvidia/nemotron-3-ultra-550b-a55b:free", ROUTER),
    "perception": ("nvidia/nemotron-3.5-super-vl:free", "particle-ai/particle-1:free",
                   "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "google/gemma-4-31b-it:free", ROUTER),
    "listener": ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",),
    "firewall": ("particle-ai/particle-1:free", "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free",
                 "inclusionai/ling-3.2-flash:free", "nvidia/nemotron-3.5-super-vl:free", ROUTER),
    "defender": ("nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3.5-super-vl:free",
                 "baidu/ernie-5.5-flash-preview:free", ROUTER),
    "carbon": ("nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3.5-super-vl:free",
               "baidu/ernie-5.5-flash-preview:free", ROUTER),
}

# Gemini: the hackathon models (overridable with MODEL_* in .env, see config.py).
GEMINI_MODELS: dict[str, str] = {
    "shopper": config.MODELS["victim"],
    "perception": config.MODELS["perception"],
    "listener": config.MODELS["perception"],
    "firewall": config.MODELS["firewall"],
    "defender": config.MODELS["defender"],
    "carbon": config.MODELS["redteam"],
}

log = logging.getLogger(__name__)
_SETTINGS_FILE = paths.STATE / "llm_settings.json"
_lock = threading.Lock()
_state: dict | None = None
_keys: dict[str, str | None] = {"gemini": config.GEMINI_API_KEY, "openrouter": config.OPENROUTER_API_KEY}


def _load() -> dict:
    global _state
    if _state is None:
        provider = config.LLM_PROVIDER if config.LLM_PROVIDER in PROVIDERS else "openrouter"
        try:
            saved = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
            if saved.get("provider") in PROVIDERS:
                provider = saved["provider"]
        except (OSError, ValueError):
            pass
        _state = {"provider": provider}
    return _state


def _save(state: dict) -> None:
    paths.ensure(_SETTINGS_FILE.parent)
    tmp = _SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(_SETTINGS_FILE)


REST_S = 180.0  # how long OpenRouter rests after every free model failed (rate limits reset within minutes)
_rest_until = 0.0


def chosen() -> str:
    """The provider picked on the Models page."""
    return _load()["provider"]


def provider() -> str:
    """The provider the agents use right now: the chosen one, except that while every free OpenRouter model is
    rate limited (or down) the jobs run on Gemini, if a Gemini key is set, until OpenRouter has rested. Paid
    OpenRouter models are never used."""
    picked = chosen()
    if picked == "openrouter" and resting() and _keys.get("gemini"):
        return "gemini"
    return picked


def resting() -> bool:
    return time.monotonic() < _rest_until


def rest_openrouter(seconds: float = REST_S) -> bool:
    """Every free OpenRouter model failed: run on Gemini for a while. Returns whether there is a Gemini to use."""
    global _rest_until
    if not _keys.get("gemini"):
        return False
    _rest_until = time.monotonic() + seconds
    log.warning("every free OpenRouter model failed; using Gemini for the next %d s", int(seconds))
    return True


def models_for(role: str, provider_name: str | None = None) -> tuple[str, ...]:
    """The models for a job on a provider, best first. Gemini has one; OpenRouter an ordered list of free ones."""
    if role not in ROLE_IDS:
        raise KeyError(role)
    if (provider_name or provider()) == "openrouter":
        return OPENROUTER_CHAINS[role]
    return (GEMINI_MODELS[role],)


def model_for(role: str, provider_name: str | None = None) -> str:
    """The first-choice model for a job."""
    return models_for(role, provider_name)[0]


def api_key(provider_name: str | None = None) -> str | None:
    return _keys.get(provider_name or provider()) or None


def snapshot() -> dict:
    """What the Models page shows (read-only). Keys are reported as set/unset only, never echoed."""
    return {
        "provider": chosen(),
        "active": provider(),
        "providers": list(PROVIDERS),
        "roles": [{"id": r.id, "name": r.name, "label": r.label, "needs": list(r.needs),
                   "models": {p: list(models_for(r.id, p)) for p in PROVIDERS}} for r in ROLES],
        "keys": {p: bool(_keys.get(p)) for p in PROVIDERS},
    }


def update(provider_name: str) -> dict:
    """Switch the provider. (Models are fixed; there is nothing else to change.)"""
    if provider_name not in PROVIDERS:
        raise ValueError(f"provider must be one of {PROVIDERS}")
    with _lock:
        state = _load()
        state["provider"] = provider_name
        _save(state)
    return snapshot()


def set_key(provider_name: str, key: str, persist: bool = False) -> None:
    """Use `key` for this process; with persist, also write it to backend/.env."""
    if provider_name not in PROVIDERS:
        raise ValueError(f"provider must be one of {PROVIDERS}")
    key = key.strip()
    if not key or len(key) > 400 or any(c.isspace() for c in key):
        raise ValueError("that does not look like an API key")
    with _lock:
        _keys[provider_name] = key
        name = "GEMINI_API_KEY" if provider_name == "gemini" else "OPENROUTER_API_KEY"
        setattr(config, name, key)
        if provider_name == "gemini":  # the shared google-genai clients hold the old key
            from app import gemini

            gemini._client = None
            gemini._beta_client = None
        if persist:
            _write_env(name, key)


def _write_env(name: str, value: str) -> None:
    env = paths.ENV_FILE
    lines = env.read_text(encoding="utf-8").splitlines() if env.is_file() else []
    lines = [l for l in lines if not l.startswith(f"{name}=")] + [f"{name}={value}"]
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _reset_for_tests(state: dict | None = None) -> None:
    global _state, _rest_until
    _state = state
    _rest_until = 0.0
