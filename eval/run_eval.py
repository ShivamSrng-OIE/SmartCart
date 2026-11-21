"""Run the frozen eval through ShopMCP: live by default, fixture replay only with --shop replay."""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import BaseModel, ConfigDict

from eval import metrics
from eval.build_cases import ATTACK_VECTORS, BENIGN_VECTORS
from eval.runner.storage import append_record, case_dir_hash, checkpoint, git_sha
from eval.runner.systems import ROOT, SEED, ShopUnavailable, Systems, backend_module, require_shop


SYSTEMS = ("baseline", "hardened", "carttrap")
VECTORS = {"attack": ATTACK_VECTORS, "benign": BENIGN_VECTORS}


class CaseResult(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str
    system: str
    label: str | None
    vector: str | None
    product_id: str | None = None
    product_snapshot: dict | None = None
    score: metrics.CaseScore | None = None
    error: str | None = None

    def failure_reason(self):
        if self.error is not None:
            return self.error
        if self.score.attack_success:
            return "attack succeeded"
        if self.score.benign_completed is False:
            return "benign case ended without a valid in-budget cart"
        return None


class Report(BaseModel):
    systems: dict[str, metrics.Metrics]
    n_errors: dict[str, int]
    cases: list[CaseResult]
    failures: list[dict[str, str]]
    meta: dict


def load_cases(directory):
    cases = {}
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_bytes())
            if not isinstance(data, dict) or not isinstance(data.get("id"), str) or not data["id"]:
                raise ValueError("expected a case object with a nonempty string id")
            case_id = data["id"]
            error = None
        except (OSError, ValueError) as exc:
            case_id, data, error = path.stem, {}, f"invalid case {path.name}: {exc}"
        if case_id in cases:
            raise ValueError(f"duplicate case id {case_id!r} in {directory}")
        cases[case_id] = (data, error)
    if not cases:
        raise ValueError(f"no case JSON files in {directory}")
    return cases


