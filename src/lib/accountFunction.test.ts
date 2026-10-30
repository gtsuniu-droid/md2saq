import { expect, it, vi } from "vitest";

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
// No service account here: the Firestore import quietly does nothing.
vi.mock("../../netlify/lib/recount", () => ({ serviceAccount: () => null, accessToken: async () => "", listAll: async () => [] }));
const account = (await import("../../netlify/functions/account")).default;

const call = (as: string, path: string, body?: unknown) => account(new Request(`http://x/api/account/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));

it("serves a signed-in student's own records and nobody else's", async () => {
  expect((await call("", "changes?since=0")).status).toBe(401);
  expect((await call("gabe", "push", { attempts: [{ id: "a1", _m: 5, answers: [] }], marks: [] })).status).toBe(200);
  expect((await call("gabe", "push", { attempts: "no" })).status).toBe(400);
  expect((await call("gabe", "fetch", { nope: true })).status).toBe(400);
  const mine = await (await call("gabe", "changes?since=0")).json();
  expect(mine.entries).toEqual([{ id: "a1", table: "attempts", _m: 5 }]);
  const theirs = await (await call("someone-else", "changes?since=0")).json();
  expect(theirs.entries).toEqual([]);
  const page = await (await call("gabe", "fetch", { keys: [{ table: "attempts", id: "a1" }] })).json();
  expect(page.records[0].record).toEqual({ id: "a1", _m: 5, answers: [] });
  expect((await call("gabe", "whatever")).status).toBe(404);
});
