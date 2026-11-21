"""Large PNGs are re-encoded as JPEG before upload (a 1.1 MB PNG cost ~700 ms per firewall call)."""
import io

from PIL import Image

from backend import gemini


def _png(size=(900, 700)) -> bytes:
    import os
    img = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3))  # incompressible, so big
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def test_big_png_becomes_smaller_jpeg_same_pixels():
    data = _png()
    assert len(data) > gemini.SLIM_ABOVE_BYTES
    out, mime = gemini.slim_image(data, "image/png")
    assert mime == "image/jpeg" and Image.open(io.BytesIO(out)).size == (900, 700)


def test_small_png_and_jpeg_untouched():
    small = io.BytesIO()
    Image.new("RGB", (10, 10)).save(small, "PNG")
    assert gemini.slim_image(small.getvalue(), "image/png") == (small.getvalue(), "image/png")
    assert gemini.slim_image(b"x" * 500_000, "image/jpeg") == (b"x" * 500_000, "image/jpeg")


def test_undecodable_png_falls_back_to_original():
    junk = b"not a png" * 50_000
    assert gemini.slim_image(junk, "image/png") == (junk, "image/png")
