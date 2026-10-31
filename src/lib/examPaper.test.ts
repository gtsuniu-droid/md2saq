import { describe, it, expect } from "vitest";
import type { Question, QuestionSet } from "../data/types";
import { PRESENTATIONS } from "../data/presentations";
import { buildExamPaper, examPresentationPool, examSupply } from "./examPaper";
import { seededRandom } from "./sessionBuilder";
import { primaryPresentation } from "./primaryPresentation";

const sets: QuestionSet[] = PRESENTATIONS.slice(0, 8).flatMap((p, i) => [0, 1].map((j) => ({ id: `${i}-${j}`, name: p.name, primaryPresentation: p.id, createdAt: 1 })));
const questions: Question[] = sets.flatMap((s) => [2, 0, 1].map((order) => ({ id: `${s.id}-q${order}`, setId: s.id, order, text: "Question", parts: [], presentations: ["vomiting"], tags: [], createdAt: 1 })));

describe("fixed exam paper", () => {
  it("draws six distinct primary presentations with one entire ordered set each", () => {
    for (let seed = 0; seed < 20; seed++) {
      const paper = buildExamPaper(sets, questions, seededRandom(seed));
      const ids = [...new Set(paper.map(q => q.setId))];
      expect(ids).toHaveLength(6);
      expect(paper).toHaveLength(18);
      expect(new Set(ids.map(id => primaryPresentation(sets.find(s => s.id === id)!, paper.filter(q => q.setId === id)))).size).toBe(6);
      ids.forEach(id => expect(paper.filter(q => q.setId === id).map(q => q.order)).toEqual([0, 1, 2]));
    }
  });
  it("never repeats a presentation when they are chosen, and fills a bigger paper only from the whole bank", () => {
    const chosen = PRESENTATIONS.slice(0, 5).map((p) => p.id);
    const paper = buildExamPaper(sets, questions, seededRandom(3), { count: 5, presentations: chosen });
    const ids = [...new Set(paper.map((q) => q.setId))];
    expect(ids).toHaveLength(5);
    expect(new Set(ids.map((id) => sets.find((s) => s.id === id)!.primaryPresentation)).size).toBe(5);
    // Three presentations chosen cannot give five different ones, however many sets they hold.
    expect(buildExamPaper(sets, questions, seededRandom(3), { count: 5, presentations: chosen.slice(0, 3) })).toEqual([]);
    expect(examSupply(sets, questions, chosen.slice(0, 3))).toBe(3);
    expect(examSupply(sets, questions, [...chosen.slice(0, 3), "no-such-presentation"])).toBe(3);
    // From the whole bank a ten-set paper draws every presentation once, then goes round again.
    expect(buildExamPaper(sets, questions, seededRandom(3), { count: 10 }).length).toBe(30);
    expect(examSupply(sets, questions)).toBe(16);
    expect(buildExamPaper(sets.slice(0, 4), questions)).toEqual([]);
    const extras = [{ id: "empty", name: "Empty", primaryPresentation: "cough", createdAt: 1 }, { id: "unknown", name: "Unknown", primaryPresentation: "fake", createdAt: 1 }];
    expect(examPresentationPool([...sets, ...extras], [...questions, { ...questions[0], id: "unknown-q", setId: "unknown" }]).size).toBe(8);
  });
  it("selects different papers for different random draws without mutating the bank", () => {
    const before = JSON.stringify({ sets, questions });
    expect(buildExamPaper(sets, questions, seededRandom(1))).not.toEqual(buildExamPaper(sets, questions, seededRandom(2)));
    expect(JSON.stringify({ sets, questions })).toBe(before);
  });
});
