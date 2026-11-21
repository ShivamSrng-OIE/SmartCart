import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Tone } from "../state";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "brand";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "btn-primary disabled:opacity-40",
  secondary: "btn-secondary disabled:opacity-50",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40",
  brand: "btn-brand disabled:opacity-40",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-[13px]",
  md: "h-9 gap-2 rounded-lg px-3 text-[13px]",
  lg: "h-11 gap-2 rounded-[10px] px-4 text-[14px]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode; trailing?: ReactNode }
>(function Button({ variant = "secondary", size = "md", icon, trailing, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,opacity,border-color,transform] duration-150 select-none active:scale-[0.98]",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink active:scale-95 disabled:opacity-40",
        active && "bg-surface-2 text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-2",
  danger: "text-danger",
  safe: "text-safe",
  warn: "text-warn",
};
const TONE_CHIP: Record<Tone, string> = {
  neutral: "border-line bg-surface-2 text-ink-2",
  danger: "border-danger-line bg-danger-soft text-danger",
  safe: "border-safe-line bg-safe-soft text-safe",
  warn: "border-warn-line bg-warn-soft text-warn",
};
const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-ink-3",
  danger: "bg-danger",
  safe: "bg-safe",
  warn: "bg-warn",
};

export const toneText = (t: Tone) => TONE_TEXT[t];

export function Chip({ tone = "neutral", children, className, mono = true }: { tone?: Tone; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium whitespace-nowrap",
        mono && "font-mono tracking-wide",
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cx("relative inline-flex size-2 shrink-0", className)}>
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", TONE_DOT[tone])} />}
      <span className={cx("relative inline-flex size-2 rounded-full", TONE_DOT[tone])} />
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[10px] text-ink-3">
      {children}
    </kbd>
  );
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-3", className)}>
      <h3 className="label">{children}</h3>
      {aside}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-xl border border-line bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap transition-all",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
