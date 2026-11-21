import { useCallback, useEffect, useRef, useState } from "react";
import { fixtureEvents, replay, startRun, streamRun } from "../api";
import { applyEvent, initialState, type ArenaState } from "../state";
import type { Intent, TraceEvent } from "../types";
import type { FixtureName } from "../config";
import { REPLAY_SPEED } from "../config";
import type { Mode } from "./useBackend";

export interface RunInput {
  form: FormData;
  intent: Intent;
  fixture: FixtureName;
}

export type Phase = "idle" | "starting" | "streaming" | "done" | "error";

/** Owns one run at a time: starts it (live or replay), feeds events through the reducer. */
export function useArena(mode: Mode) {
  const [state, setState] = useState<ArenaState>(() => initialState());
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const onEvent = useCallback((e: TraceEvent) => {
    setState((s) => {
      const next = applyEvent(s, e);
      return next;
    });
  }, []);

  // Phase follows the reducer: done when the guarded pane finishes.
  useEffect(() => {
    if (state.guarded.finished && phase === "streaming") setPhase("done");
  }, [state.guarded.finished, phase]);

  const run = useCallback(
    async ({ form, intent, fixture }: RunInput) => {
      stop();
      setError(null);
      setPhase("starting");
      setStartedAt(performance.now());

      if (mode === "replay") {
        const events = fixtureEvents(fixture);
        setState(initialState(intent, events[0]?.run_id));
        setPhase("streaming");
        stopRef.current = replay(events, onEvent, REPLAY_SPEED);
        return;
      }

      try {
        const runId = await startRun(form);
        setState(initialState(intent, runId));
        setPhase("streaming");
        stopRef.current = streamRun(runId, onEvent, (msg) => {
          setError(msg);
          setPhase("error");
        });
      } catch (err) {
        setState(initialState(intent));
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [mode, onEvent, stop],
  );

  const reset = useCallback(() => {
    stop();
    setState(initialState());
    setPhase("idle");
    setError(null);
    setStartedAt(null);
  }, [stop]);

  return { state, phase, error, startedAt, run, reset };
}
