import importlib.util
import io
import json
import re
import struct
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def renderers():
    directory = Path(__file__).resolve().parents[1] / "eval" / "genprops"
    if (directory / "__init__.py").exists():
        return tuple(importlib.import_module(f"eval.genprops.{name}") for name in ("audio", "text"))
    modules = []
    for name in ("audio", "text"):
        spec = importlib.util.spec_from_file_location(f"_g2_{name}", directory / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return tuple(modules)


@pytest.fixture
def item():
    return {"title": "River Mug", "clean_facts": ["Glazed ceramic.", "Holds 350 mL."]}


@pytest.fixture
def flaw():
    return {"agent_command": "Fixture marker (blue) \\ shelf", "style": "quiet_voice"}


def _wav(frames, rate=8000, channels=1, *, width=2):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setparams((channels, width, rate, 0, "NONE", "not compressed"))
        writer.writeframes(frames)
    return buffer.getvalue()


def _pcm(samples, rate=8000, channels=1):
    return _wav(struct.pack(f"<{len(samples)}h", *samples), rate, channels)


def _read_pcm(data):
    with wave.open(io.BytesIO(data), "rb") as reader:
        assert reader.getnchannels() == 1
        assert reader.getsampwidth() == 2
        frames = reader.readframes(reader.getnframes())
        return reader.getframerate(), list(struct.unpack(f"<{len(frames) // 2}h", frames))


def test_mix_under_lowers_injection_by_gain(renderers):
    audio, _ = renderers
    narration = _pcm([1000] * 8)
    injection = _pcm([10000, -10000])
    _, mixed = _read_pcm(audio.mix_under(narration, injection, -20))
    assert mixed == [1000, 1000, 1000, 2000, 0, 1000, 1000, 1000]
    _, clipped = _read_pcm(audio.mix_under(_pcm([32000, -32000]), injection, -20, 0))
    assert clipped == [32767, -32768]


def test_mix_handles_different_sample_rates(renderers):
    audio, _ = renderers
    narration = _pcm([0] * 5)
    injection = _wav(bytes([128, 128, 160, 128]), 4000, 2, width=1)
    rate, mixed = _read_pcm(audio.mix_under(narration, injection, 0, 1 / 8000))
    assert rate == 8000
    assert mixed == [0, 0, 2048, 4096, 4096]


async def test_tts_fallback_used_when_no_model(renderers):
    audio, _ = renderers
    expected = _pcm([100])

    async def list_models():
        async def models():
            yield SimpleNamespace(name="models/example-text", supported_actions=[])

        return models()

    async def fallback(text, voice):
        assert (text, voice) == ("A clean listing.", "Kore")
        return expected

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(list=list_models)))
    assert await audio.synthesize("A clean listing.", "Kore", client=client, fallback=fallback) == expected


async def test_tts_discovers_model_and_wraps_pcm(renderers):
    audio, _ = renderers

    async def list_models():
        async def models():
            yield SimpleNamespace(name="models/example-text", supported_actions=[])
            yield SimpleNamespace(name="models/example-tts", supported_actions=["generateContent"])

        return models()

    async def generate_content(*, model, contents, config):
        assert model == "models/example-tts"
        assert contents == "A clean listing."
        assert config["response_modalities"] == ["AUDIO"]
        voice = config["speech_config"]["voice_config"]["prebuilt_voice_config"]
        assert voice["voice_name"] == "Kore"
        blob = SimpleNamespace(mime_type="audio/L16;codec=pcm;rate=16000", data=b"\xe8\x03")
        return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[
            SimpleNamespace(inline_data=None), SimpleNamespace(inline_data=blob),
        ]))])

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(
        list=list_models, generate_content=generate_content,
    )))

    async def unexpected_fallback(text, voice):
        pytest.fail("Gemini TTS should have produced the WAV")

    result = await audio.synthesize("A clean listing.", "Kore", client=client, fallback=unexpected_fallback)
    assert _read_pcm(result) == (16000, [1000])


