import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateNote } from "../../src/lib/noteModel";
import { PRESENTATION_BY_ID } from "../../src/data/presentations";
import type { PresentationNote } from "../../src/data/types";

interface NoteStore {
  list(options: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
  getWithMetadata(key: string, options: { type: "json" }): Promise<{ data: PresentationNote; etag: string } | null>;
  setJSON(key: string, value: PresentationNote, options: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}
const hosted = () => !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_DEV);
function openStore(): NoteStore {
  if (hosted()) return getStore({ name: "presentation-notes", consistency: "strong" }) as unknown as NoteStore;
  const directory = join(process.cwd(), ".netlify");
  const file = join(directory, "dev-notes.json");
  const read = (): Record<string, PresentationNote> => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };
  return {
    async list({ prefix }) { return { blobs: Object.keys(read()).filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
    async getWithMetadata(key) { const data = read()[key]; return data ? { data, etag: data.revision } : null; },
    async setJSON(key, note, options) {
      const data = read(), previous = data[key];
      if ((options.onlyIfNew && previous) || (options.onlyIfMatch && previous?.revision !== options.onlyIfMatch)) return { modified: false };
      data[key] = note; mkdirSync(directory, { recursive: true }); writeFileSync(file, JSON.stringify(data));
      return { modified: true };
    },
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function handleNotes(req: Request, store: NoteStore, passcode: string | undefined): Promise<Response> {
  const presentation = new URL(req.url).searchParams.get("presentation") ?? "";
  if (!PRESENTATION_BY_ID.has(presentation)) return json({ error: "Choose a valid presentation." }, 400);
  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: presentation + "/" });
    const records = await Promise.all(blobs.map(({ key }) => store.getWithMetadata(key, { type: "json" })));
    return json({ notes: records.filter((r) => !!r).map((r) => r!.data) });
  }
  if (req.method !== "PUT") return json({ error: "Method not allowed." }, 405);
  if (!passcode || req.headers.get("x-passcode") !== passcode) return json({ error: "Unlock Admin in Settings to edit the shared library." }, 403);
  let note: PresentationNote, baseRevision: string | undefined;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 800_000) return json({ error: "Note too large." }, 413);
    const body = JSON.parse(raw);
    note = body.note; baseRevision = body.baseRevision;
    validateNote(note);
    if (note.ownerId !== "@shared" || !/^shared-[a-zA-Z0-9-]+$/.test(note.id) || note.presentationId !== presentation) throw new Error("Invalid shared note.");
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Invalid note." }, 400); }
  const key = `${presentation}/${note.id}`;
  const previous = await store.getWithMetadata(key, { type: "json" });
  if ((previous?.data.revision ?? undefined) !== (baseRevision || undefined)) return json({ error: "This shared note changed. Copy your edits, refresh the library, then reopen it." }, 409);
  const next = { ...note, ownerId: "@shared", createdAt: previous?.data.createdAt ?? Date.now(), _m: Date.now(), revision: crypto.randomUUID() };
  const result = await store.setJSON(key, next, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!result.modified) return json({ error: "Another editor just saved this note. Refresh before trying again." }, 409);
  return json({ note: next });
}
export default (req: Request) => handleNotes(req, openStore(), process.env.BANK_PASSCODE ?? (hosted() ? undefined : "dev"));
export const config: Config = { path: "/api/notes" };
