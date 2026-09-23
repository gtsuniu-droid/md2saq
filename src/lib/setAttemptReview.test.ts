import { describe, expect, it } from "vitest";
import type { Attempt, Mark, Question } from "../data/types";
import { setAttemptReview } from "./setAttemptReview";
const questions: Question[] = [0,1,2].map((order) => ({ id: `q${order}`, setId: "set", order, text: `Question ${order}`, parts: [], tags: [], presentations: [], createdAt: 1 }));
const attempt = (id: string, questionId: string, sessionId = "sitting", ownerId = "alice"): Attempt => ({ id, questionId, ownerId, sessionId, answers: [{ label: "", text: id, doc: null }], startedAt: 1, submittedAt: 5, mode: "practice", elapsedSec: 10 });
describe("whole-set attempt review", () => {
  it("shows the whole set in question order and only the selected sitting's answers", () => {
    const otherQuestion = { ...questions[0], id: "elsewhere", setId: "other-set" };
    const review = setAttemptReview("first", [attempt("second", "q1"), attempt("first", "q0"), attempt("retry", "q0", "later"), attempt("other", "elsewhere"), attempt("private", "q2", "sitting", "bob")], [...questions, otherQuestion], [], "alice")!;
    expect(review.rows.map((r) => r.question?.id)).toEqual(["q0", "q1", "q2"]);
    expect(review.rows.map((r) => r.attempt?.id)).toEqual(["first", "second", undefined]);
  });
  it("denies another account's anchor and does not combine legacy attempts without session IDs", () => {
    const legacy = { ...attempt("a", "q0"), sessionId: undefined };
    const other = { ...attempt("b", "q1"), sessionId: undefined };
    expect(setAttemptReview("a", [legacy], questions, [], "bob")).toBeNull();
    expect(setAttemptReview("a", [legacy, other], questions, [], "alice")!.rows.map((r) => r.attempt?.id)).toEqual(["a", undefined, undefined]);
  });
  it("retains saved answers when the bank question is missing, plus drafts from the same sitting", () => {
    const a = { ...attempt("a", "missing"), qref: { setId: "remote", order: 0, text: "Original question" } };
    const b = { ...attempt("b", "missing2"), submittedAt: undefined, qref: { setId: "remote", order: 1 } };
    const review = setAttemptReview("a", [a,b], [], [], "alice")!;
    expect(review.rows.map((r) => r.attempt?.answers[0].text)).toEqual(["a","b"]);
    expect(review.rows[0].attempt?.qref?.text).toBe("Original question");
  });
  it("uses the latest score belonging to this account, including zero", () => {
    const mark = (id: string, markedAt: number, score: number, ownerId = "alice"): Mark => ({ id, markedAt, score, ownerId, attemptId: "a", questionId: "q0", maxScore: 5, parts: [], errorTags: [] });
    const review = setAttemptReview("a", [attempt("a", "q0")], questions, [mark("old", 1, 3), mark("new", 2, 0), mark("foreign", 3, 5, "bob")], "alice")!;
    expect(review.rows[0].mark?.id).toBe("new");
    expect(review.rows[0].mark?.score).toBe(0);
  });
});
