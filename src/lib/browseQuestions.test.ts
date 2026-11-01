import { describe, expect, it } from "vitest";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { browseQuestions, markedQuestions } from "./browseQuestions";
import { summarise } from "./sets";

const sets: QuestionSet[] = [{ id: "a", name: "First", number: 1, createdAt: 1, primaryPresentation: "cough" }, { id: "b", name: "Second", number: 2, createdAt: 2, primaryPresentation: "fever" }];
const questions: Question[] = [
  { id: "a1", setId: "a", order: 0, createdAt: 1, text: "Name the diagnosis", parts: [], presentations: [], tags: [] },
  { id: "a2", setId: "a", order: 1, createdAt: 1, text: "Outline management", parts: [], presentations: [], tags: [] },
  { id: "b1", setId: "b", order: 0, createdAt: 1, text: "Assess hydration", parts: [], presentations: [], tags: [] },
];
const attempt = (id: string, questionId: string, submittedAt: number): Attempt => ({ id, questionId, answers: [], startedAt: submittedAt - 1, submittedAt, elapsedSec: 1, mode: "practice" });
const mark = (attemptId: string, questionId: string, score: number, maxScore: number, markedAt = 1): Mark => ({ id: `m-${attemptId}-${markedAt}`, attemptId, questionId, score, maxScore, parts: [], errorTags: [], markedAt });
const attempts = [attempt("x1", "a1", 100), attempt("x2", "a1", 300), attempt("y", "a2", 200), attempt("z", "b1", 250), attempt("unmarked", "b1", 400)];
const marks = [mark("x1", "a1", 1, 4), mark("x2", "a1", 2, 4), mark("x2", "a1", 3, 4, 2), mark("y", "a2", 1, 5), mark("z", "b1", 9, 10)];
const summaries = summarise(sets, questions, attempts, marks);

describe("questions I had marked", () => {
  it("lists each marked question once, by its latest marked sitting and newest mark", () => {
    const rows = markedQuestions(summaries, attempts, marks);
    expect(rows.map((r) => [r.question.id, r.attemptId, r.score, r.maxScore, r.percent, r.number])).toEqual([["b1", "z", 9, 10, 90, 1], ["a1", "x2", 3, 4, 75, 1], ["a2", "y", 1, 5, 20, 2]]);
  });
  it("sorts worst first or latest first, and searches the set and the question", () => {
    const rows = markedQuestions(summaries, attempts, marks);
    expect(browseQuestions(rows, "", "", "worst").map((r) => r.question.id)).toEqual(["a2", "a1", "b1"]);
    expect(browseQuestions(rows, "", "", "latest").map((r) => r.question.id)).toEqual(["a1", "b1", "a2"]);
    expect(browseQuestions(rows, "hydration", "", "worst").map((r) => r.question.id)).toEqual(["b1"]);
    expect(browseQuestions(rows, "", "cough", "worst").map((r) => r.question.id)).toEqual(["a2", "a1"]);
  });
});
