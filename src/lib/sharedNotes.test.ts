import { describe, expect, it } from "vitest";
import { handleNotes } from "../../netlify/functions/notes";
import type { PresentationNote } from "../data/types";
const note: PresentationNote = { id: "shared-test", presentationId: "abdominal-pain", kind: "Core presentation", title: "Example", doc: { type: "doc", content: [] }, text: "Example", source: "", ownerId: "@shared", createdAt: 1, _m: 1, revision: "", deleted: false };
function setup() {
  const data = new Map<string, PresentationNote>();
  const store = {
    async list({ prefix }: { prefix: string }) { return { blobs: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
    async getWithMetadata(key: string) { const n = data.get(key); return n ? { data: n, etag: n.revision } : null; },
    async setJSON(key: string, n: PresentationNote, options: { onlyIfMatch?: string; onlyIfNew?: boolean }) { const p = data.get(key); if ((options.onlyIfNew && p) || (options.onlyIfMatch && p?.revision !== options.onlyIfMatch)) return { modified: false }; data.set(key, n); return { modified: true }; },
  };
  const send = (value = note, passcode = "admin", baseRevision?: string) => handleNotes(new Request("https://test/api/notes?presentation=abdominal-pain", { method: "PUT", headers: { "x-passcode": passcode }, body: JSON.stringify({ note: value, baseRevision }) }), store, "admin");
  return { store, send };
}
describe("shared website notes", () => {
  it("requires admin access for writes but allows public reading", async () => {
    const { store, send } = setup();
    expect((await send(note, "wrong")).status).toBe(403);
    expect((await send()).status).toBe(200);
    const r = await handleNotes(new Request("https://test/api/notes?presentation=abdominal-pain"), store, "admin");
    expect((await r.json()).notes[0].title).toBe("Example");
  });
  it("rejects stale updates and keeps deleted notes restorable", async () => {
    const { send } = setup();
    const saved = (await (await send()).json()).note;
    expect((await send({ ...saved, title: "Stale" }, "admin", "wrong")).status).toBe(409);
    const deleted = (await (await send({ ...saved, deleted: true }, "admin", saved.revision)).json()).note;
    const restored = (await (await send({ ...deleted, deleted: false }, "admin", deleted.revision)).json()).note;
    expect(restored.deleted).toBe(false);
    expect(restored.doc).toEqual(note.doc);
  });
  it("rejects private notes and invalid presentations", async () => {
    const { send } = setup();
    expect((await send({ ...note, ownerId: "private-account" })).status).toBe(400);
    expect((await send({ ...note, presentationId: "missing" })).status).toBe(400);
  });
  it("uses a conditional write so a race cannot overwrite another edit", async () => {
    const { store } = setup();
    store.setJSON = async () => ({ modified: false });
    const r = await handleNotes(new Request("https://test/api/notes?presentation=abdominal-pain", { method: "PUT", headers: { "x-passcode": "admin" }, body: JSON.stringify({ note }) }), store, "admin");
    expect(r.status).toBe(409);
  });
});
