import { expect, it, vi } from "vitest";

const blobs = new Map<string, unknown>();
vi.mock("../../netlify/lib/store", () => ({
  openNamedStore: (name: string) => ({
    get: async (k: string) => blobs.get(`${name}/${k}`) ?? null,
    setJSON: async (k: string, v: unknown) => { blobs.set(`${name}/${k}`, v); },
    delete: async (k: string) => { blobs.delete(`${name}/${k}`); },
    list: async (prefix: string) => [...blobs.keys()].filter((k) => k.startsWith(`${name}/${prefix}`)).map((k) => k.slice(name.length + 1)),
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

it("keeps everyone's answers, marks and comments under the code, in the site's own store", async () => {
  const made = await (await call("gabe", { create: paper })).json();
  const code = made.code as string;
  const room = (as: string) => call(as, undefined, `?code=${code}`).then(() => study(new Request(`http://x/api/study/room?code=${code}`, { headers: { authorization: `Bearer ${as}` } })));
  const post = (as: string, action: string, body: Record<string, unknown>) => study(new Request(`http://x/api/study/${action}`, { method: "POST", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: JSON.stringify({ code, ...body }) }));
  expect((await room("gabe")).status).toBe(200);
  expect((await (await room("gabe")).json()).shared).toEqual([]);
  // Sharing is only ever your own, under a name; a stranger with the code is counted as having joined.
  expect((await post("sam", "share", { name: "Sam", answers: [{ index: 0, text: "Aspirin", score: 2, maxScore: 3 }] })).status).toBe(200);
  expect((await post("sam", "share", { name: "Sam", answers: "no" })).status).toBe(400);
  expect((await post("sam", "share", { name: "Sam", answers: [{ index: 99, text: "x" }] })).status).toBe(400);
  await post("gabe", "share", { name: "Gabe", answers: [{ index: 0, text: "Aspirin and PCI", parts: [{ label: "a", text: "Aspirin" }, { label: "b", text: "PCI" }] }] });
  let view = await (await room("gabe")).json();
  expect(view.study.participants.map((p: { uid: string }) => p.uid)).toEqual(["gabe", "sam"]);
  expect(view.shared.map((s: { uid: string }) => s.uid)).toEqual(["sam", "gabe"]);
  expect(view.shared[1].answers[0].parts).toHaveLength(2);
  // A mark replaces the same person's earlier mark on that answer, and a null score takes it away.
  expect((await post("gabe", "mark", { index: 0, targetUid: "sam", score: 2, maxScore: 3 })).status).toBe(200);
  expect((await post("gabe", "mark", { index: 0, targetUid: "sam", score: 4, maxScore: 3 })).status).toBe(400);
  view = await (await post("gabe", "mark", { index: 0, targetUid: "sam", score: 3, maxScore: 3 })).json();
  expect(view.marks).toEqual([expect.objectContaining({ index: 0, targetUid: "sam", by: "gabe", score: 3, maxScore: 3 })]);
  await post("sam", "mark", { index: 0, targetUid: "gabe", score: 1, maxScore: 3 });
  view = await (await post("gabe", "mark", { index: 0, targetUid: "sam", score: null, maxScore: 3 })).json();
  expect(view.marks.map((m: { by: string }) => m.by)).toEqual(["sam"]);
  // Comments: the writer or the host may take one back, nobody else.
  view = await (await post("sam", "comment", { name: "Sam", index: 0, targetUid: "gabe", text: "  Dose?  " })).json();
  expect(view.comments).toEqual([expect.objectContaining({ uid: "sam", name: "Sam", index: 0, targetUid: "gabe", text: "Dose?" })]);
  const id = view.comments[0].id as string;
  expect((await post("sam", "comment", { name: "Sam", index: 0, targetUid: "gabe", text: "   " })).status).toBe(400);
  view = await (await post("ana", "uncomment", { id })).json();
  expect(view.comments).toHaveLength(1);
  view = await (await post("gabe", "uncomment", { id })).json();
  expect(view.comments).toEqual([]);
  // The whole room is one GET, and an unknown code is a plain 404 everywhere.
  view = await (await room("sam")).json();
  expect(view.marks).toHaveLength(1);
  expect((await study(new Request("http://x/api/study/room?code=000001", { headers: { authorization: "Bearer sam" } }))).status).toBe(404);
  expect((await study(new Request("http://x/api/study/mark", { method: "POST", headers: { authorization: "Bearer sam" }, body: JSON.stringify({ code: "000001", index: 0, targetUid: "gabe", score: 1, maxScore: 3 }) }))).status).toBe(404);
});

it("forgets a code a month after it expired, answers and all", async () => {
  const made = await (await call("gabe", { create: paper })).json();
  const code = made.code as string;
  const post = (as: string, action: string, body: Record<string, unknown>) => study(new Request(`http://x/api/study/${action}`, { method: "POST", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: JSON.stringify({ code, ...body }) }));
  await post("gabe", "share", { name: "Gabe", answers: [{ index: 0, text: "Aspirin" }] });
  const { readStudy } = await import("../../netlify/lib/studyStore");
  const soon = made.expiresAt + 24 * 3600 * 1000;
  expect(await readStudy(code, undefined, soon)).not.toBeNull();
  expect(await readStudy(code, undefined, made.expiresAt + 31 * 24 * 3600 * 1000)).toBeNull();
  expect((await call("gabe", undefined, `?code=${code}`)).status).toBe(404);
  expect([...blobs.keys()].filter((k) => k.includes(code))).toEqual([]);
});

it("refuses marks and comments on answers the session does not have, and joins or shares after the code expires", async () => {
  const made = await (await call("gabe", { create: paper })).json();
  const code = made.code as string;
  const post = (as: string, action: string, body: Record<string, unknown>) => study(new Request(`http://x/api/study/${action}`, { method: "POST", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: JSON.stringify({ code, ...body }) }));
  // Marking someone who never joined or shared, or a question the code does not have, is refused.
  expect((await post("gabe", "mark", { index: 0, targetUid: "stranger", score: 1, maxScore: 3 })).status).toBe(400);
  expect((await post("gabe", "mark", { index: 7, targetUid: "gabe", score: 1, maxScore: 3 })).status).toBe(400);
  expect((await post("gabe", "comment", { name: "Gabe", index: 0, targetUid: "stranger", text: "hi" })).status).toBe(400);
  // Someone who shared without joining first can be marked.
  await post("sam", "share", { name: "Sam", answers: [{ index: 0, text: "Aspirin" }] });
  expect((await post("gabe", "mark", { index: 0, targetUid: "sam", score: 1, maxScore: 3 })).status).toBe(200);
  // After the week is up, joining and sharing are refused but marking goes on.
  const { giveMark, joinStudy, shareAnswers, readStudy } = await import("../../netlify/lib/studyStore");
  const late = made.expiresAt + 60_000;
  await expect(joinStudy(code, { uid: "ana", name: "Ana" }, undefined, late)).rejects.toThrow(/expired/);
  await expect(shareAnswers(code, "ana", { name: "Ana" }, [{ index: 0, text: "x" }], late)).rejects.toThrow(/expired/);
  expect(await giveMark(code, "sam", { index: 0, targetUid: "gabe", score: 2, maxScore: 3 }, late)).not.toBeNull();
  expect(await readStudy(code, undefined, late)).not.toBeNull();
});

it("keeps a room reply under the size limit by letting the heaviest share fall back to text", async () => {
  const { fitShared } = await import("../../netlify/lib/studyStore");
  const doc = (n: number) => ({ type: "doc", content: [{ type: "text", text: "x".repeat(n) }] });
  const share = (uid: string, n: number) => ({ uid, name: uid, sharedAt: 1, answers: [{ index: 0, text: "short", parts: [{ label: "", text: "short", doc: doc(n) }] }] });
  const fitted = fitShared([share("a", 1000), share("b", 5000), share("c", 200)], 6000);
  expect(fitted.find((s) => s.uid === "b")!.answers[0].parts![0].doc).toBeUndefined();
  expect(fitted.find((s) => s.uid === "a")!.answers[0].parts![0].doc).toBeDefined();
  expect(fitted.find((s) => s.uid === "b")!.answers[0].parts![0].text).toBe("short");
  expect(JSON.stringify(fitted).length).toBeLessThan(6000 + 200);
});
