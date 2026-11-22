"""One genai client per process, Decisions warm-up on startup, FIREWALL_TIMEOUT_MS env var."""
import asyncio
import importlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import config, gemini
from app import firewall_decisions as fw
from app.schemas import Intent, ToolCall
from app.rules import RuleSet


# --- clients are created once per process ---

def test_clients_created_once(monkeypatch):
    made = []

    class FakeGenai:
        @staticmethod
        def Client(**kw):
            made.append(kw)
            return SimpleNamespace(kw=kw)

    import google
    monkeypatch.setattr(google, "genai", FakeGenai, raising=False)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini, "_client", None)
    monkeypatch.setattr(gemini, "_beta_client", None)
    for _ in range(5):
        assert gemini.client() is gemini.client()
        assert gemini.beta_client() is gemini.beta_client()
    assert len(made) == 2
    assert made[1]["http_options"] == {"api_version": "v1beta"}


async def test_decide_reuses_one_beta_client(monkeypatch):
    seen = []

    class Decisions:
        async def create(self, **kw):
            raise RuntimeError("stop")

    client = SimpleNamespace(aio=SimpleNamespace(decisions=Decisions()))

    def beta():
        seen.append(client)
        return client

    monkeypatch.setattr(config, "FIREWALL_BACKEND", "decisions")
    monkeypatch.setattr(gemini, "beta_client", beta)
    rules = RuleSet(version=1, probes=[])
    for _ in range(3):
        await fw.decide(Intent(text="x", budget=None), [], None, ToolCall(name="create_cart", arguments={}),
                        None, rules, 1.0)
    assert len(seen) == 3 and all(c is client for c in seen)


# --- warm-up ---

async def test_warm_up_makes_one_tiny_call(monkeypatch):
    sent = []

    async def fake(request, timeout_s):
        sent.append((request, timeout_s))
        return {"answers": {"warm_up": {"type": "noul", "noul": 0.5, "confidence": 0.5}}}

    monkeypatch.setattr(config, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(config, "FIREWALL_BACKEND", "decisions")
    monkeypatch.setattr(fw, "_call_decisions", fake)
    ms = await fw.warm_up()
    assert isinstance(ms, int) and ms >= 0
    (req, timeout_s), = sent
    assert list(req["questions"]) == ["warm_up"] and timeout_s > config.THRESHOLDS["firewall_timeout_ms"] / 1000


async def test_warm_up_failure_is_logged_not_raised(monkeypatch, caplog):
    async def boom(request, timeout_s):
        raise RuntimeError("403 not allowed")

    monkeypatch.setattr(config, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(config, "FIREWALL_BACKEND", "decisions")
    monkeypatch.setattr(fw, "_call_decisions", boom)
    assert await fw.warm_up() is None
    assert "403 not allowed" in caplog.text


@pytest.mark.parametrize("key,backend", [(None, "decisions"), ("k", "json_llm")])
async def test_warm_up_skipped(monkeypatch, key, backend):
    async def fail(request, timeout_s):
        raise AssertionError("must not call")

    monkeypatch.setattr(config, "GEMINI_API_KEY", key)
    monkeypatch.setattr(config, "FIREWALL_BACKEND", backend)
    monkeypatch.setattr(fw, "_call_decisions", fail)
    assert await fw.warm_up() is None


def test_startup_fires_warm_up_in_background(monkeypatch):
    import app.main as main
    calls = []

    async def fake_warm_up():
        calls.append(1)
        await asyncio.sleep(0)

    monkeypatch.setattr(main, "warm_up", fake_warm_up)
    with TestClient(main.app) as c:  # the context manager runs startup
        assert c.get("/health").json()["ok"] is True
    assert calls == [1]


# --- FIREWALL_TIMEOUT_MS ---

def test_firewall_timeout_from_env(monkeypatch):
    try:
        monkeypatch.setenv("FIREWALL_TIMEOUT_MS", "3000")
        assert importlib.reload(config).THRESHOLDS["firewall_timeout_ms"] == 3000
        monkeypatch.delenv("FIREWALL_TIMEOUT_MS")
        assert importlib.reload(config).THRESHOLDS["firewall_timeout_ms"] == 2500  # default
    finally:
        monkeypatch.delenv("FIREWALL_TIMEOUT_MS", raising=False)
        importlib.reload(config)
