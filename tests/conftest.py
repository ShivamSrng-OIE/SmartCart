"""Shared test setup: nothing a test does can touch the real runtime state (reputation, listings, keys,
the saved provider choice), and every test starts on the Gemini provider unless it says otherwise."""
import pytest

from app import config, paths
from app.llm import settings
from app.warehouse import catalog


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "STATE", tmp_path / "state")
    monkeypatch.setattr(paths, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(config, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "_SETTINGS_FILE", tmp_path / "llm_settings.json")
    settings._reset_for_tests(None)
    from app.warehouse import reputation

    reputation._cache = None
    reputation._sessions.clear()
    catalog.invalidate()
    yield
    reputation._cache = None
    reputation._sessions.clear()
    settings._reset_for_tests(None)
    catalog.invalidate()


@pytest.fixture
def empty_warehouse(tmp_path, monkeypatch):
    """A warehouse with no seed listings and no merchants (tests then add only what they need)."""
    monkeypatch.setattr(paths, "WAREHOUSE", tmp_path / "empty_warehouse")
    catalog.invalidate()
    yield
    catalog.invalidate()
