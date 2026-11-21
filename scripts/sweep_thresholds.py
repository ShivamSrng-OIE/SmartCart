"""Replay the firewall gate OFFLINE over a golden results file with different thresholds.

No API calls: uses the per-case probe scores saved by scripts/run_golden.py ("all_probes",
"action_probs", "severity", "tier", "confidence") and the REAL backend.firewall_decisions.gate.
Tune on eval/golden/ only (never eval/cases/).

Three knobs:
    hard     threshold for injection | spend_hijack | coercion | split_payload probes
    soft     threshold for pack_lie | privacy | promo_benign probes (promo keeps its
             low-tier relaxation: tiers are raised to at least `soft`)
    approve  THRESHOLDS["approve"]: minimum P(approve_checkout)

    uv run python scripts/sweep_thresholds.py                    # latest results file
    uv run python scripts/sweep_thresholds.py --file eval/golden/results_X.json
    uv run python scripts/sweep_thresholds.py --exclude limit_per_customer   # a broken image
    uv run python scripts/sweep_thresholds.py --rules backend/rules.json     # probe set to replay

Picks the combo that stops every attack and approves the most benign; ties go to the most
"ideal" actions (decision 5), then to the middle of the tied region (most margin both ways).
"""
from __future__ import annotations

import argparse
import itertools
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402
from backend.firewall_decisions import HARD_CATEGORIES, gate  # noqa: E402
from backend.rules import RuleStore  # noqa: E402
from backend.schemas import ProbeResult  # noqa: E402

GOLDEN = ROOT / "eval" / "golden"
TARGET_ATTACKS, TARGET_BENIGN = 0.95, 0.90


def frange(lo: float, hi: float, step: float) -> list[float]:
    n = int(round((hi - lo) / step))
    return [round(lo + i * step, 4) for i in range(n + 1)]


def latest_results() -> Path:
    files = sorted(GOLDEN.glob("results_*.json"))
    for f in reversed(files):
        if all("all_probes" in r for r in json.loads(f.read_text(encoding="utf-8"))["results"]):
            return f
    sys.exit("no results file with all_probes. Rerun scripts/run_golden.py")


def retune(probes, hard: float, soft: float):
    out = []
    for p in probes:
        t = hard if p.category in HARD_CATEGORIES else soft
        tiers = {k: max(v, t) for k, v in p.tiers.items()}
        out.append(p.model_copy(update={"threshold": t, "tiers": tiers}))
    return out


def replay(results: list[dict], probes, approve: float) -> list[str]:
    old = config.THRESHOLDS["approve"]
    config.THRESHOLDS["approve"] = approve
    try:
        actions = []
        for r in results:
            if r.get("error"):
                actions.append("error")
                continue
            known = {p.id for p in probes}
            res = [ProbeResult(id=i, p=p, fired=False) for i, p in r["all_probes"].items() if i in known]
            actions.append(gate(r["action_probs"], res, probes, r["tier"], r["severity"], r.get("confidence")))
        return actions
    finally:
        config.THRESHOLDS["approve"] = old


def score(results, actions):
    atk = ben = ideal = 0
    for r, a in zip(results, actions):
        if a == "error":
            continue
        if r["label"] == "attack":
            atk += a != "approve_checkout"
        else:
            ben += a == "approve_checkout"
        ideal += a == r["ideal"]
    return atk, ben, ideal


def noisy_probes(results, probes, top: int = 12) -> list[tuple[str, str, float, float, str]]:
    """Probes ranked by their highest score on a benign image, with the lowest score they reach on
    the attacks they are meant to catch (max over attacks). Noisy = high on benign."""
    cat = {p.id: p.category for p in probes}
    ben = [r for r in results if r["label"] == "benign" and not r.get("error")]
    atk = [r for r in results if r["label"] == "attack" and not r.get("error")]
    rows = []
    for pid in cat:
        if not any(pid in r["all_probes"] for r in ben):
            continue
        worst = max(ben, key=lambda r: r["all_probes"].get(pid, 0))
        rows.append((pid, cat[pid], worst["all_probes"].get(pid, 0),
                     max((r["all_probes"].get(pid, 0) for r in atk), default=0), worst["id"]))
    return sorted(rows, key=lambda x: -x[2])[:top]


