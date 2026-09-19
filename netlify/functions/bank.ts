import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { parseQuestions, questionFullText } from "../../src/lib/parser";
import { suggestPresentations } from "../../src/lib/suggest";
import { PRESENTATION_BY_ID } from "../../src/data/presentations";

interface BankEntry {
  id: string;
  name: string;
  source?: string;
  questionCount: number;
  presentations: string[];
  uploadedAt: number;
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
  set: { name?: string; source?: string };
  questions: { presentations?: string[] }[];
  key?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function packFromText(u: TextUpload) {
  const parsed = parseQuestions(u.text);
  const extra = (u.presentations ?? []).filter((id) => PRESENTATION_BY_ID.has(id));
  const setId = crypto.randomUUID();
  const now = Date.now();
  return {
    format: "saq-practice-set" as const,
    version: 1 as const,
    set: { id: setId, name: u.name, source: u.source, createdAt: now },
    questions: parsed.map((q, i) => ({
      id: crypto.randomUUID(),
      setId,
      order: i,
      text: q.text,
      marks: q.marks,
      modelAnswer: q.modelAnswer,
      parts: q.parts,
      presentations: [...new Set([...suggestPresentations(questionFullText(q), 1), ...extra])],
      tags: [],
      createdAt: now,
    })),
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

  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (id) {
      const pack = await store.get(`sets/${id}`, { type: "json" });
      return pack ? json(pack) : new Response("Not found", { status: 404 });
    }
    const index = ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [];
    return json({ sets: index.sort((a, b) => b.uploadedAt - a.uploadedAt) });
  }

  if (req.method === "POST") {
    let body: TextUpload | SetPackUpload;
    try {
      body = (await req.json()) as TextUpload | SetPackUpload;
    } catch {
      return new Response("Body must be JSON.", { status: 400 });
    }

    let pack: ReturnType<typeof packFromText> | SetPackUpload;
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

    const index = ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [];
    const key = typeof body.key === "string" ? body.key.slice(0, 200) : undefined;
    if (key) {
      const existing = index.find((e) => e.key === key);
      if (existing) return json({ ...existing, duplicate: true });
    }

    const id = crypto.randomUUID();
    const presentations = [...new Set(pack.questions.flatMap((q) => q.presentations ?? []))];
    const entry: BankEntry = {
      id,
      name: String(pack.set.name ?? "Untitled set").slice(0, 200),
      source: pack.set.source ? String(pack.set.source).slice(0, 200) : undefined,
      questionCount: pack.questions.length,
      presentations,
      uploadedAt: Date.now(),
      key,
    };
    await store.setJSON(`sets/${id}`, pack);
    await store.setJSON("index", [...index, entry]);
    return json(entry, 201);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/bank" };
