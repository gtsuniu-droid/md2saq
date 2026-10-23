import { deliverCatalogue, deliverContent, deliverImage, saveDelivery } from "../lib/bankDelivery";
import type { SetPack } from "../../src/lib/setPack";
import { setLinkCode } from "../../src/lib/shortSetLink";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parsePaper, questionFullText } from "../../src/lib/parser";
import { suggestPresentations } from "../../src/lib/suggest";
import { PRESENTATION_BY_ID } from "../../src/data/presentations";
import { numberingGroup, rankedPresentations } from "../../src/lib/setGroup";

/**
 * Numbers are automatic: within each presentation the sets are 1..n in the
 * order they were first published, closing gaps when one is deleted or moved.
 * Returns true when any entry changed.
 */
function renumber(index: BankEntry[]): boolean {
  let changed = false;
  const groups = new Map<string, BankEntry[]>();
  for (const e of index) {
    const group = e.group ?? numberingGroup(e.tags, [{ presentations: e.presentations }]);
    if (e.group !== group) {
      e.group = group;
      changed = true;
    }
    groups.set(group, [...(groups.get(group) ?? []), e]);
  }
  for (const members of groups.values()) {
    members.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.uploadedAt - b.uploadedAt);
    members.forEach((e, i) => {
      if (e.number !== i + 1) {
        e.number = i + 1;
        changed = true;
      }
    });
  }
  return changed;
}

interface BankEntry {
  id: string;
  /** The set's own id inside the pack, so the same set published again from any device updates this entry. */
  setId?: string;
  /** Number within its presentation (see setGroup.ts), assigned when the set is first shared. */
  number?: number;
  /** The presentation or branch the number counts within. */
  group?: string;
  name: string;
  source?: string;
  collection?: string;
  tags?: string[];
  questionCount: number;
  presentations: string[];
  uploadedAt: number;
  updatedAt?: number;
  /** Caller-supplied idempotency key, so re-sending the same batch does not duplicate it. */
  key?: string;
}

interface TextUpload {
  format: "saq-practice-text";
  name: string;
  source?: string;
  text: string;
  /** Presentation ids to apply to every question, on top of what is detected from the text. */
  presentations?: string[];
  key?: string;
}

interface SetPackUpload {
  format: "saq-practice-set";
  set: { primaryPresentation?: string; id?: string; name?: string; source?: string; collection?: string; tags?: string[]; number?: number };
  questions: { presentations?: string[] }[];
  key?: string;
}

type Pack = SetPackUpload | ReturnType<typeof packFromText>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function packFromText(u: TextUpload) {
  const { questions: parsed, meta } = parsePaper(u.text);
  const extra = (u.presentations ?? []).filter((id) => PRESENTATION_BY_ID.has(id));
  const setId = crypto.randomUUID();
  const now = Date.now();
  return {
    format: "saq-practice-set" as const,
    version: 1 as const,
    set: { id: setId, name: u.name === "Untitled set" && meta.title ? meta.title : u.name, source: u.source, suggestedMinutes: meta.minutes, createdAt: now, primaryPresentation: extra[0] },
    questions: parsed.map((q, i) => ({
      id: crypto.randomUUID(),
      setId,
      order: i,
      stems: q.stems.length ? q.stems : undefined,
      text: q.text,
      marks: q.marks,
      modelAnswer: q.modelAnswer,
      parts: q.parts,
      presentations: [...new Set([...suggestPresentations([...q.stems, questionFullText(q)].join("\n"), 1), ...extra])],
      tags: [],
      createdAt: now,
    })),
  };
}

function entryFrom(id: string, pack: Pack, previous?: BankEntry): BankEntry {
  const set = pack.set as SetPackUpload["set"];
  const presentations = rankedPresentations(pack.questions);
  return {
    id,
    setId: typeof set.id === "string" ? set.id : previous?.setId,
    number: previous?.number,
    group: numberingGroup(set.tags, pack.questions, set.primaryPresentation),
    name: String(set.name ?? "Untitled set").slice(0, 200),
    source: set.source ? String(set.source).slice(0, 200) : undefined,
    collection: set.collection ? String(set.collection).slice(0, 200) : undefined,
    tags: Array.isArray(set.tags) ? set.tags.map((t) => String(t).slice(0, 80)).slice(0, 50) : undefined,
    questionCount: pack.questions.length,
    presentations,
    uploadedAt: previous?.uploadedAt ?? Date.now(),
    updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? previous?.uploadedAt ?? 0) + 1),
    key: previous?.key,
  };
}

