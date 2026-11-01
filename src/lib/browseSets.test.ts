import { describe, expect, it } from "vitest";
import { browseSets, shortSatDate } from "./browseSets";
import { summarise } from "./sets";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";

const sets: QuestionSet[] = [
  { id: "a", name: "First", number: 2, createdAt: 1, primaryPresentation: "abdominal-pain", tags: ["Renal"], collection: "Bank A" },
  { id: "b", name: "Second", number: 10, createdAt: 2, primaryPresentation: "vomiting" },
];
const questions: Question[] = [
  { id: "a1", setId: "a", order: 0, createdAt: 1, text: "Name initial investigations", stems: ["Patient with flank pain"], modelAnswer: "Hidden diagnosis", parts: [], presentations: ["vomiting"], tags: [] },
  { id: "a2", setId: "a", order: 1, createdAt: 1, text: "Outline management", parts: [{ label: "a", text: "Explain the anatomy", modelAnswer: "Secret mechanism" }], presentations: ["vomiting"], tags: [] },
  { id: "b1", setId: "b", order: 0, createdAt: 1, text: "Assess hydration", parts: [], presentations: ["vomiting"], tags: [] },
];
const summaries = summarise(sets, questions, [], []);

describe("set browsing", () => {
  it("returns the whole set when a later question or subpart matches", () => {
    expect(browseSets(summaries, "anatomy", "")[0].questions.map(q => q.id)).toEqual(["a1", "a2"]);
    expect(browseSets(summaries, "FLANK investigations", "").map(s => s.set.id)).toEqual(["a"]);
  });
  it("does not leak answers through search", () => {
    expect(browseSets(summaries, "hidden diagnosis", "")).toEqual([]);
    expect(browseSets(summaries, "secret mechanism", "")).toEqual([]);
  });
  it("uses only the primary complaint when filtering sets", () => {
    expect(browseSets(summaries, "", "vomiting").map(s => s.set.id)).toEqual(["b"]);
    expect(browseSets(summaries, "", "abdominal-pain").map(s => s.set.id)).toEqual(["a"]);
  });
  it("keeps tag and collection deep-link filters", () => {
    expect(browseSets(summaries, "", "", "Renal", "Bank A").map(s => s.set.id)).toEqual(["a"]);
    expect(browseSets(summaries, "", "", "Renal", "Missing")).toEqual([]);
  });
  it("filters by done since the last reset, sorts by last sat, and keeps every sitting", () => {
    const attempts: Attempt[] = [
      { id: "x", questionId: "a1", answers: [], startedAt: 90, submittedAt: 100, elapsedSec: 10, mode: "practice", sessionId: "s1" },
      { id: "y", questionId: "b1", answers: [], startedAt: 290, submittedAt: 300, elapsedSec: 10, mode: "practice", sessionId: "s2" },
    ];
    const marks: Mark[] = [{ id: "m", attemptId: "y", questionId: "b1", score: 3, maxScore: 4, parts: [], errorTags: [], markedAt: 301 }];
    const sat = summarise(sets, questions, attempts, marks);
    expect(sat.map((s) => [s.set.id, s.done, s.lastSat?.submittedAt])).toEqual([["b", true, 300], ["a", true, 100]]);
    expect(browseSets(sat, "", "", null, null, "done").map((s) => s.set.id)).toEqual(["a", "b"]);
    expect(browseSets(sat, "", "", null, null, "new")).toEqual([]);
    expect(browseSets(sat, "", "", null, null, "", "sat").map((s) => s.set.id)).toEqual(["b", "a"]);
    const reset = summarise(sets, questions, attempts, marks, { progressResetAt: 200 });
    expect(reset.map((s) => [s.set.id, s.done])).toEqual([["b", true], ["a", false]]);
    expect(reset.find((s) => s.set.id === "a")!.sittings).toHaveLength(1);
    expect(browseSets(reset, "", "", null, null, "new").map((s) => s.set.id)).toEqual(["a"]);
    expect(browseSets(reset, "", "", null, null, "", "sat").map((s) => s.set.id)).toEqual(["b", "a"]);
    expect(summarise(sets, questions, attempts, marks, { presentationResetAt: { vomiting: 400 } }).map((s) => [s.set.id, s.done])).toEqual([["b", false], ["a", true]]);
    expect(shortSatDate(new Date(2026, 10, 3).getTime(), new Date(2026, 11, 1).getTime())).toMatch(/3/);
    expect(shortSatDate(new Date(2025, 10, 3).getTime(), new Date(2026, 11, 1).getTime())).toMatch(/2025/);
  });
});
