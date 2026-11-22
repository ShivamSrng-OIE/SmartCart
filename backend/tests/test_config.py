from fastapi.testclient import TestClient

from app import config
from app.main import app


def test_config_defaults():
    assert set(config.MODELS) == {"victim", "perception", "firewall", "defender", "redteam", "imagegen"}
    assert config.THRESHOLDS["approve"] == 0.86
    assert config.THRESHOLDS["probe_default"] == 0.50
    assert config.TIERS == {"low_max": 40, "high_min": 150}
    assert config.FIREWALL_BACKEND in {"decisions", "json_llm"}


def test_health():
    assert TestClient(app).get("/health").json() == {"ok": True}
