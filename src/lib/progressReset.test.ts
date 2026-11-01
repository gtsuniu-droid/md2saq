import { describe, expect, it } from "vitest";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { attemptsSinceReset, countingMarks, mergeProgressResets, resetAtFor, sameProgressResets } from "./progressReset";

const sets: QuestionSet[] = [{ id: "c", name: "Cough case", primaryPresentation: "cough", createdAt: 1 }, { id: "f", name: "Fever case", primaryPresentation: "fever", createdAt: 1 }];
const questions: Question[] = [{ id: "c1", setId: "c", order: 0, text: "Q", parts: [], presentations: ["cough"], tags: [], createdAt: 1 }, { id: "f1", setId: "f", order: 0, text: "Q", parts: [], presentations: ["fever"], tags: [], createdAt: 1 }];
const attempt = (id: string, questionId: string, submittedAt?: number): Attempt => ({ id, questionId, answers: [], startedAt: 1, submittedAt, elapsedSec: 1, mode: "practice" });
const attempts = [attempt("c-old", "c1", 100), attempt("c-new", "c1", 300), attempt("f-old", "f1", 100), attempt("draft", "f1")];

describe("progress resets", () => {
  it("keeps every attempt when nothing was reset", () => {
    expect(attemptsSinceReset(attempts, questions, sets, {})).toBe(attempts);
    expect(resetAtFor({}, "cough")).toBe(0);
  });
  it("drops sittings submitted before the reset that covers their set", () => {
    expect(attemptsSinceReset(attempts, questions, sets, { progressResetAt: 200 }).map((a) => a.id)).toEqual(["c-new", "draft"]);
    expect(attemptsSinceReset(attempts, questions, sets, { presentationResetAt: { cough: 200 } }).map((a) => a.id)).toEqual(["c-new", "f-old", "draft"]);
    // The later of the two times applies.
    expect(attemptsSinceReset(attempts, questions, sets, { progressResetAt: 50, presentationResetAt: { cough: 350 } }).map((a) => a.id)).toEqual(["f-old", "draft"]);
    expect(resetAtFor({ progressResetAt: 50, presentationResetAt: { cough: 350 } }, "cough")).toBe(350);
    expect(resetAtFor({ progressResetAt: 50, presentationResetAt: { cough: 350 } }, "fever")).toBe(50);
  });
  it("an attempt whose question is unknown goes by the all-sets reset", () => {
    const stray = attempt("stray", "gone", 100);
    expect(attemptsSinceReset([stray], questions, sets, { presentationResetAt: { cough: 200 } })).toEqual([stray]);
    expect(attemptsSinceReset([stray], questions, sets, { progressResetAt: 200 })).toEqual([]);
  });
  it("leaves out marks on attempts that no longer count", () => {
    const marks = [{ attemptId: "c-old" }, { attemptId: "c-new" }] as Mark[];
    expect(countingMarks(marks, attemptsSinceReset(attempts, questions, sets, { progressResetAt: 200 })).map((m) => m.attemptId)).toEqual(["c-new"]);
  });
  it("merges two devices' resets by taking the later time of each", () => {
    expect(mergeProgressResets({ progressResetAt: 10, presentationResetAt: { cough: 30 } }, { progressResetAt: 20, presentationResetAt: { cough: 25, fever: 40 } })).toEqual({ progressResetAt: 20, presentationResetAt: { cough: 30, fever: 40 } });
    // A presentation time an all-sets reset has overtaken is dropped.
    expect(mergeProgressResets({ presentationResetAt: { cough: 30 } }, { progressResetAt: 50 })).toEqual({ progressResetAt: 50 });
    expect(mergeProgressResets({}, {})).toEqual({});
    expect(sameProgressResets({ progressResetAt: 5 }, { progressResetAt: 5, presentationResetAt: {} })).toBe(true);
    expect(sameProgressResets({ progressResetAt: 5 }, { progressResetAt: 6 })).toBe(false);
    expect(sameProgressResets({}, { presentationResetAt: { cough: 1 } })).toBe(false);
  });
});
