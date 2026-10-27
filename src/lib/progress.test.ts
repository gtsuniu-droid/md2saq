import { expect, it } from "vitest";
import { figuresFor, weekStart, weeklyFigures } from "../../netlify/lib/progress";

it("counts each account's questions and completed sets this week and last", () => {
  const now = new Date(2026, 9, 28, 12).getTime();
  const start = weekStart(now);
  const a = (uid: string, submittedAt: number, questionId: string, bankId?: string, order?: number) => ({ uid, submittedAt, questionId, bankId, order });
  const rows = [a("g", start + 1, "q1", "B", 0), a("g", start + 2, "q2", "B", 1), a("g", start + 3, "q3", "C", 0), a("g", start - 1000, "q9", "C", 1), a("j", start + 5, "q1", "B", 0), a("g", start + 6, "q1", "B", 0)];
  const counts = new Map([["B", 2], ["C", 3]]);
  expect(figuresFor(rows.filter((r) => r.uid === "g"), counts, start)).toEqual({ questions: 3, sets: 1 });
  const all = weeklyFigures(rows, counts, now);
  expect(all.get("g")).toEqual({ week: { questions: 3, sets: 1 }, last: { questions: 1, sets: 0 } });
  expect(all.get("j")).toEqual({ week: { questions: 1, sets: 0 }, last: { questions: 0, sets: 0 } });
});
