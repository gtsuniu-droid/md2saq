import { describe, expect, it } from "vitest";
import type { Attempt, Mark, Question } from "../data/types";
import { answeredPerDay, compileQuestions, heatGrid, presentationProgress, summarise } from "./stats";

const day = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();
const attempt = (id: string, questionId: string, submittedAt: number, elapsedSec = 60): Attempt => ({
  id, questionId, answers: [], startedAt: submittedAt - elapsedSec * 1000, submittedAt, elapsedSec, mode: "practice",
});
const mark = (attemptId: string, questionId: string, score: number, maxScore: number): Mark => ({
  id: "m" + attemptId, attemptId, questionId, score, maxScore, parts: [], errorTags: [], markedAt: 1,
});
const q = (id: string, setId: string, order: number, presentations: string[]): Question => ({
  id, setId, order, text: id, parts: [], presentations, tags: [], createdAt: 1,
});

describe("stats", () => {
  const attempts = [attempt("a1", "q1", day(2026, 9, 1)), attempt("a2", "q2", day(2026, 9, 1), 120), attempt("a3", "q3", day(2026, 9, 3), 30)];
  const marks = [mark("a1", "q1", 3, 4), mark("a2", "q2", 1, 4)];

  it("counts answered questions per day", () => {
    const per = answeredPerDay(attempts);
    expect(per.get("2026-09-01")).toBe(2);
    expect(per.get("2026-09-03")).toBe(1);
  });

  it("summarises answered, correct, daily average and time", () => {
    const s = summarise(attempts, marks);
    expect(s.answered).toBe(3);
    expect(s.correctPct).toBe(50);
    expect(s.dailyAvg).toBe(1.5);
    expect(s.secondsPerQuestion).toBe(70);
    expect(s.activeDays).toBe(2);
  });

  it("builds a week grid ending on the given day with month labels", () => {
    const grid = heatGrid(answeredPerDay(attempts), day(2026, 9, 6), 14);
    expect(grid.weeks.length).toBeGreaterThanOrEqual(2);
    const cells = grid.weeks.flat().filter(Boolean);
    expect(cells.find((c) => c!.day === "2026-09-01")!.level).toBe(4);
    expect(cells.find((c) => c!.day === "2026-09-03")!.level).toBe(2);
    expect(grid.months.some((m) => m.label === "Sep")).toBe(true);
  });

  it("reports per-presentation progress", () => {
    const qs = [q("q1", "s", 0, ["cough"]), q("q2", "s", 1, ["cough"]), q("q3", "s", 2, ["fever"]), q("q4", "s", 3, ["fever"])];
    const p = presentationProgress(qs, attempts, marks, ["cough", "fever"]);
    expect(p.get("cough")).toMatchObject({ total: 2, attempted: 2, marked: 2, meanPct: 50 });
    expect(p.get("fever")).toMatchObject({ total: 2, attempted: 1, marked: 0, meanPct: null });
  });

  it("counts a child presentation's questions toward its parent", () => {
    const qs = [q("q1", "s", 0, ["back-pain"]), q("q2", "s", 1, ["musculoskeletal-pain"])];
    const parentOf = new Map([["back-pain", "musculoskeletal-pain"]]);
    const p = presentationProgress(qs, [], [], ["back-pain", "musculoskeletal-pain"], parentOf);
    expect(p.get("musculoskeletal-pain")!.total).toBe(2);
    expect(p.get("back-pain")!.total).toBe(1);
    expect(compileQuestions(qs, [], ["musculoskeletal-pain"], { random: () => 0.5, parentOf })).toHaveLength(2);
  });

  it("compiles a random session that keeps cases together", () => {
    const qs = [q("a1", "A", 0, ["cough"]), q("a2", "A", 1, ["cough"]), q("b1", "B", 0, ["fever"]), q("b2", "B", 1, ["cough"]), q("c1", "C", 0, ["falls"])];
    let seed = 0.7;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const picked = compileQuestions(qs, [], ["cough", "fever"], { random });
    expect(picked.map((x) => x.id).sort()).toEqual(["a1", "a2", "b1", "b2"]);
    const setSeq = picked.map((x) => x.setId);
    expect(setSeq.indexOf("A") === setSeq.lastIndexOf("A") - 1 || setSeq.indexOf("B") === setSeq.lastIndexOf("B") - 1).toBe(true);
    const fresh = compileQuestions(qs, [attempt("x", "a1", 1)], ["cough"], { random, newOnly: true, count: 2 });
    expect(fresh).toHaveLength(2);
    expect(fresh.some((x) => x.id === "a1")).toBe(false);
  });
});
