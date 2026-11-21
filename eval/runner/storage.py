"""Freeze proof, source revision and durable JSONL checkpoints."""

import hashlib
import json
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def case_dir_hash(directory):
    """SHA-256 over sorted relative paths and bytes, with length framing."""
    directory = Path(directory)
    if not directory.is_dir():
        raise ValueError(f"missing case directory: {directory}")
    digest = hashlib.sha256()
    paths = (p for p in directory.rglob("*") if p.is_file())
    for path in sorted(paths, key=lambda p: p.relative_to(directory).as_posix()):
        name = path.relative_to(directory).as_posix().encode()
        digest.update(len(name).to_bytes(8, "big"))
        digest.update(name)
        with path.open("rb") as source:
            digest.update(os.fstat(source.fileno()).st_size.to_bytes(8, "big"))
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def git_sha(root):
    """Read HEAD without invoking git (including linked worktrees and packed refs)."""
    gitdir = root / ".git"
    if gitdir.is_file():
        gitdir = root / gitdir.read_text().strip().removeprefix("gitdir: ")
    if not (gitdir / "HEAD").is_file():
        return None
    value = (gitdir / "HEAD").read_text().strip()
    if value.startswith("ref: "):
        ref = value[5:]
        common = gitdir / "commondir"
        refs_dir = gitdir / common.read_text().strip() if common.exists() else gitdir
        loose = refs_dir / ref
        if loose.exists():
            value = loose.read_text().strip()
        elif (refs_dir / "packed-refs").exists():
            for line in (refs_dir / "packed-refs").read_text().splitlines():
                sha, _, name = line.partition(" ")
                if name == ref:
                    value = sha
                    break
    return value if re.fullmatch(r"[0-9a-f]{40}([0-9a-f]{24})?", value) else None


def append_record(stream, obj):
    stream.write(json.dumps(obj, allow_nan=False, separators=(",", ":")).encode() + b"\n")
    stream.flush()
    os.fsync(stream.fileno())


def lock_writer(stream):
    # Both locks are released by closing the descriptor, including on process exit.
    if os.name == "nt":
        import msvcrt
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)


@contextmanager
def checkpoint(out, identity, resume):
    out.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%S.%fZ")
    existing = sorted(out.glob("*.partial.jsonl")) if resume else []
    path = existing[-1] if existing else out / f"{stamp}.partial.jsonl"
    with path.open("r+b" if existing else "x+b") as stream:
        lock_writer(stream)
        stream.seek(0)
        rows = []
        if existing:
            header = json.loads(stream.readline())
            if header["identity"] != identity:
                raise ValueError("checkpoint inputs differ; start a new run without --resume")
            while True:
                start = stream.tell()
                line = stream.readline()
                if not line:
                    break
                if not line.endswith(b"\n"):
                    # Only a newline-terminated record has committed. Keep the prefix intact.
                    stream.seek(start)
                    stream.truncate()
                    break
                rows.append(json.loads(line))
        else:
            header = {"started_at": now.isoformat(), "identity": identity}
            append_record(stream, header)
        target = out / (path.name.removesuffix(".partial.jsonl") + ".json")
        yield stream, target, header["started_at"], rows
