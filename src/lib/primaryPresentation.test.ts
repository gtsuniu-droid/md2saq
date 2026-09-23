import { describe, expect, it } from "vitest";
import { primaryPresentation } from "./primaryPresentation";
import { buildSessionSelection, setPresentationProgress } from "./sessionBuilder";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
const sets: QuestionSet[] = [{ id: "a", name: "Abdominal pain SAQ Bank", createdAt: 1 }, { id: "v", name: "Vomiting case", primaryPresentation: "vomiting", createdAt: 1 }, { id: "empty", name: "Empty", createdAt: 1 }];
const questions: Question[] = [0,1].map((order) => ({ id: `a${order}`, setId: "a", order, presentations: ["vomiting", "abdominal-pain"], tags: [], parts: [], text: "Q", createdAt: 1 }));
questions.push({ ...questions[0], id: "v0", setId: "v" });
const attempts = questions.map((q): Attempt => ({ id: `answer-${q.id}`, questionId: q.id, submittedAt: 5, answers: [], startedAt: 1, elapsedSec: 1, mode: "practice" }));
const marks = attempts.map((a): Mark => ({ id: `mark-${a.id}`, attemptId: a.id, questionId: a.questionId, markedAt: 6, score: 1, maxScore: 1, parts: [], errorTags: [] }));
describe("primary set presentations", () => {
  it("uses an explicit primary complaint ahead of all secondary tags and legacy names", () => {
    expect(primaryPresentation({ ...sets[0], primaryPresentation: "cough", tags: ["Vomiting::Topic"] }, questions)).toBe("cough");
    expect(primaryPresentation(sets[0], questions)).toBe("abdominal-pain");
    expect(primaryPresentation({ ...sets[0], name: "Legacy", tags: ["Abdominal pain::Cases"] }, questions)).toBe("abdominal-pain");
  });
  it("does not select an abdominal-pain set through its vomiting tags", () => {
    const input = { unit: "sets" as const, sets, questions, attempts: [], presentations: ["vomiting"], newOnly: false, random: () => .5, parentOf: new Map<string,string>() };
    expect(buildSessionSelection(input).map((q) => q.id)).toEqual(["v0"]);
    expect(buildSessionSelection({ ...input, presentations: ["abdominal-pain"] }).map((q) => q.id)).toEqual(["a0", "a1"]);
  });
  it("counts whole sets once and requires all questions marked for a completed set", () => {
    const ids = ["abdominal-pain", "vomiting", "cough"];
    const partial = setPresentationProgress(sets, questions, attempts, marks.slice(0,1), ids);
    expect(partial.all).toEqual({ total: 2, attempted: 2, marked: 0 });
    expect(partial.progress.get("abdominal-pain")?.total).toBe(1);
    expect(partial.progress.get("vomiting")?.total).toBe(1);
    expect(partial.progress.get("cough")?.total).toBe(0);
    expect(setPresentationProgress(sets, questions, attempts, marks, ids).all.marked).toBe(2);
    const retry = { ...attempts[0], id: "retry", submittedAt: 10 };
    expect(setPresentationProgress(sets, questions, [...attempts,retry], marks, ids).all.marked).toBe(1);
  });
});
