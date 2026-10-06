import { describe, expect, it } from "vitest";
import type { Question, Session } from "../data/types";
import { openedSetCount, paperQuestionGroup, sessionQuestionRows, sessionAtQuestion, sessionSetGroups } from "./sessionNavigation";
import { stemsOf } from "./questions";
const questions: Question[] = ["a", "a", "b", "b", "c"].map((setId, i) => ({ id: `q${i}`, setId, order: i, text: "Question", stems: ["Shared wording"], parts: [], presentations: [], tags: [], createdAt: 1 }));
const session: Session = { id: "s", mode: "practice", studyUnit: "sets", openedSetCount: 1, questionIds: questions.map((q) => q.id), attemptIds: ["a0", "a1", "a2", "a3", "a4"], index: 0, startedAt: 42, totalSec: 90 };
describe("progressive whole-set sessions", () => {
  it("starts with one set, appends the next on navigation, and preserves opened sets when going back", () => {
    const groups = sessionSetGroups(session, questions);
    expect(groups.map((g) => g.indices)).toEqual([[0, 1], [2, 3], [4]]);
    expect(openedSetCount(session, groups)).toBe(1);
    const second = sessionAtQuestion(session, questions, 2);
    expect(second.openedSetCount).toBe(2);
    expect(second.attemptIds).toEqual(session.attemptIds);
    expect(second.startedAt).toBe(42);
    expect(second.totalSec).toBe(90);
    expect(sessionAtQuestion(second, questions, 0).openedSetCount).toBe(2);
    expect(sessionAtQuestion(second, questions, 4).openedSetCount).toBe(3);
  });
  it("never merges different bank sets because their stems happen to match or be empty", () => {
    expect(paperQuestionGroup(questions, 0, stemsOf)).toEqual([0, 1]);
    expect(paperQuestionGroup(questions, 2, stemsOf)).toEqual([2, 3]);
    expect(paperQuestionGroup(questions.map((q) => ({ ...q, stems: [] })), 2, stemsOf)).toEqual([2, 3]);
  });
  it("restores opened progress and handles older sessions without set metadata", () => {
    const restored = JSON.parse(JSON.stringify(sessionAtQuestion(session, questions, 2))) as Session;
    expect(openedSetCount(restored, sessionSetGroups(restored, questions))).toBe(2);
    expect(openedSetCount({ ...session, studyUnit: undefined }, sessionSetGroups(session, questions))).toBe(3);
    expect(openedSetCount({ ...session, index: 4, openedSetCount: undefined }, sessionSetGroups(session, questions))).toBe(3);
  });
  it("supports exams and clamps navigation at the last question without changing the paper", () => {
    const last = sessionAtQuestion({ ...session, mode: "exam" }, questions, 50);
    expect(last.index).toBe(4);
    expect(last.openedSetCount).toBe(3);
    expect(last.mode).toBe("exam");
    expect(last.questionIds).toEqual(session.questionIds);
  });
});

describe("vertical question sidebar", () => {
  it("appends a whole set only after Next reaches its first question, keeping earlier rows", () => {
    expect(sessionQuestionRows(session, questions).map((r) => r.label)).toEqual(["1", "2"]);
    const last = sessionAtQuestion(session, questions, 1);
    expect(sessionQuestionRows(last, questions).map((r) => r.label)).toEqual(["1", "2"]);
    const next = sessionAtQuestion(last, questions, 2);
    expect(sessionQuestionRows(next, questions).map((r) => r.label)).toEqual(["1", "2", "3", "4"]);
    const back = sessionAtQuestion(next, questions, 0);
    expect(sessionQuestionRows(back, questions).map((r) => r.label)).toEqual(["1", "2", "3", "4"]);
    expect(sessionQuestionRows(back, questions).filter((r) => r.current).map((r) => r.label)).toEqual(["1"]);
  });
  it("highlights exactly one row even when a multipart question first opens or an old part was removed", () => {
    const multipart = questions.map((q, i) => i === 0 ? { ...q, parts: [{ label: "a", text: "First" }, { label: "b", text: "Second" }] } : q);
    for (const activePart of ["", "a", "b", "removed"]) {
      const rows = sessionQuestionRows(session, multipart, activePart);
      expect(rows.filter((r) => r.current)).toHaveLength(1);
      expect(rows.find((r) => r.current)?.part).toBe(activePart === "b" ? "b" : "a");
    }
  });
});

it("makes every exam stem available during reading without changing progressive practice", () => {
  const exam = { ...session, mode: "exam" as const, examFormat: "six-stem" as const, readingSec: 900 };
  expect(openedSetCount(exam, sessionSetGroups(exam, questions))).toBe(3);
  expect(sessionQuestionRows(exam, questions)).toHaveLength(5);
  expect(openedSetCount(session, sessionSetGroups(session, questions))).toBe(1);
});
