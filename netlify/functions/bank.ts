import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parsePaper, questionFullText } from "../../src/lib/parser";
import { suggestPresentations } from "../../src/lib/suggest";
import { PRESENTATION_BY_ID } from "../../src/data/presentations";

interface BankEntry {
  id: string;
  /** The set's own id inside the pack, so the same set published again from any device updates this entry. */
  setId?: string;
  /** Running number across the bank, assigned when the set is first shared. */
  number?: number;
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
  set: { id?: string; name?: string; source?: string; collection?: string; tags?: string[]; number?: number };
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
    set: { id: setId, name: u.name === "Untitled set" && meta.title ? meta.title : u.name, source: u.source, suggestedMinutes: meta.minutes, createdAt: now },
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
  const presentations = [...new Set(pack.questions.flatMap((q) => q.presentations ?? []))];
  return {
    id,
    setId: typeof set.id === "string" ? set.id : previous?.setId,
    number: previous?.number,
    name: String(set.name ?? "Untitled set").slice(0, 200),
    source: set.source ? String(set.source).slice(0, 200) : undefined,
    collection: set.collection ? String(set.collection).slice(0, 200) : undefined,
    tags: Array.isArray(set.tags) ? set.tags.map((t) => String(t).slice(0, 80)).slice(0, 50) : undefined,
    questionCount: pack.questions.length,
    presentations,
    uploadedAt: previous?.uploadedAt ?? Date.now(),
    updatedAt: Date.now(),
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
    // Entries from before numbering get numbers in upload order, once.
    if (index.some((e) => e.number === undefined)) {
      let next = index.reduce((m, e) => Math.max(m, e.number ?? 0), 0);
      for (const e of [...index].sort((a, b) => a.uploadedAt - b.uploadedAt)) if (e.number === undefined) e.number = ++next;
      await store.setJSON("index", index);
    }
    return index;
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

  if (req.method === "GET") {
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
      (r.pack.set as { number?: number }).number = same.number;
      await store.setJSON(`sets/${same.id}`, r.pack);
      await store.setJSON("index", index.map((e) => (e.id === same.id ? entry : e)));
      return json(entry);
    }
    const id = crypto.randomUUID();
    const number = index.reduce((m, e) => Math.max(m, e.number ?? 0), 0) + 1;
    const entry = { ...entryFrom(id, r.pack), number, key: r.key };
    (r.pack.set as { number?: number }).number = number;
    await store.setJSON(`sets/${id}`, r.pack);
    await store.setJSON("index", [...index, entry]);
    return json(entry, 201);
  }

  if (req.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id.", { status: 400 });
    const index = await loadIndex();
    const previous = index.find((e) => e.id === id);
    if (!previous) return new Response("Not found", { status: 404 });
    const r = await readPack();
    if (r instanceof Response) return r;
    const entry = entryFrom(id, r.pack, previous);
    (r.pack.set as { number?: number }).number = previous.number;
    await store.setJSON(`sets/${id}`, r.pack);
    await store.setJSON("index", index.map((e) => (e.id === id ? entry : e)));
    return json(entry);
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id.", { status: 400 });
    const index = await loadIndex();
    if (!index.some((e) => e.id === id)) return new Response("Not found", { status: 404 });
    await store.delete(`sets/${id}`);
    await store.setJSON("index", index.filter((e) => e.id !== id));
    return json({ deleted: id });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/bank" };
