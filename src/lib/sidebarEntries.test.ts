import { expect, it } from "vitest";
import type { Attempt, Mark, Question, QuestionSet, Session } from "../data/types";
import type { MarkingDraft } from "./markingSet";
import { markBand, sidebarEntries } from "./sidebarEntries";

const q = (id: string, setId: string, order: number, parts: string[] = []): Question => ({ id, setId, order, text: "Question", parts: parts.map((label) => ({ label, text: "Part", marks: 2 })), presentations: [], tags: [], createdAt: 1 });
const questions = [q("q0", "a", 0, ["a", "b"]), q("q1", "a", 1), q("q2", "b", 0)];
const session: Session = { id: "s", mode: "practice", studyUnit: "questions", questionIds: ["q0", "q1", "q2"], attemptIds: ["t0", "t1", "t2"], index: 0, startedAt: 1 };
// Everything answered, except question 3, which was submitted blank.
const written = (labels: string[]) => labels.map((label) => ({ label, text: "My answer", doc: null }));
const attempts = [written(["a", "b"]), written([""]), []].map((answers, i) => ({ id: `t${i}`, questionId: `q${i}`, answers, startedAt: 1, submittedAt: 2, elapsedSec: 1, mode: "practice" }) as Attempt);
const sets = [{ id: "a", name: "Chest pain", number: 7, createdAt: 1 }, { id: "b", name: "Back pain", createdAt: 1 }] as QuestionSet[];
const mark = (attemptId: string, markedAt: number, parts: [string, number][]): Mark => ({ id: `m${markedAt}`, attemptId, questionId: "", score: 0, maxScore: 0, parts: parts.map(([label, score]) => ({ label, score, maxScore: 2, pointsHit: [] })), errorTags: [], markedAt });
const draft = (parts: [string, number][], scored: string[]): MarkingDraft => ({ parts: parts.map(([label, score]) => ({ label, score, maxScore: 2, pointsHit: [] })), scored, errorTags: [], learningPoint: "", notes: "", reviewLater: false, lookedAtAnswer: false });
const show = (marks: Mark[], drafts = new Map<string, MarkingDraft>(), s = session) => sidebarEntries(s, questions, attempts, sets, marks, "", drafts)
  .map((e) => e.kind === "set" ? `[${e.label}${e.allMarked ? " ✓" : ""}]` : `${e.row.label}${e.unanswered ? " –" : ""}${e.score ? ` ${e.score.score}` : ""}`);

it("numbers sets in the order they come up, and ticks a set once every part in it is marked", () => {
  expect(show([])).toEqual(["[Set 1]", "1 (a)", "1 (b)", "2", "[Set 2]", "3 –"]);
  // The latest mark counts; 1 (b) is not in it, so set 1 is not finished.
  expect(show([mark("t0", 1, [["a", 0], ["b", 0]]), mark("t0", 5, [["a", 2]]), mark("t1", 3, [["", 2]])])).toEqual(["[Set 1]", "1 (a) 2", "1 (b)", "2 2", "[Set 2]", "3 –"]);
  expect(show([mark("t0", 1, [["a", 1], ["b", 1]]), mark("t1", 3, [["", 2]])])[0]).toBe("[Set 1 ✓]");
  // Hovering a heading gives the bank's own label and name.
  expect(sidebarEntries(session, questions, attempts, sets, [], "").filter((e) => e.kind === "set").map((e) => e.kind === "set" && e.title)).toEqual(["Set 07: Chest pain", "Back pain"]);
});

it("shows scores typed on the marking page before they are saved, nought included, but not untouched parts", () => {
  const typing = new Map([["t0", draft([["a", 0], ["b", 0]], ["a"])]]);
  expect(show([], typing).slice(1, 3)).toEqual(["1 (a) 0", "1 (b)"]);
  // A typed score is newer than the saved one.
  expect(show([mark("t0", 1, [["a", 2], ["b", 2]])], new Map([["t0", draft([["a", 1], ["b", 2]], ["a"])]])).slice(1, 3)).toEqual(["1 (a) 1", "1 (b) 2"]);
});

it("leaves headings out when the session is a single set", () => {
  const one: Session = { ...session, questionIds: ["q0", "q1"], attemptIds: ["t0", "t1"] };
  expect(show([], new Map(), one)).toEqual(["1 (a)", "1 (b)", "2"]);
});

it("colours a marked part's row the way the home page colours scores", () => {
  const band = (score: number, maxScore: number) => markBand({ score, maxScore });
  expect([band(3, 3), band(7, 10), band(2, 3), band(1, 2), band(4.9, 10), band(0, 2), band(1, 0)]).toEqual(["good", "good", "mid", "mid", "low", "low", ""]);
});
