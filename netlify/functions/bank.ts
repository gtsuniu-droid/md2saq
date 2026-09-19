import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { parsePaper, questionFullText } from "../../src/lib/parser";
import { suggestPresentations } from "../../src/lib/suggest";
import { PRESENTATION_BY_ID } from "../../src/data/presentations";

interface BankEntry {
  id: string;
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
  set: { name?: string; source?: string; collection?: string; tags?: string[] };
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

function suppliedPasscode(req: Request): string | null {
  return req.headers.get("x-passcode") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}

export default async (req: Request): Promise<Response> => {
  const store = getStore("bank");
  const url = new URL(req.url);
  const expected = process.env.BANK_PASSCODE;
  if (!expected) return new Response("The bank is not configured on this site (BANK_PASSCODE is unset).", { status: 503 });
  if (suppliedPasscode(req) !== expected) return new Response("Wrong passcode.", { status: 403 });

  const loadIndex = async (): Promise<BankEntry[]> => ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [];

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
    if (JSON.stringify(pack).length > 2_000_000) return new Response("Set too large.", { status: 413 });
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
    const id = crypto.randomUUID();
    const entry = { ...entryFrom(id, r.pack), key: r.key };
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
