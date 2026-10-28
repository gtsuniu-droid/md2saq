import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { db } from "../data/db";
import type { Attempt } from "../data/types";
import { belongsToAccount } from "./progressAccount";
import { submittedCount } from "./useSubmittedCount";

const attempt = (id: string, ownerId: string | undefined, submittedAt?: number) => ({ id, questionId: "q", ...(ownerId === undefined ? {} : { ownerId }), answers: [], startedAt: 1, elapsedSec: 0, mode: "practice", ...(submittedAt ? { submittedAt } : {}) }) as Attempt;

it("counts an account's submitted answers from the indexes, the same as reading them all", async () => {
  await db.attempts.bulkPut([attempt("a", "u", 10), attempt("b", "u"), attempt("c", "u", 20), attempt("d", "other", 30), attempt("e", undefined, 40), attempt("f", "", 50)]);
  const slow = async (uid: string) => (await db.attempts.toArray()).filter((a) => belongsToAccount(a, uid) && a.submittedAt !== undefined).length;
  for (const uid of ["u", "other", "", "nobody"]) expect(await submittedCount(uid)).toBe(await slow(uid));
  expect(await submittedCount("u")).toBe(2);
  expect(await submittedCount(undefined)).toBe(0);
  await db.attempts.update("b", { submittedAt: 60 });
  expect(await submittedCount("u")).toBe(3);
});
