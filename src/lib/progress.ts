import type { ArenaState } from "../state";

export type StageStatus = "todo" | "active" | "done";

export interface Stage {
  id: "reading" | "firewall" | "decision" | "alternative" | "evidence" | "explain";
  label: string;
  /** what is happening or what was found, in a few words */
  detail?: string;
  status: StageStatus;
}

export interface ListingFacts {
  photos: number;
  hasVideo?: boolean;
  hasAudio?: boolean;
}

function readingLabel(f: ListingFacts): string {
  const parts = [f.photos > 0 ? `${f.photos} photo${f.photos === 1 ? "" : "s"}` : null, f.hasVideo ? "the video" : null, f.hasAudio ? "the audio" : null, "the description"].filter(Boolean) as string[];
  return `Reading ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}`;
}

/**
 * The live checklist for a cart check, worked out from the events the backend has sent so far (nothing is
 * simulated): the listing is read and the firewall asked at the same time; when the verdict arrives the check is
 * decided; if the order was held, the safe alternative, the exact spot of the hidden text and the written
 * explanation are prepared next, and each shows as done when its result arrives.
 */
export function checkStages(state: ArenaState, facts: ListingFacts): Stage[] {
  const g = state.guarded;
  const finished = g.finished;
  const perceptionSeen = g.steps.some((s) => s.kind === "log" && s.data?.event === "perception");
  const verdict = state.verdict;
  const held = !!verdict && verdict.action !== "approve_checkout";
  const hasAlternative = !!state.fraudCard?.safe_cart;
  const hasEvidence = (g.evidence?.length ?? 0) > 0;

  const done = (b: boolean): StageStatus => (b ? "done" : "active");
  const stages: Stage[] = [
    { id: "reading", label: readingLabel(facts), status: done(perceptionSeen || finished) },
    { id: "firewall", label: "Checking the order against what you asked for", status: done(!!verdict || finished) },
    {
      id: "decision",
      label: verdict ? (held ? "Held: this listing tries to steer the shopping agent" : "Approved: everything matched") : "Deciding",
      status: verdict ? "done" : "todo",
    },
  ];
  if (held) {
    stages.push(
      { id: "alternative", label: "Finding a safe alternative", status: done(hasAlternative || finished) },
      { id: "evidence", label: "Pinpointing the hidden text", status: done(hasEvidence || finished) },
      { id: "explain", label: "Writing the explanation", status: done(finished) },
    );
  }
  return stages;
}

/** One short phrase for tight spaces (a button, a card): what is happening right now. */
export function currentActivity(state: ArenaState, facts: ListingFacts): string {
  const stages = checkStages(state, facts);
  const active = stages.filter((s) => s.status === "active");
  if (!active.length) return "Finishing up";
  const first = active[0];
  if (first.id === "reading" && active.length > 1) return "Reading and checking the order";
  return first.label;
}
