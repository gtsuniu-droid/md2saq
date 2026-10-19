import { describe, expect, it } from "vitest";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { historyEntries, historyGroups } from "./history";
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
  it("folds a set sat in one session into one row with the total, and keeps a lone question as itself", () => {
    const q1: Question = { ...question, id: "q1", order: 0, text: "First", presentations: ["chest-pain"] };
    const q2: Question = { ...question, id: "q2", order: 1, text: "Second", presentations: ["chest-pain"] };
    const sitting = (id: string, questionId: string) => ({ ...attempt(id, "alice", 50), questionId, sessionId: "sess" });
    const marks: Mark[] = [
      { ...mark("m1", "alice", 60), attemptId: "a1", questionId: "q1", score: 3, maxScore: 5 },
      { ...mark("m2", "alice", 60), attemptId: "a2", questionId: "q2", score: 4, maxScore: 6, reviewLater: true },
    ];
    const entries = historyEntries([sitting("a1", "q1"), sitting("a2", "q2"), { ...attempt("solo", "alice", 70), questionId: "q2" }], marks, [q1, q2], [set], "alice");
    const groups = historyGroups(entries, [q1, q2], (id) => id === "chest-pain" ? "Chest pain" : id);
    expect(groups.map((g) => g.kind)).toEqual(["question", "set"]);
    expect(groups[1].label).toBe("Chest pain — Set 04");
    expect(groups[1].text).toBe("Example case");
    expect(groups[1]).toMatchObject({ total: 2, marked: 2, score: 7, maxScore: 11, reviewLater: true });
    expect(groups[1].anchor.id).toBe("a1");
    expect(groups[0]).toMatchObject({ label: "Set 04, Question 2", total: 1, marked: 0, score: undefined });
  });
});
