"""Which provider and model runs each agent role. Changed at runtime from the Settings page.

Roles (the names the team used during the hackathon in brackets):
    shopper     (Hydrogen)  the autonomous shopping agent: tool calling + photos
    perception  (Argon)     reads listing photos, video frames and text into Claims
    listener    (Argon)     transcribes audio and video voice-overs
    firewall    (Decisions) scores every money-moving call against the probe rules
    defender    (Neon)      writes the "why is this fraud" explanation
    carbon      (Carbon)    self-healing: studies incidents, drafts new checks

The provider choice and model ids are saved to data/state/llm_settings.json (no secrets).
API keys come from backend/.env; the Settings page can set them for the running process and,
if asked, write them to backend/.env (which git ignores).
"""
from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass

from app import config, paths

PROVIDERS = ("gemini", "openrouter")


@dataclass(frozen=True)
class Role:
    id: str
    name: str
    label: str
    needs: tuple[str, ...]  # capabilities a good model for this role should have


ROLES: tuple[Role, ...] = (
    Role("shopper", "Hydrogen", "Autonomous shopping agent: searches, reads listings, builds carts", ("tools", "image")),
    Role("perception", "Argon", "Reads listing photos, video frames and descriptions", ("image",)),
    Role("listener", "Argon (audio)", "Transcribes audio clips and video voice-overs", ("audio",)),
    Role("firewall", "Firewall", "Scores each cart against the probe rules before money moves", ("json",)),
    Role("defender", "Neon", "Explains a block in plain words and finds a safe swap", ()),
    Role("carbon", "Carbon", "Self-healing: studies incidents and drafts new checks", ("json",)),
)
ROLE_IDS = tuple(r.id for r in ROLES)

# One equivalent model per role and provider. Gemini ids are the hackathon models (overridable
# with MODEL_* in .env); OpenRouter ids are free models that cover the same capabilities.
DEFAULTS: dict[str, dict[str, str]] = {
    "gemini": {
        "shopper": config.MODELS["victim"],
        "perception": config.MODELS["perception"],
        "listener": config.MODELS["perception"],
        "firewall": config.MODELS["firewall"],
        "defender": config.MODELS["defender"],
        "carbon": config.MODELS["redteam"],
    },
    "openrouter": {
        "shopper": "google/gemma-4-31b-it:free",
        "perception": "google/gemma-4-31b-it:free",
        "listener": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "firewall": "google/gemma-4-26b-a4b-it:free",
        "defender": "google/gemma-4-26b-a4b-it:free",
        "carbon": "google/gemma-4-31b-it:free",
    },
}

_SETTINGS_FILE = paths.STATE / "llm_settings.json"
_MODEL_ID = re.compile(r"^[A-Za-z0-9._:/@+-]{1,120}$")
_lock = threading.Lock()
_state: dict | None = None
_keys: dict[str, str | None] = {"gemini": config.GEMINI_API_KEY, "openrouter": config.OPENROUTER_API_KEY}


def _env_defaults() -> dict:
    models = {p: dict(m) for p, m in DEFAULTS.items()}
    import os

    for role in ROLE_IDS:  # OPENROUTER_MODEL_SHOPPER=... etc.
        env = os.getenv(f"OPENROUTER_MODEL_{role.upper()}")
        if env:
            models["openrouter"][role] = env
    provider = config.LLM_PROVIDER if config.LLM_PROVIDER in PROVIDERS else "openrouter"
    return {"provider": provider, "models": models}


def _load() -> dict:
    global _state
    if _state is None:
        state = _env_defaults()
        try:
            saved = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
            if saved.get("provider") in PROVIDERS:
                state["provider"] = saved["provider"]
            for provider, models in (saved.get("models") or {}).items():
                if provider in PROVIDERS and isinstance(models, dict):
                    for role, model in models.items():
                        if role in ROLE_IDS and isinstance(model, str) and _MODEL_ID.fullmatch(model):
                            state["models"][provider][role] = model
        except (OSError, ValueError):
            pass
        _state = state
    return _state


def _save(state: dict) -> None:
    paths.ensure(_SETTINGS_FILE.parent)
    tmp = _SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(_SETTINGS_FILE)


def provider() -> str:
    return _load()["provider"]


def model_for(role: str, provider_name: str | None = None) -> str:
    state = _load()
    return state["models"][provider_name or state["provider"]][role]


def api_key(provider_name: str | None = None) -> str | None:
    return _keys.get(provider_name or provider()) or None


def snapshot() -> dict:
    """What the Settings page shows. Keys are reported as set/unset only, never echoed."""
    state = _load()
    return {
        "provider": state["provider"],
        "providers": list(PROVIDERS),
        "models": {p: dict(m) for p, m in state["models"].items()},
        "defaults": {p: dict(m) for p, m in DEFAULTS.items()},
        "roles": [{"id": r.id, "name": r.name, "label": r.label, "needs": list(r.needs)} for r in ROLES],
        "keys": {p: bool(_keys.get(p)) for p in PROVIDERS},
    }


def update(provider_name: str | None = None, models: dict | None = None) -> dict:
    with _lock:
        state = _load()
        if provider_name is not None:
            if provider_name not in PROVIDERS:
                raise ValueError(f"provider must be one of {PROVIDERS}")
            state["provider"] = provider_name
        for prov, roles in (models or {}).items():
            if prov not in PROVIDERS or not isinstance(roles, dict):
                raise ValueError(f"unknown provider {prov!r}")
            for role, model in roles.items():
                if role not in ROLE_IDS:
                    raise ValueError(f"unknown role {role!r}")
                if not isinstance(model, str) or not _MODEL_ID.fullmatch(model):
                    raise ValueError(f"invalid model id for {role}")
                state["models"][prov][role] = model
        _save(state)
    return snapshot()


def reset(provider_name: str) -> dict:
    with _lock:
        state = _load()
        state["models"][provider_name] = dict(DEFAULTS[provider_name])
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
    global _state
    _state = state
