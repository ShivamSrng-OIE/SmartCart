// Types and helpers for the poisoned-dataset browser (GET /api/dataset). Kept local on purpose.
import { apiUrl } from "../config";
export type DatasetModality = "image" | "video" | "audio" | "text" | "image+text" | "none";

export interface DatasetItem {
  item_id: string;
  poisoned_modality: string;
  hijack?: string | null;
  case_label?: string | null;
  product_type?: string | null;
  product?: { product_id?: string; title?: string; price_cents?: number; product_type?: string } | null;
  flaw?: string | null;
  gate_passed?: boolean | null;
  files?: string[];
  source?: "warehouse";
  category?: string | null;
  merchant?: string | null;
  request?: string;
  budget?: number | string | null;
}

export interface ModalityCell {
  asr: number;
  benign_completion?: number;
  n_attack: number;
  n_benign?: number;
}
export type ByModality = Record<string, Record<string, ModalityCell>>;

export const MODALITIES: DatasetModality[] = ["image", "video", "audio", "text", "image+text", "none"];

const BASE = apiUrl("/api/dataset");
export const imageUrl = (id: string, file = "image.png") => `${BASE}/${encodeURIComponent(id)}/${file}`;
/** The photo of a dataset item: warehouse listings keep a .jpg, the generated props a .png. */
export const itemImage = (item: Pick<DatasetItem, "item_id" | "files">) => imageUrl(item.item_id, item.files?.includes("image.jpg") ? "image.jpg" : "image.png");
export const fileUrl = (id: string, name: string) => `${BASE}/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;

export async function fetchDataset(): Promise<DatasetItem[]> {
  const r = await fetch(BASE);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GET ${BASE} failed: ${r.status}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
  return list as DatasetItem[];
}

/** The listing's own description (the text the store shows next to the product), or null. */
export async function fetchListingText(item: Pick<DatasetItem, "item_id" | "files">, signal?: AbortSignal): Promise<string | null> {
  if (!item.files?.includes("description.txt")) return null;
  try {
    const r = await fetch(fileUrl(item.item_id, "description.txt"), { signal });
    const text = r.ok ? (await r.text()).trim() : "";
    return text || null;
  } catch {
    return null;
  }
}

export async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const r = await fetch(url, { signal });
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** Which of image.jpg|png / audio.wav / video.mp4 to pull for an item. */
export function mediaToFetch(item: Pick<DatasetItem, "files">): { kind: "image" | "audio" | "video"; name: string }[] {
  const files = item.files ?? [];
  // Only files that exist: a listing can be text-only when its generated media isn't on this machine.
  const photo = files.includes("image.jpg") ? "image.jpg" : files.includes("image.png") ? "image.png" : null;
  const out: { kind: "image" | "audio" | "video"; name: string }[] = photo ? [{ kind: "image", name: photo }] : [];
  if (files.includes("video.mp4")) out.push({ kind: "video", name: "video.mp4" });
  if (files.includes("audio.wav")) out.push({ kind: "audio", name: "audio.wav" });
  return out;
}
