"""Firewall image settings: resolution + downscale of the long side (backend/gemini.py)."""
import base64
import io

from PIL import Image

from backend import config, gemini
from backend.schemas import Media


def _img(tmp_path, w, h, name="x.png"):
    p = tmp_path / name
    Image.new("RGB", (w, h), (200, 30, 30)).save(p)
    return Media(kind="image", path=str(p), mime="image/png")


def _size(block):
    return Image.open(io.BytesIO(base64.b64decode(block["data"]))).size


def test_large_image_downscaled_to_max_px_as_jpeg(tmp_path):
    b = gemini.content_blocks([_img(tmp_path, 2400, 1800)], resolution="high", max_px=1024)[0]
    assert _size(b) == (1024, 768) and b["mime_type"] == "image/jpeg" and b["resolution"] == "high"


def test_small_image_sent_unchanged(tmp_path):
    m = _img(tmp_path, 800, 600)
    b = gemini.content_blocks([m], max_px=1024)[0]
    assert base64.b64decode(b["data"]) == (tmp_path / "x.png").read_bytes() and b["mime_type"] == "image/png"


def test_max_px_zero_never_downscales(tmp_path):
    b = gemini.content_blocks([_img(tmp_path, 2400, 1800)], max_px=0)[0]
    assert _size(b) == (2400, 1800) and b["resolution"] == "ultra_high"


def test_undecodable_image_sent_as_is(tmp_path):
    p = tmp_path / "fake.png"
    p.write_bytes(b"\x89PNG fake")
    b = gemini.content_blocks([Media(kind="image", path=str(p), mime="image/png")], max_px=1024)[0]
    assert base64.b64decode(b["data"]) == b"\x89PNG fake"


def test_firewall_blocks_use_config(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "FIREWALL_IMAGE_RESOLUTION", "high")
    monkeypatch.setattr(config, "FIREWALL_IMAGE_MAX_PX", 512)
    b = gemini.firewall_content_blocks([_img(tmp_path, 2000, 1000)])[0]
    assert _size(b) == (512, 256) and b["resolution"] == "high"


def test_defaults_are_high_1024():
    assert config.FIREWALL_IMAGE_RESOLUTION == "high" and config.FIREWALL_IMAGE_MAX_PX == 1024
