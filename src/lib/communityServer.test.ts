import { beforeEach, expect, it, vi } from "vitest";

const blobs = new Map<string, unknown>();
vi.mock("../../netlify/lib/store", () => ({
  openNamedStore: (name: string) => ({
    get: async (k: string) => blobs.get(`${name}/${k}`) ?? null,
    setJSON: async (k: string, v: unknown) => { blobs.set(`${name}/${k}`, v); },
    delete: async (k: string) => { blobs.delete(`${name}/${k}`); },
    list: async () => [],
    update: async <T,>(k: string, change: (c: T | null) => T | null | Promise<T | null>) => { const next = await change((blobs.get(`${name}/${k}`) as T) ?? null); if (next !== null) blobs.set(`${name}/${k}`, next); return next; },
  }),
}));
// Each test caller's bearer token is their uid; the "sign-in" gives a name, picture and email.
const people: Record<string, { name?: string; picture?: string; email?: string }> = {
  ana: { name: "Ana Lee", picture: "https://lh3.googleusercontent.com/ana", email: "ana@x.com" },
  sam: { name: "Sam" },
  boss: { name: "Boss", email: "boss@x.com" },
};
vi.mock("../../netlify/lib/idtoken", () => ({ verifiedUser: async (req: Request) => { const uid = req.headers.get("authorization")?.slice(7) ?? ""; return people[uid] ? { uid, ...people[uid] } : null; } }));
vi.mock("../../netlify/functions/mcp-token", () => ({ firebaseEnv: () => ({ projectId: "p", adminEmails: ["boss@x.com"] }), caller: async () => ({ role: "student" }) }));
const firestore = vi.hoisted(() => ({ docs: {} as Record<string, unknown[]>, reads: 0 }));
vi.mock("../../netlify/lib/recount", () => ({
  serviceAccount: () => ({ project_id: "p" }), accessToken: async () => "t",
  listAll: async (_base: string, _token: string, path: string) => { firestore.reads++; return firestore.docs[path] ?? []; },
  num: (v?: { timestampValue?: string }) => v?.timestampValue ? Date.parse(v.timestampValue) : undefined,
  str: (v?: { stringValue?: string }) => v?.stringValue,
}));
const community = (await import("../../netlify/functions/community")).default;

const at = { bank: "bank1", q: "q1" };
const post = (as: string, body: Record<string, unknown>) => community(new Request("http://x/api/community", { method: "POST", headers: { authorization: `Bearer ${as}` }, body: JSON.stringify({ ...at, ...body }) }));
const read = async (as: string, channel: string, cursor = 0) => (await community(new Request(`http://x/api/community?bank=bank1&q=q1&channel=${channel}&cursor=${cursor}`, { headers: { authorization: `Bearer ${as}` } }))).json();
beforeEach(() => { blobs.clear(); firestore.docs = {}; firestore.reads = 0; });

it("keeps reports with the author's own sign-in name and picture, and their source", async () => {
  expect((await post("", { channel: "suggestions", action: "post", id: "r1", body: "x", kind: "problem" })).status).toBe(401);
  expect((await post("ana", { channel: "suggestions", action: "post", id: "r1", body: "Dose is wrong.", kind: "problem", source: "https://bnf.nice.org.uk/drugs/aspirin", authorName: "Someone else" })).status).toBe(201);
  const { posts } = await read("sam", "suggestions");
  expect(posts).toEqual([expect.objectContaining({ id: "r1", authorId: "ana", authorName: "Ana Lee", authorPhoto: "https://lh3.googleusercontent.com/ana", source: "https://bnf.nice.org.uk/drugs/aspirin", kind: "problem", resolved: false })]);
  // A sign-in without a picture just has none.
  await post("sam", { channel: "discussion", action: "post", id: "c1", body: "Agree.", kind: "comment" });
  expect((await read("ana", "discussion")).posts[0]).not.toHaveProperty("authorPhoto");
  expect((await post("sam", { channel: "discussion", action: "post", id: "c2", body: "x", kind: "problem" })).status).toBe(400);
});

it("treats a resent post as the same one, and refuses its id for anything else", async () => {
  const send = (body: string) => post("ana", { channel: "discussion", action: "post", id: "same", body, kind: "comment" });
  expect((await send("Hello")).status).toBe(201);
  expect((await send("Hello")).status).toBe(201);
  expect((await read("ana", "discussion")).posts).toHaveLength(1);
  expect((await (await send("Different")).json()).error).toContain("already been sent");
});

it("pages newest first", async () => {
  for (let i = 0; i < 30; i++) await post("ana", { channel: "discussion", action: "post", id: `p${i}`, body: `n${i}`, kind: "comment" });
  const first = await read("sam", "discussion");
  expect([first.posts.length, first.posts[0].body, first.cursor]).toEqual([25, "n29", 25]);
  const rest = await read("sam", "discussion", first.cursor);
  expect([rest.posts.length, rest.posts.at(-1).body, rest.cursor]).toEqual([5, "n0", undefined]);
});

it("lets authors delete their own, and only moderators delete others' or resolve reports", async () => {
  await post("ana", { channel: "suggestions", action: "post", id: "r1", body: "Wrong.", kind: "problem" });
  expect((await post("sam", { channel: "suggestions", action: "delete", id: "r1" })).status).toBe(403);
  expect((await post("sam", { channel: "suggestions", action: "resolve", id: "r1", resolved: true })).status).toBe(403);
  expect((await post("boss", { channel: "suggestions", action: "resolve", id: "r1", resolved: true })).status).toBe(200);
  expect((await read("ana", "suggestions")).posts[0].resolved).toBe(true);
  expect((await post("ana", { channel: "suggestions", action: "delete", id: "r1" })).status).toBe(200);
  expect((await read("ana", "suggestions")).posts).toEqual([]);
});

it("brings a question's Firestore posts across once, keeping them alongside new ones", async () => {
  firestore.docs["questionCommunity/bank1/questions/q1/suggestions"] = [{ name: "x/old1", fields: { authorId: { stringValue: "olduser" }, authorName: { stringValue: "Old" }, body: { stringValue: "Old report" }, kind: { stringValue: "problem" }, resolved: { booleanValue: false }, createdAt: { timestampValue: "2026-10-01T00:00:00Z" } } }];
  await post("ana", { channel: "suggestions", action: "post", id: "new1", body: "New report", kind: "problem" });
  expect((await read("sam", "suggestions")).posts.map((p: { id: string }) => p.id)).toEqual(["new1", "old1"]);
  await read("sam", "suggestions"); await read("sam", "discussion");
  expect(firestore.reads).toBe(2); // one list per channel, the first time only
});
