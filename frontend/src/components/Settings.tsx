import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Loader2, Play, RotateCcw, Save, X } from "lucide-react";
import { ApiError, getLlmSettings, getModelList, putLlmKey, putLlmSettings, testRole, type LlmRole, type LlmSettings, type ModelInfo } from "../lib/marketplace";
import { Button, Chip, Segmented, cx } from "./ui";

type Provider = "gemini" | "openrouter";
const PROVIDER_LABEL: Record<Provider, string> = { gemini: "Google Gemini", openrouter: "OpenRouter (free models)" };
const CUSTOM = "__custom__";
const CAPABILITY_LABEL: Record<string, string> = { tools: "tool calling", image: "reads photos", audio: "hears audio", json: "structured output" };

interface TestState {
  busy?: boolean;
  ok?: boolean;
  text?: string;
}

function suits(role: LlmRole, m: ModelInfo): boolean {
  return role.needs.every((n) => (n === "tools" ? m.tools : n === "json" ? m.json : m.input.includes(n)));
}

function RoleRow({ role, provider, value, models, dirty, test, onChange, onTest }: {
  role: LlmRole; provider: Provider; value: string; models: ModelInfo[]; dirty: boolean; test?: TestState; onChange: (v: string) => void; onTest: () => void;
}) {
  const known = models.some((m) => m.id === value);
  // "custom" only when the person picks "Enter a model id…"; a current value the list doesn't know is just shown as an option
  const [custom, setCustom] = useState(false);
  const recommended = models.filter((m) => suits(role, m));
  const others = models.filter((m) => !suits(role, m));
  const current = models.find((m) => m.id === value);
  const optionLabel = (m: ModelInfo) => m.name || m.id;

  return (
    <li className="flex flex-col gap-2 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          {role.name}
          {role.needs.map((n) => <Chip key={n} mono={false} className="h-5 text-[10px]">{CAPABILITY_LABEL[n] ?? n}</Chip>)}
        </p>
        <p className="text-[13px] leading-snug text-ink-3">{role.label}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <select
          aria-label={`Model for ${role.name}`}
          value={custom ? CUSTOM : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) return setCustom(true);
            setCustom(false);
            onChange(e.target.value);
          }}
          className="field h-10 py-0 text-[14px]"
        >
          {recommended.length > 0 && (
            <optgroup label="Recommended for this job">
              {recommended.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Other models">
              {others.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
            </optgroup>
          )}
          {!known && !custom && value && <option value={value}>{value} (current)</option>}
          <option value={CUSTOM}>Enter a model id…</option>
        </select>
        {custom && (
          <input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={provider === "openrouter" ? "vendor/model-name:free" : "gemini-2.5-flash"} aria-label={`Custom model id for ${role.name}`} className="field h-10 font-mono text-[13px]" />
        )}
        {current && !custom && (
          <p className="truncate text-xs text-ink-3">
            {current.input.join(", ")} in{current.tools ? " · tools" : ""}{current.json ? " · JSON" : ""}{current.context ? ` · ${Math.round(current.context / 1000)}k context` : ""}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <Button size="sm" disabled={dirty || test?.busy} onClick={onTest} icon={test?.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} title={dirty ? "Save first, then test" : "Send one tiny request to this model"}>
          Test
        </Button>
        {test?.text && (
          <span className={cx("flex max-w-56 items-center gap-1 text-xs", test.ok ? "text-safe" : "text-danger")} role="status">
            {test.ok ? <Check className="size-3.5 shrink-0" /> : <X className="size-3.5 shrink-0" />}
            <span className="truncate" title={test.text}>{test.text}</span>
          </span>
        )}
      </div>
    </li>
  );
}

export function Settings() {
  const [server, setServer] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [persist, setPersist] = useState(true);
  const [busy, setBusy] = useState<"save" | "key" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const apply = useCallback((s: LlmSettings) => {
    setServer(s);
    setProvider(s.provider);
    setDraft(JSON.parse(JSON.stringify(s.models)));
  }, []);

  useEffect(() => {
    getLlmSettings().then(apply).catch((err) => setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn’t load settings." }));
  }, [apply]);

  useEffect(() => {
    if (models[provider]) return;
    getModelList(provider).then((list) => setModels((m) => ({ ...m, [provider]: list }))).catch(() => setModels((m) => ({ ...m, [provider]: [] })));
  }, [provider, models]);

  const dirty = useMemo(() => !!server && (provider !== server.provider || JSON.stringify(draft) !== JSON.stringify(server.models)), [server, provider, draft]);
  const list = models[provider] ?? [];

  const fail = (err: unknown) => setMessage({ ok: false, text: err instanceof ApiError && err.status === 403 ? "Changes are only allowed from the machine running the server, or after signing in as the operator (Sell → sign in as “warehouse”)." : err instanceof Error ? err.message : "That didn’t work." });

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      apply(await putLlmSettings({ provider, models: draft }));
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
      setTests((t) => ({ ...t, [role]: { ok: r.ok, text: r.ok ? `${r.ms} ms · replied “${r.reply ?? ""}”` : (r.error ?? "failed") } }));
    } catch (err) {
      setTests((t) => ({ ...t, [role]: { ok: false, text: err instanceof Error ? err.message : "failed" } }));
    }
  };

  const reset = () => server && setDraft((d) => ({ ...d, [provider]: { ...server.defaults[provider] } }));

  if (!server) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="h-14 w-1/2 animate-pulse rounded-lg bg-surface-2" />
        <div className="card h-72 animate-pulse" />
        {message && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{message.text}</p>}
      </div>
    );
  }

  const keySet = server.keys[provider];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-5">
      <div>
        <p className="label mb-1">Settings</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Models</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2 sm:text-[15px]">
          Choose where the agents get their intelligence. Pick a provider, then a model for each job. Every agent uses the equivalent model on whichever provider you choose.
        </p>
      </div>

      <section className="card flex flex-col gap-4 p-4 sm:p-5" aria-label="Provider">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight">Provider</h2>
            <p className="text-xs text-ink-3">{provider === "openrouter" ? "Free models are slower and rate limited, so checks take longer." : "Uses the Gemini API key on the server."}</p>
          </div>
          <Segmented value={provider} onChange={(v) => setProvider(v)} options={(["gemini", "openrouter"] as Provider[]).map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} />
        </div>

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight">Model for each agent</h2>
            <p className="text-xs text-ink-3">{list.length ? `${list.length} models available on ${PROVIDER_LABEL[provider]}.` : "Loading models…"}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={reset} icon={<RotateCcw className="size-3.5" />}>Use recommended</Button>
        </div>
        <ul className="mt-1 divide-y divide-line">
          {server.roles.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              provider={provider}
              value={draft[provider]?.[role.id] ?? server.defaults[provider][role.id]}
              models={list}
              dirty={dirty}
              test={tests[role.id]}
              onChange={(v) => setDraft((d) => ({ ...d, [provider]: { ...d[provider], [role.id]: v } }))}
              onTest={() => runTest(role.id)}
            />
          ))}
        </ul>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-float backdrop-blur sm:p-4">
        <p role="status" className={cx("min-w-0 flex-1 text-[13px]", message ? (message.ok ? "text-safe" : "text-danger") : "text-ink-3")}>
          {message?.text ?? (dirty ? "You have unsaved changes." : `Running on ${PROVIDER_LABEL[server.provider]}.`)}
        </p>
        <Button variant="primary" size="lg" disabled={!dirty || busy === "save"} onClick={save} icon={busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
