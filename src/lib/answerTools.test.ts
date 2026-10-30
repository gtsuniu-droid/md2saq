import { expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SetForMarking } from "./setForMarking";

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
vi.mock("../../netlify/lib/idtoken", () => ({ verifiedUid: async (req: Request) => req.headers.get("authorization")?.slice(7) || null }));
vi.mock("../../netlify/functions/mcp-token", () => ({ firebaseEnv: () => ({ projectId: "p" }) }));

const { registerAnswerTools } = await import("../../netlify/lib/answerTools");
const answers = (await import("../../netlify/functions/answers")).default;

const set: SetForMarking = { key: "t1", name: "Set 12: Chest pain", at: 100, questions: [
  { attemptId: "t1", number: 1, stems: ["Mr Lee, 64, chest pain."], text: "", model: "", parts: [
    { id: "1(a)", label: "a", marks: 2, prompt: "List TWO differentials.", answer: "STEMI and pericarditis", model: "STEMI; dissection" },
    { id: "1(b)", label: "b", marks: 1, prompt: "First investigation?", answer: "ECG", model: "ECG" },
  ] },
] };
const call = (as: string, init: RequestInit = {}) => answers(new Request("http://x/api/answers?key=t1", { ...init, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" } }));
async function connect(uid: string) {
  const server = new McpServer({ name: "t", version: "0" });
  registerAnswerTools(server, uid);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: !!r.isError, body: JSON.parse((r.content as { text: string }[])[0].text) };
  };
}

it("lets a student's connector read their set and leave marks the marking page then picks up", async () => {
  expect((await call("", { method: "POST", body: JSON.stringify(set) })).status).toBe(401);
  expect((await call("gabe", { method: "POST", body: JSON.stringify({ ...set, questions: "x" }) })).status).toBe(400);
  expect((await call("gabe", { method: "POST", body: JSON.stringify(set) })).status).toBe(204);
  expect(await (await call("gabe")).json()).toEqual({ suggested: null });

  const tool = await connect("gabe");
  const got = await tool("getMyAnswers", {});
  expect(got.body).toMatchObject({ success: true, set: "Set 12: Chest pain", parts: [{ part: "1(a)", marks: 2 }, { part: "1(b)", marks: 1 }] });
  expect(got.body.text).toContain("My answer:\nSTEMI and pericarditis");
  expect(got.body.howToMark).toMatch(/^Mark strictly[\s\S]*pearl[\s\S]*markMyAnswers with set "t1"\.$/);

  const marked = await tool("markMyAnswers", { marks: [{ part: "1(a)", score: 1, feedback: "Half right.", comments: [{ quote: "pericarditis", comment: "Think dissection." }] }], summary: "Good start." });
  expect(marked.body).toMatchObject({ success: true, partsMarked: 1, total: "1 / 3", notMarked: ["1(b)"] });
  const { suggested } = await (await call("gabe")).json();
  expect(suggested.parts[0]).toMatchObject({ attemptId: "t1", label: "a", score: 1, comments: [{ quote: "pericarditis", start: 10 }] });
  expect(suggested.summary).toBe("Good start.");

  // Re-opening the marking page keeps the suggestions with the set.
  await call("gabe", { method: "POST", body: JSON.stringify(set) });
  expect((await (await call("gabe")).json()).suggested.parts).toHaveLength(1);

  // Nobody else's connector or sign-in reaches them.
  expect((await (await connect("someone"))("getMyAnswers", {})).error).toBe(true);
  expect(await (await call("someone")).json()).toEqual({ suggested: null });
  expect((await tool("markMyAnswers", { marks: [{ part: "9", score: 1, feedback: "" }] })).error).toBe(true);
});

it("tells sets with the same name apart by their id", async () => {
  const twin = { ...set, key: "t9", at: 200, questions: [{ ...set.questions[0], attemptId: "t9" }] };
  await call("ana", { method: "POST", body: JSON.stringify(set) });
  await call("ana", { method: "POST", body: JSON.stringify(twin) });
  const tool = await connect("ana");
  expect((await tool("getMyAnswers", {})).body.id).toBe("t9"); // the most recent
  expect((await tool("getMyAnswers", { set: "t1" })).body).toMatchObject({ id: "t1", otherRecentSets: [{ id: "t9", name: set.name }] });
  expect((await tool("markMyAnswers", { set: "t1", marks: [{ part: "1(b)", score: 1, feedback: "Yes." }] })).body).toMatchObject({ success: true, id: "t1" });
  expect((await (await call("ana")).json()).suggested.parts[0]).toMatchObject({ attemptId: "t1", label: "b" });
});

