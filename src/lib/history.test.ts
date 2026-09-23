import { describe, expect, it } from "vitest";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { historyEntries } from "./history";
const question: Question = { id: "q", setId: "s", order: 2, text: "Explain your approach", parts: [], presentations: [], tags: [], createdAt: 1 };
const set: QuestionSet = { id: "s", name: "Example case", number: 4, createdAt: 1 };
const attempt = (id: string, ownerId: string, submittedAt?: number): Attempt => ({ id, ownerId, questionId: "q", mode: "practice", startedAt: 1, submittedAt, elapsedSec: 10, answers: [] });
const mark = (id: string, ownerId: string, markedAt: number): Mark => ({ id, ownerId, attemptId: "a", questionId: "q", markedAt, score: markedAt, maxScore: 10, parts: [], errorTags: [] });
describe("account history", () => {
  it("keeps repeat attempts, excludes other accounts and unused drafts, newest first", () => {
    const entries = historyEntries([attempt("a", "alice", 10), attempt("draft", "alice"), attempt("b", "alice", 20), attempt("bob", "bob", 30)], [], [question], [set], "alice");
    expect(entries.map((r) => r.attempt.id)).toEqual(["b", "a"]);
    expect(entries[0].label).toBe("Set 04, Question 3");
    expect(entries[0].text).toBe(question.text);
  });
  it("uses only the account's newest saved score, including zero scores", () => {
    const entries = historyEntries([attempt("a", "alice", 10)], [mark("old", "alice", 1), { ...mark("new", "alice", 2), score: 0 }, mark("other", "bob", 9)], [question], [set], "alice");
    expect(entries[0].mark?.score).toBe(0);
    expect(entries[0].mark?.id).toBe("new");
  });
  it("keeps cloud history identifiable before its questions arrive", () => {
    const a = { ...attempt("a", "alice", 10), qref: { setId: "remote", order: 0, setNumber: 7, text: "A saved question" } };
    const entries = historyEntries([a], [], [], [], "alice");
    expect(entries[0].label).toBe("Set 07, Question 1");
    expect(entries[0].text).toBe("A saved question");
    expect(entries[0].question).toBeUndefined();
  });
});
