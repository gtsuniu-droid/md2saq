import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db, withRemoteWrites } from "../data/db";
import type { Attempt, Mark, Question, Session } from "../data/types";
import { historyEntries } from "./history";
import { setProgressAccount } from "./progressAccount";
import { loadSession, saveSession, sessionOwner } from "./session";
import { getProgressSyncState, questionRef, syncNow } from "./sync";
import { importAll, exportAll } from "./exportImport";

vi.mock("./firebase", () => ({ cloudConfigured: () => true, currentUser: vi.fn(), idToken: async () => "token" }));
vi.mock("./notes", () => ({ syncNotes: vi.fn().mockResolvedValue(undefined) }));
// The account store, in memory, reached the way the app reaches it: over fetch to /api/account.
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
const { changes, fetchRecords, push: pushToStore } = await import("../../netlify/lib/accountStore");
const pushes: string[] = [];
let failNext: string | null = null;
/** Who is calling: the tests sync one account at a time, so the current user is whoever last signed in; concurrent calls name themselves. */
let caller = "";
const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const u = new URL(url, "http://x");
  const action = u.pathname.split("/").pop();
  const uid = (init?.headers as Record<string, string>)?.["x-test-uid"] ?? caller;
  if (failNext) { const m = failNext; failNext = null; throw new Error(m); }
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (action === "changes") return json(await changes(uid, Number(u.searchParams.get("since") ?? 0)));
  if (action === "fetch") return json(await fetchRecords(uid, (JSON.parse(String(init?.body)) as { keys: { table: "attempts" | "marks"; id: string }[] }).keys));
  if (action === "push") { pushes.push(uid); return json(await pushToStore(uid, JSON.parse(String(init?.body)))); }
  return new Response("{}", { status: 404 });
};
const cloudKeys = (uid: string, table: string) => [...blobs.keys()].filter((k) => k.startsWith(`${uid}/${table}/`)).map((k) => k.split("/").pop()!);
const cloudIndex = (uid: string) => blobs.get(`${uid}/index`) as { session?: { session?: { id: string } } } | undefined;
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
}
const q: Question = { id: "q", setId: "set", order: 0, text: "Describe your approach", parts: [], tags: [], presentations: [], createdAt: 1 };
const attempt = (id: string, ownerId: string): Attempt => ({ id, ownerId, questionId: "q", qref: { setId: "set", bankId: "bank", order: 0, text: q.text, setNumber: 1 }, answers: [{ label: "", text: "My answer", doc: { type: "doc", content: [] } }], startedAt: 10, submittedAt: 20, elapsedSec: 5, mode: "practice", sessionId: `paper-${id}` });
const mark = (id: string, ownerId: string): Mark => ({ id: `mark-${id}`, ownerId, attemptId: id, questionId: "q", qref: { setId: "set", bankId: "bank", order: 0 }, score: 2, maxScore: 3, parts: [], errorTags: [], markedAt: 30 });
const session = (id: string): Session => ({ id: `paper-${id}`, questionIds: ["q"], attemptIds: [id], index: 0, mode: "practice", startedAt: 10 });
let now = 10_000;
beforeEach(async () => {
  vi.stubGlobal("localStorage", storage()); vi.stubGlobal("sessionStorage", storage());
  vi.spyOn(Date, "now").mockImplementation(() => ++now);
  await Promise.all(db.tables.map((table) => table.clear()));
  blobs.clear(); pushes.length = 0; failNext = null; caller = "";
  vi.stubGlobal("fetch", fakeFetch);
  await db.sets.put({ id: "set", name: "Case", number: 1, bankId: "bank", createdAt: 1 });
  await db.questions.put(q);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("account-owned progress and cloud history", () => {
  it("keeps answers, marks, cursors and unfinished sessions separate when switching accounts", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put(attempt("a", "alice")); await db.marks.put(mark("a", "alice"));
    saveSession(session("a")); caller = "alice"; await syncNow({ uid: "alice" });
    await setProgressAccount({ uid: "bob" });
    expect(loadSession()).toBeNull();
    await db.attempts.put(attempt("b", "bob")); await db.marks.put(mark("b", "bob"));
    saveSession(session("b")); caller = "bob"; await syncNow({ uid: "bob" });
    expect(cloudKeys("alice", "attempts")).toEqual(["a"]);
    expect(cloudKeys("bob", "attempts")).toEqual(["b"]);
    expect(cloudKeys("bob", "marks")).toEqual(["mark-b"]);
    expect(cloudIndex("bob")?.session?.session).toMatchObject({ id: "paper-b" });
    expect(await db.meta.get("sync.pulledAt:alice")).toBeDefined();
    expect(await db.meta.get("sync.pulledAt:bob")).toBeDefined();
    await setProgressAccount(null); expect(loadSession()).toBeNull();
    expect(historyEntries(await db.attempts.toArray(), await db.marks.toArray(), [q], [], "")).toEqual([]);
    await setProgressAccount({ uid: "alice" }); expect(loadSession()?.id).toBe("paper-a");
    const rows = historyEntries(await db.attempts.toArray(), await db.marks.toArray(), [q], [], "alice");
    expect(rows.map((r) => r.attempt.id)).toEqual(["a"]);
    expect(rows[0].mark?.score).toBe(2);
  });
  it("claims guest work once and retains a legacy paper for its previous account", async () => {
    await db.attempts.put(attempt("guest", ""));
    saveSession(session("guest"));
    await setProgressAccount({ uid: "alice" });
    expect((await db.attempts.get("guest"))?.ownerId).toBe("alice");
    expect(loadSession()?.id).toBe("paper-guest");
    await setProgressAccount({ uid: "bob" });
    expect((await db.attempts.get("guest"))?.ownerId).toBe("alice");
    expect(loadSession()).toBeNull();
  });
  it("migrates an existing global paper to the account stored on the device before switching", async () => {
    localStorage.setItem("saq-session-v2", JSON.stringify({ session: session("legacy"), _m: 40 }));
    await db.settings.put({ id: "settings", minutesPerMark: 1, autoImportBank: false, ambossHighlights: false, ambossOnPaper: false, cloudUser: { uid: "alice" } });
    // The first render may read the old envelope before authentication finishes.
    expect(loadSession()?.id).toBe("paper-legacy");
    await setProgressAccount({ uid: "bob" });
    expect(loadSession()).toBeNull();
    expect(loadSession("alice")?.id).toBe("paper-legacy");
    expect(sessionOwner()).toBe("bob");
  });
  it("restores history, marks and the paper on another device with different question ids", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put({ ...attempt("a", "alice"), qref: await questionRef(q) }); await db.marks.put(mark("a", "alice"));
    saveSession({ ...session("a"), studyUnit: "sets", openedSetCount: 2 }); caller = "alice"; await syncNow({ uid: "alice" });
    await Promise.all([db.attempts.clear(), db.marks.clear(), db.meta.clear(), db.settings.clear(), db.questions.clear()]);
    localStorage.clear();
    await db.questions.put({ ...q, id: "q-on-new-device" });
    await setProgressAccount({ uid: "alice" }); await syncNow({ uid: "alice" });
    expect((await db.attempts.get("a"))?.questionId).toBe("q-on-new-device");
    expect((await db.attempts.get("a"))?.answers[0].text).toBe("My answer");
    expect((await db.marks.get("mark-a"))?.ownerId).toBe("alice");
    expect(loadSession()?.questionIds).toEqual(["q-on-new-device"]);
    expect(loadSession()).toMatchObject({ studyUnit: "sets", openedSetCount: 2 });
  });
  it("retains history before its bank arrives and resolves it on the next sync", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.questions.clear();
    caller = "alice";
    await pushToStore("alice", { attempts: [{ ...attempt("remote", "alice"), _m: 100 } as unknown as Record<string, unknown> & { id: string }], marks: [], deletes: [] });
    expect((await syncNow({ uid: "alice" }))?.unresolved).toBe(1);
    expect((await db.attempts.get("remote"))?.submittedAt).toBe(20);
    expect(await db.meta.get("sync.pulledAt:alice")).toBeUndefined();
    await db.questions.put({ ...q, id: "downloaded" });
    expect((await syncNow({ uid: "alice" }))?.unresolved).toBe(0);
    expect((await db.attempts.get("remote"))?.questionId).toBe("downloaded");
  });
  it("uploads everything a device holds the first time it meets the account store, then only what changed", async () => {
    await setProgressAccount({ uid: "alice" });
    // Pushed to Firestore long ago: the push cursor is past these records' stamps.
    await withRemoteWrites(async () => { await db.attempts.put({ ...attempt("old", "alice"), _m: 500 }); await db.marks.put({ ...mark("old", "alice"), _m: 600 }); });
    await db.meta.put({ id: "sync.pushedAt:alice", value: 9_000 });
    caller = "alice"; await syncNow({ uid: "alice" });
    expect(cloudKeys("alice", "attempts")).toEqual(["old"]);
    expect(cloudKeys("alice", "marks")).toEqual(["mark-old"]);
    // Seeded: the next sync sends only what changed since.
    await db.attempts.put(attempt("new", "alice"));
    const before = pushes.length;
    await syncNow({ uid: "alice" });
    expect(pushes.length).toBe(before + 1);
    expect(cloudKeys("alice", "attempts").sort()).toEqual(["new", "old"]);
    expect((blobs.get("alice/attempts/old") as { _m: number })._m).toBe(500);
  });
  it("keeps offline attempts and retries failed cloud writes without advancing the cursor", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put(attempt("a", "alice"));
    caller = "alice"; failNext = "Offline";
    await expect(syncNow({ uid: "alice" })).rejects.toThrow("Offline");
    expect(getProgressSyncState().status).toBe("error");
    expect(await db.meta.get("sync.pushedAt:alice")).toBeUndefined();
    expect(await db.attempts.get("a")).toBeDefined();
    await syncNow({ uid: "alice" });
    expect(cloudKeys("alice", "attempts")).toEqual(["a"]);
    expect(getProgressSyncState().status).toBe("synced");
  });
  it("preserves a guest paper when the signed-in account already has one", async () => {
    await setProgressAccount({ uid: "alice" });
    saveSession(session("a"));
    await setProgressAccount(null);
    await db.attempts.put(attempt("guest", ""));
    await db.marks.put(mark("guest", ""));
    saveSession(session("guest"));
    await setProgressAccount({ uid: "alice" });
    expect(loadSession()?.id).toBe("paper-a");
    expect((await db.attempts.get("guest"))?.ownerId).toBe("");
    expect((await db.marks.get("mark-guest"))?.ownerId).toBe("");
    await setProgressAccount(null);
    expect(loadSession()?.id).toBe("paper-guest");
  });
  it("imports a backup into another account without replacing the original account's answers", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put(attempt("a", "alice")); await db.marks.put(mark("a", "alice"));
    const backup = await exportAll();
    await setProgressAccount({ uid: "bob" });
    await importAll(backup);
    expect((await db.attempts.get("a"))?.ownerId).toBe("alice");
    expect((await db.marks.get("mark-a"))?.ownerId).toBe("alice");
    const bobBackup = await exportAll();
    expect(bobBackup.attempts).toHaveLength(1);
    expect(bobBackup.attempts[0].id).not.toBe("a");
    expect(bobBackup.marks[0].attemptId).toBe(bobBackup.attempts[0].id);
  });
  it("syncs concurrent account requests into their own records, one push per account", async () => {
    await db.attempts.bulkPut([attempt("a", "alice"), attempt("b", "bob")]);
    // Syncs run one account at a time, so the caller can follow the queue: whoever's turn it is signs the calls.
    const { idToken } = await import("./firebase");
    void idToken;
    const turns = ["alice", "bob"];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => fakeFetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-test-uid": (() => { const u = new URL(url, "http://x"); if (u.pathname.endsWith("changes") && turns.length > 1 && pushes.filter((p) => p === turns[0]).length) turns.shift(); return turns[0]; })() } }));
    await Promise.all([syncNow({ uid: "alice" }), syncNow({ uid: "bob" }), syncNow({ uid: "alice" })]);
    expect(cloudKeys("alice", "attempts")).toEqual(["a"]);
    expect(cloudKeys("bob", "attempts")).toEqual(["b"]);
    expect(pushes.filter((u) => u === "alice")).toHaveLength(1);
  });
});
