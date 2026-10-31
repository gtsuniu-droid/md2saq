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
    expect(entries[0].label).toBe("Set 04: Example case, Question 3");
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
    expect(groups[1].label).toBe("Chest pain Set 04: Example case");
    expect(groups[1].text).toBe("First");
    expect(groups[1]).toMatchObject({ total: 2, marked: 2, score: 7, maxScore: 11, reviewLater: true });
    expect(groups[1].anchor.id).toBe("a1");
    expect(groups[0]).toMatchObject({ label: "Set 04: Example case, Question 2", total: 1, marked: 0, score: undefined });
  });
});


describe("exam history", () => {
  const sets: QuestionSet[] = [set, { ...set, id: "s2", name: "Another case", number: 5 }];
  const questions: Question[] = [
    { ...question, id: "q1", order: 0, presentations: ["chest-pain"] },
    { ...question, id: "q2", order: 1, presentations: ["chest-pain"] },
    { ...question, id: "q3", setId: "s2", order: 0, presentations: ["falls"] },
  ];
  const paper = (mode: Attempt["mode"] = "exam", sessionId = "paper"): Attempt[] => questions.map((q, i) => ({
    ...attempt(`${sessionId}-${q.id}`, "alice", 100 + i), questionId: q.id, mode, sessionId, startedAt: 10 + i,
  }));
  const marks = (attempts: Attempt[]): Mark[] => attempts.map((a, i) => ({
    ...mark(`m-${a.id}`, "alice", 200), attemptId: a.id, questionId: a.questionId, score: i, maxScore: 4, reviewLater: i === 2,
  }));
  const group = (attempts: Attempt[], saved: Mark[] = [], qs = questions, ss = sets) =>
    historyGroups(historyEntries(attempts, saved, qs, ss, "alice"), qs, (id) => id);

  it("shows multiple exam sets as one row with the whole paper's score", () => {
    const attempts = paper();
    const groups = group(attempts, marks(attempts));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "exam:paper", kind: "exam", sessionId: "paper", label: "Exam", setIds: ["s", "s2"],
      total: 3, marked: 3, score: 3, maxScore: 12, reviewLater: true, submittedAt: 102,
      presentation: undefined, presentationId: undefined, set: undefined,
      text: "Set 04: Example case, Set 05: Another case",
    });
    expect(groups[0].entries.map((e) => e.attempt.id)).toEqual(attempts.map((a) => a.id));
  });

  it("keeps practice sets separate, even when they share a session", () => {
    const groups = group(paper("practice"));
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.kind)).toEqual(["question", "set"]);
    expect(groups[1].setIds).toEqual(["s"]);
  });

  it("keeps repeated exam sessions separate and newest first", () => {
    const groups = group([...paper(), ...paper("exam", "repeat").map((a) => ({ ...a, submittedAt: 300 }))]);
    expect(groups.map((g) => g.key)).toEqual(["exam:repeat", "exam:paper"]);
  });

  it("counts partial marking without displaying an incomplete score", () => {
    const attempts = paper();
    expect(group(attempts, marks(attempts).slice(0, 1))[0]).toMatchObject({ total: 3, marked: 1, score: undefined, maxScore: undefined });
    expect(group(attempts)[0]).toMatchObject({ total: 3, marked: 0 });
  });

  it("groups exams from cloud references before the bank downloads", () => {
    const attempts = paper().map((a, i) => ({ ...a, qref: { setId: questions[i].setId, setName: i < 2 ? "Remote chest case" : "Remote falls case", order: questions[i].order } }));
    expect(group(attempts, [], [], [])[0]).toMatchObject({ kind: "exam", setIds: ["s", "s2"], total: 3, text: "Remote chest case, Remote falls case" });
  });

  it("also gives a one-question exam a session row, leaving sessionless attempts alone", () => {
    expect(group(paper().slice(0, 1))[0]).toMatchObject({ kind: "exam", total: 1, setIds: ["s"] });
    expect(group([{ ...paper()[0], sessionId: undefined }])[0]).toMatchObject({ kind: "question", setIds: [] });
  });
});
