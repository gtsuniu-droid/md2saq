import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

/**
 * The study function against the real store layer (the JSON file it keeps when not on Netlify),
 * with only sign-in stubbed: the whole server path a device talks to, end to end.
 */
vi.mock("../../netlify/lib/idtoken", () => ({ verifiedUid: async (req: Request) => req.headers.get("authorization")?.slice(7) || null }));
vi.mock("../../netlify/functions/mcp-token", () => ({ firebaseEnv: () => ({ projectId: "p" }) }));
const study = (await import("../../netlify/functions/study")).default;

const cwd = process.cwd();
let dir = "";
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "saq-study-")); process.chdir(dir); });
afterAll(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });

const call = (as: string, path: string, body?: unknown) => study(new Request(`http://x/api/study${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));

it("takes a session from code to shared answers, part marks and comments through the real store", async () => {
  const made = await (await call("gabe", "", { create: { presentations: ["chest-pain"], questions: [{ bankId: "b1", order: 0, text: "Three causes.", setLabel: "Set 12", marks: 3 }], mode: "practice", minutes: 20, hostName: "Gabe" } })).json();
  const code = made.code as string;
  // Entering the code puts Sam on the list before anything is shared.
  expect((await (await call("sam", "", { join: code, name: "Sam" })).json()).participants.map((p: { name: string }) => p.name)).toEqual(["Gabe", "Sam"]);
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Aspirin", marks: [{ type: "bold" }] }] }] };
  const shared = await call("sam", "/share", { code, name: "Sam", answers: [{ index: 0, text: "Aspirin", parts: [{ label: "", text: "Aspirin", doc }], score: 2, maxScore: 3 }] });
  expect(shared.status, await shared.clone().text()).toBe(200);
  // A picture-heavy document is too big to carry and travels as text instead.
  const heavy = { type: "doc", content: [{ type: "image", attrs: { src: `data:image/png;base64,${"A".repeat(70_000)}` } }] };
  await call("gabe", "/share", { code, name: "Gabe", answers: [{ index: 0, text: "PE, pneumonia, pneumothorax", parts: [{ label: "", text: "PE, pneumonia, pneumothorax", doc: heavy }] }] });
  let room = await (await call("gabe", `/room?code=${code}`)).json();
  expect(room.shared.find((s: { uid: string }) => s.uid === "sam").answers[0].parts[0].doc).toEqual(doc);
  expect(room.shared.find((s: { uid: string }) => s.uid === "gabe").answers[0].parts[0].doc).toBeUndefined();
  // A mark can carry the ticked points per part; a malformed one is refused.
  room = await (await call("gabe", "/mark", { code, index: 0, targetUid: "sam", score: 2, maxScore: 3, parts: [{ label: "", score: 2, maxScore: 3, pointsHit: [0, 2] }] })).json();
  expect(room.marks[0]).toMatchObject({ by: "gabe", score: 2, parts: [{ pointsHit: [0, 2] }] });
  expect((await call("gabe", "/mark", { code, index: 0, targetUid: "sam", score: 2, maxScore: 3, parts: [{ label: "", score: 2, maxScore: 3, pointsHit: ["x"] }] })).status).toBe(400);
  room = await (await call("sam", "/comment", { code, name: "Sam", index: 0, targetUid: "gabe", text: "Which one first?" })).json();
  expect(room.comments).toHaveLength(1);
  // Everything is one GET for the page.
  room = await (await call("sam", `/room?code=${code}`)).json();
  expect(room.study.participants).toHaveLength(2);
  expect(room.shared).toHaveLength(2);
  expect(room.marks).toHaveLength(1);
  expect(room.comments).toHaveLength(1);
});
