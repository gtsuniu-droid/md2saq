import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, KEEP_STAMP } from "../data/db";
import type { Attempt } from "../data/types";

const attempt = (id: string): Attempt => ({ id, ownerId: "me", questionId: `q-${id}`, answers: [], startedAt: 1, elapsedSec: 0, mode: "practice" });
const stamp = async (id: string) => (await db.attempts.get(id))!._m ?? 0;
const tick = () => new Promise((r) => setTimeout(r, 2));

beforeEach(async () => { await db.attempts.clear(); await db.attempts.bulkAdd([attempt("a"), attempt("b")]); });

it("a marked write keeps the modified stamp and leaves no marker behind; a plain write moves it", async () => {
  const before = await stamp("a");
  expect(before).toBeGreaterThan(0);
  await tick();
  await db.attempts.update("a", { elapsedSec: 9, [KEEP_STAMP]: true } as Partial<Attempt>);
  const kept = await db.attempts.get("a");
  expect(kept).toMatchObject({ elapsedSec: 9, _m: before });
  expect(KEEP_STAMP in kept!).toBe(false);
  await tick();
  await db.attempts.update("a", { elapsedSec: 10 });
  expect(await stamp("a")).toBeGreaterThan(before);
});

it("a marked write in flight never unstamps another write landing at the same time", async () => {
  const before = await stamp("b");
  await tick();
  await Promise.all([
    db.attempts.update("a", { elapsedSec: 5, [KEEP_STAMP]: true } as Partial<Attempt>),
    db.attempts.update("b", { answers: [{ label: "", text: "STEMI", doc: null }] }),
  ]);
  expect(await stamp("b")).toBeGreaterThan(before);
});

it("a marked put keeps the stamp it was given, as a record from the account must", async () => {
  await db.attempts.put({ ...attempt("c"), _m: 777, [KEEP_STAMP]: true } as Attempt);
  const c = await db.attempts.get("c");
  expect(c?._m).toBe(777);
  expect(KEEP_STAMP in c!).toBe(false);
});
