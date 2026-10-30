import { expect, it, vi } from "vitest";

const blobs = new Map<string, unknown>();
vi.mock("../../netlify/lib/store", () => ({
  hosted: () => false,
  openNamedStore: () => ({
    get: async (k: string) => blobs.get(k) ?? null,
    setJSON: async (k: string, v: unknown) => { blobs.set(k, JSON.parse(JSON.stringify(v))); },
    delete: async (k: string) => { blobs.delete(k); },
    list: async (prefix: string) => [...blobs.keys()].filter((k) => k.startsWith(prefix)),
    update: async <T,>(k: string, change: (c: T | null) => T | null | Promise<T | null>) => { const next = await change((blobs.get(k) as T) ?? null); if (next !== null) blobs.set(k, JSON.parse(JSON.stringify(next))); return next; },
  }),
}));
// Firestore, as the import sees it: one account with two attempts (served as two pages), a mark, settings, a paper and a deletion.
const firestore: Record<string, { name: string; fields: Record<string, unknown> }[]> = {
  attempts: [
    { name: "p/users/u1/attempts/a1", fields: { id: { stringValue: "a1" }, _m: { integerValue: "100" }, questionId: { stringValue: "q1" }, submittedAt: { integerValue: "100" }, elapsedSec: { doubleValue: 4.5 }, answers: { arrayValue: { values: [{ mapValue: { fields: { label: { stringValue: "" }, text: { stringValue: "Aspirin" }, doc: { nullValue: null } } } }] } }, qref: { mapValue: { fields: { bankId: { stringValue: "b1" }, order: { integerValue: "0" } } } } } },
    { name: "p/users/u1/attempts/a2", fields: { id: { stringValue: "a2" }, _m: { integerValue: "50" }, questionId: { stringValue: "q2" }, answers: { arrayValue: { values: [] } } } },
  ],
  marks: [{ name: "p/users/u1/marks/m1", fields: { id: { stringValue: "m1" }, _m: { integerValue: "110" }, attemptId: { stringValue: "a1" }, score: { integerValue: "3" }, reviewLater: { booleanValue: false } } }],
  settings: [
    { name: "p/users/u1/settings/settings", fields: { id: { stringValue: "settings" }, _m: { integerValue: "90" }, minutesPerMark: { doubleValue: 1.5 } } },
    { name: "p/users/u1/settings/session", fields: { id: { stringValue: "session" }, _m: { integerValue: "95" }, session: { mapValue: { fields: { id: { stringValue: "s1" }, index: { integerValue: "0" } } } } } },
  ],
  deleted: [{ name: "p/users/u1/deleted/a2", fields: { id: { stringValue: "a2" }, table: { stringValue: "attempts" }, _m: { integerValue: "70" } } }],
};
let failing = false;
const pages: string[] = [];
vi.mock("../../netlify/lib/recount", () => ({
  serviceAccount: () => ({ client_email: "sa@x", private_key: "k", project_id: "p" }),
  accessToken: async () => "token",
  // Attempts come one document per page, to exercise paging; everything else in one.
  listPage: async (_base: string, _token: string, path: string, pageToken = "") => {
    if (failing) throw new Error("Firestore read failed (429)");
    pages.push(`${path}:${pageToken}`);
    const docs = firestore[path] ?? [];
    if (path !== "attempts") return { docs, nextPageToken: "" };
    const i = Number(pageToken || 0);
    return { docs: docs.slice(i, i + 1), nextPageToken: i + 1 < docs.length ? String(i + 1) : "" };
  },
}));
vi.mock("../../netlify/functions/mcp-token", () => ({ firebaseEnv: () => ({ projectId: "p" }) }));
const { importFromFirestore, decode, importDue, IMPORT_RETRY_MS } = await import("../../netlify/lib/accountImport");
const { changes, fetchRecords, readIndex, push } = await import("../../netlify/lib/accountStore");

