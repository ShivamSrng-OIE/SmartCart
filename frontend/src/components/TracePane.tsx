import { useRef, useState, type ReactNode } from "react";
import { ChevronRight, ShieldAlert, ShieldCheck, ShieldX, Bot, ScanEye } from "lucide-react";
import type { PaneState, Step } from "../state";
import type { ProductLedger } from "../lib/spend";
import { money, ms, secs, shortId, toolLabel } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { Chip, Dot, cx, toneText } from "./ui";

type Variant = "victim" | "guarded";

const STATUS: Record<Variant, Record<PaneState["status"], { label: string; tone: "neutral" | "danger" | "safe" | "warn" }>> = {
  victim: {
    idle: { label: "Waiting", tone: "neutral" },
    running: { label: "Working", tone: "neutral" },
    hijacked: { label: "Unexpected order", tone: "danger" },
    intercepted: { label: "Cart ready", tone: "neutral" },
    blocked: { label: "Held", tone: "warn" },
    escalated: { label: "Alternative", tone: "warn" },
    approved: { label: "Verified", tone: "safe" },
    firewall_error: { label: "On hold", tone: "warn" },
  },
  guarded: {
    idle: { label: "Waiting", tone: "neutral" },
    running: { label: "Working", tone: "neutral" },
    hijacked: { label: "Unexpected order", tone: "danger" },
    intercepted: { label: "Prepared", tone: "warn" },
    blocked: { label: "Held", tone: "warn" },
    escalated: { label: "Alternative", tone: "warn" },
    approved: { label: "Verified", tone: "safe" },
    firewall_error: { label: "On hold", tone: "warn" },
  },
};

// Role first, model in the tooltip: judges read roles, engineers can still hover for the model.
const SOURCE_LABEL: Record<string, string> = {
  argon: "Photo",
  hydrogen: "Assistant",
  neon: "Review",
  carttrap: "Safe Checkout",
  firewall: "Safe Checkout",
};
const SOURCE_MODEL: Record<string, string> = { argon: "Gemini 4 Argon", hydrogen: "Gemini 4 Hydrogen", neon: "Gemini 4 Neon" };

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function linesText(args: Record<string, unknown>, products: ProductLedger): string | null {
  const lines = (args.lines ?? args.line_items) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(lines) || !lines.length) return null;
  return lines
    .map((l) => {
      const p = products[String(l.product_id ?? "")];
      const title = (p?.title as string | undefined) ?? shortId(l.product_id);
      return `${l.quantity ?? l.qty ?? 1} × ${title}`;
    })
    .join(", ");
}

/** Model replies can carry markdown (**bold**, list dashes); the trace shows plain sentences. */
export function plainText(text: string | undefined | null): string {
  return (text ?? "").replace(/\*\*|__/g, "").replace(/(^|\s)[-*] (?=\S)/g, "$1").replace(/\s+/g, " ").trim();
}

