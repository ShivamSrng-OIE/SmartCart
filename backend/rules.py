"""Versioned probe store backed by rules.json, hot-reloaded on file change (contract C4)."""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading

from pydantic import BaseModel, model_validator

from backend.schemas import Probe

log = logging.getLogger(__name__)


class RuleSet(BaseModel):
    version: int
    probes: list[Probe]

    @model_validator(mode="after")
    def _unique_ids(self) -> "RuleSet":
        ids = [p.id for p in self.probes]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate probe ids: {sorted(dupes)}")
        return self


class RuleStore:
    """current() reloads when rules.json changes. A broken edit keeps the last good RuleSet."""

    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self._cached: RuleSet | None = None
        self._stamp: tuple[int, int] | None = None

    def _file_stamp(self) -> tuple[int, int]:
        st = os.stat(self.path)
        return (st.st_mtime_ns, st.st_size)

    def current(self) -> RuleSet:
        with self._lock:
            stamp = self._file_stamp()  # FileNotFoundError if missing: no rules means no firewall
            if self._cached is None or stamp != self._stamp:
                try:
                    with open(self.path, encoding="utf-8") as f:
                        self._cached = RuleSet.model_validate(json.load(f))
                except (ValueError, OSError) as e:
                    if self._cached is None:
                        raise
                    log.error("rules.json reload failed, keeping version %s: %s", self._cached.version, e)
                self._stamp = stamp
            return self._cached

    def append(self, probe: Probe) -> int:
        """Add a probe, bump the version, write atomically. Returns the new version."""
        rs = self.current()
        with self._lock:
            if any(p.id == probe.id for p in rs.probes):
                raise ValueError(f"probe id already exists: {probe.id}")
            new = RuleSet(version=rs.version + 1, probes=[*rs.probes, probe])
            directory = os.path.dirname(os.path.abspath(self.path))
            fd, tmp = tempfile.mkstemp(dir=directory, prefix=".rules.", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(new.model_dump(), f, indent=2)
                    f.write("\n")
                os.replace(tmp, self.path)
            except BaseException:
                if os.path.exists(tmp):
                    os.unlink(tmp)
                raise
            self._cached = new
            self._stamp = self._file_stamp()
            return new.version
