import { expect, it } from "vitest";
import { validUsername, normaliseUsername } from "./social";
import { firstSentence, questionsInWeek, setsInWeek, sortRows, standing, trend, weekKey, weekStart, type LeaderboardRow } from "./leaderboard";
import type { Attempt } from "../data/types";

it("accepts sensible usernames and refuses the rest", () => {
  expect(validUsername("Eiden")).toBeNull();
  expect(validUsername("emma aria_2")).toBeNull();
  expect(validUsername("")).toBeNull();
  expect(validUsername("a".repeat(21))).toMatch(/20 characters/);
  expect(validUsername("bad<name>")).toMatch(/letters/);
  expect(validUsername(" spaced ")).toBeNull();
  expect(validUsername("two  spaces")).toMatch(/single spaces/);
  expect(normaliseUsername("  Emma   Aria ")).toBe("emma aria");
});

const a = (id: string, questionId: string, submittedAt: number | undefined, ownerId = "me"): Attempt => ({ id, ownerId, questionId, startedAt: 1, submittedAt, elapsedSec: 1, mode: "practice", answers: [] });

it("counts a week from Monday, by questions and by whole sets, for the account only", () => {
  const wed = new Date(2026, 9, 28, 15, 0).getTime();
  const start = weekStart(wed);
  expect(new Date(start).getDay()).toBe(1);
  expect(new Date(start).getDate()).toBe(26);
  expect(weekKey(wed)).toBe("2026-W44");
  expect(weekKey(new Date(2027, 0, 1).getTime())).toBe("2026-W53");
  const questions = [{ id: "q1", setId: "A" }, { id: "q2", setId: "A" }, { id: "q3", setId: "B" }, { id: "q4", setId: "B" }, { id: "q5", setId: "B" }];
  const attempts = [a("1", "q1", start + 1000), a("2", "q2", start + 3 * 86_400_000), a("3", "q3", undefined), a("4", "q4", start - 1), a("5", "q5", start + 7 * 86_400_000), a("6", "q3", start + 5000, "other"), a("7", "q3", start + 6000)];
  expect(questionsInWeek(attempts, "me", start)).toBe(3);
  // A set clicked through with nothing written counts for nothing.
  const blank = { ...a("8", "q4", start + 2000), answers: [{ label: "", text: " ", doc: null }] };
  expect(questionsInWeek([...attempts, blank], "me", start)).toBe(3);
  expect(setsInWeek([...attempts, blank], questions, "me", start)).toBe(1);
  expect(setsInWeek(attempts, questions, "me", start)).toBe(1);
  expect(questionsInWeek(attempts, "me", start - 7 * 86_400_000)).toBe(1);
});

it("orders by the chosen unit and describes where you stand", () => {
  const row = (uid: string, count: number, sets: number, prevCount = 0): LeaderboardRow => ({ uid, name: uid, count, sets, prevCount, prevSets: 0, visible: true, updatedAt: 0 });
  const rows = [row("Jackson", 41, 9, 50), row("Eiden", 58, 4), row("Emma", 37, 7, 37)];
  expect(sortRows(rows, "questions").map((r) => r.uid)).toEqual(["Eiden", "Jackson", "Emma"]);
  expect(sortRows(rows, "sets").map((r) => r.uid)).toEqual(["Jackson", "Emma", "Eiden"]);
  expect(standing(sortRows(rows, "questions"), "Eiden", "questions")).toBe("You lead this week with 58 questions. Jackson is 17 behind.");
  expect(standing(sortRows(rows, "sets"), "Eiden", "sets")).toBe("You're 3rd with 4 sets. 4 more to pass Emma.");
  expect(standing(sortRows(rows, "questions"), "nobody", "questions")).toBeNull();
  expect(firstSentence("You lead this week with 36 questions.")).toBe("You lead this week with 36 questions.");
  expect(firstSentence("You're 3rd with 4 sets. 4 more to pass Emma.")).toBe("You're 3rd with 4 sets.");
  expect(trend(rows[0], "questions")).toBe("down");
  expect(trend(rows[1], "questions")).toBe("up");
  expect(trend(rows[2], "questions")).toBe("same");
});
