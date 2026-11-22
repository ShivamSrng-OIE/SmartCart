import { useCallback, useEffect, useState } from "react";
import { Bot, FileWarning, Loader2, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, TrendingDown } from "lucide-react";
import { ApiError, getBriefing, getTrust, resetTrust, type Incident, type ShopifyReport, type TrustOverview } from "../lib/marketplace";
import { money } from "../lib/format";
import { reasonLabel, statusTone } from "../lib/trust";
import { RatingChange, TrustMeter } from "./TrustBadge";
import { Button, Chip, cx } from "./ui";

const SOURCE_LABEL: Record<string, string> = { agent: "Assistant", cart: "Shopper’s cart", portal: "Seller’s listing" };
const SEVERITY: Record<string, { label: string; tone: "danger" | "warn" | "neutral" }> = {
  block: { label: "Blocked", tone: "danger" },
  escalate: { label: "Swapped", tone: "warn" },
  scan: { label: "Scan flag", tone: "neutral" },
};

function ago(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "safe" }) {
  return (
    <div className="card p-3.5 sm:p-4">
      <p className="label">{label}</p>
      <p className={cx("tnum mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]", tone === "danger" && "text-danger", tone === "safe" && "text-safe")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function IncidentRow({ i, name }: { i: Incident; name: string }) {
  const sev = SEVERITY[i.severity] ?? SEVERITY.scan;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone={sev.tone} mono={false}>{sev.label}</Chip>
        <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{i.title}</p>
        {i.amount > 0 && <span className="tnum text-[13px] font-semibold">{money(i.amount, true)} stopped</span>}
      </div>
      <p className="text-xs text-ink-3">
        {name} · found by {SOURCE_LABEL[i.source] ?? i.source} · {ago(i.ts)}
        {i.query ? ` · after searching “${i.query}”` : ""}
      </p>
      {i.reasons.length > 0 && <p className="text-[13px] text-ink-2">{i.reasons.map(reasonLabel).join(" · ")}</p>}
      {i.quotes[0] && <p className="rounded-md border border-danger-line bg-danger-soft px-2.5 py-1.5 text-[12px] break-words text-danger">“{i.quotes[0]}”</p>}
    </li>
  );
}

function ReportCard({ r }: { r: ShopifyReport }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-danger-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tnum rounded-md bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-white">{r.id}</span>
        <span className="text-xs text-ink-3">filed {ago(r.filed_at)}{r.incidents > 1 ? ` · updated ${ago(r.updated_at)} · ${r.incidents} incidents` : ""}</span>
      </div>
      <p className="truncate text-[14px] font-medium" title={r.title}>{r.title}</p>
      <p className="text-[13px] text-ink-2">
        Seller <span className="font-medium text-ink">{r.merchant_name}</span>
        {r.reasons.length > 0 && <> · {r.reasons.map(reasonLabel).join(", ")}</>}
      </p>
      {r.evidence[0] && <p className="rounded-md border border-danger-line bg-danger-soft px-2.5 py-1.5 text-[12px] break-words text-danger">“{r.evidence[0]}”</p>}
      <p className="mt-auto text-[11px] text-ink-3">For {r.to}, with the photos, the listing text and the order that was stopped.</p>
    </li>
  );
}

export function Trust() {
  const [data, setData] = useState<TrustOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<{ summary: string; model: string | null; source: "model" | "rules" } | null>(null);
  const [briefing_busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getTrust());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load marketplace trust.");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => !document.hidden && void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  const ask = async () => {
    setBusy(true);
    try {
      setBriefing(await getBriefing());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Carbon couldn’t write a briefing.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await resetTrust();
      setBriefing(null);
      setConfirmReset(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Sign in as the operator (Sell → sign in as “warehouse”) to reset the shared ledger." : err instanceof Error ? err.message : "Couldn’t reset.");
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  };

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <div className="h-16 w-1/2 animate-pulse rounded-lg bg-surface-2" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-24 animate-pulse" />)}</div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const names = Object.fromEntries(data.merchants.map((m) => [m.id, m.name]));
  const t = data.totals;
  const { analysis } = data;

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 sm:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label mb-1">Marketplace trust</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Which sellers can shoppers trust?</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2 sm:text-[15px]">
            Every time Safe Checkout stops a listing, for a shopper or for the assistant, it is remembered. Sellers with repeat problems lose trust, their stars drop, their products sink in search and carry a warning, and the listing is written up for Shopify’s review.
          </p>
          {data.session && <p className="mt-1.5 text-xs text-ink-3">These numbers belong to this visit: every session starts from the sellers’ original ratings.</p>}
        </div>
        {t.incidents > 0 &&
          (confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-ink-2">{data.session ? "Forget this visit’s incidents?" : "Forget everything?"}</span>
              <Button variant="primary" size="sm" className="bg-danger! text-white!" disabled={resetting} onClick={reset} icon={resetting ? <Loader2 className="size-3.5 animate-spin" /> : undefined}>Yes, reset</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)} icon={<RotateCcw className="size-3.5" />} title="Put every seller back to its original rating">Start over</Button>
          ))}
      </div>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Incidents recorded" value={String(t.incidents)} hint={`${t.by_source.agent ?? 0} by the assistant · ${t.by_source.cart ?? 0} at carts · ${t.by_source.portal ?? 0} at publishing`} />
        <Stat label="Stopped at checkout" value={String(t.blocked)} tone={t.blocked ? "danger" : undefined} hint="orders held by Safe Checkout" />
        <Stat label="Money protected" value={money(t.protected_usd, true)} tone={t.protected_usd ? "safe" : undefined} hint="value of the orders that were held" />
        <Stat label="Flagged sellers" value={`${t.flagged_merchants}`} tone={t.flagged_merchants ? "danger" : undefined} hint={`${t.flagged_products} listing${t.flagged_products === 1 ? "" : "s"} blocked`} />
        <Stat label="Ratings lowered" value={String(t.ratings_lowered)} tone={t.ratings_lowered ? "danger" : undefined} hint={`listings across ${t.merchants_lowered} seller${t.merchants_lowered === 1 ? "" : "s"}`} />
        <Stat label="Reports for Shopify" value={String(t.reports)} tone={t.reports ? "danger" : undefined} hint="listings written up for review" />
      </div>

      <section className="card flex flex-col gap-3 p-4 sm:p-5" aria-label="Carbon">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]"><Bot className="size-5 text-ink-2" /></span>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">Carbon’s briefing</h2>
              <p className="text-xs text-ink-3">The analyst that studies these incidents and decides what to demote.</p>
            </div>
          </div>
          <Button size="sm" onClick={ask} disabled={briefing_busy || t.incidents === 0} icon={briefing_busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}>
            {briefing ? "Refresh" : "Write a briefing"}
          </Button>
        </div>
        {briefing ? (
          <div>
            <p className="text-[15px] leading-relaxed text-ink">{briefing.summary}</p>
            <p className="mt-1.5 text-xs text-ink-3">{briefing.source === "model" ? `Written by ${briefing.model}` : "Summarised from the numbers (no model key set, or no model needed)"}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-3">{t.incidents === 0 ? "Nothing to analyse yet. Add a poisoned listing to a cart, or let the assistant shop, and Carbon will start learning." : "Press the button for a written summary of what Carbon has found."}</p>
        )}

        {(analysis.insights.length > 0 || analysis.actions.length > 0) && (
          <div className="grid grid-cols-1 gap-4 border-t border-line pt-3 lg:grid-cols-2">
            <div>
              <p className="label mb-2">What Carbon noticed</p>
              <ul className="flex flex-col gap-2">
                {analysis.insights.map((i, k) => (
                  <li key={k} className="flex items-start gap-2 text-[13px]">
                    <ShieldAlert className={cx("mt-0.5 size-4 shrink-0", i.severity === "high" ? "text-danger" : "text-warn")} />
                    <span><span className="font-medium">{i.title}.</span> <span className="text-ink-2">{i.detail}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="label mb-2">What it did about it</p>
              {analysis.actions.length ? (
                <ul className="flex flex-col gap-2">
                  {analysis.actions.map((a, k) => (
                    <li key={k} className="flex items-start gap-2 text-[13px]">
                      {a.action === "demote" ? <TrendingDown className="mt-0.5 size-4 shrink-0 text-warn" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
                      <span>
                        <span className="font-medium">{a.action === "demote" ? `Demoted ${a.merchant}` : `Warning on ${a.product}`}</span>
                        <span className="text-ink-2"> · {a.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-3">No sellers demoted yet.</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-4 sm:p-5" aria-label="Reports for Shopify">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-danger-soft shadow-[inset_0_0_0_1px_var(--danger-line)]"><FileWarning className="size-5 text-danger" /></span>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">Reports for Shopify</h2>
              <p className="text-xs text-ink-3">Each blocked listing and its seller, with the evidence, for Shopify’s merchant-trust review.</p>
            </div>
          </div>
          <Chip mono={false}>Queued here · nothing is sent automatically</Chip>
        </div>
        {data.reports.length ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {data.reports.map((r) => <ReportCard key={r.id} r={r} />)}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No reports yet. When Safe Checkout blocks a listing, its report shows up here.</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="card overflow-hidden" aria-label="Sellers">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-[17px] font-semibold tracking-tight">Sellers</h2>
            <p className="text-xs text-ink-3">Lowest trust first.</p>
          </div>
          <ul className="divide-y divide-line">
            {data.merchants.map((m) => (
              <li key={m.id} className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5", m.status === "flagged" && "bg-danger-soft/40")}>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="flex items-center gap-2 truncate text-[14px] font-medium">
                    {m.status === "flagged" ? <ShieldAlert className="size-4 shrink-0 text-danger" /> : <ShieldCheck className={cx("size-4 shrink-0", m.status === "watch" ? "text-warn" : "text-safe")} />}
                    <span className="truncate">{m.name}</span>
                  </p>
                  <p className="truncate text-xs text-ink-3">{m.location} · {m.listings} listings</p>
                </div>
                <RatingChange before={m.original_rating} after={m.rating} />
                <TrustMeter value={m.trust} status={m.status} />
                <Chip tone={statusTone(m.status)} mono={false} className="w-20 justify-center capitalize">{m.status}</Chip>
                <p className="tnum w-24 text-right text-xs text-ink-3">{m.incidents ? `${m.incidents} incident${m.incidents === 1 ? "" : "s"}` : "no incidents"}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-label="Recent incidents">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-[17px] font-semibold tracking-tight">Recent incidents</h2>
            <p className="text-xs text-ink-3">Updates automatically.</p>
          </div>
          {data.incidents.length ? (
            <ul className="thin-scroll max-h-[640px] divide-y divide-line overflow-y-auto px-4 sm:px-5">
              {data.incidents.map((i) => <IncidentRow key={i.id} i={i} name={names[i.merchant] ?? i.merchant} />)}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-ink-3">No incidents yet. Everything the marketplace has checked so far has been clean.</p>
          )}
        </section>
      </div>
    </div>
  );
}
