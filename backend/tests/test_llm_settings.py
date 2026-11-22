"""Provider/model settings: defaults per role, saved choices, keys never echoed."""
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


def test_every_role_has_a_default_model_for_both_providers():
    for provider in settings.PROVIDERS:
        assert set(settings.DEFAULTS[provider]) == set(settings.ROLE_IDS)


def test_openrouter_defaults_are_free_models():
    assert all(m.endswith(":free") or m == "openrouter/free" for m in settings.DEFAULTS["openrouter"].values())


def test_update_switches_provider_and_model_and_persists(tmp_path):
    snap = settings.update("openrouter", {"openrouter": {"shopper": "google/gemma-4-26b-a4b-it:free"}})
    assert snap["provider"] == "openrouter" and settings.model_for("shopper") == "google/gemma-4-26b-a4b-it:free"
    saved = json.loads((tmp_path / "llm_settings.json").read_text())
    assert saved["provider"] == "openrouter" and "key" not in json.dumps(saved).lower()
    settings._reset_for_tests(None)  # a fresh process reads the same choice
    assert settings.model_for("shopper") == "google/gemma-4-26b-a4b-it:free"


@pytest.mark.parametrize("bad", [
    {"provider_name": "claude"},
    {"models": {"openrouter": {"nonsense": "x"}}},
    {"models": {"openrouter": {"shopper": "bad model id!"}}},
])
def test_update_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        settings.update(**bad)


def test_keys_are_reported_as_set_or_not_never_echoed(monkeypatch):
    monkeypatch.setitem(settings._keys, "openrouter", None)
    assert settings.snapshot()["keys"]["openrouter"] is False
    settings.set_key("openrouter", "sk-or-v1-secret", persist=True)
    snap = settings.snapshot()
    assert snap["keys"]["openrouter"] is True and "secret" not in json.dumps(snap)
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
