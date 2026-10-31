import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import type { PresentationNote } from "../data/types";
import { noteIsNewer, noteSection, validateNote } from "./noteModel";
import { getNotesSyncState, saveNote, syncNotes } from "./notes";
import { syncNow } from "./sync";
import { exportAll, importAll } from "./exportImport";

// The account store, in memory, behind the real /api/account function: a sync here goes through the same code as on the site.
const blobs = new Map<string, unknown>();
vi.mock("../../netlify/lib/store", () => ({
  hosted: () => false,
  openNamedStore: () => ({
    get: async (k: string) => blobs.get(k) ?? null,
    setJSON: async (k: string, v: unknown) => { blobs.set(k, structuredClone(v)); },
    delete: async (k: string) => { blobs.delete(k); },
    list: async (prefix: string) => [...blobs.keys()].filter((k) => k.startsWith(prefix)),
    update: async <T,>(k: string, change: (c: T | null) => T | null | Promise<T | null>) => { const next = await change((blobs.get(k) as T) ?? null); if (next !== null) blobs.set(k, structuredClone(next)); return next; },
  }),
}));
vi.mock("../../netlify/lib/idtoken", () => ({ verifiedUid: async (req: Request) => req.headers.get("authorization")?.slice(7) || null }));
vi.mock("../../netlify/functions/mcp-token", () => ({ firebaseEnv: () => ({ projectId: "p" }) }));
vi.mock("../../netlify/lib/recount", () => ({ serviceAccount: () => null, accessToken: async () => "", listPage: async () => ({ docs: [], nextPageToken: "" }) }));
vi.mock("./firebase", () => ({ cloudConfigured: () => true, currentUser: async () => ({ uid: "alice" }), idToken: async () => "alice" }));
const account = (await import("../../netlify/functions/account")).default;

