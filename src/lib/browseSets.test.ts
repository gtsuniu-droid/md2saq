import { describe, expect, it } from "vitest";
import { browseSets } from "./browseSets";
import { summarise } from "./sets";
import type { Question, QuestionSet } from "../data/types";

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
});
