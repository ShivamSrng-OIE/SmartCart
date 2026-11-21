import { Quote } from "lucide-react";
import type { EvidenceItem } from "../types";

type Box = number[];

function BoxOverlay({ box }: { box: Box }) {
  const [y0, x0, y1, x1] = box;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute animate-pulse rounded-sm border-2 border-danger shadow-[0_0_0_2px_rgba(0,0,0,0.5)]"
      style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
    />
  );
}

function Located({ src, box, alt }: { src: string; box: Box; alt: string }) {
  return (
    <div className="relative inline-block max-w-full self-start leading-none">
      <img src={src} alt={alt} className="block max-h-56 max-w-full rounded-lg border border-line" />
      <BoxOverlay box={box} />
    </div>
  );
}

function Said({ text }: { text: string }) {
  return (
    <p className="flex gap-2 text-[14px] text-ink">
      <Quote className="mt-1 size-3 shrink-0 text-danger" aria-hidden />
      <span className="font-mono text-[13px] leading-snug">{text}</span>
    </p>
  );
}

function Waveform({ peaks, seg }: { peaks: number[]; seg: [number, number] }) {
  const n = Math.max(1, peaks.length);
  const max = Math.max(1e-6, ...peaks);
  return (
    <svg
      viewBox={`0 0 ${n} 40`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Waveform; the hidden instruction is highlighted from bar ${seg[0]} to ${seg[1]}`}
      className="h-20 w-full rounded-lg border border-line bg-surface-2"
    >
      {peaks.map((p, i) => {
        const h = Math.max(1, (p / max) * 38);
        const hot = i >= seg[0] && i <= seg[1];
        return <rect key={i} x={i + 0.15} y={20 - h / 2} width={0.7} height={h} className={hot ? "fill-danger" : "fill-ink-3"} />;
      })}
    </svg>
  );
}

function Annotated({ src, caption, alt }: { src: string; caption: string; alt: string }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <a href={src} target="_blank" rel="noopener noreferrer" title="Open full size">
        <img src={src} alt={alt} className="max-h-[420px] w-full cursor-zoom-in rounded-lg border border-danger-line bg-black object-contain" />
      </a>
      <figcaption className="text-[13px] font-medium text-ink-2">{caption}</figcaption>
    </figure>
  );
}

function Callout({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="flex gap-2 rounded-lg border-2 border-danger bg-danger/10 px-3 py-2 text-ink">
      <Quote className="mt-1 size-3.5 shrink-0 text-danger" aria-hidden />
      <span className="font-mono text-[14px] leading-snug font-semibold text-danger">&ldquo;{text}&rdquo;</span>
    </p>
  );
}

function Item({ item, photoUrl }: { item: EvidenceItem; photoUrl?: string }) {
  if (item.modality === "image") {
    if (item.crop_url) {
      return (
        <div className="flex flex-col gap-2.5">
          <Annotated src={item.crop_url} caption="Hidden instruction found in the product photo" alt="Product photo with the hidden instruction boxed in red and zoomed" />
          <Callout text={item.text} />
        </div>
      );
    }
    const full = item.source_url ?? photoUrl;
    return (
      <div className="flex flex-col gap-2.5">
        {full && <Located src={full} box={item.box} alt="Full image with the hidden text outlined" />}
        <Said text={item.text} />
      </div>
    );
  }
  if (item.modality === "video") {
    const t = item.t_s.toFixed(1);
    return (
      <div className="flex flex-col gap-2.5">
        <Annotated src={item.frame_url} caption={`Frame at ${t}s of the product video`} alt={`Video frame at ${t} seconds with the hidden instruction boxed in red`} />
        <Callout text={item.text} />
      </div>
    );
  }
  const [i0, i1] = item.seg;
  return (
    <div className="flex flex-col gap-2.5">
      <Waveform peaks={item.peaks} seg={[i0, i1]} />
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-semibold text-danger">
          Hear the hidden part ({item.start_s.toFixed(1)}&ndash;{item.end_s.toFixed(1)}s)
        </p>
        <audio controls src={item.clip_url} className="h-12 w-full" aria-label="Audio clip with the hidden instruction" />
      </div>
      <Callout text={item.transcript} />
    </div>
  );
}

export function Evidence({ items, photoUrl }: { items: EvidenceItem[]; photoUrl?: string }) {
  if (!items.length) return null;
  return (
    <section aria-label="Where the hidden instruction is" className="rounded-xl border border-danger-line p-3.5">
      <h3 className="label mb-2.5 text-danger!">Where the hidden instruction is</h3>
      <div className="flex flex-col gap-4">
        {items.map((it, i) => (
          <Item key={i} item={it} photoUrl={photoUrl} />
        ))}
      </div>
    </section>
  );
}