const requests: string[] = [];
let offline = false;
let duringPush: (() => Promise<void>) | null = null;
const note = (changes: Partial<PresentationNote> = {}): PresentationNote => ({ id: "n1", presentationId: "abdominal-pain", title: "Approach", kind: "Lecture Notes", doc: { type: "doc", content: [{ type: "paragraph" }] }, text: "", source: "", ownerId: "alice", createdAt: 1, _m: 10, revision: "a", deleted: false, ...changes });
/** What another of Alice's devices pushed straight to the store. */
const elsewhere = (notes: PresentationNote[]) => account(new Request("http://x/api/account/push", { method: "POST", headers: { authorization: "Bearer alice" }, body: JSON.stringify({ attempts: [], marks: [], notes, deletes: [] }) }));
const stored = (id: string) => blobs.get(`alice/notes/${id}`) as PresentationNote | undefined;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  blobs.clear(); requests.length = 0; offline = false; duringPush = null;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname.replace("/api/account/", "");
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (offline) throw new Error("Offline");
    if (path === "push" && duringPush) await duringPush();
    return account(new Request(`http://x${url}`, init));
  });
});
describe("presentation notes", () => {
  it("keeps legacy notes in Overview and preserves clinical sections through backup", async () => {
    expect(noteSection(note().section)).toBe("overview");
    expect(noteSection("invalid-link")).toBe("overview");
    expect(() => validateNote(note({ section: "other" as never }))).toThrow();
    const saved = await saveNote(note({ ownerId: "", section: "ddx" }));
    const backup = await exportAll();
    expect(backup.notes?.[0].section).toBe("ddx");
    await db.notes.delete(saved.id);
    await importAll(backup);
    expect((await db.notes.get(saved.id))?.section).toBe("ddx");
  });
  it("saves rich content and rejects a stale editor without discarding its data", async () => {
    const saved = await saveNote(note({ ownerId: "" }));
    expect((await db.notes.get("n1"))?.title).toBe("Approach");
    await expect(saveNote(note({ title: "Stale" }), "old-revision")).rejects.toThrow("changed on another device");
    expect((await db.notes.get("n1"))?.revision).toBe(saved.revision);
  });
  it("claims device notes for the account, uploads only its own, and afterwards sends and reads only what changed", async () => {
    await db.notes.bulkPut([note({ ownerId: "" }), note({ id: "bob-note", ownerId: "bob" })]);
    await syncNotes({ uid: "alice" });
    expect(getNotesSyncState().status).toBe("synced");
    expect(stored("n1")?.ownerId).toBe("alice");
    expect(stored("bob-note")).toBeUndefined();
    expect((await db.notes.get("bob-note"))?.ownerId).toBe("bob");
    // The note went up once; the pull then heard of it but, holding that very version, did not fetch it.
    expect(requests).toEqual(["POST push", "GET changes"]);
    // Nothing changed since: one request, no records read, no library loaded.
    requests.length = 0;
    await syncNow({ uid: "alice" });
    expect(requests).toEqual(["GET changes"]);
    // An edit goes up on its own, without the other notes.
    const edited = await saveNote({ ...note(), title: "Approach, revised" }, "a");
    await db.notes.put(note({ id: "n2", title: "Second", _m: Date.now() }));
    requests.length = 0;
    await syncNow({ uid: "alice" });
    expect(requests).toEqual(["POST push", "GET changes"]);
    expect(stored("n1")?.revision).toBe(edited.revision);
    expect(stored("n2")?.title).toBe("Second");
  });
  it("pulls newer cloud edits and deletions without first overwriting them", async () => {
    await db.notes.put(note());
    await elsewhere([note({ _m: 20, revision: "b", deleted: true })]);
    await syncNotes({ uid: "alice" });
    expect((await db.notes.get("n1"))?.deleted).toBe(true);
    expect(stored("n1")?._m).toBe(20);
    // A note that is only in the account arrives too; another account's never does.
    await elsewhere([note({ id: "n3", title: "From the other device", _m: 30 })]);
    blobs.set("alice/notes/stray", note({ id: "stray", ownerId: "carol" }));
    await syncNow({ uid: "alice" });
    expect((await db.notes.get("n3"))?.title).toBe("From the other device");
    expect(await db.notes.get("stray")).toBeUndefined();
  });
  it("preserves edits made while the sync was in flight", async () => {
    await db.notes.put(note());
    duringPush = async () => { await db.notes.put(note({ _m: Date.now(), revision: "c", title: "Typed during sync" })); };
    await syncNotes({ uid: "alice" });
    expect((await db.notes.get("n1"))?.title).toBe("Typed during sync");
    duringPush = null;
    await syncNow({ uid: "alice" });
    expect(stored("n1")?.title).toBe("Typed during sync");
  });
  it("keeps failed uploads locally for a later retry", async () => {
    await db.notes.put(note());
    offline = true;
    await expect(syncNotes({ uid: "alice" })).rejects.toThrow("Offline");
    expect(getNotesSyncState().status).toBe("error");
    expect(await db.notes.get("n1")).toEqual(note());
    expect(stored("n1")).toBeUndefined();
    offline = false;
    await syncNotes({ uid: "alice" });
    expect(stored("n1")?.title).toBe("Approach");
  });
  it("supports recoverable deletion and deterministic simultaneous revisions", async () => {
    const saved = await saveNote(note());
    const deleted = await saveNote({ ...saved, deleted: true }, saved.revision);
    expect(deleted.doc).toEqual(saved.doc);
    const restored = await saveNote({ ...deleted, deleted: false }, deleted.revision);
    expect(restored.deleted).toBe(false);
    expect(noteIsNewer(note({ revision: "z" }), note())).toBe(true);
  });
  it("backs up only the current account and restores notes from old and new backups", async () => {
    await db.notes.bulkPut([note({ ownerId: "" }), note({ id: "private", ownerId: "bob" })]);
    const backup = await exportAll();
    expect(backup.notes?.map((n) => n.id)).toEqual(["n1"]);
    await db.notes.delete("n1");
    expect((await importAll(backup)).notes).toBe(1);
    expect((await db.notes.get("n1"))?.title).toBe("Approach");
    const { notes: _notes, ...legacy } = backup;
    expect((await importAll(legacy)).notes).toBe(0);
  });
  it("rejects unknown presentations and oversized notes before persistence", () => {
    expect(() => validateNote(note({ presentationId: "not-a-presentation" }))).toThrow();
    expect(() => validateNote(note({ text: "x".repeat(800_000) }))).toThrow("too large");
  });
});
