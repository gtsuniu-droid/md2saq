import { createHash } from "node:crypto";
import type { SetPack } from "../../src/lib/setPack";
import { catalogueEntry, withIdentityKeys, type BankCatalogue } from "../../src/lib/bankCatalogue";

export interface DeliveryStore {
  get(key: string, opts: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<void>;
}
export interface DeliveryEntry { id: string; number?: number; uploadedAt: number; updatedAt?: number }
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const revision = (entry: DeliveryEntry) => entry.updatedAt ?? entry.uploadedAt;

async function mapLimit<T, U>(items: T[], fn: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function saveDelivery(store: DeliveryStore, entry: DeliveryEntry, pack: SetPack, origin: string) {
  // Deduplicate image strings before serialising, including repeated case-stem images.
  const assets = new Map<string, string>();
  const json = JSON.stringify(pack, (_key, value) => {
    if (typeof value !== "string" || !/^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return value;
    const id = hash(value);
    assets.set(id, value);
    return `${origin}/api/bank?image=${id}`;
  });
  await mapLimit([...assets], async ([id, data]) => store.setJSON(`images/${id}`, data));
  const content = JSON.parse(json) as SetPack;
  await store.setJSON(`delivery/${entry.id}/${revision(entry)}`, content);
  await store.setJSON(`summary/${entry.id}/${revision(entry)}`, await withIdentityKeys(catalogueEntry(entry.id, revision(entry), pack, entry.number), pack.questions));
  return content;
}

export async function deliverCatalogue(store: DeliveryStore, index: DeliveryEntry[], req: Request): Promise<Response> {
  const signature = hash(JSON.stringify(index.map(e => [e.id, revision(e), e.number])));
  const headers = { "content-type": "application/json", "cache-control": "no-cache", etag: `"${signature}"` };
  if (req.headers.get("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });
  const key = `catalogues/${signature}`;
  let catalogue = await store.get(key, { type: "json" }) as BankCatalogue | null;
  if (!catalogue) {
    const entries = await mapLimit(index, async entry => {
      const cached = await store.get(`summary/${entry.id}/${revision(entry)}`, { type: "json" }) as ReturnType<typeof catalogueEntry> | null;
      if (cached) return { ...cached, set: { ...cached.set, number: entry.number ?? cached.set.number } };
      // Compatibility with the existing bank: backfill lightweight summaries once,
      // on the server, without requiring every browser to download the old packs.
      const pack = await store.get(`sets/${entry.id}`, { type: "json" }) as SetPack | null;
      if (!pack) throw new Error("A published set is temporarily unavailable. Please retry.");
      const summary = await withIdentityKeys(catalogueEntry(entry.id, revision(entry), pack, entry.number), pack.questions);
      await store.setJSON(`summary/${entry.id}/${revision(entry)}`, summary);
      return summary;
    });
    catalogue = { version: 1, entries };
    await store.setJSON(key, catalogue);
  }
  return new Response(JSON.stringify(catalogue), { headers });
}

export async function deliverContent(store: DeliveryStore, entry: DeliveryEntry, origin: string): Promise<Response> {
  let pack = await store.get(`delivery/${entry.id}/${revision(entry)}`, { type: "json" });
  if (!pack) {
    const original = await store.get(`sets/${entry.id}`, { type: "json" }) as SetPack | null;
    if (!original) return new Response("Not found", { status: 404 });
    pack = await saveDelivery(store, entry, original, origin);
  }
  // The request includes the current revision. Old revisions are rejected before here.
  return new Response(JSON.stringify(pack), { headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable", "Netlify-CDN-Cache-Control": "public, max-age=31536000, durable" } });
}

export async function deliverImage(store: DeliveryStore, id: string): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(id)) return new Response("Not found", { status: 404 });
  const data = await store.get(`images/${id}`, { type: "json" });
  if (typeof data !== "string") return new Response("Not found", { status: 404 });
  const match = /^data:(image\/(?:png|jpe?g|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/.exec(data);
  if (!match) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(match[2], "base64"), { headers: { "content-type": match[1], "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable", "Netlify-CDN-Cache-Control": "public, max-age=31536000, durable" } });
}
