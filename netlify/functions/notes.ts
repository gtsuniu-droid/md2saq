import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_SHARED_NOTE_BYTES, validateNote } from "../../src/lib/noteModel";
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
export async function handleNotes(req: Request, store: NoteStore, passcode: string | undefined, saveImage?: (src: string) => Promise<string>): Promise<Response> {
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
    if (new TextEncoder().encode(raw).length > MAX_SHARED_NOTE_BYTES + 1000) return json({ error: "Note too large." }, 413);
    const body = JSON.parse(raw);
    note = body.note; baseRevision = body.baseRevision;
    validateNote(note, MAX_SHARED_NOTE_BYTES);
    if (note.ownerId !== "@shared" || !/^shared-[a-zA-Z0-9-]+$/.test(note.id) || note.presentationId !== presentation) throw new Error("Invalid shared note.");
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Invalid note." }, 400); }
  const key = `${presentation}/${note.id}`;
  const previous = await store.getWithMetadata(key, { type: "json" });
  if ((previous?.data.revision ?? undefined) !== (baseRevision || undefined)) return json({ error: "This shared note changed. Copy your edits, refresh the library, then reopen it." }, 409);
  if (saveImage) {
    try { note = { ...note, doc: await persistNoteImages(note.doc, saveImage) }; validateNote(note); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Could not save note images." }, 400); }
  }
  const next = { ...note, ownerId: "@shared", createdAt: previous?.data.createdAt ?? Date.now(), _m: Math.max(Date.now(), (previous?.data._m ?? 0) + 1), revision: crypto.randomUUID() };
  const result = await store.setJSON(key, next, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!result.modified) return json({ error: "Another editor just saved this note. Refresh before trying again." }, 409);
  return json({ note: next });
}
/** Replace inline pictures with permanent, deduplicated Blob URLs before saving the note. */
export async function persistNoteImages(doc: unknown, save: (src: string) => Promise<string>): Promise<unknown> {
  if (!doc || typeof doc !== "object") return doc;
  if (Array.isArray(doc)) return Promise.all(doc.map((n) => persistNoteImages(n, save)));
  const node = doc as { type?: string; attrs?: { src?: string }; content?: unknown[] };
  if (node.type === "image" && typeof node.attrs?.src === "string" && node.attrs.src.startsWith("data:")) {
    return { ...node, attrs: { ...node.attrs, src: await save(node.attrs.src) } };
  }
  return node.content ? { ...node, content: await persistNoteImages(node.content, save) } : node;
}
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url), image = url.searchParams.get("image");
  if (image !== null) {
    if (req.method !== "GET" || !/^[a-f0-9]{64}$/.test(image)) return new Response("Not found", { status: 404 });
    if (!hosted()) {
      try { return new Response(readFileSync(join(process.cwd(), ".netlify", "dev-note-images", image)), { headers: { "content-type": "image/png" } }); }
      catch { return new Response("Not found", { status: 404 }); }
    }
    const result = await getStore({ name: "presentation-note-images", consistency: "strong" }).getWithMetadata(image, { type: "arrayBuffer" });
    return result ? new Response(result.data, { headers: { "content-type": String(result.metadata.mime ?? "image/png"), "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } }) : new Response("Not found", { status: 404 });
  }
  const saveImage = async (src: string): Promise<string> => {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(src);
    if (!match) throw new Error("Use PNG, JPEG, WebP or GIF images.");
    const bytes = Buffer.from(match[2], "base64"), hash = createHash("sha256").update(bytes).digest("hex");
    if (hosted()) await getStore({ name: "presentation-note-images", consistency: "strong" }).set(hash, new Uint8Array(bytes).buffer, { onlyIfNew: true, metadata: { mime: match[1] } });
    else { const directory = join(process.cwd(), ".netlify", "dev-note-images"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, hash), bytes); }
    return `/api/notes?image=${hash}`;
  };
  return handleNotes(req, openStore(), process.env.BANK_PASSCODE ?? (hosted() ? undefined : "dev"), saveImage);
};
export const config: Config = { path: "/api/notes" };
