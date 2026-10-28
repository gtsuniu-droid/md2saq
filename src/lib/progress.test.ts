import { expect, it } from "vitest";
import { figuresFor, staleTable, weekKey, weekStart, weeklyFigures, type CacheBody, type Rec } from "../../netlify/lib/progress";

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

it("serves the last table plus what devices posted since when Firestore cannot be read", () => {
  const now = Date.UTC(2026, 9, 28, 12); // Wednesday
  const thisWeek = weekKey(now);
  const last: CacheBody = { at: now - 3 * 3600_000, week: weekStart(now), accounts: 2, rowsWithEmail: [
    { uid: "a", name: "Ava", email: "ava@x", nickname: "Ava", joined: true, questions: 10, sets: 2, prevQuestions: 4, prevSets: 1, source: "server" },
    { uid: "b", name: "Ben", email: "ben@x", joined: false, questions: 3, sets: 0, prevQuestions: 0, prevSets: 0, source: "server" },
  ] };
  const posted = new Map<string, Rec>([
    ["a", { name: "Ava", week: thisWeek, count: 9, sets: 2, prevCount: 4, prevSets: 1, visible: true, at: now - 5 * 3600_000 }], // older than the table: ignored
    ["b", { name: "Benny", week: thisWeek, count: 7, sets: 1, prevCount: 0, prevSets: 0, visible: true, at: now - 60_000 }], // newer: joined, renamed, counted
    ["c", { name: "Cal Smith", week: thisWeek, count: 12, sets: 3, prevCount: 0, prevSets: 0, visible: true, at: now - 30_000 }], // never seen: added
  ]);
  const body = staleTable(last, posted, now, "429");
  expect(body.stale).toBe(true);
  expect(body.asOf).toBe(last.at);
  expect(body.rowsWithEmail.map((r) => [r.uid, r.questions, r.joined, r.nickname ?? "", r.source])).toEqual([
    ["c", 12, true, "Cal Smith", "device"], ["a", 10, true, "Ava", "server"], ["b", 7, true, "Benny", "device"],
  ]);
  expect(body.rowsWithEmail[0].name).toBe("Cal");
  expect(body.rowsWithEmail[2].email).toBe("ben@x");
});

it("rolls a last-week table into last week's column, and stands on posted records alone without one", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const last: CacheBody = { at: now - 8 * 24 * 3600_000, week: weekStart(now) - 7 * 24 * 3600_000, accounts: 1, rowsWithEmail: [
    { uid: "a", name: "Ava", joined: true, questions: 10, sets: 2, prevQuestions: 4, prevSets: 1, source: "server" },
  ] };
  const rolled = staleTable(last, new Map(), now, "429").rowsWithEmail[0];
  expect([rolled.questions, rolled.sets, rolled.prevQuestions, rolled.prevSets]).toEqual([0, 0, 10, 2]);
  const alone = staleTable(null, new Map<string, Rec>([["d", { name: "Dee", week: weekKey(now - 7 * 24 * 3600_000), count: 5, sets: 1, prevCount: 0, prevSets: 0, visible: false, at: now }]]), now, "429");
  expect(alone.asOf).toBeUndefined();
  expect(alone.rowsWithEmail).toEqual([{ uid: "d", name: "Dee", photo: undefined, nickname: "Dee", joined: false, lastSeenAt: now, questions: 0, sets: 0, prevQuestions: 5, prevSets: 1, source: "device" }]);
});
