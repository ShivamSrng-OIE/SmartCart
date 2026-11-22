import { useCallback, useEffect, useState } from "react";
import { OwnKeyForm } from "./OwnKey";
import { Check, Eye, EyeOff, KeyRound, Loader2, Play, Save, X } from "lucide-react";
import { ApiError, getLlmSettings, putLlmKey, putLlmSettings, testRole, type LlmRole, type LlmSettings } from "../lib/marketplace";
import { shortModel } from "../hooks/useModelLabels";
import { Button, Chip, Segmented, cx } from "./ui";

type Provider = "gemini" | "openrouter";
const PROVIDER_LABEL: Record<Provider, string> = { gemini: "Google Gemini", openrouter: "OpenRouter (free models)" };
const CAPABILITY_LABEL: Record<string, string> = { tools: "tool calling", image: "reads photos", audio: "hears audio", json: "structured output" };

interface TestState {
  busy?: boolean;
  ok?: boolean;
  text?: string;
}

function RoleRow({ role, provider, test, onTest }: { role: LlmRole; provider: Provider; test?: TestState; onTest: () => void }) {
  const models = role.models[provider] ?? [];
  const [first, ...rest] = models;
  return (
    <li className="flex flex-col gap-2 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
          {role.name}
          {role.needs.map((n) => <Chip key={n} mono={false} className="h-5 text-[10px]">{CAPABILITY_LABEL[n] ?? n}</Chip>)}
        </p>
        <p className="text-[13px] leading-snug text-ink-3">{role.label}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-ink" title={first}>{first ? shortModel(first) : "—"}</p>
        {rest.length > 0 && provider === "openrouter" && (
          <p className="truncate text-xs text-ink-3" title={rest.join(", ")}>
            if busy: {rest.slice(0, 2).map(shortModel).join(" → ")}{rest.length > 2 ? " → …" : ""}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <Button size="sm" disabled={test?.busy} onClick={onTest} icon={test?.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} title="Send one tiny request for this job">
          Test
        </Button>
        {test?.text && (
          <span className={cx("flex max-w-64 items-center gap-1 text-xs", test.ok ? "text-safe" : "text-danger")} role="status">
            {test.ok ? <Check className="size-3.5 shrink-0" /> : <X className="size-3.5 shrink-0" />}
            <span className="line-clamp-2" title={test.text}>{test.text}</span>
          </span>
        )}
      </div>
    </li>
  );
}

export function Settings() {
  const [server, setServer] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [persist, setPersist] = useState(true);
  const [busy, setBusy] = useState<"save" | "key" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const apply = useCallback((s: LlmSettings) => {
    setServer(s);
    setProvider(s.provider);
  }, []);

  useEffect(() => {
    getLlmSettings().then(apply).catch((err) => setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn’t load settings." }));
  }, [apply]);

  const dirty = !!server && provider !== server.provider;

  const fail = (err: unknown) =>
    setMessage({
      ok: false,
      text: err instanceof ApiError && err.status === 403
        ? "Changes are only allowed from the machine running the server, or after signing in as the operator (Sell → sign in as “warehouse”)."
        : err instanceof Error ? err.message : "That didn’t work.",
    });

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      apply(await putLlmSettings(provider));
      setTests({});
      setMessage({ ok: true, text: `Saved. The agents now run on ${PROVIDER_LABEL[provider]}.` });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async () => {
    setBusy("key");
    setMessage(null);
    try {
      apply(await putLlmKey(provider, key, persist));
      setKey("");
      setMessage({ ok: true, text: persist ? "Key saved for this run and written to the backend’s .env." : "Key saved for this run only." });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const runTest = async (role: string) => {
    setTests((t) => ({ ...t, [role]: { busy: true } }));
    try {
      const r = await testRole(role);
      setTests((t) => ({ ...t, [role]: { ok: r.ok, text: r.ok ? `${shortModel(r.model)} answered in ${(r.ms / 1000).toFixed(1)} s` : (r.error ?? "failed") } }));
    } catch (err) {
      setTests((t) => ({ ...t, [role]: { ok: false, text: err instanceof Error ? err.message : "failed" } }));
    }
  };

  if (!server) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="h-14 w-1/2 animate-pulse rounded-lg bg-surface-2" />
        <div className="card h-72 animate-pulse" />
        {message && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{message.text}</p>}
      </div>
    );
  }

  const keySet = server.keys[provider];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 sm:gap-5">
      <div>
        <p className="label mb-1">Settings</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI models &amp; keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2 sm:text-[15px]">
          Pick where the agents get their intelligence. The model for each job is chosen automatically: on OpenRouter only free models are used, the best one for each job first, with the next ones as backup if it is busy.
        </p>
      </div>

      <section className="card flex flex-col gap-3 p-4 sm:p-5" aria-labelledby="own-key-title">
        <div>
          <h2 id="own-key-title" className="text-[17px] font-semibold tracking-tight">Use your own key</h2>
          <p className="text-xs text-ink-3">Anyone can add their own free OpenRouter or Gemini key. Your requests then run on your quota, so they stay fast even when the shared one is used up.</p>
        </div>
        <OwnKeyForm />
      </section>

      <section className="card flex flex-col gap-4 p-4 sm:p-5" aria-label="Provider">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Provider</h2>
            <p className="text-xs text-ink-3">{provider === "openrouter" ? "Free models only. Slower than Gemini, and they can be briefly rate limited." : "Uses the Gemini API key on the server."}</p>
          </div>
          <Segmented value={provider} onChange={(v) => setProvider(v)} options={(["openrouter", "gemini"] as Provider[]).map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} />
        </div>
        {server.provider === "openrouter" && server.active === "gemini" && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn" role="status">
            Every free OpenRouter model is rate limited right now, so the jobs are running on Gemini for a few minutes. OpenRouter is tried again after that.
          </p>
        )}

        <div className="rounded-xl border border-line bg-surface-2 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[14px] font-medium"><KeyRound className="size-4 text-ink-3" /> {provider === "openrouter" ? "OpenRouter" : "Gemini"} API key</p>
            <Chip tone={keySet ? "safe" : "warn"} mono={false}>{keySet ? "Key set" : "No key yet"}</Chip>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <div className="relative min-w-60 flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value.trim())}
                placeholder={keySet ? "Paste a new key to replace it" : provider === "openrouter" ? "sk-or-v1-…" : "AIza…"}
                autoComplete="off"
                spellCheck={false}
                aria-label="API key"
                className="field h-10 pr-10 font-mono text-[13px]"
              />
              <button type="button" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? "Hide key" : "Show key"} className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button variant="primary" size="lg" disabled={!key || busy === "key"} onClick={saveKey} icon={busy === "key" ? <Loader2 className="size-4 animate-spin" /> : undefined}>Save key</Button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            Also remember it in the backend’s <span className="font-mono text-xs">.env</span> (kept out of git)
          </label>
        </div>
      </section>

      <section className="card p-4 sm:p-5" aria-label="Models">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">What runs each job</h2>
          <p className="text-xs text-ink-3">
            {provider === "openrouter"
              ? "Chosen from the free models by testing them on the app’s real tasks. Audio needs Gemini: free OpenRouter models can’t take audio."
              : "The Gemini models for each job."}
          </p>
        </div>
        <ul className="mt-1 divide-y divide-line">
          {server.roles.map((role) => (
            <RoleRow key={role.id} role={role} provider={provider} test={tests[role.id]} onTest={() => runTest(role.id)} />
          ))}
        </ul>
        {dirty && <p className="mt-2 text-xs text-ink-3">Save to test the {PROVIDER_LABEL[provider]} models.</p>}
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-float backdrop-blur sm:p-4">
        <p role="status" className={cx("min-w-0 flex-1 text-[13px]", message ? (message.ok ? "text-safe" : "text-danger") : "text-ink-3")}>
          {message?.text ?? (dirty ? "You have unsaved changes." : `Running on ${PROVIDER_LABEL[server.provider]}.`)}
        </p>
        <Button variant="primary" size="lg" disabled={!dirty || busy === "save"} onClick={save} icon={busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}>
          Save provider
        </Button>
      </div>
    </div>
  );
}
