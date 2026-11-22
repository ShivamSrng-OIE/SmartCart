import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, LogIn, LogOut, Mic, Pencil, Plus, ScanSearch, Search, ShieldAlert, ShieldCheck, Store, Trash2, Video, X } from "lucide-react";
import {
  ApiError, createListing, deleteListing, deletePhoto, getCategories, getListings, getSession, getStores, login, photoUrl, reviewListing, token, updateListing,
  type Listing, type Review, type Session,
} from "../lib/marketplace";
import { money } from "../lib/format";
import { reasonLabel } from "../lib/trust";
import { TrustMeter } from "./TrustBadge";
import { Button, Chip, cx } from "./ui";

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/* ----------------------------------------------------------------- sign in */

function LoginCard({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getStores().then((s) => setStores(s.map((x) => ({ id: x.id, name: x.name })))).catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(username.trim(), password);
      token.set(r.token);
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That username or password isn’t right." : err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col justify-center gap-3 py-2 md:py-8">
        <span className="flex size-11 items-center justify-center rounded-xl bg-brand text-brand-ink">
          <Store className="size-6" />
        </span>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[34px]">Sell on Tote</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">
          Shoppers never need an account. Sellers do: sign in to manage your store, add products with as many photos as you like, and see how Safe Checkout reads each listing.
        </p>
        <ul className="mt-1 flex flex-col gap-2 text-[14px] text-ink-2">
          <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-safe" /> Every listing is scanned for text that tries to steer AI shoppers.</li>
          <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-safe" /> Your trust score rises and falls with what shoppers actually run into.</li>
        </ul>
      </div>

      <form onSubmit={submit} className="card flex flex-col gap-4 p-5 sm:p-6" aria-label="Merchant sign in">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">Merchant sign-in</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Shopping needs no sign-in. This is only for sellers.</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Store</span>
          <input list="stores" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required placeholder="warehouse, or pick a store" className="field" />
          <datalist id="stores">
            <option value="warehouse">Operator (all stores)</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="field" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !username.trim() || !password} icon={busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}>
          Sign in
        </Button>
        <p className="text-xs leading-relaxed text-ink-3">
          Demo accounts: <span className="font-mono">warehouse</span> manages every store; each store’s own name signs in to just that store. The demo password is the one set as <span className="font-mono">MERCHANT_PASSWORD</span> in the backend’s <span className="font-mono">.env</span> (default <span className="font-mono">warehouse-demo</span>).
        </p>
        {stores.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {stores.slice(0, 6).map((s) => (
              <button key={s.id} type="button" onClick={() => setUsername(s.id)} className="h-7 rounded-full border border-line px-2.5 text-xs text-ink-2 hover:border-line-strong hover:text-ink">
                {s.name}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

/* ----------------------------------------------------------------- review */

function ReviewPanel({ review, className }: { review: Review; className?: string }) {
  return (
    <div role="status" className={cx("rounded-xl border p-3", review.flagged ? "border-danger-line bg-danger-soft" : "border-safe-line bg-safe-soft", className)}>
      <p className={cx("flex items-center gap-2 text-[13px] font-semibold", review.flagged ? "text-danger" : "text-safe")}>
        {review.flagged ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
        {review.flagged ? "Instructions aimed at AI shoppers found" : "Clean"}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{review.advice}</p>
      {review.quotes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {review.quotes.slice(0, 4).map((q, i) => (
            <li key={i} className="rounded-md border border-danger-line bg-surface px-2.5 py-1.5 font-mono text-[12px] break-words text-danger">
              “{q.quote}”
              <span className="ml-2 font-sans text-[11px] text-ink-3">{reasonLabel(q.category)}</span>
            </li>
          ))}
        </ul>
      )}
      {review.deep && (
        <p className="mt-2 text-[12px] text-ink-3">
          Photo and video read: {review.deep.instructions_detected ? "instructions found" : "nothing found"}
          {review.deep.visible_text?.length ? ` · text seen: ${review.deep.visible_text.slice(0, 4).join(" · ")}` : ""}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

interface FormState {
  title: string;
  price: string;
  productType: string;
  category: string;
  optionName: string;
  options: string;
  description: string;
}

const blank: FormState = { title: "", price: "", productType: "", category: "", optionName: "Size", options: "", description: "" };

const fromListing = (l: Listing): FormState => ({
  title: l.title,
  price: (l.price_cents / 100).toFixed(2),
  productType: l.product_type ?? "",
  category: l.category ?? "",
  optionName: l.options?.name ?? "Option",
  options: (l.options?.values ?? []).map((v) => (v.price_delta ? `${v.label}:${v.price_delta > 0 ? "+" : ""}${(v.price_delta / 100).toFixed(2)}` : v.label)).join(", "),
  description: l.description,
});

function Editor({ listing, session, stores, onClose, onSaved }: { listing: Listing | null; session: Session; stores: { id: string; name: string }[]; onClose: () => void; onSaved: (l: Listing) => void }) {
  const [form, setForm] = useState<FormState>(listing ? fromListing(listing) : blank);
  const [current, setCurrent] = useState<Listing | null>(listing);
  const [owner, setOwner] = useState(session.role === "admin" ? (stores[0]?.id ?? "") : session.username);
  const [files, setFiles] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Listing | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);
  const dialog = useRef<HTMLFormElement>(null);

  useEffect(() => {
    getCategories().then((c) => setCategories(c.map((x) => x.id))).catch(() => undefined);
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const photoCount = (current?.photos.length ?? 0) + files.length;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (!f.type.startsWith("image/")) return setError(`${f.name} isn’t an image.`);
      if (f.size > MAX_PHOTO_BYTES) return setError(`${f.name} is over 12 MB.`);
      ok.push(f);
    }
    setError(null);
    setFiles((xs) => [...xs, ...ok].slice(0, 8));
  };

  const removeExisting = async (url: string) => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const { listing: l } = await deletePhoto(current.slug, url.split("/").pop() ?? "");
      setCurrent(l);
      onSaved(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t remove that photo.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number.parseFloat(form.price);
    if (!form.title.trim()) return setError("Give the product a title.");
    if (!Number.isFinite(price) || price < 0.5) return setError("Enter a price of at least $0.50.");
    if (!form.description.trim()) return setError("Add a description.");
    if (!current && !files.length) return setError("Add at least one photo.");
    const body = new FormData();
    body.set("title", form.title.trim());
    body.set("price", String(price));
    body.set("description", form.description);
    body.set("product_type", form.productType.trim() || "Everyday Goods");
    body.set("category", form.category.trim() || "everyday-goods");
    body.set("option_name", form.optionName.trim() || "Option");
    body.set("options", form.options);
    if (!current && session.role === "admin" && owner) body.set("merchant", owner);
    files.forEach((f) => body.append("photos", f));
    if (video) body.set("video", video);
    if (audio) body.set("audio", audio);
    setBusy(true);
    setError(null);
    try {
      const { listing: l } = current ? await updateListing(current.slug, body) : await createListing(body);
      setCurrent(l);
      setSaved(l);
      setFiles([]);
      setVideo(null);
      setAudio(null);
      onSaved(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save the listing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={listing ? "Edit listing" : "New listing"}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form ref={dialog} tabIndex={-1} onSubmit={save} className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-bg shadow-float outline-none sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
          <h2 className="text-[17px] font-semibold tracking-tight">{listing ? "Edit listing" : "New listing"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </header>

        <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          {saved && (
            <div className="flex flex-col gap-2">
              <p className="rounded-lg bg-safe-soft px-3 py-2 text-[13px] font-medium text-safe">Saved. Shoppers can see it now.</p>
              <ReviewPanel review={saved.review} />
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

          <section className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[13px] font-medium">Title</span>
              <input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={120} className="field" placeholder="Heavyweight Graphic Hoodie" />
            </label>
            {!current && session.role === "admin" && (
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-[13px] font-medium">Sold by</span>
                <select value={owner} onChange={(e) => setOwner(e.target.value)} className="field">
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Price (USD)</span>
              <input value={form.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="field tnum" placeholder="39.99" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Product type</span>
              <input value={form.productType} onChange={(e) => set("productType", e.target.value)} maxLength={60} className="field" placeholder="Hoodies" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Category</span>
              <input list="cats" value={form.category} onChange={(e) => set("category", e.target.value)} className="field" placeholder="hoodies" />
              <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Options <span className="font-normal text-ink-3">(comma separated)</span></span>
              <div className="flex gap-2">
                <input value={form.optionName} onChange={(e) => set("optionName", e.target.value)} className="field w-24 shrink-0" aria-label="Option name" placeholder="Size" />
                <input value={form.options} onChange={(e) => set("options", e.target.value)} className="field" aria-label="Option values" placeholder="S, M, L, XL:+3" />
              </div>
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[13px] font-medium">Description</span>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={7} maxLength={8000} className="field resize-y leading-relaxed" placeholder="What it is, what it’s made of, how it fits. Bullet points start with “- ”." />
              <span className="text-xs text-ink-3">Everything here is read by Safe Checkout. Text that tries to give orders to an AI shopper gets the listing flagged.</span>
            </label>
          </section>

          <section className="card flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[14px] font-semibold">Photos</h3>
                <p className="text-xs text-ink-3">Add as many as you like (up to 8). The first one is the cover.</p>
              </div>
              <label className="btn-secondary inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-[13px] font-medium">
                <ImagePlus className="size-4" /> Add photos
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            {photoCount === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">No photos yet.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {(current?.photos ?? []).map((u, i) => (
                  <li key={u} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-2">
                    <img src={photoUrl(u)} alt={`Photo ${i + 1}`} className="size-full object-cover" loading="lazy" />
                    {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] font-medium text-white">Cover</span>}
                    <button type="button" disabled={busy || (current?.photos.length ?? 0) < 2} onClick={() => removeExisting(u)} aria-label={`Remove photo ${i + 1}`} className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:hidden">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
                {previews.map((u, i) => (
                  <li key={u} className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-ink-3 bg-surface-2">
                    <img src={u} alt={`New photo ${i + 1}`} className="size-full object-cover" />
                    <span className="absolute bottom-1 left-1 rounded bg-brand px-1.5 text-[10px] font-medium text-brand-ink">New</span>
                    <button type="button" onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))} aria-label={`Remove new photo ${i + 1}`} className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-2 hover:border-line-strong">
                <Video className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{video ? video.name : current?.has_video ? "Replace the product video" : "Add a product video (mp4)"}</span>
                <input type="file" accept="video/mp4,video/quicktime" className="sr-only" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} />
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-2 hover:border-line-strong">
                <Mic className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{audio ? audio.name : current?.has_audio ? "Replace the audio" : "Add audio (wav, mp3)"}</span>
                <input type="file" accept="audio/*" className="sr-only" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface px-4 py-3 sm:px-5">
          <Button type="button" variant="ghost" onClick={onClose}>{saved ? "Done" : "Cancel"}</Button>
          <Button type="submit" variant="primary" disabled={busy} icon={busy ? <Loader2 className="size-4 animate-spin" /> : undefined}>
            {busy ? "Saving…" : current ? "Save changes" : "Publish listing"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ portal */

function ListingRow({ l, onEdit, onDelete, onReview, busy }: { l: Listing; onEdit: () => void; onDelete: () => void; onReview: (deep: boolean) => void; busy: boolean }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirm]);
  const flagged = l.review.flagged || l.status === "flagged";
  return (
    <li className={cx("card flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:p-4", flagged && "shadow-[0_0_0_1px_var(--danger-line)]")}>
      <div className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2 sm:size-24">
        {l.photos[0] ? <img src={photoUrl(l.photos[0])} alt="" className="size-full object-cover" loading="lazy" /> : null}
        {l.photos.length > 1 && <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1.5 text-[10px] font-medium text-white">{l.photos.length} photos</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{l.title}</h3>
          <span className="tnum text-[14px] font-semibold">{money(l.price_cents / 100)}</span>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <span>{l.product_type ?? "Listing"}</span>
          <span aria-hidden>·</span>
          <span>{l.category?.replace(/-/g, " ")}</span>
          {l.origin === "portal" && <Chip mono={false} className="h-5 text-[10px]">Edited here</Chip>}
          {l.has_video && <Chip mono={false} className="h-5 text-[10px]">Video</Chip>}
          {l.has_audio && <Chip mono={false} className="h-5 text-[10px]">Audio</Chip>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {flagged ? (
            <Chip tone="danger" mono={false}><ShieldAlert className="size-3" /> {l.review.flagged ? "Agent instructions in description" : "Flagged by shoppers’ checks"}</Chip>
          ) : (
            <Chip tone="safe" mono={false}><ShieldCheck className="size-3" /> Clean</Chip>
          )}
          {l.incidents > 0 && <Chip tone="warn" mono={false}>{l.incidents} incident{l.incidents === 1 ? "" : "s"}</Chip>}
        </div>
        {l.review.flagged && l.review.quotes[0] && (
          <p className="mt-2 rounded-md border border-danger-line bg-danger-soft px-2.5 py-1.5 font-mono text-[12px] break-words text-danger">“{l.review.quotes[0].quote}”</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:flex-col sm:items-stretch">
        <Button size="sm" onClick={onEdit} icon={<Pencil className="size-3.5" />}>Edit</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview(false)} icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}>Scan</Button>
        {confirm ? (
          <Button size="sm" variant="primary" className="bg-danger! text-white!" onClick={onDelete}>Confirm delete</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} icon={<Trash2 className="size-3.5" />}>Delete</Button>
        )}
      </div>
    </li>
  );
}

function Portal({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [store, setStore] = useState<string>(session.role === "admin" ? "" : session.username);
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Listing | "new" | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ slug: string; review: Review } | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>(session.stores ?? []);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows((await getListings(store || undefined)).listings);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut();
      setError(err instanceof Error ? err.message : "Couldn’t load your listings.");
      setRows([]);
    }
  }, [store, onSignOut]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (session.role === "admin" && !stores.length) getStores().then((s) => setStores(s.map((x) => ({ id: x.id, name: x.name })))).catch(() => undefined);
  }, [session.role, stores.length]);

  const shown = useMemo(() => (rows ?? []).filter((l) => !q.trim() || `${l.title} ${l.product_type} ${l.category}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const flaggedCount = (rows ?? []).filter((l) => l.review.flagged || l.status === "flagged").length;
  const title = session.role === "admin" ? (store ? stores.find((s) => s.id === store)?.name ?? store : "All stores") : session.merchant?.name ?? session.username;

  const upsert = (l: Listing) => setRows((xs) => (xs ? (xs.some((x) => x.slug === l.slug) ? xs.map((x) => (x.slug === l.slug ? l : x)) : [l, ...xs]) : [l]));

  const scan = async (l: Listing, deep: boolean) => {
    setScanning(l.slug);
    try {
      const review = await reviewListing(l.slug, deep);
      setNotice({ slug: l.slug, review });
      setRows((xs) => xs?.map((x) => (x.slug === l.slug ? { ...x, review } : x)) ?? xs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The scan failed.");
    } finally {
      setScanning(null);
    }
  };

  const remove = async (l: Listing) => {
    try {
      await deleteListing(l.slug);
      setRows((xs) => xs?.filter((x) => x.slug !== l.slug) ?? xs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t delete that listing.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <header className="card flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink"><Store className="size-6" /></span>
          <div className="min-w-0">
            <p className="label">{session.role === "admin" ? "Operator" : "Merchant"}</p>
            <h1 className="truncate text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
            {session.merchant?.tagline && <p className="truncate text-[13px] text-ink-3">{session.merchant.tagline}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {session.stats && (
            <div className="text-right">
              <p className="label">Seller trust</p>
              <TrustMeter value={session.stats.trust} status={session.stats.status} className="justify-end" />
            </div>
          )}
          <Button variant="ghost" onClick={onSignOut} icon={<LogOut className="size-4" />}>Sign out</Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          ["Listings", String(rows?.length ?? "–")],
          ["Need attention", String(rows ? flaggedCount : "–"), flaggedCount > 0],
          ["Seller trust", session.stats ? `${session.stats.trust}/100` : "All stores"],
        ].map(([label, value, warn]) => (
          <div key={String(label)} className="card p-3.5 sm:p-4">
            <p className="label">{label}</p>
            <p className={cx("tnum mt-1 text-xl font-semibold tracking-tight sm:text-2xl", warn && "text-danger")}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your listings" aria-label="Search your listings" className="field h-10 pl-9" type="search" />
        </div>
        {session.role === "admin" && (
          <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Store" className="field h-10 w-auto min-w-44">
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <Button variant="primary" size="lg" onClick={() => setEditing("new")} icon={<Plus className="size-4" />}>Add listing</Button>
      </div>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {notice && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">Scan result · {rows?.find((x) => x.slug === notice.slug)?.title}</p>
            <button onClick={() => setNotice(null)} className="text-xs text-ink-3 hover:text-ink">Dismiss</button>
          </div>
          <ReviewPanel review={notice.review} />
        </div>
      )}

      {rows === null ? (
        <ul className="flex flex-col gap-3">{Array.from({ length: 4 }, (_, i) => <li key={i} className="card h-28 animate-pulse" />)}</ul>
      ) : shown.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Store className="size-7 text-ink-3" />
          <p className="text-[15px] font-medium">{rows.length ? "Nothing matches that search" : "No listings yet"}</p>
          <p className="max-w-sm text-sm text-ink-3">{rows.length ? "Try a different word." : "Add your first product with a few photos."}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((l) => (
            <ListingRow key={l.slug} l={l} busy={scanning === l.slug} onEdit={() => setEditing(l)} onDelete={() => remove(l)} onReview={(deep) => scan(l, deep)} />
          ))}
        </ul>
      )}

      {editing && <Editor listing={editing === "new" ? null : editing} session={session} stores={stores} onClose={() => setEditing(null)} onSaved={upsert} />}
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export function Sell() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !!token.get());

  const refresh = useCallback(async () => {
    if (!token.get()) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      setSession(await getSession());
    } catch {
      token.clear();
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const signOut = useCallback(() => {
    token.clear();
    setSession(null);
  }, []);

  if (loading) return <div className="card mx-auto h-64 w-full max-w-4xl animate-pulse" aria-label="Loading" />;
  return session ? <Portal session={session} onSignOut={signOut} /> : <LoginCard onSignedIn={refresh} />;
}
