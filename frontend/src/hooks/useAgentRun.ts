import { useCallback, useEffect, useRef, useState } from "react";
import { fixtureEvents, replay, runAgent } from "../api";
import { applyEvent, initialState, type ArenaState } from "../state";
import type { Intent, TraceEvent } from "../types";
import { REPLAY_SPEED, type FixtureName, type RunKind } from "../config";
import type { Mode } from "./useBackend";
import type { Phase } from "./useArena";

/** One AI shopper (mode 2 or 3): live against its endpoint, or the scripted demo for its pane. */
export function useAgentRun(kind: RunKind, mode: Mode) {
  const pane = kind === "unprotected" ? "victim" : "guarded";
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

  const onEvent = useCallback((e: TraceEvent) => setState((s) => applyEvent(s, e)), []);

  useEffect(() => {
    if (state[pane].finished && phase === "streaming") setPhase("done");
  }, [state, pane, phase]);

  const run = useCallback(
    (form: FormData, intent: Intent, fixture: FixtureName) => {
      stop();
      setError(null);
      setPhase("starting");
      setStartedAt(performance.now());
      setState(initialState(intent));

      if (mode === "replay") {
        const events = fixtureEvents(fixture).filter((e) => e.pane === pane);
        setState(initialState(intent, events[0]?.run_id));
        setPhase("streaming");
        stopRef.current = replay(events, onEvent, REPLAY_SPEED);
        return;
      }

      stopRef.current = runAgent(kind, form, {
        onStart: (runId) => {
          setState(initialState(intent, runId));
          setPhase("streaming");
        },
        onEvent,
        onError: (msg) => {
          setError(msg);
          setPhase("error");
        },
      });
    },
    [kind, mode, onEvent, pane, stop],
  );

  const reset = useCallback(() => {
    stop();
    setState(initialState());
    setPhase("idle");
    setError(null);
    setStartedAt(null);
  }, [stop]);

  return { state, phase, error, startedAt, run, reset, pane } as const;
}
