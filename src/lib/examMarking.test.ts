import { describe, expect, it } from "vitest";
import type { Attempt, Question, QuestionSet } from "../data/types";
import { buildExamForMarking, examKey, examSets } from "./examMarking";
import { checkSuggested, markPrompt, setText } from "./setForMarking";

const sets: QuestionSet[] = [
  { id: "s1", name: "Chest pain", number: 1, markingNotes: "Accept NSTEMI.", createdAt: 1 },
  { id: "s2", name: "Falls", number: 2, markingNotes: "Consider medication causes.", createdAt: 1 },
];
const question = (id: string, setId: string, order: number): Question => ({
  id, setId, order, stems: ["Shared case"], text: "Give a diagnosis.", marks: 2,
  modelAnswer: "Diagnosis", parts: [], presentations: [], tags: [], createdAt: 1,
});
const questions = [question("q1", "s1", 0), question("q2", "s1", 2), question("q3", "s2", 0)];
const attempts: Attempt[] = questions.map((q, i) => ({
  id: `a${i + 1}`, questionId: q.id, sessionId: "paper", mode: "exam", startedAt: 10 + i,
  submittedAt: 100 + i, elapsedSec: 5, answers: [{ label: "", text: `Answer ${i + 1}`, doc: null }],
}));

describe("whole exam marking", () => {
  it("uses the session's order for sets, and question order within each set", () => {
    const groups = examSets([...attempts].reverse(), questions, sets, ["a3", "a2", "a1"]);
    expect(groups.map((g) => g.setId)).toEqual(["s2", "s1"]);
    expect(groups[1].rows.map((r) => r.attempt?.id)).toEqual(["a1", "a2"]);
    expect(examSets([...attempts].reverse(), questions, sets).map((g) => g.setId)).toEqual(["s1", "s2"]);
  });

  it("numbers all submitted questions continuously, with sections and each set's notes", () => {
    const paper = buildExamForMarking(examKey("paper"), examSets(attempts, questions, sets));
    expect(paper).toMatchObject({ key: "exam:paper", exam: true, at: 102 });
    expect(paper.questions.map((q) => [q.number, q.attemptId, q.section, q.parts[0].id])).toEqual([
      [1, "a1", "Set 01: Chest pain", "1"], [2, "a2", undefined, "2"], [3, "a3", "Set 02: Falls", "3"],
    ]);
    // A shared stem is repeated at the start of the next set, even if its text is identical.
    expect(paper.questions.map((q) => q.stems)).toEqual([["Shared case"], [], ["Shared case"]]);
    expect(paper.notes).toBe("Set 01: Chest pain: Accept NSTEMI.\n\nSet 02: Falls: Consider medication causes.");
    const text = setText(paper);
    expect(text).toContain("Please mark my answers to this exam paper");
    expect(text).toContain("# Set 01: Chest pain");
    expect(text).toContain("# Set 02: Falls");
    expect(text).toContain("## Question 3 [2 marks]");
    expect(text).toContain("My answer:\nAnswer 3");
    expect(markPrompt(paper)).toContain("one paper of 2 sets and 3 questions, numbered 1 to 3 right through; mark the whole paper in one go");
    expect(markPrompt(paper)).toContain('getMyAnswers (set: "exam:paper")');
    expect(markPrompt(paper)).toContain('markMyAnswers (set: "exam:paper")');
    const { marks, problems } = checkSuggested(paper, [{ part: "3", score: 1 }]);
    expect(problems).toEqual([]);
    expect(marks.parts[0]).toMatchObject({ attemptId: "a3", label: "", score: 1 });
  });

  it("skips drafts and missing questions without gaps or empty sections", () => {
    const rows = [...attempts.map((a) => a.id === "a2" ? { ...a, submittedAt: undefined } : a), { ...attempts[0], id: "gone", questionId: "gone", qref: { setId: "deleted", order: 0 } }];
    const paper = buildExamForMarking(examKey("paper"), examSets(rows, questions, sets));
    expect(paper.questions.map((q) => [q.number, q.attemptId])).toEqual([[1, "a1"], [2, "a3"]]);
    const empty = buildExamForMarking(examKey("empty"), examSets(rows.map((a) => ({ ...a, submittedAt: undefined })), questions, sets));
    expect(empty.questions).toEqual([]);
    expect(empty.notes).toBeUndefined();
  });

  it("uses cloud set references when metadata has not downloaded", () => {
    const remote = attempts.map((a, i) => ({ ...a, qref: { setId: questions[i].setId, setName: questions[i].setId, order: questions[i].order } }));
    expect(examSets(remote, [], []).map((g) => [g.setId, g.name, g.rows.length])).toEqual([["s1", "s1", 2], ["s2", "s2", 1]]);
  });
});
