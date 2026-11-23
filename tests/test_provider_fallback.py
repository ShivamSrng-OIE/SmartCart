"""When every free OpenRouter model is rate limited, the jobs run on Gemini for a while (if a Gemini key is set).
OpenRouter stays the chosen provider, and no paid OpenRouter model is ever tried."""
import httpx

from app.llm import api, openrouter, settings


def _openrouter_chosen(monkeypatch, gemini_key):
    settings._reset_for_tests({"provider": "openrouter"})
    monkeypatch.setitem(settings._keys, "openrouter", "sk-or-test")
    monkeypatch.setitem(settings._keys, "gemini", gemini_key)


def _all_busy(monkeypatch) -> list[str]:
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        asked.append(json.loads(request.content)["model"])
        return httpx.Response(429, json={"error": {"code": 429, "message": "rate limited"}})

    monkeypatch.setattr(openrouter, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=openrouter.BASE_URL))
    return asked


async def test_busy_free_models_hand_the_job_to_gemini(monkeypatch):
    _openrouter_chosen(monkeypatch, "AIza-test")
    asked = _all_busy(monkeypatch)
    used: list[str] = []

    async def gemini(model, system, parts, *, json_out, timeout):
        used.append(model)
        return '{"ok": true}'

    monkeypatch.setattr(api, "_gemini_generate", gemini)
    data, model = await api.complete_json("firewall", "sys", "question")
    assert data == {"ok": True} and model == settings.model_for("firewall", "gemini") == used[0]
    assert asked and all(openrouter.is_free_model(m) for m in asked)
    assert settings.chosen() == "openrouter" and settings.provider() == "gemini" and settings.snapshot()["active"] == "gemini"


async def test_without_a_gemini_key_the_failure_is_reported(monkeypatch):
    _openrouter_chosen(monkeypatch, None)
    _all_busy(monkeypatch)
    try:
        await api.complete_text("defender", "sys", "hi")
    except openrouter.OpenRouterError:
        pass
    else:
        raise AssertionError("expected the OpenRouter failure")
    assert settings.provider() == "openrouter" and not settings.resting()


def test_openrouter_is_used_again_after_its_rest(monkeypatch):
    _openrouter_chosen(monkeypatch, "AIza-test")
    assert settings.rest_openrouter(seconds=0.0) is True
    assert settings.provider() == "openrouter"


def test_a_rejected_gemini_key_is_never_the_fallback(monkeypatch):
    _openrouter_chosen(monkeypatch, "AIza-revoked")
    settings.note_failure("gemini", RuntimeError("401 UNAUTHENTICATED. API key not valid. Please pass a valid API key."))
    assert settings.rest_openrouter() is False and settings.provider() == "openrouter"
    assert settings.limits()["gemini"] == "limited"


def test_a_key_rejected_mid_rest_hands_back_to_openrouter(monkeypatch):
    _openrouter_chosen(monkeypatch, "AIza-test")
    assert settings.rest_openrouter() is True and settings.provider() == "gemini"
    settings.note_failure("gemini", RuntimeError("403 PERMISSION_DENIED"))
    assert settings.provider() == "openrouter"
