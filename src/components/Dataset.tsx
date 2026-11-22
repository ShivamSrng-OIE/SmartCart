import { useEffect, useMemo, useState } from "react";
import { Database, Play } from "lucide-react";
import { useDraft } from "../draft";
import { money } from "../lib/format";
import { fetchBlob, fetchDataset, fetchListingText, fileUrl, itemImage, mediaToFetch, type DatasetItem } from "../lib/dataset";
import { Button, Chip } from "./ui";

export function Dataset({ onRun }: { onRun: () => void }) {
  const { set, attach, detach } = useDraft();
  const [items, setItems] = useState<DatasetItem[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchDataset()
      .then((l) => live && setItems(l))
      .catch(() => {
        if (!live) return;
        setError(true);
        setItems([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const modalities = useMemo(() => [...new Set((items ?? []).map((i) => i.poisoned_modality))], [items]);
  const shown = useMemo(() => (items ?? []).filter((i) => filter === "all" || i.poisoned_modality === filter), [items, filter]);

  async function run(item: DatasetItem) {
    setBusy(item.item_id);
    const got = await Promise.all(mediaToFetch(item).map(async (m) => ({ ...m, blob: await fetchBlob(fileUrl(item.item_id, m.name)) })));
    const listingText = (await fetchListingText(item)) ?? "";
    (["image", "audio", "video", "pdf"] as const).forEach(detach);
    got.forEach((g) => g.blob && attach(g.kind, g.blob, g.name, "upload"));
    const p = item.product;
    set({
      request: item.request ?? "",
      budget: item.budget != null ? String(item.budget) : "",
      product: p?.title ? { id: p.product_id, title: p.title, price: p.price_cents != null ? p.price_cents / 100 : null } : null,
      scenarioId: null,
      listingText,
    });
    setBusy(null);
    onRun();
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label mb-1">Dataset</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Poisoned orders we test against</h1>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by modality">
          {["all", ...modalities].map((m) => (
            <Button key={m} size="sm" variant={filter === m ? "primary" : "secondary"} onClick={() => setFilter(m)}>
              {m}
            </Button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div className="card h-64 animate-pulse" aria-label="Loading" />
      ) : shown.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center">
          <Database className="size-7 text-ink-3" />
          <p className="text-[15px] font-medium">{error ? "The dataset could not be loaded" : items.length ? "No items for this filter" : "No dataset items yet"}</p>
          <p className="max-w-md text-sm text-ink-3">Poisoned and clean listings show up here once the backend has loaded the warehouse.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((i) => (
            <div key={i.item_id} className="card flex flex-col overflow-hidden">
              <img src={itemImage(i)} alt={i.product?.title ?? i.case_label ?? i.item_id} loading="lazy" className="aspect-[4/3] w-full bg-surface-2 object-cover" />
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip>{i.poisoned_modality}</Chip>
                  {i.case_label === "benign" ? <Chip tone="safe">clean</Chip> : i.hijack && i.hijack !== "none" && <Chip tone="danger">{i.hijack}</Chip>}
                  {i.category && <Chip mono={false}>{i.category.replace(/-/g, " ")}</Chip>}
                  {i.gate_passed != null && <Chip tone={i.gate_passed ? "safe" : "warn"}>{i.gate_passed ? "gate passed" : "gate failed"}</Chip>}
                </div>
                <p className="text-[15px] font-semibold">
                  {i.product?.title ?? i.case_label ?? i.item_id}
                  {i.product?.price_cents != null && <span className="ml-2 font-normal text-ink-2">{money(i.product.price_cents / 100)}</span>}
                </p>
                {i.flaw && <p className="text-sm text-ink-2">{i.flaw}</p>}
                <div className="mt-auto pt-2">
                  <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} disabled={busy === i.item_id} onClick={() => run(i)}>
                    {busy === i.item_id ? "Loading…" : "Run in Compare"}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
