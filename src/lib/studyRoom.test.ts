import { expect, it } from "vitest";
import { average, markedByMe, marksOn, maxFor, peopleOf } from "./studyRoom";
import type { PeerMark, SharedAnswers, StudySession } from "./studyTypes";

const study = { code: "728686", hostUid: "g", hostName: "gabb", createdAt: 0, expiresAt: 0, presentations: [], mode: "practice", minutes: 0, questions: [{ bankId: "b", order: 0, text: "Q1", setLabel: "Set 03", marks: 9 }, { bankId: "b", order: 1, text: "Q2", setLabel: "Set 03" }], participants: [{ uid: "g", name: "gabb" }, { uid: "k", name: "Kevin" }] } as StudySession;
const shared: SharedAnswers[] = [
  { uid: "k", name: "Kev (old name)", answers: [{ index: 0, text: "PE", score: 7, maxScore: 9 }, { index: 1, text: "CTPA" }], sharedAt: 2 },
  { uid: "p", name: "Priya", answers: [{ index: 0, text: "PE too" }], sharedAt: 3 },
  { uid: "g", name: "gabb", answers: [{ index: 0, text: "Mine", score: 6, maxScore: 9 }], sharedAt: 1 },
];

it("lists me first, then everyone who joined or shared by name, keeping the joined name", () => {
  const people = peopleOf(study, shared, "k");
  expect(people.map((p) => p.uid)).toEqual(["k", "g", "p"]);
  expect(people[0].name).toBe("Kevin");
  expect(people[2].shared?.answers).toHaveLength(1);
});

it("averages marks, picks the right maximum and knows when I have marked everyone", () => {
  const marks: PeerMark[] = [{ index: 0, targetUid: "k", by: "g", score: 7, maxScore: 9, at: 5 }, { index: 0, targetUid: "k", by: "p", score: 6, maxScore: 9, at: 4 }, { index: 1, targetUid: "k", by: "g", score: 2, maxScore: 10, at: 6 }];
  expect(marksOn(marks, 0, "k").map((m) => m.by)).toEqual(["p", "g"]);
  expect(average(marksOn(marks, 0, "k"))).toBe(6.5);
  expect(average([])).toBeNull();
  expect(maxFor(study.questions[0], undefined)).toBe(9);
  expect(maxFor(study.questions[1], { index: 1, text: "", maxScore: 4 })).toBe(4);
  expect(maxFor(study.questions[1], undefined)).toBe(10);
  const people = peopleOf(study, shared, "g");
  // Marked once every friend's answer there has my mark; a question nobody else answered never is.
  expect(markedByMe(people, marks, 0, "g")).toBe(false);
  expect(markedByMe(people, [...marks, { index: 0, targetUid: "p", by: "g", score: 5, maxScore: 9, at: 7 }], 0, "g")).toBe(true);
  expect(markedByMe(people, marks, 1, "g")).toBe(true);
  expect(markedByMe(people, marks, 1, "k")).toBe(false);
});
