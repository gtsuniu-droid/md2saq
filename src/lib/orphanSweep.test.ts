import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { db, KEEP_STAMP } from "../data/db";
import type { Attempt } from "../data/types";

vi.mock("./sync", () => ({ recordDeletes: vi.fn(async () => undefined) }));
const { ORPHAN_AGE_MS, sweepOrphans } = await import("./orphanSweep");
const { recordDeletes } = await import("./sync");

const NOW = 10 * ORPHAN_AGE_MS;
const attempt = (id: string, extra: Partial<Attempt>): Attempt => ({ id, ownerId: "me", questionId: `q-${id}`, answers: [], startedAt: NOW - 2 * ORPHAN_AGE_MS, elapsedSec: 0, mode: "practice", sessionId: "old", ...extra });

beforeEach(async () => {
  await db.attempts.clear();
  await db.attempts.bulkAdd([
    attempt("leftover", {}),
    attempt("fresh", { startedAt: NOW - ORPHAN_AGE_MS / 2 }),
    attempt("live", { sessionId: "current" }),
    attempt("submitted", { submittedAt: NOW - ORPHAN_AGE_MS }),
    attempt("theirs", { ownerId: "you" }),
  ]);
  // Stamps are set on add; make the old ones old.
  await db.attempts.where("id").anyOf(["leftover", "live", "submitted", "theirs"]).modify({ _m: NOW - 2 * ORPHAN_AGE_MS, [KEEP_STAMP]: true } as Partial<Attempt>);
  vi.mocked(recordDeletes).mockClear();
});

it("removes only this account's day-old unsubmitted attempts outside the current paper, and tells the account", async () => {
  expect(await sweepOrphans("me", "current", NOW)).toEqual(["leftover"]);
  expect((await db.attempts.toArray()).map((a) => a.id).sort()).toEqual(["fresh", "live", "submitted", "theirs"]);
  expect(vi.mocked(recordDeletes).mock.calls).toEqual([["attempts", ["leftover"]]]);
});

it("an attempt written to within the day stays, whatever its start time", async () => {
  await db.attempts.update("leftover", { elapsedSec: 1 });
  expect(await sweepOrphans("me", "current", Date.now())).toEqual([]);
});
