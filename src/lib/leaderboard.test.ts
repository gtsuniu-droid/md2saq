import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { db } from "../data/db";
import type { Attempt, Settings } from "../data/types";
import { NICKNAME_JOINED_UNTIL as until } from "../../netlify/lib/progress";
import { fetchLeaderboard, nicknameMeantJoin, onBoard, publishWeeklyCount, submittedSignature, weekStart } from "./leaderboard";
import { getSettings } from "../data/db";
import { loadLibrary } from "./library";
import { syncNow } from "./sync";

vi.mock("./firebase", () => ({ cloudConfigured: () => true, idToken: async () => "token", communityServices: async () => { throw new Error("offline"); }, services: async () => { throw new Error("offline"); } }));
vi.mock("./library", () => ({ loadLibrary: vi.fn(async () => ({ sets: [], questions: [], pending: new Set() })) }));
const sync = { state: { status: "idle" } as { uid?: string; status: string; at?: number } };
vi.mock("./sync", () => ({ getProgressSyncState: () => sync.state, syncNow: vi.fn(async () => null), requestSync: () => undefined }));

const posts: Record<string, unknown>[] = [];
let served = 0;
const row = (count: number) => ({ uid: "u", name: "Gabe", questions: count, sets: 0, prevQuestions: 0, prevSets: 0 });
const answer = (id: string, extra: Partial<Attempt> = {}): Attempt => ({ id, ownerId: "u", questionId: `q-${id}`, answers: [], startedAt: Date.now() - 10, submittedAt: Date.now(), elapsedSec: 5, mode: "practice", ...extra } as unknown as Attempt);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ id: "settings", cloudUser: { uid: "u", name: "Gabe" } } as unknown as Settings);
  posts.length = 0;
  sync.state = { uid: "u", status: "synced", at: Date.now() };
  vi.mocked(syncNow).mockClear(); vi.mocked(loadLibrary).mockClear();
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
  // Its sync is fresh, so its figures are the account's; it never starts a sync of its own.
  expect(posts[0]).toMatchObject({ complete: true });
  expect(syncNow).not.toHaveBeenCalled();
  // Nothing changed: decided from the indexes, without the library or any answer being read.
  const loads = vi.mocked(loadLibrary).mock.calls.length;
  expect(await publishWeeklyCount("u", { ifChanged: true })).toBeNull();
  expect(posts).toHaveLength(1);
  expect(loadLibrary).toHaveBeenCalledTimes(loads);
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

it("treats a nickname picked with the join box left unticked as joining, while leaving since then stands", async () => {
  expect(nicknameMeantJoin({ username: "Ball clapper", leaderboard: false })).toBe(true);
  expect(nicknameMeantJoin({ username: "Ball clapper", leaderboard: false, chosenAt: until - 1 })).toBe(true);
  expect(nicknameMeantJoin({ username: "Ball clapper", leaderboard: false, chosenAt: until })).toBe(false);
  expect(nicknameMeantJoin({ username: " ", leaderboard: false })).toBe(false);
  expect(nicknameMeantJoin({ username: "Ball clapper", leaderboard: true })).toBe(false);
  // Publishing joins the device's own settings too, dated now, so the choice reaches other devices and can be undone in Settings.
  await db.settings.update("settings", { social: { username: "Ball clapper", leaderboard: false } });
  await publishWeeklyCount("u");
  expect(posts[0]).toMatchObject({ name: "Ball clapper", visible: true });
  const social = (await getSettings()).social!;
  expect(social.leaderboard).toBe(true);
  expect(social.chosenAt).toBeGreaterThan(until);
});

it("a device whose sync is stale posts figures it can only raise, without syncing from inside the publish", async () => {
  sync.state = { status: "idle" };
  await db.attempts.add(answer("a"));
  await publishWeeklyCount("u");
  expect(posts[0]).not.toHaveProperty("complete");
  expect(syncNow).not.toHaveBeenCalled();
});

it("counts the week and the week before from the owner-and-date index, never drafts or another account's answers", async () => {
  const start = weekStart(Date.now());
  await db.attempts.bulkPut([
    answer("now"), answer("early", { submittedAt: start + 1 }),
    answer("last", { submittedAt: start - 1 }), answer("older", { submittedAt: start - 8 * 24 * 3600 * 1000 }),
    answer("draft", { submittedAt: undefined }), answer("theirs", { ownerId: "v" }),
    answer("blank", { answers: [{ label: "", text: " ", doc: null }] }),
  ]);
  expect(await submittedSignature("u")).toBe(`5@${(await db.attempts.get("now"))!.submittedAt}`);
  await publishWeeklyCount("u");
  expect(posts[0]).toMatchObject({ count: 2, prevCount: 1, total: 4 });
});
