import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, Eye, EyeOff, KeyRound, Loader2, X, Zap } from "lucide-react";
import type { ServiceLimits } from "../api";
import { apiUrl } from "../config";
import { getOwnKey, maskKey, onOwnKeyChange, ownKeyHeaders, PROVIDER_INFO, setOwnKey, type OwnKey, type OwnProvider } from "../lib/ownKey";
import { Button, cx } from "./ui";

/** The visitor's own key, kept in sync across the app. */
export function useOwnKey(): OwnKey | null {
  const [key, setKey] = useState<OwnKey | null>(() => getOwnKey());
  useEffect(() => onOwnKeyChange(() => setKey(getOwnKey())), []);
  return key;
}

type Check = { state: "idle" } | { state: "busy" } | { state: "ok"; model?: string } | { state: "error"; message: string };

async function checkKey(v: OwnKey): Promise<{ ok: boolean; model?: string; error?: string }> {
  const r = await fetch(apiUrl("/api/llm/own-key/check"), { method: "POST", headers: ownKeyHeaders(v) });
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; model?: string; error?: string; detail?: string };
  if (!r.ok) return { ok: false, error: typeof body.detail === "string" ? body.detail : "the check didn't go through" };
  return { ok: !!body.ok, model: body.model, error: body.error };
}

