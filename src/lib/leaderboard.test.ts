import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { db } from "../data/db";
import type { Attempt, Settings } from "../data/types";
import { fetchLeaderboard, onBoard, publishWeeklyCount } from "./leaderboard";

vi.mock("./firebase", () => ({ cloudConfigured: () => true, idToken: async () => "token", communityServices: async () => { throw new Error("offline"); }, services: async () => { throw new Error("offline"); } }));
vi.mock("./library", () => ({ loadLibrary: async () => ({ sets: [], questions: [], pending: new Set() }) }));

const posts: Record<string, unknown>[] = [];
let served = 0;
const row = (count: number) => ({ uid: "u", name: "Gabe", questions: count, sets: 0, prevQuestions: 0, prevSets: 0 });
const answer = (id: string): Attempt => ({ id, ownerId: "u", questionId: `q-${id}`, answers: [], startedAt: Date.now() - 10, submittedAt: Date.now(), elapsedSec: 5, mode: "practice" } as unknown as Attempt);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ id: "settings", cloudUser: { uid: "u", name: "Gabe" } } as unknown as Settings);
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { const b = JSON.parse(String(init.body)); posts.push(b); return new Response(JSON.stringify({ rows: [row(b.count)] })); }
    return new Response(JSON.stringify({ rows: [row(served)] }));
  }));
});

it("posts on moving between pages only when the figures changed, and tells open boards", async () => {
  const seen: number[] = [];
  const off = onBoard((b) => seen.push(b.rows[0].count));
  await db.attempts.add(answer("a"));
  expect((await publishWeeklyCount("u"))?.rows[0].count).toBe(1);
  // This device never saw a join or leave: it has no say in whether the student is on the board.
  expect(posts[0]).not.toHaveProperty("visible");
  expect(await publishWeeklyCount("u", { ifChanged: true })).toBeNull();
  expect(posts).toHaveLength(1);
  await db.attempts.add(answer("b"));
  await publishWeeklyCount("u", { ifChanged: true });
  expect(posts.map((p) => p.count)).toEqual([1, 2]);
  expect(seen).toEqual([1, 2]);
  off();
  // A board copy from before the last post (the CDN keeps one for half a minute) does not undo it.
  served = 0;
  expect((await fetchLeaderboard()).rows[0].count).toBe(2);
  served = 5;
  expect((await fetchLeaderboard()).rows[0].count).toBe(5);
});
