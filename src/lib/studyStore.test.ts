import { expect, it, vi } from "vitest";

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
const picks: number[] = [];
vi.mock("node:crypto", async (original) => ({ ...(await original<typeof import("node:crypto")>()), randomInt: (min: number, max: number) => picks.shift() ?? min + Math.floor(Math.random() * (max - min)) }));
vi.mock("../../netlify/lib/idtoken", () => ({ verifiedUid: async (req: Request) => req.headers.get("authorization")?.slice(7) || null }));
vi.mock("../../netlify/functions/mcp-token", () => ({ firebaseEnv: () => ({ projectId: "p" }) }));
const study = (await import("../../netlify/functions/study")).default;

const call = (as: string, body?: unknown, query = "") => study(new Request(`http://x/api/study${query}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const paper = { presentations: ["chest-pain"], questions: [{ bankId: "b1", order: 0, text: "List THREE causes.", setLabel: "Set 12", marks: 3 }], mode: "practice", minutes: 20, hostName: "Gabe" };

it("makes, looks up and joins a code without Firestore", async () => {
  expect((await call("", { create: paper })).status).toBe(401);
  expect((await call("gabe", { create: { ...paper, questions: [] } })).status).toBe(400);
  const res = await call("gabe", { create: paper });
  expect(res.status).toBe(201);
  const made = await res.json();
  expect(made).toMatchObject({ hostUid: "gabe", hostName: "Gabe", mode: "practice", minutes: 20, participants: [{ uid: "gabe", name: "Gabe" }] });
  expect(made.code).toMatch(/^[1-9]\d{5}$/);
  expect(made.expiresAt - made.createdAt).toBe(7 * 24 * 3600 * 1000);

  expect((await (await call("sam", undefined, `?code=${made.code}`)).json()).questions).toEqual(paper.questions);
  expect((await call("sam", undefined, "?code=000000")).status).toBe(404);
  expect((await call("sam", undefined, "?code=12")).status).toBe(400);

  const joined = await (await call("sam", { join: made.code, name: "Sam" })).json();
  expect(joined.participants.map((p: { uid: string }) => p.uid)).toEqual(["gabe", "sam"]);
  // Joining twice adds no one.
  expect((await (await call("sam", { join: made.code, name: "Sam again" })).json()).participants).toHaveLength(2);
  expect((await call("sam", { join: "999999", name: "Sam" })).status).toBe(404);
});

it("never hands out a code that is already taken", async () => {
  picks.push(424242);
  const first = await (await call("gabe", { create: paper })).json();
  picks.push(424242, 424242, 515151);
  const second = await (await call("ana", { create: paper })).json();
  expect([first.code, second.code]).toEqual(["424242", "515151"]);
  expect((await (await call("sam", undefined, "?code=424242")).json()).hostUid).toBe("gabe");
});
