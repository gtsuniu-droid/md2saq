import { expect, it } from "vitest";
import type { Attempt, Question } from "../data/types";
import { introducedStems, markingDraft, reconcileMarkingParts } from "./markingSet";
const question: Question = { id: "q", setId: "set", order: 0, text: "Question", parts: [{ label: "a", text: "First", marks: 3 }, { label: "b", text: "Second", marks: 2 }], tags: [], presentations: [], createdAt: 1 };
const attempt: Attempt = { id: "a", questionId: "q", answers: [], startedAt: 1, submittedAt: 2, elapsedSec: 0, mode: "practice" };
it("retains draft scores by label after a subquestion is deleted, without losing private notes", () => {
  const draft = markingDraft(question, attempt);
  draft.parts[1].score = 2;
  draft.notes = "Keep my reminder";
  const edited = { ...question, parts: [question.parts[1], { label: "c", text: "New", marks: 4 }] };
  const next = reconcileMarkingParts(draft, edited);
  expect(next.parts.map((p) => [p.label, p.score, p.maxScore])).toEqual([["b", 2, 2], ["c", 0, 4]]);
  expect(next.notes).toBe("Keep my reminder");
});

it("shows shared case stems once and appends only new stage details", () => {
  const first = { ...question, stems: ["Initial case"] };
  const later = { ...question, id: "q2", stems: ["Initial case", "New examination findings"] };
  expect(introducedStems(first)).toEqual([{ text: "Initial case", index: 0 }]);
  expect(introducedStems(first, first)).toEqual([]);
  expect(introducedStems(later, first)).toEqual([{ text: "New examination findings", index: 1 }]);
  expect(introducedStems({ ...later, setId: "another-set" }, first)).toHaveLength(2);
  expect(introducedStems(first, later)).toEqual([{ text: "Initial case", index: 0 }]);
});