/** One human sentence per step; JSON stays one tap away. */
function summarize(step: Step, products: ProductLedger): ReactNode {
  const a = step.args ?? {};
  const r = obj(step.result);
  switch (step.title) {
    case "search_catalog": {
      const n = Array.isArray(r.products) ? r.products.length : Array.isArray(step.result) ? (step.result as unknown[]).length : null;
      return (
        <>
          “{String(a.query ?? obj(a.catalog).query ?? "")}”{n != null && <span className="text-ink-3"> → {n} result{n === 1 ? "" : "s"}</span>}
        </>
      );
    }
    case "get_product":
    case "lookup_catalog": {
      const title = (r.title as string | undefined) ?? (products[String(a.product_id ?? "")]?.title as string | undefined);
      const price = typeof r.price === "number" ? r.price : null;
      return title ? (
        <>
          {title}
          {price != null && <span className="text-ink-3"> · {money(price)}</span>}
        </>
      ) : (
        <span className="text-ink-3">{shortId(a.product_id ?? a.ref)}</span>
      );
    }
    default: {
      const lt = linesText(a, products);
      if (lt) return lt;
      if (a.amount != null) return `${money(Number(a.amount))} to an external card`;
      return null;
    }
  }
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="thin-scroll mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StepRow({ step, products, variant, quiet }: { step: Step; products: ProductLedger; variant: Variant; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  const source = typeof step.data.source === "string" ? step.data.source : undefined;

  // Quiet mode (Assistant pages): the order card already shows this, so keep the row compact.
  if (step.kind === "intercepted" && quiet) {
    return (
      <li data-step className="flex items-start gap-3 py-1.5">
        <span className="tnum w-12 shrink-0 pt-0.5 text-right text-[11px] text-ink-3">{secs(step.t_ms)}</span>
        <span className="mt-[7px] shrink-0">
          <Dot tone={step.tone === "danger" ? "danger" : "neutral"} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">Order prepared</span>
          <span className="block truncate text-[13px] text-ink-2">
            {summarize(step, products) ?? "—"}
            <span className="text-ink-3"> · not submitted</span>
          </span>
        </span>
        {step.spend != null && <span className={cx("tnum shrink-0 text-xs", step.tone === "danger" ? "text-danger" : "text-ink-2")}>{money(step.spend)}</span>}
      </li>
    );
  }

  // The hijacked call: the moment the left pane exists to show.
  if (step.kind === "intercepted") {
    const danger = step.tone === "danger";
    return (
      <li data-step className={cx("rounded-xl border p-3.5", danger ? "border-danger-line bg-danger-soft" : "border-warn-line bg-warn-soft")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cx("flex items-center gap-2 text-[13px] font-semibold", danger ? "text-danger" : "text-warn")}>
              <ShieldAlert className="size-4" />
              {danger ? "Order doesn’t match your request" : "Order ready"}
            </div>
            <p className="mt-1 text-[15px] font-medium text-ink">
              {toolLabel(step.title)}
              <span className="font-normal text-ink-2"> · {summarize(step, products) ?? "—"}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">The order was prepared but not submitted, so nothing was charged.</p>
          </div>
          {step.spend != null && (
            <div className="text-right">
              <div className={cx("tnum text-xl font-semibold tracking-tight", danger ? "text-danger" : "text-ink")}>{money(step.spend)}</div>
              <div className="label mt-0.5">order total</div>
            </div>
          )}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
          <ChevronRight className={cx("size-3 transition-transform", open && "rotate-90")} /> Arguments
        </button>
        {open && <JsonBlock value={step.args} />}
      </li>
    );
  }

  if (step.kind === "verdict" && step.verdict) {
    const v = step.verdict;
    const Icon = v.error ? ShieldX : v.action === "approve_checkout" ? ShieldCheck : v.action === "escalate_to_neon_swap" ? ShieldAlert : ShieldX;
    const label = v.error
      ? "Verification unavailable, order held"
      : v.action === "approve_checkout"
        ? "Order verified"
        : v.action === "escalate_to_neon_swap"
          ? "Better match suggested"
          : "Order held for review";
    return (
      <li data-step className="flex items-center gap-3 py-2">
        <span className="tnum w-12 shrink-0 text-right text-[11px] text-ink-3">{secs(step.t_ms)}</span>
        <div className={cx("flex min-w-0 flex-1 items-center gap-2 text-[14px] font-semibold", toneText(step.tone))}>
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
          <span className="tnum ml-auto text-xs font-medium text-ink-3">{ms(v.latency_ms)}</span>
        </div>
      </li>
    );
  }

  if (step.kind === "log" || step.kind === "fraud_card") {
    if (step.kind === "fraud_card") {
      return (
        <li data-step className="flex items-center gap-3 py-1.5">
          <span className="tnum w-12 shrink-0 text-right text-[11px] text-ink-3">{secs(step.t_ms)}</span>
          <span className="text-[13px] text-ink-2">Review details ready</span>
        </li>
      );
    }
    const Icon = source === "argon" ? ScanEye : Bot;
    return (
      <li data-step className="flex items-start gap-3 py-1.5">
        <span className="tnum w-12 shrink-0 pt-0.5 text-right text-[11px] text-ink-3">{secs(step.t_ms)}</span>
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
          <p className="min-w-0 text-[13px] leading-snug text-ink-2">
            {source && (
              <span className="font-medium text-ink" title={SOURCE_MODEL[source]}>
                {SOURCE_LABEL[source] ?? source}:{" "}
              </span>
            )}
            {plainText(step.message)}
          </p>
        </div>
      </li>
    );
  }

  // tool_call (+ attached result)
  const pending = step.tone === "warn" && !step.verdict && variant === "guarded";
  return (
    <li data-step className="group">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 rounded-lg py-1.5 text-left">
        <span className="tnum w-12 shrink-0 pt-0.5 text-right text-[11px] text-ink-3">{secs(step.t_ms)}</span>
        <span className="mt-[7px] shrink-0">
          <Dot tone={step.tone === "neutral" ? "neutral" : step.tone} pulse={pending} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cx("text-[14px] font-medium", step.tone === "neutral" ? "text-ink" : toneText(step.tone))}>{toolLabel(step.title)}</span>
            {source === "neon" && <Chip className="h-5 px-1.5 text-[10px]">alternative</Chip>}
            {pending && <span className="text-xs text-warn">verifying…</span>}
            {step.spend != null && <span className="tnum ml-auto pl-2 text-xs text-ink-2">{money(step.spend)}</span>}
          </span>
          <span className="block truncate text-[13px] text-ink-2">{summarize(step, products)}</span>
        </span>
        <ChevronRight className={cx("mt-1 size-3.5 shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100", open && "rotate-90 opacity-100")} />
      </button>
      {open && (
        <div className="pb-2 pl-[68px]">
          <JsonBlock value={{ arguments: step.args, ...(step.result !== undefined ? { result: step.result } : {}) }} />
        </div>
      )}
    </li>
  );
}

