import asyncio
import io
import json
import struct
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from PIL import Image

from backend import config, defender_neon, gemini
from backend.main import app
from backend.schemas import Media
from tests.test_defender import FakeShop, block_context


@pytest.fixture
def ev(monkeypatch, tmp_path):
    from backend import evidence

    monkeypatch.setattr(evidence, "EVIDENCE_DIR", tmp_path / "evidence")
    return evidence


@pytest.fixture
def model(monkeypatch):
    def install(*answers):
        create = AsyncMock(side_effect=[
            answer if isinstance(answer, Exception) else SimpleNamespace(output_text=json.dumps(answer))
            for answer in answers
        ])
        client = SimpleNamespace(aio=SimpleNamespace(interactions=SimpleNamespace(create=create)))
        monkeypatch.setattr(gemini, "client", lambda: client)
        return create

    return install


def picture(tmp_path):
    path = tmp_path / "photo.png"
    # A different color in each vertical third catches transposed or misplaced crops.
    image = Image.new("RGB", (300, 100), "white")
    image.paste("black", (100, 0, 200, 100))
    image.save(path)
    return Media(kind="image", path=str(path), mime="image/png")


@pytest.fixture
async def http():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_image_crop_and_route(ev, tmp_path, model, http):
    answer = {"modality": "image", "box": [200, 400, 600, 600], "text": "sample note"}
    create = model(answer)
    item, = await ev.locate([picture(tmp_path)], None, "run-1")
    assert item["box"] == answer["box"] and item["text"] == "sample note"
    assert item["crop_url"] == "/api/evidence/run-1/crop_0.jpg"
    response = await http.get(item["crop_url"])
    assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(response.content)) as crop:
        assert crop.size == (78, 52)  # 60x40 plus 15% on each edge
        assert crop.getextrema() == ((0, 0), (0, 0), (0, 0))
    request = create.await_args.kwargs
    assert request["model"] == config.MODELS["perception"] and "tools" not in request
    assert request["response_format"]["schema"] and request["input"][0]["type"] == "image"


async def test_video_seeks_to_time_and_serves_frame(ev, tmp_path, model, http, monkeypatch):
    path = tmp_path / "movie.mp4"
    path.write_bytes(b"fixture video bytes")
    jpeg = io.BytesIO()
    Image.new("RGB", (16, 8)).save(jpeg, "JPEG")
    process = SimpleNamespace(returncode=0, communicate=AsyncMock(return_value=(jpeg.getvalue(), None)))
    spawn = AsyncMock(return_value=process)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    model({"modality": "video", "box": [0, 100, 300, 900], "t_s": 1.75, "text": "sample caption"})
    item, = await ev.locate([Media(kind="video", path=str(path), mime="video/mp4")], None, "vid")
    args = spawn.await_args.args
    assert "ffmpeg" in str(args[0]).lower()
    assert float(args[args.index("-ss") + 1]) == item["t_s"] == 1.75
    assert item["box"] == [0, 100, 300, 900] and item["frame_url"] == "/api/evidence/vid/frame_0.jpg"
    assert (await http.get(item["frame_url"])).content == jpeg.getvalue()


async def test_audio_segment_and_whole_recording_waveform(ev, tmp_path, model, http):
    source = tmp_path / "voice.wav"
    samples = [0] * 50 + [-2000] * 100 + [1000] * 50
    with wave.open(str(source), "wb") as wav:
        wav.setparams((2, 2, 100, 0, "NONE", "not compressed"))
        wav.writeframes(b"".join(struct.pack("<hh", 0, sample) for sample in samples))
    model({"modality": "audio", "start_s": 0.5, "end_s": 1.5, "transcript": "sample speech"})
    item, = await ev.locate([Media(kind="audio", path=str(source), mime="audio/wav")], None, "voice")
    assert item["peaks"] == [0.0] * 50 + [1.0] * 100 + [0.5] * 50
    assert item["segment"] == [50, 150] and item["transcript"] == "sample speech"
    assert item["clip_url"] == "/api/evidence/voice/clip_0.wav"
    with wave.open(io.BytesIO((await http.get(item["clip_url"])).content)) as wav:
        assert (wav.getnchannels(), wav.getframerate(), wav.getnframes()) == (2, 100, 100)
        assert wav.readframes(100) == struct.pack("<hh", 0, -2000) * 100


@pytest.mark.parametrize("answer", [
    RuntimeError("unavailable"),
    {"modality": "image", "box": [100, 0, 50, 10], "text": "inverted"},
])
async def test_failure_discards_batch(ev, tmp_path, model, answer):
    source = picture(tmp_path)
    model({"modality": "image", "box": [0, 0, 500, 500], "text": "sample"}, answer)
    assert await ev.locate([source, source], None, "batch") == []
    assert not list(ev.EVIDENCE_DIR.rglob("*.jpg"))


async def test_no_match_skips_only_that_file(ev, tmp_path, model):
    source = picture(tmp_path)
    create = model(None, {"modality": "image", "box": [0, 0, 500, 500], "text": "sample"})
    items = await ev.locate([source, source], None, "mixed")
    assert create.await_count == 2 and len(items) == 1


async def test_deadline_cancels_model(ev, tmp_path, monkeypatch):
    cancelled = asyncio.Event()

    async def slow(**kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(
        aio=SimpleNamespace(interactions=SimpleNamespace(create=slow))))
    monkeypatch.setattr(ev, "TIMEOUT_S", 0.1)
    assert await asyncio.wait_for(ev.locate([picture(tmp_path)], None, "slow"), timeout=1) == []
    assert cancelled.is_set()


async def test_route_rejects_paths_outside_allowlist(ev, http):
    run = ev.EVIDENCE_DIR / "safe"
    run.mkdir(parents=True)
    (run.parent / "crop_0.jpg").write_bytes(b"private")
    (run / "source.jpg").write_bytes(b"private")
    for path in ["%2e%2e/crop_0.jpg", "safe/%2e%2e%5ccrop_0.jpg", "safe/source.jpg",
                 "bad.id/crop_0.jpg", "missing/clip_0.wav", "safe/%2e%2e%2fcrop_0.jpg"]:
        assert (await http.get("/api/evidence/" + path)).status_code == 404


async def test_on_block_streams_evidence_while_swap_pending(ev, monkeypatch):
    block = block_context(FakeShop([]))
    block.media = [Media(kind="image", path="fixture", mime="image/png")]
    swapping = asyncio.Event()
    release_swap = asyncio.Event()
    items = [{"modality": "image", "crop_url": "/api/evidence/defender-test/crop_0.jpg"}]

    async def locate(media, claims, run_id):
        assert (media, claims, run_id) == (block.media, block.claims, block.run_id)
        await swapping.wait()
        return items

    async def swap(*args, **kwargs):
        swapping.set()
        await release_swap.wait()

    monkeypatch.setattr(ev, "locate", locate)
    monkeypatch.setattr(defender_neon, "safe_swap", swap)
    monkeypatch.setattr(defender_neon, "_neon_reason", AsyncMock(return_value="Explanation"))
    handler = asyncio.create_task(defender_neon.on_block(block))
    stream = block.bus.subscribe(block.run_id)
    try:
        assert (await asyncio.wait_for(anext(stream), 1)).kind == "fraud_card"
        event = await asyncio.wait_for(anext(stream), 1)
        assert (event.pane, event.kind, event.data) == ("guarded", "evidence", {"items": items})
    finally:
        release_swap.set()
        await asyncio.wait_for(handler, 1)
        await stream.aclose()
