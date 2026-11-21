import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AudioLines, Camera, FileText, Film, ImagePlus, Mic, Paperclip, Play, RotateCcw, Square, TriangleAlert, Video, X } from "lucide-react";
import { useCamera, useRecorder, useSpeech } from "../hooks/useMedia";
import { SCENARIOS } from "../config";
import { useDraft, type Attached, type MediaKind } from "../draft";
import { money } from "../lib/format";
import { parseItems } from "../lib/intent";
import { gsap, d } from "../lib/motion";
import type { Mode } from "../hooks/useBackend";
import { ProductPicker } from "./ProductPicker";
import { Button, Chip, Dot, IconButton, Kbd, cx } from "./ui";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KIND_ICON: Record<MediaKind, typeof Camera> = { image: Camera, audio: AudioLines, video: Film, pdf: FileText };

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return null;
}

export function ModeBadge({ mode }: { mode: Mode }) {
  return mode === "replay" ? (
    <Chip tone="warn" className="h-6" mono={false}>
      <TriangleAlert className="size-3" /> Sample data
    </Chip>
  ) : (
    <Chip tone="safe" className="h-6" mono={false}>
      <Dot tone="safe" pulse /> Live
    </Chip>
  );
}

export function RequestPanel({
  mode,
  busy,
  onRun,
  onReset,
  canReset,
  wide = false,
  title = "Your request",
  runLabel = "Run",
  className,
}: {
  mode: Mode;
  busy: boolean;
  onRun: () => void;
  onReset: () => void;
  canReset: boolean;
  /** horizontal layout for the side-by-side compare page */
  wide?: boolean;
  title?: string;
  runLabel?: string;
  className?: string;
}) {
  const { draft, intent, scenario, set, attach, detach, pickScenario } = useDraft();
  const root = useRef<HTMLElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const cam = useCamera();
  const speech = useSpeech(useCallback((text: string) => set({ request: text }), [set]));
  const recorder = useRecorder(useCallback((blob: Blob) => attach("audio", blob, "mic-clip.webm", "mic"), [attach]));

  const canRun = draft.request.trim().length > 2 && !busy;
  const items = parseItems(draft.request);
  const image = draft.media.image;
  const others = (["audio", "video", "pdf"] as MediaKind[]).map((k) => draft.media[k]).filter(Boolean) as Attached[];

  const flashFields = () =>
    gsap.fromTo(root.current!.querySelectorAll("[data-fill]"), { backgroundColor: "var(--surface-2)" }, { backgroundColor: "var(--surface)", duration: d(0.8), ease: "power2.out", clearProps: "backgroundColor" });

  const snap = async () => {
    const blob = await cam.snap();
    if (!blob) return;
    attach("image", blob, "webcam-frame.jpg", "camera");
    gsap.fromTo(flashRef.current, { opacity: 0.9 }, { opacity: 0, duration: d(0.45), ease: "power2.out" });
    cam.stop();
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const k = kindOf(f);
      if (k) attach(k, f, f.name, "upload");
    }
  };

  const submit = useCallback(() => {
    if (canRun) onRun();
  }, [canRun, onRun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  };

  /* ---------------------------------------------------------------- pieces */

  const scenarios = (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">Examples</span>
      <div className="flex flex-wrap gap-1.5">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              pickScenario(s);
              flashFields();
            }}
            title={s.summary}
            className={cx(
              "inline-flex min-h-8 items-center gap-2 rounded-lg border px-2.5 py-1 text-left text-[13px] font-medium transition-colors",
              scenario?.id === s.id ? "border-ink bg-ink text-ink-inverse" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            {s.title}
          </button>
        ))}
      </div>
      {scenario && <p className="text-xs text-ink-3">{scenario.summary}</p>}
    </div>
  );

  const photo = (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[13px] font-medium">
        Photo <span className="text-xs font-normal text-ink-3">optional</span>
      </span>
      <div
        className={cx("relative overflow-hidden rounded-xl border bg-sunken", wide ? "aspect-[4/3] xl:aspect-auto xl:h-[150px]" : "aspect-[2/1]", dragging ? "border-ink" : "border-line")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <video ref={cam.videoRef} playsInline muted className={cx("absolute inset-0 size-full object-cover", cam.state !== "live" && "hidden")} />
        {image && cam.state !== "live" && <img src={image.url} alt="Attached product photo" className="absolute inset-0 size-full object-cover" />}
        <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-white opacity-0" />

        {!image && cam.state !== "live" && (
          <div className="hairline-grid absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={<Video className="size-3.5" />} onClick={cam.start} disabled={cam.state === "starting"}>
                {cam.state === "starting" ? "Starting…" : "Use camera"}
              </Button>
              <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Upload
              </Button>
            </div>
            <p className="text-xs text-ink-3">
              {cam.state === "denied" ? "Camera blocked. Allow it in the browser, or upload a photo." : cam.state === "unavailable" ? "No camera found. Upload or drop a photo." : "Show the product to the camera, or drop a photo here."}
            </p>
          </div>
        )}

        {cam.state === "live" && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[11px] text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-danger" /> Camera on
            </span>
            <div className="flex gap-1.5">
              <button onClick={cam.stop} className="rounded-lg bg-black/50 px-2.5 py-1.5 text-xs text-white hover:bg-black/70">
                Cancel
              </button>
              <button onClick={snap} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90">
                <Camera className="size-3.5" /> Take photo
              </button>
            </div>
          </div>
        )}

        {image && cam.state !== "live" && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2.5">
            <span className="rounded-md bg-black/50 px-2 py-1 text-[11px] text-white">Photo attached</span>
            <div className="flex gap-1.5">
              <button onClick={() => detach("image")} className="rounded-lg bg-black/50 px-2.5 py-1.5 text-xs text-white hover:bg-black/70">
                Remove
              </button>
              <button onClick={cam.start} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90">
                <RotateCcw className="size-3.5" /> Retake
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const request = (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor="request" className="text-[13px] font-medium">
        What are you looking for?
      </label>
      <div className="relative">
        <textarea
          id="request"
          data-fill
          value={draft.request}
          onChange={(e) => set({ request: e.target.value })}
          rows={2}
          placeholder="Buy one pack of these under $25"
          maxLength={1000}
          className={cx("field resize-none pr-12 text-base leading-relaxed", wide ? "min-h-[88px] sm:text-[17px]" : "min-h-[76px]")}
        />
        {speech.supported && (
          <IconButton
            label={speech.listening ? "Stop listening" : "Speak your request"}
            onClick={speech.listening ? speech.stop : speech.start}
            active={speech.listening}
            className={cx("absolute top-2 right-2", speech.listening && "text-danger")}
          >
            {speech.listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
          </IconButton>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Understood as:{" "}
        {items.length > 1 ? (
          <span className="text-ink-2">{items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</span>
        ) : (
          <>
            buy <span className="font-medium text-ink-2">{intent.quantity}</span>
          </>
        )}
        {intent.budget != null ? (
          <>
            , spend at most <span className="font-medium text-ink-2">{money(intent.budget)}</span>
          </>
        ) : (
          ", no budget"
        )}
      </p>
    </div>
  );

  const budgetAndProduct = (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Budget</span>
        <div className="relative" data-fill>
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">$</span>
          <input
            inputMode="decimal"
            value={draft.budget}
            onChange={(e) => set({ budget: e.target.value.replace(/[^\d.]/g, "") })}
            placeholder="25"
            className="field tnum h-[42px] pl-7"
            aria-label="Budget in dollars"
          />
        </div>
      </label>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] font-medium">Product</span>
        <ProductPicker value={draft.product} onChange={(product) => set({ product })} live={mode === "live"} />
      </div>
    </div>
  );

  const attachments = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" icon={<Paperclip className="size-3.5" />} onClick={() => fileRef.current?.click()}>
        Attach audio, video or PDF
      </Button>
      {recorder.supported && (
        <Button
          size="sm"
          variant="ghost"
          className={recorder.recording ? "text-danger" : undefined}
          icon={recorder.recording ? <Square className="size-3 fill-current" /> : <AudioLines className="size-3.5" />}
          onClick={recorder.recording ? recorder.stop : recorder.start}
        >
          {recorder.recording ? `Stop · 0:${String(recorder.seconds).padStart(2, "0")}` : "Record a clip"}
        </Button>
      )}
      {others.map((m) => {
        const Icon = KIND_ICON[m.kind];
        return (
          <span key={m.kind} className="inline-flex h-7 max-w-[200px] items-center gap-1.5 rounded-lg border border-line bg-surface-2 pr-1 pl-2 text-xs text-ink-2">
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{m.name}</span>
            <button onClick={() => detach(m.kind)} className="rounded p-0.5 hover:bg-line" aria-label={`Remove ${m.name}`}>
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,audio/*,video/*,application/pdf"
        multiple
        hidden
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );

  const actions = (
    <div className="flex items-stretch gap-2">
      <Button
        variant="primary"
        size="lg"
        onClick={submit}
        disabled={!canRun}
        className="flex-1"
        icon={<Play className="size-4 fill-current" />}
        trailing={
          <span className="ml-1 hidden items-center gap-0.5 opacity-60 lg:inline-flex">
            <Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>↵</Kbd>
          </span>
        }
      >
        {busy ? "Running…" : runLabel}
      </Button>
      {canReset && (
        <Button size="lg" variant="secondary" onClick={onReset} icon={<RotateCcw className="size-4" />} aria-label="Start over">
          <span className="hidden sm:inline">Start over</span>
        </Button>
      )}
    </div>
  );

  if (!wide) {
    // Stacked: the Run button is pinned to the bottom so it never scrolls out of view.
    return (
      <section ref={root} className={cx("card flex flex-col overflow-hidden lg:max-h-[calc(100dvh-96px)]", className)} aria-label={title}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <ModeBadge mode={mode} />
        </div>
        <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {scenarios}
          <div className="h-px shrink-0 bg-line" />
          {request}
          {budgetAndProduct}
          {photo}
          {attachments}
        </div>
        <div className="border-t border-line bg-surface p-3">{actions}</div>
      </section>
    );
  }

  return (
    <section ref={root} className={cx("card p-4", className)} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <ModeBadge mode={mode} />
      </div>

      <div className="flex flex-col gap-3">
          {scenarios}
          <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_380px_200px]">
            {photo}
            {request}
            <div className="flex min-w-0 flex-col gap-3">
              {budgetAndProduct}
              {attachments}
            </div>
            <div className="flex flex-col justify-end md:col-span-2 xl:col-span-1">{actions}</div>
          </div>
        </div>
    </section>
  );
}
