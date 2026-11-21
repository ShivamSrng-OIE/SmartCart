// Types and helpers for the poisoned-dataset browser (GET /api/dataset). Kept local on purpose.
export type DatasetModality = "image" | "video" | "audio" | "none";

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
  request?: string;
  budget?: number | string | null;
}

export type WarehousePurchase = Pick<DatasetItem, "files" | "request" | "budget"> & { productId: string };

export interface ModalityCell {
  asr: number;
  benign_completion?: number;
  n_attack: number;
  n_benign?: number;
}
export type ByModality = Record<string, Record<string, ModalityCell>>;

export const MODALITIES: DatasetModality[] = ["image", "video", "audio", "none"];

const BASE = "/api/dataset";
export const imageUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}/image.png`;
export const fileUrl = (id: string, name: string) => `${BASE}/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;

export async function fetchDataset(): Promise<DatasetItem[]> {
  const r = await fetch(BASE);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GET ${BASE} failed: ${r.status}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
  return list as DatasetItem[];
}

export async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const r = await fetch(url, { signal });
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** Which of image.png / audio.wav / video.mp4 to pull for an item. */
export function mediaToFetch(item: Pick<DatasetItem, "files">): { kind: "image" | "audio" | "video"; name: string }[] {
  const files = item.files ?? [];
  const out: { kind: "image" | "audio" | "video"; name: string }[] = [{ kind: "image", name: "image.png" }];
  if (files.includes("video.mp4")) out.push({ kind: "video", name: "video.mp4" });
  if (files.includes("audio.wav")) out.push({ kind: "audio", name: "audio.wav" });
  return out;
}
