"""Provider settings: fixed best-free models per job, ordered fallbacks, only the provider is switchable, keys never echoed."""
import json

import pytest

from app import paths
from app.llm import openrouter, settings


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "_SETTINGS_FILE", tmp_path / "llm_settings.json")
    monkeypatch.setattr(paths, "ENV_FILE", tmp_path / ".env")
    settings._reset_for_tests(None)
    yield
    settings._reset_for_tests(None)


def test_every_job_has_models_on_both_providers():
    for role in settings.ROLE_IDS:
        assert settings.OPENROUTER_CHAINS[role] and role in settings.GEMINI_MODELS


def test_every_openrouter_model_is_free_and_each_chain_ends_at_the_free_router_or_is_audio_only():
    for role, chain in settings.OPENROUTER_CHAINS.items():
        assert all(openrouter.is_free_model(m) for m in chain), role
        assert chain[-1] == settings.ROUTER or role == "listener"
        assert len(set(chain)) == len(chain)  # no model listed twice


def test_the_first_choice_is_the_best_measured_model():
    assert settings.model_for("shopper", "openrouter") == "nvidia/nemotron-3.5-super-vl:free"
    assert settings.model_for("firewall", "openrouter") == "particle-ai/particle-1:free"  # the one that passed the real firewall prompt
    assert settings.models_for("shopper", "openrouter")[0] != settings.models_for("shopper", "openrouter")[-1]


def test_gemini_uses_one_model_per_job():
    assert all(len(settings.models_for(r, "gemini")) == 1 for r in settings.ROLE_IDS)


def test_only_the_provider_can_be_switched_and_it_persists(tmp_path):
    assert settings.update("openrouter")["provider"] == "openrouter"
    assert json.loads((tmp_path / "llm_settings.json").read_text()) == {"provider": "openrouter"}
    settings._reset_for_tests(None)  # a fresh process reads the same choice
    assert settings.provider() == "openrouter"
    with pytest.raises(ValueError):
        settings.update("unknown-provider")
    with pytest.raises(TypeError):
        settings.update("openrouter", {"openrouter": {"shopper": "openai/gpt-4o"}})  # there is no way to choose a model


def test_the_snapshot_is_read_only_and_never_contains_keys(monkeypatch):
    monkeypatch.setitem(settings._keys, "openrouter", "sk-or-v1-secret")
    snap = settings.snapshot()
    assert "secret" not in json.dumps(snap) and snap["keys"]["openrouter"] is True
    shopper = next(r for r in snap["roles"] if r["id"] == "shopper")
    assert shopper["models"]["openrouter"][0].endswith(":free")


def test_keys_are_reported_as_set_or_not_never_echoed(monkeypatch):
    monkeypatch.setitem(settings._keys, "openrouter", None)
    assert settings.snapshot()["keys"]["openrouter"] is False
    settings.set_key("openrouter", "sk-or-v1-secret", persist=True)
    assert settings.snapshot()["keys"]["openrouter"] is True
    assert "OPENROUTER_API_KEY=sk-or-v1-secret" in paths.ENV_FILE.read_text()


def test_set_key_rejects_junk():
    with pytest.raises(ValueError):
        settings.set_key("openrouter", "has spaces")


@pytest.mark.parametrize("text, expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": 1}\n```', {"a": 1}),
    ('Sure! Here you go: {"a": {"b": [1, 2]}} hope that helps', {"a": {"b": [1, 2]}}),
    ('<think>hmm {"x": 0}</think>{"a": 2}', {"a": 2}),
])
def test_extract_json_tolerates_chatter(text, expected):
    assert openrouter.extract_json(text) == expected


def test_extract_json_raises_when_there_is_none():
    with pytest.raises(ValueError):
        openrouter.extract_json("no json here")
