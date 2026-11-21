"""Normalize uploaded media before the pipelines see it.

Browsers record microphone clips as webm/ogg and people upload mp3/m4a, but the audio evidence
(waveform + playable clip) reads PCM WAV only, and WAV is the one audio format every Gemini
endpoint accepts. So audio is converted to 16-bit mono WAV once, at upload time. If ffmpeg is
missing or fails, the original file is kept and the run continues without audio evidence.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

log = logging.getLogger(__name__)

WINDOWS_FFMPEG = Path(r"C:\FFmpeg\bin\ffmpeg.exe")
WAV_MIMES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"}


def ffmpeg_path() -> str:
    return str(WINDOWS_FFMPEG) if WINDOWS_FFMPEG.is_file() else (shutil.which("ffmpeg") or "ffmpeg")


def is_pcm_wav(path: Path) -> bool:
    """True when the standard library can read it as WAV (the same reader the evidence code uses)."""
    import wave

    try:
        with wave.open(str(path), "rb"):
            return True
    except (wave.Error, EOFError, OSError):
        return False


async def to_wav(path: Path, rate: int = 16000) -> Path:
    """Return a PCM WAV copy next to `path` (or `path` itself when it already is one / on failure)."""
    if is_pcm_wav(path):
        return path
    target = path.with_name(f"{path.stem}_pcm.wav")
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_path(), "-nostdin", "-loglevel", "error", "-y",
            "-i", str(path.resolve()), "-vn", "-ac", "1", "-ar", str(rate), "-c:a", "pcm_s16le", str(target),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=30)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise
        if proc.returncode == 0 and target.is_file() and is_pcm_wav(target):
            return target
    except Exception as exc:  # noqa: BLE001 - never block a run on conversion
        log.warning("audio conversion skipped: %s", type(exc).__name__)
    target.unlink(missing_ok=True)
    return path
