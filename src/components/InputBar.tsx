import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Camera, FileText, Film, ImagePlus, Mic, Paperclip, Play, RotateCcw, Square, Video, X, AudioLines } from "lucide-react";
import { useCamera, useRecorder, useSpeech } from "../hooks/useMedia";
import { SCENARIOS, type FixtureName, type Scenario } from "../config";
import { findDemo, refFromProduct, type ProductRef } from "../catalog";
import { ProductPicker } from "./ProductPicker";
import { parseIntent } from "../lib/intent";
import { money } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import type { RunInput } from "../hooks/useArena";
import type { Mode } from "../hooks/useBackend";
import { Button, IconButton, Kbd, cx } from "./ui";

type MediaKind = "image" | "audio" | "video" | "pdf";
interface Attached {
  kind: MediaKind;
  blob: Blob;
  name: string;
  url: string;
  source: "camera" | "upload" | "mic";
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KIND_ICON: Record<MediaKind, typeof Camera> = { image: Camera, audio: AudioLines, video: Film, pdf: FileText };

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return null;
}

export function InputBar({
  mode,
  busy,
  onRun,
  onReset,
  canReset,
  product,
  onProduct,
}: {
  mode: Mode;
  busy: boolean;
  onRun: (input: RunInput) => void;
  onReset: () => void;
  canReset: boolean;
  product: ProductRef | null;
  onProduct: (p: ProductRef | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [request, setRequest] = useState(SCENARIOS[0].request);
  const [budget, setBudget] = useState(SCENARIOS[0].budget);
  const [media, setMedia] = useState<Partial<Record<MediaKind, Attached>>>({});
  const [scenario, setScenario] = useState<Scenario | null>(SCENARIOS[0]);
  const [dragging, setDragging] = useState(false);

  const cam = useCamera();
  const speech = useSpeech(
    useCallback((text: string) => {
      setRequest(text);
      setScenario((s) => s);
    }, []),
  );
  const recorder = useRecorder(
    useCallback((blob: Blob) => attach("audio", blob, "mic-clip.webm", "mic"), []), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const attach = (kind: MediaKind, blob: Blob, name: string, source: Attached["source"]) => {
    setMedia((m) => {
      if (m[kind]) URL.revokeObjectURL(m[kind]!.url);
      return { ...m, [kind]: { kind, blob, name, url: URL.createObjectURL(blob), source } };
    });
  };
  const detach = (kind: MediaKind) =>
    setMedia((m) => {
      if (m[kind]) URL.revokeObjectURL(m[kind]!.url);
      const next = { ...m };
      delete next[kind];
      return next;
    });

  const intent = parseIntent(request, budget);
  const fixture: FixtureName = scenario?.fixture ?? "attack";
  const canRun = request.trim().length > 2 && !busy;

  const pickScenario = (s: Scenario) => {
    setScenario(s);
    setRequest(s.request);
    setBudget(s.budget);
    const demo = findDemo(s.productId);
    onProduct(demo ? refFromProduct(demo) : null);
    gsap.fromTo(
      root.current!.querySelectorAll("[data-fill]"),
      { backgroundColor: "var(--surface-2)" },
      { backgroundColor: "transparent", duration: d(0.8), ease: "power2.out", clearProps: "backgroundColor" },
    );
  };

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
    if (!canRun) return;
    const form = new FormData();
    form.set("request", request.trim());
    if (budget.trim()) form.set("budget", budget.trim());
    if (product?.url && !product.id) form.set("product_url", product.url);
    if (product?.id) form.set("demo_product_id", product.id);
    for (const m of Object.values(media)) if (m) form.set(m.kind, m.blob, m.name);
    form.set("mode", "both");
    onRun({ form, intent, fixture });
  }, [canRun, request, budget, product, media, onRun, intent, fixture]);

  // ⌘/Ctrl + Enter runs from anywhere.
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

  useGSAP(
    () => {
      gsap.from("[data-chip]", { y: 6, opacity: 0, stagger: 0.04, duration: d(0.4), ease: "power2.out" });
    },
    { scope: root, dependencies: [Object.keys(media).join()] },
  );

  const image = media.image;
  const others = (["audio", "video", "pdf"] as MediaKind[]).map((k) => media[k]).filter(Boolean) as Attached[];

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  };

  return (
    <section ref={root} className="card p-3 sm:p-4" aria-label="Scenario">
      {/* Scenario presets */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="label mr-1">Scenario</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => pickScenario(s)}
            title={s.summary}
            className={cx(
              "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors",
              scenario?.id === s.id ? "border-ink bg-ink text-ink-inverse" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            <span className={cx("size-1.5 rounded-full", s.expect === "block" ? "bg-danger" : "bg-safe")} />
            {s.title}
          </button>
        ))}
        {mode === "replay" && (
          <span className="ml-auto hidden text-xs text-ink-3 md:inline">Replay mode plays the recorded run for the selected scenario.</span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_380px_auto]">
        {/* Camera */}
        <div
          className={cx(
            "relative aspect-[16/10] overflow-hidden rounded-xl border bg-sunken sm:aspect-[4/3] md:row-span-2 xl:row-span-1 xl:aspect-auto xl:h-[150px]",
            dragging ? "border-ink" : "border-line",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <video ref={cam.videoRef} playsInline muted className={cx("absolute inset-0 size-full object-cover", cam.state !== "live" && "hidden")} />
          {image && cam.state !== "live" && <img src={image.url} alt="Snapped frame" className="absolute inset-0 size-full object-cover" />}
          <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-white opacity-0" />

          {!image && cam.state !== "live" && (
            <div className="hairline-grid absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <div className="flex gap-2">
                <Button size="sm" variant="primary" icon={<Video className="size-3.5" />} onClick={cam.start} disabled={cam.state === "starting"}>
                  {cam.state === "starting" ? "Starting…" : "Camera"}
                </Button>
                <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                  Upload
                </Button>
              </div>
              <p className="text-xs text-ink-3">
                {cam.state === "denied"
                  ? "Camera blocked. Allow it in the browser, or upload a photo."
                  : cam.state === "unavailable"
                    ? "No camera found. Upload or drop a photo."
                    : "Hold the product up, or drop a photo here."}
              </p>
            </div>
          )}

          {cam.state === "live" && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 font-mono text-[10px] tracking-wider text-white uppercase">
                <span className="size-1.5 animate-pulse rounded-full bg-danger" /> Live
              </span>
              <div className="flex gap-1.5">
                <button onClick={cam.stop} className="rounded-lg bg-black/50 px-2.5 py-1.5 text-xs text-white hover:bg-black/70">
                  Cancel
                </button>
                <button onClick={snap} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90">
                  <Camera className="size-3.5" /> Snap
                </button>
              </div>
            </div>
          )}

          {image && cam.state !== "live" && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2.5">
              <span className="rounded-md bg-black/50 px-2 py-1 font-mono text-[10px] tracking-wider text-white uppercase">Untrusted image</span>
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

        {/* Request — the only trusted input */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="request" className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink">What should the agent buy?</span>
            <span className="label hidden sm:inline">Trusted intent</span>
          </label>
          <div className="relative flex-1">
            <textarea
              id="request"
              data-fill
              value={request}
              onChange={(e) => {
                setRequest(e.target.value);
              }}
              rows={2}
              placeholder="Buy one pack of these under $25"
              className="field h-full min-h-[88px] resize-none pr-12 text-base leading-relaxed sm:text-[17px] xl:min-h-0"
            />
            {speech.supported && (
              <IconButton
                label={speech.listening ? "Stop listening" : "Push to talk"}
                onClick={speech.listening ? speech.stop : speech.start}
                active={speech.listening}
                className={cx("absolute top-2 right-2", speech.listening && "text-danger")}
              >
                {speech.listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
              </IconButton>
            )}
          </div>
          <p className="text-xs text-ink-3">
            Agent reads: <span className="text-ink-2">buy {intent.quantity}</span>
            {intent.budget != null ? (
              <>
                {" "}
                · <span className="text-ink-2">max {money(intent.budget)}</span>
              </>
            ) : (
              " · no budget"
            )}
            <span className="hidden sm:inline"> · everything else is treated as untrusted media</span>
          </p>
        </div>

        {/* Budget + product */}
        <div className="flex min-w-0 flex-col gap-3 md:col-start-2 xl:col-start-auto">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Budget</span>
              <div className="relative" data-fill>
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">$</span>
                <input
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="25"
                  className="field tnum h-[42px] pl-7"
                  aria-label="Budget in dollars"
                />
              </div>
            </label>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] font-medium">Product</span>
              <ProductPicker value={product} onChange={onProduct} live={mode === "live"} />
            </div>
          </div>

          {/* Untrusted media */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={<Paperclip className="size-3.5" />} onClick={() => fileRef.current?.click()}>
              Attach
            </Button>
            {recorder.supported && (
              <Button
                size="sm"
                variant="ghost"
                className={recorder.recording ? "text-danger" : undefined}
                icon={recorder.recording ? <Square className="size-3 fill-current" /> : <AudioLines className="size-3.5" />}
                onClick={recorder.recording ? recorder.stop : recorder.start}
              >
                {recorder.recording ? `Stop · 0:${String(recorder.seconds).padStart(2, "0")}` : "Record clip"}
              </Button>
            )}
            {others.map((m) => {
              const Icon = KIND_ICON[m.kind];
              return (
                <span key={m.kind} data-chip className="inline-flex h-7 max-w-[180px] items-center gap-1.5 rounded-lg border border-line bg-surface-2 pr-1 pl-2 text-xs text-ink-2">
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
        </div>

        {/* Run */}
        <div className="flex items-stretch gap-2 md:col-span-2 xl:col-span-1 xl:flex-col xl:justify-end">
          <Button
            variant="primary"
            size="lg"
            onClick={submit}
            disabled={!canRun}
            className="flex-1 xl:min-w-[150px] xl:flex-none"
            icon={<Play className="size-4 fill-current" />}
            trailing={
              <span className="ml-1 hidden items-center gap-0.5 opacity-60 lg:inline-flex">
                <Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>↵</Kbd>
              </span>
            }
          >
            {busy ? "Running" : "Run"}
          </Button>
          {canReset && (
            <Button size="lg" variant="secondary" onClick={onReset} icon={<RotateCcw className="size-4" />} className="xl:min-w-[150px]">
              <span className="sr-only sm:not-sr-only">Reset</span>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