it("turns Firestore's wire values back into plain records", () => {
  expect(decode({ mapValue: { fields: { a: { integerValue: "3" }, b: { doubleValue: 1.5 }, c: { booleanValue: true }, d: { nullValue: null }, e: { arrayValue: { values: [{ stringValue: "x" }] } }, f: { timestampValue: "2026-01-01T00:00:00Z" } } } }))
    .toEqual({ a: 3, b: 1.5, c: true, d: null, e: ["x"], f: Date.UTC(2026, 0, 1) });
});

it("folds an account's Firestore records in, newest wins against what devices pushed since, deletions included", async () => {
  blobs.clear(); pages.length = 0;
  // A device already pushed a newer copy of a1 to the new store before the import ran.
  await push("u1", { attempts: [{ id: "a1", _m: 200, questionId: "q1", answers: [], submittedAt: 200, elapsedSec: 9 }], marks: [], deletes: [] }, 1000);
  // Plenty of budget: everything in one go.
  expect(await importFromFirestore("u1", 2000, undefined, 60_000, () => 2000)).toEqual({ done: true, imported: 3 });
  expect(pages).toEqual(["attempts:", "attempts:1", "marks:", "settings:", "deleted:"]);
  const index = await readIndex("u1");
  expect(index?.imported).toBe(2000);
  expect(index?.importState).toBeUndefined();
  const ch = await changes("u1", 0, 2001);
  expect(ch.entries.map((e) => `${e.id}@${e._m}${e.deleted ? "-" : ""}`).sort()).toEqual(["a1@200", "a2@70-", "m1@110"]);
  expect(ch.settings).toMatchObject({ minutesPerMark: 1.5 });
  expect(ch.session).toMatchObject({ session: { id: "s1", index: 0 } });
  expect((await fetchRecords("u1", [{ table: "attempts", id: "a1" }])).records[0].record.elapsedSec).toBe(9);
  expect((await fetchRecords("u1", [{ table: "marks", id: "m1" }])).records[0].record).toMatchObject({ attemptId: "a1", score: 3, reviewLater: false });
  // Done once: a second call does nothing.
  expect(await importFromFirestore("u1", 3000)).toBeNull();
});

it("an import that runs out of time carries on where it left off at the next pull, each page stamped as it arrives", async () => {
  blobs.clear(); pages.length = 0;
  let t = 10_000;
  const clock = () => (t += 1000);
  // No budget at all: one page per call.
  expect(await importFromFirestore("u2", 10_000, undefined, 0, clock)).toEqual({ done: false, imported: 1 });
  expect((await readIndex("u2"))?.importState).toEqual({ stage: 0, pageToken: "1" });
  // Claimed moments ago: a second pull right behind does not start another.
  expect(await importFromFirestore("u2", 10_001, undefined, 0, clock)).toBeNull();
  // A device pulling in between sees the first page by arrival time, not by the import's start.
  const seen = (await changes("u2", 10_500, 20_000)).entries.map((e) => e.id);
  expect(seen).toEqual(["a1"]);
  let now = 10_000;
  let last: { done: boolean } | null = null;
  for (let i = 0; i < 6 && !last?.done; i++) { now += 60_000; last = await importFromFirestore("u2", now, undefined, 0, clock); }
  expect(last).toEqual({ done: true, imported: 0 });
  expect((await changes("u2", 0, 99_999_999)).entries.map((e) => e.id).sort()).toEqual(["a1", "a2", "m1"]);
});

it("a refused import is tried again later, not on every pull", async () => {
  blobs.clear();
  failing = true;
  await expect(importFromFirestore("u3", 5000)).rejects.toThrow(/429/);
  expect(importDue(await readIndex("u3"), 5000 + 60_000)).toBe(false);
  expect(importDue(await readIndex("u3"), 5000 + IMPORT_RETRY_MS)).toBe(true);
  expect(await importFromFirestore("u3", 5000 + 60_000)).toBeNull();
  failing = false;
  expect(await importFromFirestore("u3", 5000 + IMPORT_RETRY_MS, undefined, 60_000, () => 1)).toEqual({ done: true, imported: 3 });
});
