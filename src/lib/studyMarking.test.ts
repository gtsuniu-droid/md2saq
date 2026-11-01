import { describe, expect, it } from "vitest";
import type { Question } from "../data/types";
import { buildRoomSetsForMarking, markTogetherPrompt, roomAttemptId, roomSetKey, roomSuggestionsToMarks } from "./studyMarking";
import { peopleOf } from "./studyRoom";
import type { SharedAnswers, StudyRoomView, StudySession } from "./studyTypes";
import { checkSuggested, setText } from "./setForMarking";

const study = { code: "728686", hostUid: "g", hostName: "gabb", createdAt: 0, expiresAt: 0, presentations: [], mode: "practice", minutes: 0,
  questions: [{ bankId: "b", order: 0, text: "Q1 text", setLabel: "Set 03", marks: 4 }, { bankId: "b", order: 1, text: "Q2 text", setLabel: "Set 03", marks: 3 }],
  participants: [{ uid: "g", name: "gabb" }, { uid: "k", name: "Kevin" }, { uid: "p", name: "Priya" }] } as StudySession;
const shared: SharedAnswers[] = [
  { uid: "k", name: "Kevin", answers: [{ index: 0, text: "(a) PE\n(b) CTPA", parts: [{ label: "a", text: "PE" }, { label: "b", text: "CTPA" }] }, { index: 1, text: "Heparin" }], sharedAt: 20 },
  { uid: "g", name: "gabb", answers: [{ index: 0, text: "Mine" }], sharedAt: 10 },
  { uid: "p", name: "Priya", answers: [], sharedAt: 5 },
];
const room: StudyRoomView = { study, shared, marks: [], comments: [] };
const questions: (Question | undefined)[] = [
  { id: "q1", setId: "s", order: 0, text: "Q1 full text", stems: ["A 60 year old man is breathless."], parts: [{ label: "a", text: "Diagnosis?", marks: 1, modelAnswer: "Pulmonary embolism [1 mark]" }, { label: "b", text: "Investigation?", marks: 3, modelAnswer: "CTPA [3 marks]" }], presentations: [], tags: [], createdAt: 1 },
  { id: "q2", setId: "s", order: 1, text: "Q2 full text", stems: ["A 60 year old man is breathless."], marks: 3, parts: [], modelAnswer: "LMWH [3 marks]", presentations: [], tags: [], createdAt: 1 },
];

describe("friends' answers laid out for the assistant", () => {
  const people = peopleOf(study, shared, "g");
  it("makes one set per friend who shared, with the case, the parts and the model answers, leaving me out", () => {
    const sets = buildRoomSetsForMarking(room, people, questions, "g");
    expect(sets.map((s) => s.key)).toEqual([roomSetKey("728686", "k")]);
    const [kevin] = sets;
    expect(kevin.name).toBe("Kevin, Mark together 728 686");
    expect(kevin.at).toBe(20);
    expect(kevin.questions.map((q) => q.attemptId)).toEqual([roomAttemptId("k", 0), roomAttemptId("k", 1)]);
    expect(kevin.questions[0].stems).toEqual(["A 60 year old man is breathless."]);
    expect(kevin.questions[1].stems).toEqual([]);
    expect(kevin.questions[0].parts.map((p) => [p.id, p.answer, p.marks, p.model])).toEqual([["1(a)", "PE", 1, "Pulmonary embolism [1 mark]"], ["1(b)", "CTPA", 3, "CTPA [3 marks]"]]);
    expect(kevin.questions[1].parts.map((p) => [p.id, p.answer, p.marks, p.model])).toEqual([["2", "Heparin", 3, "LMWH [3 marks]"]]);
    expect(setText(kevin)).toContain("Model answer:\nCTPA [3 marks]");
  });
  it("still lays the answers out when the set is not in this library", () => {
    const [kevin] = buildRoomSetsForMarking(room, people, [undefined, undefined], "g");
    expect(kevin.questions[0].text).toBe("Q1 text");
    expect(kevin.questions[0].parts.map((p) => [p.id, p.answer, p.marks])).toEqual([["1(a)", "PE", 0], ["1(b)", "CTPA", 0]]);
    expect(kevin.questions[1].parts.map((p) => [p.id, p.answer, p.marks])).toEqual([["2", "Heparin", 3]]);
  });
  it("turns the marks sent back into my marks on each friend's answers, capped and with the feedback kept", () => {
    const [kevin] = buildRoomSetsForMarking(room, people, questions, "g");
    const { marks, problems } = checkSuggested(kevin, [
      { part: "1(a)", score: 1, feedback: "Right diagnosis." },
      { part: "1(b)", score: 5, feedback: "CTPA is the test.", comments: [{ quote: "CTPA", comment: "Good." }] },
    ], undefined, 99);
    expect(problems).toEqual(["1(b): 5 is more than its 3 marks, so 3 was kept."]);
    const mine = roomSuggestionsToMarks(kevin, marks);
    expect(mine).toEqual([{ index: 0, targetUid: "k", score: 4, maxScore: 4, parts: [{ label: "a", score: 1, maxScore: 1, pointsHit: [] }, { label: "b", score: 3, maxScore: 3, pointsHit: [] }], feedback: { a: "Right diagnosis.", b: "CTPA is the test." } }]);
    // A skipped part stays at zero for me to fill in; a question with nothing suggested is not marked at all.
    const partial = roomSuggestionsToMarks(kevin, checkSuggested(kevin, [{ part: "1(b)", score: 2, feedback: "" }], undefined, 99).marks);
    expect(partial).toEqual([{ index: 0, targetUid: "k", score: 2, maxScore: 4, parts: [{ label: "a", score: 0, maxScore: 1, pointsHit: [] }, { label: "b", score: 2, maxScore: 3, pointsHit: [] }], feedback: {} }]);
  });
  it("marks a part of unknown marks out of what it was given, so the room accepts it", () => {
    const [kevin] = buildRoomSetsForMarking(room, people, [undefined, undefined], "g");
    const mine = roomSuggestionsToMarks(kevin, checkSuggested(kevin, [{ part: "1(a)", score: 1, feedback: "" }, { part: "1(b)", score: 2, feedback: "" }], undefined, 99).marks);
    expect(mine[0]).toMatchObject({ index: 0, targetUid: "k", score: 3, maxScore: 3, parts: [{ label: "a", score: 1, maxScore: 1 }, { label: "b", score: 2, maxScore: 2 }] });
  });
  it("tells the assistant each friend's set by id", () => {
    const sets = buildRoomSetsForMarking(room, people, questions, "g");
    const prompt = markTogetherPrompt("728686", sets);
    expect(prompt).toContain('"study:728686:k" (Kevin)');
    expect(prompt).toContain("728 686");
    expect(prompt).toContain("getMyAnswers");
    expect(prompt).toContain("markMyAnswers");
  });
});