/** Add, test, replace or remove your own OpenRouter or Gemini key. */
export function OwnKeyForm({ onDone, className }: { onDone?: () => void; className?: string }) {
  const current = useOwnKey();
  const [provider, setProvider] = useState<OwnProvider>(current?.provider ?? "openrouter");
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(current?.remember ?? false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const id = useId();
  const info = PROVIDER_INFO[provider];
  const trimmed = key.trim();
  const looksOff = trimmed.length > 0 && !info.looksLike.test(trimmed);

  const save = async () => {
    const v: OwnKey = { provider, key: trimmed, remember };
    setCheck({ state: "busy" });
    try {
      const res = await checkKey(v);
      if (!res.ok) return setCheck({ state: "error", message: `That key didn’t work: ${res.error ?? "the provider returned an error"}.` });
      setOwnKey(v);
      setKey("");
      setCheck({ state: "ok", model: res.model });
      onDone?.();
    } catch {
      setCheck({ state: "error", message: "Couldn’t reach the app’s server to test the key. Try again in a moment." });
    }
  };

  return (
    <div className={cx("flex flex-col gap-4", className)}>
      {current && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-safe-line bg-safe-soft px-3.5 py-3" role="status">
          <p className="flex min-w-0 items-center gap-2 text-[14px]">
            <Check className="size-4 shrink-0 text-safe" />
            <span className="min-w-0">
              Using your {PROVIDER_INFO[current.provider].name} key <span className="tnum text-ink-3">{maskKey(current.key)}</span>
              <span className="text-ink-3"> · {current.remember ? "remembered on this device" : "for this tab only"}</span>
            </span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => setOwnKey(null)}>Remove</Button>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1.5">{current ? "Use a different key" : "Which key?"}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Provider">
          {(["openrouter", "gemini"] as OwnProvider[]).map((p) => (
            <label
              key={p}
              className={cx(
                "flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3.5 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                provider === p ? "border-ink bg-surface" : "border-line bg-surface-2 hover:border-line-strong",
              )}
            >
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <input type="radio" name={`${id}-provider`} value={p} checked={provider === p} onChange={() => setProvider(p)} className="size-4 accent-[var(--ink)]" />
                {PROVIDER_INFO[p].name}
              </span>
              <span className="pl-6 text-[12px] text-ink-3">{PROVIDER_INFO[p].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-key`} className="text-[13px] font-medium">Your {info.name} API key</label>
        <div className="relative">
          <input
            id={`${id}-key`}
            type={show ? "text" : "password"}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (check.state !== "busy") setCheck({ state: "idle" });
            }}
            onKeyDown={(e) => e.key === "Enter" && trimmed && check.state !== "busy" && void save()}
            autoComplete="off"
            spellCheck={false}
            placeholder={provider === "openrouter" ? "sk-or-v1-…" : "Paste your Gemini key"}
            aria-describedby={`${id}-help`}
            aria-invalid={looksOff || check.state === "error"}
            className="field h-11 pr-11 font-mono text-[14px]"
          />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide key" : "Show key"} className="absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:text-ink">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p id={`${id}-help`} className="text-[12px] text-ink-3">
          No key yet?{" "}
          <a href={info.getUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-ink underline-offset-2 hover:underline">
            Create a free {info.name} key <ArrowUpRight className="size-3" />
          </a>
          {looksOff && <span className="text-warn"> · That doesn’t look like {provider === "openrouter" ? "an OpenRouter key (they start with sk-or-)" : "a Gemini key"}.</span>}
        </p>
      </div>

      <label className="flex items-start gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ink)]" />
        <span>Remember on this device <span className="text-ink-3">(otherwise it’s forgotten when you close this tab)</span></span>
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="primary" size="lg" disabled={!trimmed || check.state === "busy"} onClick={() => void save()} icon={check.state === "busy" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} className="w-full sm:w-auto">
          {check.state === "busy" ? "Testing your key…" : "Test and use this key"}
        </Button>
        <div role="status" aria-live="polite" className="text-[13px]">
          {check.state === "ok" && <span className="text-safe">Works. Your requests now use your key.</span>}
          {check.state === "error" && <span className="text-danger">{check.message}</span>}
        </div>
      </div>

      <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
        Your key stays in this browser. It is sent only to this app’s server, with your own requests, and is never saved there, logged or shown to
        anyone. On OpenRouter only free models are used. You can remove it any time.
      </p>
    </div>
  );
}

/** The form in a dialog (bottom sheet on phones). */
export function OwnKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      before?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-bg shadow-float outline-none sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
          <div>
            <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">Use your own AI key</h2>
            <p className="text-[13px] text-ink-3">Checks run on your own free quota, so they stay fast even when ours is used up.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </header>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <OwnKeyForm onDone={onClose} />
        </div>
      </div>
    </div>
  );
}

const DISMISS = "tote.limitsDismissed";

/** Shown across the app when the shared keys hit their limits and the visitor hasn't added a key of their own. */
export function LimitsBanner({ limits, onAddKey }: { limits: ServiceLimits | null; onAddKey: () => void }) {
  const own = useOwnKey();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS) ?? "";
    } catch {
      return "";
    }
  });
  if (!limits || limits.state === "ok" || own || dismissed === limits.state) return null;
  const limited = limits.state === "limited";
  const hide = () => {
    try {
      sessionStorage.setItem(DISMISS, limits.state);
    } catch {
      /* ignore */
    }
    setDismissed(limits.state);
  };
  return (
    <div className={cx("border-b", limited ? "border-danger-line bg-danger-soft" : "border-warn/30 bg-warn-soft")} role="status" aria-live="polite">
      <div className="mx-auto flex max-w-[2400px] flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 xl:px-8">
        <p className="flex items-start gap-2 text-[13px] text-ink">
          <Zap className={cx("mt-0.5 size-4 shrink-0", limited ? "text-danger" : "text-warn")} />
          <span>
            <span className="font-semibold">{limited ? "Our shared AI quota is used up for now." : "Our free AI models are busy right now."}</span>{" "}
            {limited
              ? "Checks are slow, and some orders are held just to be safe. Add your own free OpenRouter or Gemini key and everything runs at full speed."
              : "We’re running on a backup, so checks may be slower. The app works best with your own free key."}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
          <button onClick={onAddKey} className="btn-primary inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold">
            <KeyRound className="size-3.5" /> Add your key
          </button>
          <button onClick={hide} className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-black/5 dark:hover:bg-white/5">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
