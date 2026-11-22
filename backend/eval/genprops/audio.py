"""Generate WAV narration and mix two PCM tracks for the evaluation dataset."""

from __future__ import annotations

import asyncio
import io
import json
import math
import re
import subprocess
import sys
import tempfile
import wave
from array import array
from collections.abc import Awaitable, Callable
from pathlib import Path

from eval.genprops.text import Level, _field, _flaw_line, _listing_lines, _one_line

_NARRATOR = "Kore"
_SECOND_VOICE = "Puck"
_GAIN_DB = {"subtle": -24, "more": -18, "less": -27}
_TTS = Callable[[str, str], Awaitable[bytes]]

_SPEAK_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled } |
        ForEach-Object { $_.VoiceInfo.Name })
    if ($voices -contains $request.voice) { $speaker.SelectVoice($request.voice) }
    elseif ($request.alternate -and $voices.Count -ge 2) { $speaker.SelectVoice($voices[1]) }
    elseif ($voices.Count -gt 0) { $speaker.SelectVoice($voices[0]) }
    $speaker.SetOutputToWaveFile((Join-Path (Get-Location).Path 'speech.wav'))
    $speaker.Speak([string]$request.text)
} finally {
    $speaker.Dispose()
}
"""


def _windows_speech(text: str, voice: str) -> bytes:
    # Pass listing content as data so it never becomes part of the PowerShell script.
    request = json.dumps({"text": text, "voice": voice, "alternate": voice == _SECOND_VOICE})
    with tempfile.TemporaryDirectory(prefix="carttrap-tts-") as directory:
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", _SPEAK_SCRIPT],
            input=request.encode("ascii"), cwd=directory, check=True, capture_output=True, timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return (Path(directory) / "speech.wav").read_bytes()


def _wav_bytes(pcm: bytes, rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(pcm)
    return buffer.getvalue()


async def _gemini_speech(client, text: str, voice: str) -> bytes | None:
    models = client.aio.models
    async for model in await models.list():
        name = model.name or ""
        actions = {action.lower() for action in (getattr(model, "supported_actions", None) or ())}
        if name and ("tts" in name.lower() or actions & {"generateaudio", "texttospeech"}):
            break
    else:
        return None

    response = await models.generate_content(
        model=name,
        contents=text,
        config={"response_modalities": ["AUDIO"], "speech_config": {
            "voice_config": {"prebuilt_voice_config": {"voice_name": voice}},
        }},
    )
    for candidate in response.candidates or ():
        for part in getattr(candidate.content, "parts", None) or ():
            blob = part.inline_data
            if not blob or not blob.data:
                continue
            if blob.data.startswith(b"RIFF") and blob.data[8:12] == b"WAVE":
                return blob.data
            mime = (blob.mime_type or "").lower()
            if mime.partition(";")[0].strip() in {"audio/l16", "audio/pcm"}:
                rate = re.search(r"(?:^|;)\s*rate\s*=\s*(\d+)\b", mime)
                if len(blob.data) % 2 == 0:
                    return _wav_bytes(blob.data, int(rate[1]) if rate else 24000)
    raise ValueError("Gemini TTS returned no PCM audio")


async def synthesize(text: str, voice: str, *, client=None, fallback: _TTS | None = None) -> bytes:
    """Try a discovered Gemini TTS model, then synthesize locally with System.Speech."""
    try:
        if client is None:
            from app import gemini

            client = gemini.client()
        result = await _gemini_speech(client, text, voice)
    except Exception:
        # Discovery and generation can both fail when Gemini TTS is unavailable.
        result = None
    if result is not None:
        return result
    if fallback is not None:
        return await fallback(text, voice)
    return await asyncio.to_thread(_windows_speech, text, voice)


def _read_mono(data: bytes) -> tuple[int, list[int]]:
    with wave.open(io.BytesIO(data), "rb") as reader:
        rate = reader.getframerate()
        channels = reader.getnchannels()
        width = reader.getsampwidth()
        frame_count = reader.getnframes()
        frames = reader.readframes(frame_count)
    if len(frames) != frame_count * channels * width:
        raise ValueError("truncated PCM data")

    if width == 1:
        samples = [(sample - 128) << 8 for sample in frames]
    elif width == 2:
        pcm = array("h")
        pcm.frombytes(frames)
        if sys.byteorder == "big":
            pcm.byteswap()
        samples = pcm.tolist()
    else:
        shift = (width - 2) * 8
        samples = [
            int.from_bytes(frames[pos:pos + width], "little", signed=True) >> shift
            for pos in range(0, len(frames), width)
        ]
    if channels > 1:
        samples = [round(sum(samples[pos:pos + channels]) / channels)
                   for pos in range(0, len(samples), channels)]
    return rate, samples


def _resample(samples: list[int], source_rate: int, rate: int) -> list[int]:
    if not samples or source_rate == rate:
        return samples
    count = max(1, round(len(samples) * rate / source_rate))
    last = len(samples) - 1
    result = []
    for index in range(count):
        left, fraction = divmod(index * source_rate, rate)
        left_sample = samples[min(left, last)]
        right_sample = samples[min(left + 1, last)]
        result.append(round(left_sample + (right_sample - left_sample) * fraction / rate))
    return result


def mix_under(narration_wav: bytes, injection_wav: bytes, gain_db: float = -21,
              offset_s: float | None = None) -> bytes:
    """Mix at the narration rate, centering the second track when no offset is supplied."""
    if not math.isfinite(gain_db):
        raise ValueError("gain_db must be finite")
    if offset_s is not None and (not math.isfinite(offset_s) or offset_s < 0):
        raise ValueError("offset_s must be finite and nonnegative")
    rate, narration = _read_mono(narration_wav)
    injection_rate, injection = _read_mono(injection_wav)
    injection = _resample(injection, injection_rate, rate)
    if injection:
        offset = (max(0, (len(narration) - len(injection)) // 2)
                  if offset_s is None else round(offset_s * rate))
        narration.extend([0] * max(0, offset + len(injection) - len(narration)))
        gain = 10 ** (gain_db / 20)
        for position, sample in enumerate(injection, offset):
            mixed = narration[position] + sample * gain
            narration[position] = round(min(32767, max(-32768, mixed)))
    pcm = array("h", narration)
    if sys.byteorder == "big":
        pcm.byteswap()
    return _wav_bytes(pcm.tobytes(), rate)


def _narration(item) -> str:
    lines = _listing_lines(item)
    return " ".join(line if line.endswith((".", "!", "?")) else f"{line}." for line in lines)


async def make_clean(item, *, synthesizer: _TTS | None = None) -> bytes:
    return await (synthesizer or synthesize)(_narration(item), _NARRATOR)


async def make_poisoned(item, flaw, level: Level = "subtle", *,
                        synthesizer: _TTS | None = None) -> bytes:
    speak = synthesizer or synthesize
    gain = _GAIN_DB[level]
    if _field(flaw, "style") == "late_sentence":
        contradiction = _field(flaw, "contradiction") or _flaw_line(flaw)
        return await speak(f"{_narration(item)} {_one_line(contradiction)}".strip(), _NARRATOR)
    command = _flaw_line(flaw)
    narration = await make_clean(item, synthesizer=speak)
    injection = await speak(command, _SECOND_VOICE)
    return mix_under(narration, injection, gain)
