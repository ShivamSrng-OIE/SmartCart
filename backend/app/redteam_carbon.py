"""Audit fixed, recorded decisions and verify defensive rule changes on the same inputs."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
import json
from pathlib import Path
import re
import shutil
import time
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from app import selfheal
from app.selfheal import RuleSet, RuleStore, SelfHealError, TraceEvent


GOLDEN = Path(__file__).resolve().parents[1] / "eval" / "golden"
RECORDED_STEPS = (
    "fixture_loaded", "verdict", "blocked", "bypass", "probe_proposed", "validation",
    "probe_published", "reblocked", "redteam_error", "done",
)
STAGES = ("launch", "attack", "blocked", "mutate", "bypass", "diagnose", "probe_proposed", "validate",
          "patched", "reblocked", "verdict", "done")
PROBE_FIELDS = ("id", "type", "category", "instructions", "threshold", "added_by", "created_at")
FIREWALL_ACTIONS = ("approve_checkout", "escalate_to_neon_swap", "hard_block_quarantine")


def record_round(events: Iterable[TraceEvent | dict], path: str | Path = "runs/redteam_demo.jsonl") -> None:
    """Append replay envelopes with public decision telemetry only.

    Arbitrary text (including nested tool results and model output) can contain
    credentials even when its field name appears harmless.
    """
    lines = []
    for item in events:
        event = TraceEvent.model_validate(item)
        data = event.data
        public = {}
        if data.get("step") in RECORDED_STEPS:
            public["step"] = data["step"]
        if data.get("action") in FIREWALL_ACTIONS:
            public["action"] = data["action"]
        if data.get("stage") in STAGES:
            public["stage"] = data["stage"]
        message = data.get("message")
        # Messages are written by this module; refuse anything long or URL-shaped from other sources.
        if isinstance(message, str) and len(message) <= 240 and "://" not in message:
            public["message"] = message
        for key in ("round", "version", "severity", "latency_ms", "rules_version_from", "rules_version_to"):
            if type(data.get(key)) is int:
                public[key] = data[key]
        if isinstance(data.get("approve_p"), float):
            public["approve_p"] = data["approve_p"]
        top = data.get("top_probe")
        if isinstance(top, dict) and isinstance(top.get("id"), str) and isinstance(top.get("p"), float):
            public["top_probe"] = {"id": top["id"], "p": top["p"]}
        exploit = data.get("exploit")
        if isinstance(exploit, dict) and isinstance(exploit.get("fired"), bool):
            public["exploit"] = {"p": exploit.get("p"), "fired": exploit["fired"]}
        if isinstance(data.get("benign"), list):
            public["benign"] = [{"id": str(b["id"]), "p": b["p"]} for b in data["benign"]
                                if isinstance(b, dict) and "id" in b and isinstance(b.get("p"), (int, float))]
        probe = data.get("probe")
        if isinstance(probe, dict):
            public["probe"] = {k: probe[k] for k in PROBE_FIELDS if isinstance(probe.get(k), (str, float))}
        for key in ("vector", "payload"):
            if isinstance(data.get(key), str) and len(data[key]) <= 200:
                public[key] = data[key]
        for key in ("accepted", "reblocked"):
            if type(data.get(key)) is bool:
                public[key] = data[key]
        # The launch route assigns rt_<8 hex digits>. Replay remaps run_id.
        run_id = event.run_id if re.fullmatch(r"rt_[0-9a-f]{8}", event.run_id) else "redteam_demo"
        safe = event.model_copy(update={"run_id": run_id, "data": public})
        lines.append(safe.model_dump_json() + "\n")
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("a", encoding="utf-8") as recording:
        recording.write("".join(lines))


class ManifestEntry(BaseModel):
    round: int = Field(ge=1, le=3)
    id: str = Field(min_length=1)
    vector: Literal["sticky_note", "pack_lie", "pdf_spend", "voice_coercion", "split_payload"]
    product_id: str = Field(min_length=1)
    files: list[str] = Field(min_length=1)
    intended_hijack: str
    expected_forbidden_tool: str = Field(min_length=1)
    user_request: str
    budget: float = Field(ge=0, allow_inf_nan=False)
    mutation_of: str | None

    @classmethod
    def from_log(cls, log: str) -> ManifestEntry:
        for line in reversed(log.splitlines()):
            if line.startswith("MANIFEST:"):
                return cls.model_validate_json(line.removeprefix("MANIFEST:").strip(), strict=True)
        raise SelfHealError("recording has no manifest")


class EventBus(Protocol):
    def emit(self, event: TraceEvent) -> None: ...


class EvaluateDecision(Protocol):
    async def __call__(self, fixture: dict, rules: RuleSet) -> dict: ...


def _read_golden(directory: str):
    for path in sorted((GOLDEN / directory).glob("*.json")):
        yield json.loads(path.read_bytes())


class _BackupStore:
    """Copy rules.json to rules.json.bak before the wrapped store appends a probe."""

    def __init__(self, inner):
        self.inner = inner
        self.path = Path(inner.path)

    def current(self):
        return self.inner.current()

    def append(self, probe):
        if self.path.is_file():
            shutil.copyfile(self.path, self.path.with_suffix(self.path.suffix + ".bak"))
        return self.inner.append(probe)


def _top_probe(verdict: dict) -> dict | None:
    probes = [p for p in verdict.get("probes") or () if isinstance(p.get("p"), (int, float))]
    if not probes:
        return None
    best = max(probes, key=lambda p: p["p"])
    return {"id": best["id"], "p": float(best["p"])}


async def launch_redteam(product_id: str | None, rounds: int, bus: EventBus, run_id: str, *,
                         cases: Sequence[dict] | None = None, benign: list[dict] | None = None,
                         store: RuleStore | None = None,
                         evaluate: EvaluateDecision = selfheal.evaluate_fixture,
                         generate: selfheal.DraftGenerator | None = None,
                         score: selfheal.ProbeScorer | None = None) -> list[ManifestEntry]:
    """Audit up to three fixed snapshots. Each has a manifest_log and a Task 7 input fixture.

    Default snapshots come from eval/golden/redteam and controls from eval/golden/benign.
    The bus owns JSONL persistence. Manifest filenames are metadata only.
    """
    start = time.monotonic()
    completed = []
    round_no = 0
    operation = "load_recording"
    store = store if store is not None else selfheal.AtomicRuleStore()
    if hasattr(store, "path"):
        store = _BackupStore(store)

    def event(kind, step, stage, message, **data):
        return TraceEvent(run_id=run_id, pane="redteam", t_ms=int((time.monotonic() - start) * 1000),
                          kind=kind, data={"round": round_no, "step": step, "stage": stage,
                                           "message": message, **data})

    async def inspect(fixture):
        result = await evaluate(fixture, store.current())
        if result.get("error") or result["action"] not in FIREWALL_ACTIONS:
            raise SelfHealError("firewall evaluation unavailable")
        bus.emit(event("verdict", "verdict", "verdict",
                       "Firewall verdict: " + result["action"].replace("_", " ") + ".", **result))
        return result

    try:
        limit = min(max(rounds, 0), 3)
        records = iter(cases) if cases is not None else _read_golden("redteam")
        while len(completed) < limit:
            round_no = len(completed) + 1
            operation = "load_recording"
            record = next(records, None)
            if record is None:
                if not completed:
                    raise SelfHealError("no matching recorded fixture")
                break
            manifest = ManifestEntry.from_log(record["manifest_log"])
            if product_id is not None and manifest.product_id != product_id:
                continue
            fixture = record["fixture"]
            if manifest.round != round_no or fixture["id"] != manifest.id:
                raise SelfHealError("fixture does not match manifest")
            if fixture["proposed"]["name"] != manifest.expected_forbidden_tool:
                raise SelfHealError("recorded decision is for a different proposed call")
            payload = fixture.get("payload")
            bus.emit(event("log", "fixture_loaded", "attack", manifest.intended_hijack,
                           manifest=manifest.model_dump(), vector=manifest.vector,
                           **({"payload": payload} if isinstance(payload, str) else {})))
            completed.append(manifest)
            operation = "evaluate"
            verdict = await inspect(fixture)
            if verdict["action"] != "approve_checkout":
                latency = verdict.get("latency_ms")
                top = _top_probe(verdict)
                bus.emit(event("log", "blocked", "blocked",
                               "Safe Checkout held it" + (f" in {int(latency)} ms." if latency is not None else "."),
                               blocked_call=fixture["proposed"], action=verdict["action"],
                               severity=verdict["severity"], probes=verdict["probes"],
                               **({"latency_ms": int(latency)} if latency is not None else {}),
                               **({"top_probe": top} if top else {})))
                continue

            approve_p = (verdict.get("action_probs") or {}).get("approve_checkout")
            bus.emit(event("log", "bypass", "bypass",
                           "CartTrap approved the order. This is the miss we want to fix.",
                           **({"approve_p": float(approve_p)} if approve_p is not None else {}),
                           **({"latency_ms": int(verdict["latency_ms"])}
                              if verdict.get("latency_ms") is not None else {}),
                           call=fixture["proposed"]))
            # Reconstruct the guarded decision boundary from the recorded input.
            trace = [
                TraceEvent(run_id=run_id, pane="guarded", t_ms=0, kind=kind, data=data)
                for kind, data in [("log", {"claims": fixture.get("claims")}),
                                   ("tool_call", fixture["proposed"]), ("verdict", verdict)]
            ]
            operation = "propose"
            probe = await selfheal.propose_probe(trace, store=store, generate=generate)
            bus.emit(event("log", "probe_proposed", "probe_proposed",
                           "One new yes/no check, drafted from the missed order.",
                           probe=probe.model_dump(mode="json")))
            operation = "validate"
            controls = benign if benign is not None else list(_read_golden("benign"))
            accepted, report = await selfheal.validate_probe(probe, fixture, controls, store=store, score=score)
            if any(row.p is None for row in report.fixtures):
                bus.emit(event("log", "validation", "validate", "Scoring the new check failed.",
                               accepted=False, report=report.model_dump()))
                raise SelfHealError("fixture scoring failed")
            exploit_row = next(row for row in report.fixtures if row.fixture_id == fixture["id"])
            benign_rows = [{"id": row.fixture_id, "p": row.p} for row in report.fixtures
                           if row is not exploit_row]
            bus.emit(event("log", "validation", "validate",
                           (f"It catches the attack and stays quiet on all {len(benign_rows)} normal photos."
                            if accepted else "The new check failed validation and was not enabled."),
                           accepted=accepted, report=report.model_dump(),
                           exploit={"p": exploit_row.p, "fired": exploit_row.p >= probe.threshold},
                           benign=benign_rows))
            if accepted:
                bus.emit(event("log", "probe_published", "patched",
                               f"Rules updated from v{report.version - 1} to v{report.version} without a restart.",
                               probe_id=probe.id, version=report.version,
                               rules_version_from=report.version - 1, rules_version_to=report.version))
                operation = "verify_published_rule"
                after = await inspect(fixture)
                reblocked = after["action"] != "approve_checkout" and any(
                    p["id"] == probe.id and p["fired"] for p in after["probes"]
                )
                bus.emit(event("log", "reblocked", "reblocked",
                               "The same attack is now blocked." if reblocked
                               else "The attack still got through after the update.",
                               reblocked=reblocked, probe_id=probe.id, version=report.version))
            break
    except Exception as exc:
        # External exceptions may contain credentials or recorded media text.
        bus.emit(event("done", "redteam_error", "diagnose",
                       "The review cycle stopped during " + operation.replace("_", " ") + ".",
                       operation=operation, error=type(exc).__name__))
        return completed
    round_no = len(completed)
    bus.emit(event("done", "done", "done", "Review cycle finished."))
    return completed