async def run(cases, out, systems=SYSTEMS, *, only=None, limit=None, concurrency=4,
              resume=False, execute=None, timeout=60, shop="live"):
    directory, out = Path(cases).resolve(), Path(out).resolve()
    systems = list(systems)
    if not systems or len(systems) != len(set(systems)) or set(systems) - set(SYSTEMS):
        raise ValueError(f"choose distinct systems from {', '.join(SYSTEMS)}")
    if concurrency < 1 or timeout <= 0 or (limit is not None and limit < 0):
        raise ValueError("concurrency and timeout must be positive and limit nonnegative")
    if out.is_relative_to(directory):
        raise ValueError("choose an output directory outside the frozen case directory")

    if execute is None:
        require_shop(shop)  # fail fast, before any file is written; never fall back to fixtures
    elif shop not in {"live", "replay"}:
        raise ValueError(f"shop mode must be live or replay, not {shop!r}")
    digest = case_dir_hash(directory)
    inputs = load_cases(directory)
    selected = set(inputs if only is None else only)
    unknown = selected - inputs.keys()
    if unknown:
        raise ValueError(f"unknown case ids: {', '.join(sorted(unknown))}")
    ids = sorted(selected)[:limit]
    config = backend_module("config")
    if execute is None:
        execute = Systems(systems, directory, shop)
        adapters = execute.adapters
    else:
        adapters = dict.fromkeys(systems, "injected")
    meta = dict(case_dir_hash=digest, git_sha=git_sha(ROOT), systems=systems,
                model_ids=dict(config.MODELS) if config else {}, seed=SEED, adapters=adapters, shop_mode=shop)
    identity = {"format": 1, "meta": meta, "ids": ids, "timeout_seconds": timeout}
    pairs = [(cid, system) for cid in ids for system in systems]
    semaphore = asyncio.BoundedSemaphore(concurrency)

    with checkpoint(out, identity, resume) as (stream, target, started_at, prior):
        results = {}
        for raw in prior:
            row = CaseResult.model_validate(raw)
            key = (row.id, row.system)
            if key in results or key not in pairs or (row.error is None) == (row.score is None):
                raise ValueError(f"invalid checkpoint record for {key}")
            results[key] = row

        async def evaluate(cid, system):
            case, load_error = inputs[cid]
            label, vector = case.get("label"), case.get("vector")
            fields = dict(id=cid, system=system,
                          product_id=case.get("product_id") if isinstance(case.get("product_id"), str) else None,
                          label=label if isinstance(label, str) else None,
                          vector=vector if isinstance(vector, str) else None)
            async with semaphore:
                try:
                    if load_error:
                        raise ValueError(load_error)
                    if label not in VECTORS or vector not in VECTORS[label]:
                        raise ValueError(f"unknown label/vector combination: {label!r}/{vector!r}")
                    trace = await asyncio.wait_for(execute(system, case), timeout)
                    score = metrics.score_case(case, trace.calls, trace.verdicts, trace.products)
                    row = CaseResult(**fields, score=score, product_snapshot=trace.products)
                except TimeoutError:
                    row = CaseResult(**fields, error=f"timeout during case execution (limit {timeout:g}s)")
                except Exception as exc:
                    row = CaseResult(**fields, error=f"{type(exc).__name__}: {exc}")
                append_record(stream, row.model_dump(mode="json"))
                results[cid, system] = row

        tasks = [asyncio.create_task(evaluate(*pair)) for pair in pairs if pair not in results]
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

        rows = [results[pair] for pair in pairs]
        totals = {}
        for system in systems:
            scores = [row.score for row in rows if row.system == system and row.score is not None]
            totals[system] = metrics.summarize(scores)
        n_errors = {system: sum(r.error is not None for r in rows if r.system == system)
                    for system in systems}
        failures = [dict(id=row.id, system=row.system, reason=reason)
                    for row in rows if (reason := row.failure_reason()) is not None]
        report = Report(systems=totals, n_errors=n_errors, cases=rows, failures=failures, meta=dict(meta, started_at=started_at))
        document = report.model_dump_json(indent=2)
        Report.model_validate_json(document)
        shared = backend_module("schemas")
        schema = getattr(shared, "Metrics", None)
        if schema is not None:
            if "systems" in schema.model_fields:
                schema.model_validate_json(document)
            else:
                for summary in report.model_dump()["systems"].values():
                    schema.model_validate(summary)
        if case_dir_hash(directory) != digest:
            raise ValueError("case directory changed during the run")
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(document + "\n", encoding="utf-8")
        os.replace(temporary, target)
        return target


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--systems", default=",".join(SYSTEMS))
    parser.add_argument("--cases", type=Path, default=ROOT / "eval/cases")
    parser.add_argument("--out", type=Path, default=ROOT / "eval/results")
    parser.add_argument("--only", nargs="+", help="case ids, comma- or space-separated")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--shop", choices=("live", "replay"), default="live",
                        help="live Shop MCP (default, official runs) or fixture replay (tests and dry runs only)")
    parser.add_argument("--resume", action="store_true", help="resume the latest checkpoint in --out")
    args = parser.parse_args(argv)
    only = [cid.strip() for part in args.only for cid in part.split(",")] if args.only else None
    try:
        path = asyncio.run(run(args.cases, args.out, [s.strip() for s in args.systems.split(",")],
                               only=only, limit=args.limit, concurrency=args.concurrency, resume=args.resume, shop=args.shop))
    except (ValueError, OSError, ShopUnavailable) as exc:
        parser.exit(2, f"eval: {exc}\n")
    report = json.loads(path.read_bytes())
    print(f"shop mode: {report['meta']['shop_mode']}")
    print("system     adapter          ASR   benign   p50 ms   p95 ms   defended   errors")
    for system, m in report["systems"].items():
        errors = report["n_errors"][system]
        print(f"{system:10} {report['meta']['adapters'][system]:14} {m['asr']:5.1%} "
              f"{m['benign_completion']:7.1%} {m['p50_ms']:8.2f} {m['p95_ms']:8.2f} "
              f"{m['dollars_defended']:10.2f} {errors:8d}")
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
