"""Audit fixed, recorded decisions and verify defensive rule changes on the same inputs."""

from __future__ import annotations

from collections.abc import Sequence
import json
from pathlib import Path
import time
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from backend import selfheal
from backend.selfheal import RuleSet, RuleStore, SelfHealError, TraceEvent


GOLDEN = Path(__file__).resolve().parents[1] / "eval" / "golden"


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

    def event(kind, step, **data):
        return TraceEvent(run_id=run_id, pane="redteam", t_ms=int((time.monotonic() - start) * 1000),
                          kind=kind, data={"round": round_no, "step": step, **data})

    async def inspect(fixture):
        result = await evaluate(fixture, store.current())
        if result.get("error") or result["action"] not in {
            "approve_checkout", "escalate_to_neon_swap", "hard_block_quarantine"
        }:
            raise SelfHealError("firewall evaluation unavailable")
        bus.emit(event("verdict", "verdict", **result))
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
            bus.emit(event("log", "fixture_loaded", manifest=manifest.model_dump()))
            completed.append(manifest)
            operation = "evaluate"
            verdict = await inspect(fixture)
            if verdict["action"] != "approve_checkout":
                bus.emit(event("log", "blocked", blocked_call=fixture["proposed"],
                               action=verdict["action"], severity=verdict["severity"], probes=verdict["probes"]))
                continue

            bus.emit(event("log", "bypass"))
            # Reconstruct the guarded decision boundary from the recorded input.
            trace = [
                TraceEvent(run_id=run_id, pane="guarded", t_ms=0, kind=kind, data=data)
                for kind, data in [("log", {"claims": fixture.get("claims")}),
                                   ("tool_call", fixture["proposed"]), ("verdict", verdict)]
            ]
            operation = "propose"
            probe = await selfheal.propose_probe(trace, store=store, generate=generate)
            bus.emit(event("log", "probe_proposed", probe=probe.model_dump(mode="json")))
            operation = "validate"
            controls = benign if benign is not None else list(_read_golden("benign"))
            accepted, report = await selfheal.validate_probe(probe, fixture, controls, store=store, score=score)
            bus.emit(event("log", "validation", accepted=accepted, report=report.model_dump()))
            if any(row.p is None for row in report.fixtures):
                raise SelfHealError("fixture scoring failed")
            if accepted:
                operation = "verify_published_rule"
                after = await inspect(fixture)
                if after["action"] == "approve_checkout" or not any(
                    p["id"] == probe.id and p["fired"] for p in after["probes"]
                ):
                    raise SelfHealError("published rule did not block the recorded decision")
                bus.emit(event("log", "reblocked", probe_id=probe.id, version=report.version))
            break
    except Exception as exc:
        # External exceptions may contain credentials or recorded media text.
        bus.emit(event("done", "redteam_error", operation=operation, error=type(exc).__name__))
        return completed
    round_no = len(completed)
    bus.emit(event("done", "done"))
    return completed
