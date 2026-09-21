import { describe, expect, it } from "vitest";
import type { Attempt, Question, QuestionSet } from "../data/types";
import { buildSessionSelection, eligibleSessionSets, seededRandom, suggestedSessionMinutes } from "./sessionBuilder";
const q = (id: string, setId: string, order: number, p = "cough"): Question => ({ id, setId, order, text: id, parts: [], tags: [], presentations: [p], createdAt: 1, marks: 2 });
const sets: QuestionSet[] = [{ id: "a", name: "Case A", createdAt: 1, suggestedMinutes: 15 }, { id: "b", name: "Case B", createdAt: 1 }];
const questions = [q("a2", "a", 1, "fever"), q("a1", "a", 0), q("b1", "b", 0), q("b2", "b", 1)];
const base = { unit: "sets" as const, sets, questions, attempts: [], presentations: ["cough"], newOnly: false, random: seededRandom(4), parentOf: new Map<string, string>() };
describe("session selection", () => {
  it("selects whole sets, including questions tagged to other presentations, in original order", () => {
    expect(buildSessionSelection({ ...base, setIds: ["a"] }).map((q) => q.id)).toEqual(["a1", "a2"]);
  });
  it("counts sets, never truncating a set at the question limit", () => {
    const picked = buildSessionSelection({ ...base, count: 1 });
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((q) => q.setId)).size).toBe(1);
  });
  it("can select exactly one individual question", () => {
    expect(buildSessionSelection({ ...base, unit: "questions", count: 1 })).toHaveLength(1);
  });
  it("excludes a partially attempted set in unattempted-only mode", () => {
    const attempts = [{ questionId: "a1", submittedAt: 9 }] as Attempt[];
    expect(buildSessionSelection({ ...base, newOnly: true, attempts }).map((q) => q.id)).toEqual(["b1", "b2"]);
    expect(buildSessionSelection({ ...base, newOnly: true, attempts: [{ questionId: "a1" }] as Attempt[] })).toHaveLength(4);
  });
  it("supports child presentations, deduplicates matches, and requires an explicit selection", () => {
    const child = { ...base, questions: [q("a1", "a", 0, "back-pain")], presentations: ["musculoskeletal-pain", "back-pain"], parentOf: new Map([["back-pain", "musculoskeletal-pain"]]) };
    expect(buildSessionSelection(child)).toHaveLength(1);
    expect(buildSessionSelection({ ...base, presentations: [] })).toEqual([]);
    expect(buildSessionSelection({ ...base, setIds: [] })).toEqual([]);
  });
  it("rejects invalid counts and returns the same preview for the same seed", () => {
    for (const count of [0, -1, 1.5, NaN]) expect(buildSessionSelection({ ...base, count })).toEqual([]);
    expect(buildSessionSelection({ ...base, random: seededRandom(8), count: 1 })).toEqual(buildSessionSelection({ ...base, random: seededRandom(8), count: 1 }));
  });
  it("bases suggested time on the actual selected questions and whole-set guidance", () => {
    const picked = buildSessionSelection({ ...base, setIds: ["a"] });
    expect(suggestedSessionMinutes(picked, sets, 1.5, "sets")).toBe(15);
    expect(suggestedSessionMinutes(picked.slice(0, 1), sets, 1.5, "questions")).toBe(3);
    expect(eligibleSessionSets(sets, questions, [], ["cough"], false, new Map())).toHaveLength(2);
  });
});