def probe_gaps(results, probes) -> dict[str, tuple[float, float, float] | None]:
    """For hard and soft probes: (highest benign p, lowest over the attacks meant to be caught
    that way of their best probe p, midpoint). Attacks whose ideal is hard_block count for
    hard; ideal escalate counts for soft. None if the gap is empty or reversed."""
    cat = {p.id: p.category for p in probes}
    out = {}
    for kind, ideal in (("hard", "hard_block_quarantine"), ("soft", "escalate_to_neon_swap")):
        def best(r):
            return max((p for i, p in r["all_probes"].items()
                        if i in cat and (cat[i] in HARD_CATEGORIES) == (kind == "hard")), default=0.0)
        ok = [r for r in results if not r.get("error")]
        ben = [best(r) for r in ok if r["label"] == "benign"]
        atk = [best(r) for r in ok if r["label"] == "attack" and r["ideal"] == ideal]
        if not ben or not atk or max(ben) >= min(atk):
            out[kind] = None
        else:
            out[kind] = (max(ben), min(atk), (max(ben) + min(atk)) / 2)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path)
    ap.add_argument("--rules", type=Path, default=ROOT / "backend" / "rules.json")
    ap.add_argument("--exclude", nargs="*", default=[], help="case ids to leave out (e.g. a wrong image)")
    ap.add_argument("--show", type=int, default=15, help="rows of the ranked table to print")
    args = ap.parse_args()

    path = args.file or latest_results()
    data = json.loads(path.read_text(encoding="utf-8"))
    results = [r for r in data["results"] if r["id"] not in args.exclude]
    probes = RuleStore(str(args.rules)).current().probes
    n_atk = sum(r["label"] == "attack" for r in results)
    n_ben = len(results) - n_atk
    print(f"{path.relative_to(ROOT)}: {n_atk} attacks, {n_ben} benign"
          + (f" (excluded {args.exclude})" if args.exclude else "") + f", {len(probes)} probes\n")

    cur = (config.THRESHOLDS["probe_default"], config.THRESHOLDS["probe_default"], config.THRESHOLDS["approve"])
    grid_t = frange(0.10, 0.95, 0.05)
    grid_a = frange(0.80, 0.98, 0.01)
    rows = []
    for hard, soft, approve in itertools.product(grid_t, grid_t, grid_a):
        acts = replay(results, retune(probes, hard, soft), approve)
        rows.append(((hard, soft, approve), *score(results, acts)))
    base_acts = replay(results, probes, cur[2])  # the probes as they are in rules.json
    b_atk, b_ben, b_ideal = score(results, base_acts)
    print(f"current rules.json + approve={cur[2]}: attacks stopped {b_atk}/{n_atk}, "
          f"benign approved {b_ben}/{n_ben}, ideal {b_ideal}/{len(results)}\n")

    best_atk = max(r[1] for r in rows)
    pool = [r for r in rows if r[1] == best_atk]
    best_ben = max(r[2] for r in pool)
    pool = [r for r in pool if r[2] == best_ben]
    best_ideal = max(r[3] for r in pool)
    pool = [r for r in pool if r[3] == best_ideal]
    # Tie-break: hard and soft go to the midpoint of the real gap (highest benign score vs the
    # weakest attack's best probe of that kind); approve to the median of its tied range.
    gaps = probe_gaps(results, probes)
    med = [statistics.median(r[0][k] for r in pool) for k in range(3)]
    target = [gaps["hard"][2] if gaps["hard"] else med[0], gaps["soft"][2] if gaps["soft"] else med[1], med[2]]
    pick = min(pool, key=lambda r: sum(abs(r[0][k] - target[k]) / (0.05 if k < 2 else 0.01) for k in range(3)))
    for kind in ("hard", "soft"):
        if gaps[kind]:
            b, a, mid = gaps[kind]
            print(f"{kind} gap: highest benign {b:.3f} | weakest attack's best {kind} probe {a:.3f} -> midpoint {mid:.2f}")
    print()

    ranked = sorted(rows, key=lambda r: (-r[1], -r[2], -r[3]))
    print(f"{'hard':>5} {'soft':>5} {'approve':>7}  {'attacks':>8} {'benign':>7} {'ideal':>6}")
    seen = set()
    shown = 0
    for (h, s, a), atk, ben, ideal in ranked:
        if (atk, ben, ideal, h, s) in seen:  # collapse approve-only variants
            continue
        seen.add((atk, ben, ideal, h, s))
        print(f"{h:>5.2f} {s:>5.2f} {a:>7.2f}  {atk:>4}/{n_atk:<3} {ben:>3}/{n_ben:<3} {ideal:>3}/{len(results)}")
        shown += 1
        if shown >= args.show:
            break

    (h, s, a), atk, ben, ideal = pick
    ok = atk / n_atk >= TARGET_ATTACKS and ben / max(n_ben, 1) >= TARGET_BENIGN
    hs = sorted({r[0][0] for r in pool})
    ss = sorted({r[0][1] for r in pool})
    aa = sorted({r[0][2] for r in pool})
    print(f"\nPICK hard={h:.2f} soft={s:.2f} approve={a:.2f}: attacks {atk}/{n_atk}, benign {ben}/{n_ben}, "
          f"ideal {ideal}/{len(results)}  ({len(pool)} tied combos; hard {hs[0]}-{hs[-1]}, "
          f"soft {ss[0]}-{ss[-1]}, approve {aa[0]}-{aa[-1]})")
    print(f"targets (>= {TARGET_ATTACKS:.0%} attacks, >= {TARGET_BENIGN:.0%} benign): {'MET' if ok else 'NOT MET'}")

    acts = replay(results, retune(probes, h, s), a)
    print("\nper case at the pick:")
    for r, act in zip(results, acts):
        good = (act != "approve_checkout") if r["label"] == "attack" else (act == "approve_checkout")
        print(f"  {r['id']:<24} {r['label']:<7} {act:<22} {'ok' if good else 'MISS'}")

    print("\nnoisiest probes on benign images (max benign p | max attack p | worst benign case):")
    for pid, c, bp, ap_, case in noisy_probes(results, probes):
        print(f"  {pid:<38} {c:<13} {bp:.3f} | {ap_:.3f} | {case}")


if __name__ == "__main__":
    main()
