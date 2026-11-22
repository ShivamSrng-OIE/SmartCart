import io
import shutil
import struct
import wave

import httpx
import pytest

from app import media_prep
from app.main import app

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None and not media_prep.WINDOWS_FFMPEG.is_file(),
                                  reason="ffmpeg not installed")


def wav_bytes() -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        w.writeframes(b"".join(struct.pack("<h", (i % 50) * 300) for i in range(4000)))
    return out.getvalue()


async def test_wav_is_left_alone(tmp_path):
    p = tmp_path / "a.wav"
    p.write_bytes(wav_bytes())
    assert await media_prep.to_wav(p) == p


async def test_unconvertible_audio_keeps_original(tmp_path):
    p = tmp_path / "broken.webm"
    p.write_bytes(b"not audio at all")
    assert await media_prep.to_wav(p) == p
    assert not list(tmp_path.glob("*_pcm.wav"))


@needs_ffmpeg
async def test_non_wav_audio_becomes_pcm_wav(tmp_path):
    import asyncio

    src = tmp_path / "a.wav"
    src.write_bytes(wav_bytes())
    flac = tmp_path / "clip.flac"
    proc = await asyncio.create_subprocess_exec(media_prep.ffmpeg_path(), "-y", "-loglevel", "error", "-i", str(src), str(flac))
    await proc.wait()
    out = await media_prep.to_wav(flac)
    assert out != flac and media_prep.is_pcm_wav(out)


async def test_upload_saves_pdf_and_converts_audio(tmp_path, monkeypatch):
    monkeypatch.setattr("app.main.RUNS_DIR", tmp_path)
    seen = {}

    async def capture(intent, media, product_ref, bus, run_id):
        seen["media"] = {m.kind: m for m in media}

    real = app.state.pipelines
    app.state.pipelines = {"victim": capture, "guarded": capture}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post("/api/run", data={"request": "buy one", "mode": "victim"}, files={
                "pdf": ("spec.pdf", b"%PDF-1.4 fake", "application/octet-stream"),
                "audio": ("clip.wav", wav_bytes(), "audio/wav"),
            })
        await app.state.bus.wait_done(r.json()["run_id"])
    finally:
        app.state.pipelines = real
    assert seen["media"]["pdf"].mime == "application/pdf"
    assert seen["media"]["audio"].mime == "audio/wav"