interface Store {
  get(key: string, opts: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * On Netlify: the blob store, read with strong consistency because the index is
 * read, changed and written back on every upload and listed straight after.
 * Anywhere else (vite dev): a JSON file under .netlify/, so publishing can be
 * tried locally. BANK_PASSCODE defaults to "dev" there.
 */
function openStore(): Store {
  const onNetlify = !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_DEV);
  if (onNetlify) return getStore({ name: "bank", consistency: "strong" }) as unknown as Store;
  const file = join(process.cwd(), ".netlify", "dev-bank.json");
  const load = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const save = (data: Record<string, unknown>) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  };
  return {
    async get(key) {
      return load()[key] ?? null;
    },
    async setJSON(key, value) {
      const data = load();
      data[key] = value;
      save(data);
    },
    async delete(key) {
      const data = load();
      delete data[key];
      save(data);
    },
  };
}

function suppliedPasscode(req: Request): string | null {
  return req.headers.get("x-passcode") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}

export default async (req: Request): Promise<Response> => {
  const store = openStore();
  const url = new URL(req.url);
  const onNetlify = !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_DEV);
  const expected = process.env.BANK_PASSCODE ?? (onNetlify ? undefined : "dev");
  const authorised = !!expected && suppliedPasscode(req) === expected;
  // Reading the bank is open to everyone; changing it needs the passcode.
  if (url.searchParams.has("verify")) {
    if (!expected) return new Response("The bank is not configured on this site (BANK_PASSCODE is unset).", { status: 503 });
    return authorised ? new Response(null, { status: 204 }) : new Response("Wrong passcode.", { status: 403 });
  }
  if (req.method !== "GET") {
    if (!expected) return new Response("The bank is not configured on this site (BANK_PASSCODE is unset).", { status: 503 });
    if (!authorised) return new Response("Wrong passcode.", { status: 403 });
  }

  const loadIndex = async (): Promise<BankEntry[]> => {
    const index = ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [];
    if (renumber(index)) await store.setJSON("index", index);
    return index;
  };

  /** Write the index with numbers recomputed. */
  const saveIndex = async (index: BankEntry[]): Promise<void> => {
    renumber(index);
    await store.setJSON("index", index);
  };

  /** A set that moved to another presentation queues at the end of its new group. */
  const carryNumber = (entry: BankEntry, previous: BankEntry): void => {
    entry.number = previous.group === entry.group ? previous.number : undefined;
  };

  const readPack = async (): Promise<{ pack: Pack; key?: string } | Response> => {
    let body: TextUpload | SetPackUpload;
    try {
      body = (await req.json()) as TextUpload | SetPackUpload;
    } catch {
      return new Response("Body must be JSON.", { status: 400 });
    }
    let pack: Pack;
    if (body.format === "saq-practice-text") {
      if (typeof body.text !== "string" || !body.text.trim()) return new Response("Missing text.", { status: 400 });
      pack = packFromText({ ...body, name: String(body.name || "Untitled set").slice(0, 200) });
      if (pack.questions.length === 0) return new Response("No questions could be parsed from the text.", { status: 422 });
    } else if (body.format === "saq-practice-set" && body.set && Array.isArray(body.questions)) {
      pack = body;
    } else {
      return new Response("Unknown format. Send saq-practice-text or saq-practice-set.", { status: 400 });
    }
    if (JSON.stringify(pack).length > 5_500_000) return new Response("Set too large: keep pictures under 5 MB per set.", { status: 413 });
    return { pack, key: typeof body.key === "string" ? body.key.slice(0, 200) : undefined };
  };

  // Every change keeps the previous version, so a bad edit or a deletion can be undone.
  const HISTORY_KEEP = 20;
  interface HistoryRow { at: number; reason: "update" | "delete" | "restore"; name: string; questionCount: number }
  interface DeletedRow { id: string; name: string; group?: string; number?: number; questionCount: number; deletedAt: number }
  const snapshot = async (entry: BankEntry, reason: HistoryRow["reason"]): Promise<void> => {
    const pack = await store.get(`sets/${entry.id}`, { type: "json" });
    if (!pack) return;
    const rows = ((await store.get(`history-index/${entry.id}`, { type: "json" })) as HistoryRow[] | null) ?? [];
    const at = Math.max(Date.now(), (rows[0]?.at ?? 0) + 1);
    await store.setJSON(`history/${entry.id}/${at}`, { at, reason, entry, pack });
    rows.unshift({ at, reason, name: entry.name, questionCount: entry.questionCount });
    // Sets with pictures are large; keep only a few versions of those so storage stays small.
    const keep = JSON.stringify(pack).length > 300_000 ? 3 : HISTORY_KEEP;
    for (const old of rows.splice(keep)) await store.delete(`history/${entry.id}/${old.at}`);
    await store.setJSON(`history-index/${entry.id}`, rows);
  };
  const deletedIndex = async (): Promise<DeletedRow[]> => ((await store.get("deleted-index", { type: "json" })) as DeletedRow[] | null) ?? [];

  /** Store a pack as the set's current version: index entry, delivery files and content. */
  const publish = async (id: string, pack: Pack, previous: BankEntry | undefined, index: BankEntry[]): Promise<BankEntry> => {
    const entry = entryFrom(id, pack, previous);
    if (previous) carryNumber(entry, previous);
    const next = index.some((e) => e.id === id) ? index.map((e) => (e.id === id ? entry : e)) : [...index, entry];
    renumber(next);
    (pack.set as { number?: number }).number = entry.number;
    await saveDelivery(store, entry, pack as SetPack, url.origin);
    await store.setJSON(`sets/${id}`, pack);
    await saveIndex(next);
    return entry;
  };

  if (req.method === "GET") {
    if (url.searchParams.has("history") || url.searchParams.has("deleted")) {
      if (!authorised) return new Response("Wrong passcode.", { status: 403 });
      if (url.searchParams.has("deleted")) return json({ deleted: await deletedIndex() });
      const id = url.searchParams.get("history") ?? "";
      const at = url.searchParams.get("at");
      if (at) {
        const snap = await store.get(`history/${id}/${at}`, { type: "json" });
        return snap ? json(snap) : new Response("No such version.", { status: 404 });
      }
      return json({ versions: ((await store.get(`history-index/${id}`, { type: "json" })) as HistoryRow[] | null) ?? [] });
    }
    if (url.searchParams.has("image")) return deliverImage(store, url.searchParams.get("image") ?? "");
    if (url.searchParams.has("catalogue")) return deliverCatalogue(store, await loadIndex(), req);
    if (url.searchParams.has("content")) {
      const entry = (await loadIndex()).find(e => e.id === url.searchParams.get("content"));
      if (!entry) return new Response("Not found", { status: 404 });
      if (url.searchParams.get("v") !== String(entry.updatedAt ?? entry.uploadedAt)) return new Response("The set has changed. Refresh the library.", { status: 409 });
      return deliverContent(store, entry, url.origin);
    }
    if (url.searchParams.has("short")) {
      const code = url.searchParams.get("short") ?? "";
      if (!/^[A-Za-z0-9_-]{8}$/.test(code)) return new Response("Not found", { status: 404 });
      const index = ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [];
      const matches = (await Promise.all(index.map(async entry => ({ entry, code: await setLinkCode(entry.id) })))).filter(item => item.code === code);
      // Refuse ambiguous codes rather than ever showing a different set.
      if (matches.length !== 1) return new Response("Not found", { status: 404 });
      const bankId = matches[0].entry.id;
      const pack = await store.get(`sets/${bankId}`, { type: "json" });
      return pack ? json({ bankId, pack }) : new Response("Not found", { status: 404 });
    }
    const id = url.searchParams.get("id");
    if (id) {
      const pack = await store.get(`sets/${id}`, { type: "json" });
      return pack ? json(pack) : new Response("Not found", { status: 404 });
    }
    const index = await loadIndex();
    return json({ sets: index.sort((a, b) => (b.updatedAt ?? b.uploadedAt) - (a.updatedAt ?? a.uploadedAt)) });
  }

  if (req.method === "POST") {
    const r = await readPack();
    if (r instanceof Response) return r;
    // A parse-only pass: how the text would split into questions, with nothing stored.
    if (url.searchParams.has("preview")) return json({ pack: r.pack });
    const index = await loadIndex();
    if (r.key) {
      const existing = index.find((e) => e.key === r.key);
      if (existing) return json({ ...existing, duplicate: true });
    }
    const packSetId = (r.pack.set as { id?: string }).id;
    const same = packSetId ? index.find((e) => e.setId === packSetId) : undefined;
    if (same) {
      // Already published, perhaps from another device: update in place rather than duplicate.
      const entry = entryFrom(same.id, r.pack, same);
      carryNumber(entry, same);
      const next = index.map((e) => (e.id === same.id ? entry : e));
      renumber(next);
      (r.pack.set as { number?: number }).number = entry.number;
      await saveDelivery(store, entry, r.pack as SetPack, url.origin);
      await store.setJSON(`sets/${same.id}`, r.pack);
      await saveIndex(next);
      return json(entry);
    }
    const id = crypto.randomUUID();
    const entry: BankEntry = { ...entryFrom(id, r.pack), key: r.key };
    const next = [...index, entry];
    renumber(next);
    (r.pack.set as { number?: number }).number = entry.number;
    await saveDelivery(store, entry, r.pack as SetPack, url.origin);
    await store.setJSON(`sets/${id}`, r.pack);
    await saveIndex(next);
    return json(entry, 201);
  }

  if (req.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id.", { status: 400 });
    const index = await loadIndex();
    const previous = index.find((e) => e.id === id);
    const restoreAt = url.searchParams.get("restore");
    if (restoreAt) {
      // Bring back an earlier version, or a deleted set under its old id.
      const snap = (await store.get(`history/${id}/${restoreAt}`, { type: "json" })) as { pack: Pack } | null;
      if (!snap) return new Response("No such version.", { status: 404 });
      let base = previous;
      if (!base) {
        const tomb = (await store.get(`deleted/${id}`, { type: "json" })) as { entry: BankEntry } | null;
        if (!tomb) return new Response("Not found", { status: 404 });
        base = { ...tomb.entry, number: undefined };
      } else await snapshot(previous!, "restore");
      const entry = await publish(id, snap.pack, base, index);
      if (!previous) {
        await store.delete(`deleted/${id}`);
        await store.setJSON("deleted-index", (await deletedIndex()).filter((d) => d.id !== id));
      }
      return json(entry);
    }
    if (!previous) return new Response("Not found", { status: 404 });
    const r = await readPack();
    if (r instanceof Response) return r;
    await snapshot(previous, "update");
    return json(await publish(id, r.pack, previous, index));
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id.", { status: 400 });
    const index = await loadIndex();
    const entry = index.find((e) => e.id === id);
    if (!entry) return new Response("Not found", { status: 404 });
    await snapshot(entry, "delete");
    await store.setJSON(`deleted/${id}`, { entry, deletedAt: Date.now() });
    const rows = [{ id, name: entry.name, group: entry.group, number: entry.number, questionCount: entry.questionCount, deletedAt: Date.now() }, ...(await deletedIndex()).filter((d) => d.id !== id)];
    for (const old of rows.splice(50)) await store.delete(`deleted/${old.id}`);
    await store.setJSON("deleted-index", rows);
    await store.delete(`sets/${id}`);
    await saveIndex(index.filter((e) => e.id !== id));
    return json({ deleted: id, restorable: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/bank" };
