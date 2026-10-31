import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { db } from "../data/db";
import type { Attempt, Mark } from "../data/types";
import { isBlankAttempt } from "./blankAttempt";
import { homeAttempts, homeMarks, stripPictures, withoutPictures } from "./homeData";

const picture = "data:image/png;base64," + "A".repeat(50_000);
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "See" }, { type: "image", attrs: { src: picture, alt: "ECG" } }] }] };
const attempt = (id: string, ownerId: string, extra: Partial<Attempt> = {}): Attempt => ({ id, ownerId, questionId: "q", answers: [{ label: "", text: "", doc }], startedAt: 1, submittedAt: 10, elapsedSec: 0, mode: "practice", ...extra });

it("reads only the account's submitted attempts and its marks, without the pictures", async () => {
  await db.attempts.bulkPut([attempt("mine", "u"), attempt("draft", "u", { submittedAt: undefined }), attempt("theirs", "v"), attempt("guest", "")]);
  await db.marks.bulkPut([{ id: "m1", ownerId: "u", attemptId: "mine" }, { id: "m2", ownerId: "v", attemptId: "theirs" }, { id: "m3", ownerId: "", attemptId: "guest" }] as Mark[]);
  const mine = await homeAttempts("u");
  expect(mine.map((a) => a.id)).toEqual(["mine"]);
  expect(JSON.stringify(mine).length).toBeLessThan(1000);
  // A picture-only answer is still an answer, so the sitting is not taken for blank.
  expect(isBlankAttempt(mine[0])).toBe(false);
  expect((await homeMarks("u")).map((m) => m.id)).toEqual(["m1"]);
  expect((await homeAttempts("")).map((a) => a.id)).toEqual(["guest"]);
  expect((await homeMarks("")).map((m) => m.id)).toEqual(["m3"]);
  // The database copy keeps the picture.
  expect(JSON.stringify(await db.attempts.get("mine")).length).toBeGreaterThan(50_000);
});

it("leaves an answer without pictures as it is, and empties every picture's data, revisions included", () => {
  const plain = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Aspirin" }] }] };
  expect(stripPictures(plain)).toBe(plain);
  const slim = withoutPictures(attempt("a", "u", { answers: [{ label: "", text: "", doc, revision: { doc, text: "", at: 2 } }] }));
  const srcs = JSON.stringify(slim).match(/"src":"[^"]*"/g);
  expect(srcs).toEqual(['"src":""', '"src":""']);
  expect(JSON.stringify(slim)).toContain('"alt":"ECG"');
});
