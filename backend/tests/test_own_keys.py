"""A visitor can bring their own OpenRouter or Gemini key: it is used for their requests only, never stored or
echoed, and the app reports when the shared keys hit their limits so it can suggest adding one."""
from fastapi.testclient import TestClient

from app.llm import api, settings
from app.main import app

client = TestClient(app)
OR_KEY = "sk-or-v1-visitor-test-key"
GEM_KEY = "AIza-visitor-test-key"


def test_health_reports_the_shared_keys_state_and_whether_this_request_has_its_own(monkeypatch):
    settings._reset_for_tests({"provider": "openrouter"})
    monkeypatch.setitem(settings._keys, "openrouter", "sk-or-v1-shared")
    monkeypatch.setitem(settings._keys, "gemini", "AIza-shared")
    body = client.get("/health").json()
    assert body["own_key"] is None and body["limits"]["state"] == "ok"
    mine = client.get("/health", headers={"X-LLM-Gemini-Key": GEM_KEY}).json()
    assert mine["own_key"] == "gemini" and mine["provider"] == "gemini"
    assert GEM_KEY not in str(mine) and "AIza-shared" not in str(body)


def test_limits_move_from_busy_to_limited():
    settings._reset_for_tests({"provider": "openrouter"})
    settings._keys["openrouter"], settings._keys["gemini"] = "sk-or-v1-shared", "AIza-shared"
    settings.rest_openrouter()
    assert settings.limits()["state"] == "busy"  # Gemini fills in
    settings.note_failure("gemini", RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded"))
    assert settings.limits()["state"] == "limited"


def test_a_visitors_key_wins_for_their_request_only_and_never_rests_the_shared_one(monkeypatch):
    settings._reset_for_tests({"provider": "openrouter"})
    monkeypatch.setitem(settings._keys, "openrouter", "sk-or-v1-shared")
    monkeypatch.setitem(settings._keys, "gemini", "AIza-shared")
    token = settings.USER_KEYS.set({"openrouter": OR_KEY})
    try:
        assert settings.api_key("openrouter") == OR_KEY and settings.provider() == "openrouter"
        assert settings.rest_openrouter() is False and not settings.resting()
        settings.note_failure("gemini", RuntimeError("429"))
    finally:
        settings.USER_KEYS.reset(token)
    assert settings.api_key("openrouter") == "sk-or-v1-shared" and settings.limits()["gemini"] == "ok"


def test_the_preferred_provider_is_used_when_both_keys_are_given():
    token = settings.USER_KEYS.set({"openrouter": OR_KEY, "gemini": GEM_KEY, "prefer": "openrouter"})
    try:
        assert settings.own_key() == "openrouter"
    finally:
        settings.USER_KEYS.reset(token)


def test_malformed_headers_are_ignored():
    body = client.get("/health", headers={"X-LLM-OpenRouter-Key": "short", "X-LLM-Gemini-Key": "has space inside key"}).json()
    assert body["own_key"] is None


def test_checking_a_key_says_what_went_wrong_without_echoing_it(monkeypatch):
    assert client.post("/api/llm/own-key/check").status_code == 422

    async def ok(role, system, prompt, timeout=0):
        assert settings.api_key("openrouter") == OR_KEY
        return "OK", "free/model:free"

    monkeypatch.setattr(api, "complete_text", ok)
    good = client.post("/api/llm/own-key/check", headers={"X-LLM-OpenRouter-Key": OR_KEY}).json()
    assert good == {"ok": True, "provider": "openrouter", "model": "free/model:free", "ms": good["ms"]}

    async def bad(role, system, prompt, timeout=0):
        raise RuntimeError(f"HTTP 401 invalid key {OR_KEY}")

    monkeypatch.setattr(api, "complete_text", bad)
    r = client.post("/api/llm/own-key/check", headers={"X-LLM-OpenRouter-Key": OR_KEY})
    assert r.json()["ok"] is False and r.json()["error"] == "the key was not accepted" and OR_KEY not in r.text