export function TracePane({
  variant,
  pane,
  products,
  className,
  headerExtra,
  footer,
  compact,
  bare,
  quiet,
}: {
  quiet?: boolean;
  variant: Variant;
  pane: PaneState;
  products: ProductLedger;
  className?: string;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  /** list only, no card chrome (used inside the CartTrap panel's tabs) */
  bare?: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const st = STATUS[variant][pane.status];
  const seen = useRef(0);

  useGSAP(
    () => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-step]");
      if (!rows) return;
      if (rows.length < seen.current) seen.current = 0; // reset between runs
      const fresh = Array.from(rows).slice(seen.current);
      seen.current = rows.length;
      if (fresh.length) {
        gsap.from(fresh, { y: 8, opacity: 0, duration: d(0.35), stagger: 0.05, ease: "power2.out" });
        const last = fresh[fresh.length - 1];
        listRef.current?.parentElement?.scrollTo({ top: last.offsetTop, behavior: "smooth" });
      }
    },
    { dependencies: [pane.steps.length], scope: listRef },
  );

  useGSAP(
    () => {
      if (st.tone === "danger" && statusRef.current) {
        gsap.fromTo(statusRef.current, { x: -6 }, { x: 0, duration: d(0.5), ease: "elastic.out(1.2, 0.35)" });
      } else if (statusRef.current) {
        gsap.from(statusRef.current, { opacity: 0, y: 4, duration: d(0.3) });
      }
    },
    { dependencies: [pane.status] },
  );

  const title = variant === "victim" ? "Assistant activity" : "Assistant activity";
  const subtitle = variant === "victim" ? "Assistant" : "Safe Checkout";

  const list =
    pane.steps.length === 0 ? (
      <div className="flex h-full min-h-[120px] items-center justify-center px-6 text-center text-sm text-ink-3">
        {variant === "victim" ? "Steps appear here as the assistant searches and builds your cart." : "Steps appear here, including the check before the order is placed."}
      </div>
    ) : (
      <ol ref={listRef} className="relative flex flex-col gap-0.5">
        {pane.steps.map((s) => (
          <StepRow key={s.id} step={s} products={products} variant={variant} quiet={quiet} />
        ))}
      </ol>
    );

  if (bare) {
    return <div className={cx("thin-scroll min-h-0 overflow-y-auto", className)}>{list}</div>;
  }

  return (
    <section className={cx("card flex min-h-0 flex-col overflow-hidden", className)} aria-label={title}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="label">{subtitle}</p>
          <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">{title}</h2>
        </div>
        <div ref={statusRef} className="flex items-center gap-2">
          {headerExtra}
          <Chip tone={st.tone} className="h-7 px-2.5 text-xs">
            <Dot tone={st.tone} pulse={pane.status === "running"} />
            {st.label}
          </Chip>
        </div>
      </header>
      <div className={cx("thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2", compact ? "max-h-[360px]" : "")}>
        {list}
      </div>
      {footer && <footer className="border-t border-line px-4 py-3">{footer}</footer>}
    </section>
  );
}
