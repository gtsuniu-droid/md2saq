import { describe, it, expect } from "vitest";
import type { Question, QuestionSet } from "../data/types";
import { PRESENTATIONS } from "../data/presentations";
import { buildExamPaper, examFreshCount, examPresentationPool, examSupply } from "./examPaper";
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

describe("unattempted sets first", () => {
  it("draws unattempted sets before sets already sat, and sat sets only to make up the count", () => {
    // One set of each presentation sat: the paper is the other eight, never a sat one.
    const attempted = new Set(sets.filter((s) => s.id.endsWith("-0")).map((s) => s.id));
    for (let seed = 0; seed < 10; seed++) {
      const paper = buildExamPaper(sets, questions, seededRandom(seed), { count: 8, attempted });
      expect(new Set(paper.map((q) => q.setId)).size).toBe(8);
      expect(paper.some((q) => attempted.has(q.setId))).toBe(false);
    }
    // Only three sets unattempted: a six-set paper has those three and three sat ones.
    const mostly = new Set(sets.filter((s) => !["0-0", "1-0", "2-1"].includes(s.id)).map((s) => s.id));
    const paper = buildExamPaper(sets, questions, seededRandom(5), { count: 6, attempted: mostly });
    const ids = [...new Set(paper.map((q) => q.setId))];
    expect(ids).toHaveLength(6);
    expect(ids.filter((id) => !mostly.has(id)).sort()).toEqual(["0-0", "1-0", "2-1"]);
    // Everything sat: the paper still draws, as before.
    expect(buildExamPaper(sets, questions, seededRandom(1), { attempted: new Set(sets.map((s) => s.id)) })).toHaveLength(18);
  });
  it("says how many sets of the paper would be unattempted, as the draw itself turns out", () => {
    const attempted = new Set(sets.filter((s) => s.id.endsWith("-0")).map((s) => s.id));
    expect(examFreshCount(sets, questions, { count: 8, attempted })).toBe(8);
    const mostly = new Set(sets.filter((s) => !["0-0", "1-0", "2-1"].includes(s.id)).map((s) => s.id));
    expect(examFreshCount(sets, questions, { count: 6, attempted: mostly })).toBe(3);
    expect(examFreshCount(sets, questions, { count: 6 })).toBe(6);
    expect(examFreshCount(sets, questions, { count: 6, attempted: new Set(sets.map((s) => s.id)) })).toBe(0);
    expect(examFreshCount(sets.slice(0, 4), questions, { count: 6 })).toBe(0);
    // Unattempted sets in two presentations only: a six-set paper still spans six presentations, so two are unattempted.
    const concentrated = new Set(sets.filter((s) => !s.id.startsWith("0-") && !s.id.startsWith("1-")).map((s) => s.id));
    expect(examFreshCount(sets, questions, { count: 6, attempted: concentrated })).toBe(2);
    for (let seed = 0; seed < 10; seed++) {
      const paper = buildExamPaper(sets, questions, seededRandom(seed), { count: 6, attempted: concentrated });
      expect([...new Set(paper.map((q) => q.setId))].filter((id) => !concentrated.has(id))).toHaveLength(2);
    }
    // A ten-set paper from the whole bank goes round again and picks up the remaining unattempted sets.
    expect(examFreshCount(sets, questions, { count: 10, attempted: concentrated })).toBe(4);
    // Chosen presentations: one set each, the unattempted one where there is one.
    const chosen = PRESENTATIONS.slice(0, 5).map((p) => p.id);
    expect(examFreshCount(sets, questions, { count: 5, presentations: chosen, attempted: concentrated })).toBe(2);
  });
});