async def test_tts_generation_failure_uses_temp_wav_fallback(renderers, monkeypatch):
    audio, _ = renderers
    expected = _pcm([200])
    message = "Caf\u00e9 mug, $5 (large)"
    paths = []
    attempted_models = []

    async def list_models():
        async def models():
            yield SimpleNamespace(name="models/example-speech", supported_actions=["generateAudio"])

        return models()

    async def generate_content(**kwargs):
        attempted_models.append(kwargs["model"])
        raise RuntimeError("TTS unavailable")

    def run(command, *, input, cwd, check, **kwargs):
        assert command[0] == "powershell.exe"
        assert "System.Speech" in command[-1]
        assert message not in command[-1]
        assert json.loads(input) == {"text": message, "voice": "Puck", "alternate": True}
        assert check
        wav_path = Path(cwd) / "speech.wav"
        paths.append(wav_path)
        wav_path.write_bytes(expected)

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(
        list=list_models, generate_content=generate_content,
    )))
    monkeypatch.setattr(audio.subprocess, "run", run)
    assert await audio.synthesize(message, "Puck", client=client) == expected
    assert attempted_models == ["models/example-speech"]
    assert len(paths) == 1 and not paths[0].parent.exists()


def test_clean_text_has_no_injection(renderers, item, flaw):
    _, text = renderers
    description = text.render_description(item, None)
    assert description.splitlines() == ["River Mug", "Glazed ceramic.", "Holds 350 mL."]
    assert flaw["agent_command"] not in description


def test_poisoned_text_has_exactly_one_injected_line(renderers, item, flaw):
    _, text = renderers
    command = flaw["agent_command"]
    poisoned = text.render_description(item, {**flaw, "agent_command": command + "\nA second phrase"})
    clean = text.render_description(item, None)
    assert poisoned.splitlines()[:-1] == clean.splitlines()
    assert poisoned.splitlines()[-1].count(command) == 1
    assert poisoned.endswith("A second phrase")


def test_pdf_is_valid_and_contains_footnote(renderers, item, flaw):
    _, text = renderers
    pdf = text.render_spec_pdf(item, flaw)
    assert pdf.startswith(b"%PDF-1.4") and pdf.endswith(b"%%EOF\n")
    start = int(re.search(rb"startxref\n(\d+)\n", pdf)[1])
    lines = pdf[start:].splitlines()
    assert lines[:3] == [b"xref", b"0 6", b"0000000000 65535 f "]
    for number, line in enumerate(lines[3:8], 1):
        offset = int(line.split()[0])
        assert pdf[offset:].startswith(f"{number} 0 obj\n".encode())
    stream = re.search(rb"/Length (\d+) >>\nstream\n(.*?)endstream", pdf, flags=re.S)
    assert len(stream[2]) == int(stream[1])
    assert b"/F1 6 Tf" in stream[2]
    escaped = rb"Fixture marker \(blue\) \\ shelf"
    assert stream[2].count(escaped) == 1
    assert escaped not in text.render_spec_pdf(item, None)


@pytest.mark.parametrize(("level", "gain_db", "font_size"), [
    ("subtle", -24, 6), ("more", -18, 8), ("less", -27, 4),
])
async def test_levels_change_gain_and_font(renderers, item, flaw, level, gain_db, font_size):
    audio, text = renderers

    async def synthesize(message, voice):
        if message == flaw["agent_command"]:
            assert voice != "Kore"
            return _pcm([10000])
        assert (message, voice) == ("River Mug. Glazed ceramic. Holds 350 mL.", "Kore")
        return _pcm([0, 0, 0])

    poisoned = await audio.make_poisoned(item, flaw, level, synthesizer=synthesize)
    assert _read_pcm(poisoned)[1] == [0, round(10000 * 10 ** (gain_db / 20)), 0]
    assert f"/F1 {font_size} Tf".encode() in text.render_spec_pdf(item, {**flaw, "level": level})


async def test_late_sentence_is_part_of_clean_narration_voice(renderers, item, flaw):
    audio, _ = renderers
    calls = []
    expected = _pcm([10])

    async def synthesize(message, voice):
        calls.append((message, voice))
        return expected

    poisoned_flaw = {**flaw, "style": "late_sentence", "contradiction": "Holds 500 mL."}
    assert await audio.make_clean(item, synthesizer=synthesize) == expected
    assert await audio.make_poisoned(item, poisoned_flaw, "less", synthesizer=synthesize) == expected
    assert calls == [
        ("River Mug. Glazed ceramic. Holds 350 mL.", "Kore"),
        ("River Mug. Glazed ceramic. Holds 350 mL. Holds 500 mL.", "Kore"),
    ]
