import { expect, it } from "vitest";
import type { Attempt, Question, QuestionSet } from "../data/types";
import { buildSetForMarking, checkSuggested, docText, MARKING_RULES, markPrompt, setText } from "./setForMarking";

const stem = "Mr Lee, 64, has had central chest pain for 40 minutes. BP 100/60, HR 110.";
const q1: Question = { id: "q1", setId: "s", order: 0, stems: [stem], text: "", parts: [
  { label: "a", text: "List TWO differentials.", marks: 2, modelAnswer: "- [1] STEMI\n- [1] Aortic dissection" },
  { label: "b", text: "Name the first investigation.", marks: 1, modelAnswerDoc: { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "12-lead ECG within 10 minutes" }] }] }] }] } },
], presentations: [], tags: [], createdAt: 1 };
const q2: Question = { id: "q2", setId: "s", order: 1, stems: [stem], text: "Outline your management.", marks: 3, modelAnswer: "Aspirin, PCI.", parts: [], presentations: [], tags: [], createdAt: 1 };
const attempt = (id: string, questionId: string, answers: [string, string][]): Attempt => ({ id, questionId, answers: answers.map(([label, text]) => ({ label, text, doc: null })), startedAt: 1, submittedAt: 100, elapsedSec: 5, mode: "practice" });
const set = { id: "s", name: "Chest pain", markingNotes: "Accept NSTEMI.", createdAt: 1 } as QuestionSet;
const built = buildSetForMarking("t1", "Set 12: Chest pain", [
  { question: q1, attempt: attempt("t1", "q1", [["a", "STEMI and pericarditis"], ["b", "ECG"]]), order: 0 },
  { question: q2, attempt: attempt("t2", "q2", [["", "Aspirin 300 mg, cath lab"]]), order: 1 },
], set);

it("lays a set out for marking, the shared case once, every part with its marks and model answer", () => {
  expect(built.questions.map((q) => [q.number, q.stems.length, q.parts.map((p) => `${p.id}:${p.marks}`)])).toEqual([[1, 1, ["1(a):2", "1(b):1"]], [2, 0, ["2:3"]]]);
  expect(built.questions[0].parts[1].model).toBe("- 12-lead ECG within 10 minutes"); // kept only with formatting
  const text = setText(built);
  expect(text.indexOf(stem)).toBe(text.lastIndexOf(stem));
  expect(text).not.toContain("revised answer"); // none was made
  for (const bit of ["# Set 12: Chest pain", "### 1(a) [2 marks]", "My answer:\nSTEMI and pericarditis", "Model answer:\n- [1] STEMI", "## Question 2 [3 marks]", "## Marking notes\nAccept NSTEMI."]) expect(text).toContain(bit);
  expect(text).not.toMatch(/\bAI\b/);
  // Marked strictly, with a pearl per part, whoever the text is pasted to.
  for (const rule of MARKING_RULES) expect(text).toContain(rule);
  expect(MARKING_RULES.join(" ")).toMatch(/strictly[\s\S]*benefit of the doubt[\s\S]*only the first that many[\s\S]*pearl[\s\S]*no label/);
  // A consultant's judgement, not a blind reading of the guide, and still strict.
  expect(MARKING_RULES[0]).toMatch(/expert consultant doctor[\s\S]*clinical reasoning[\s\S]*evidence-based[\s\S]*not a script[\s\S]*clinical equivalent/);
  expect(MARKING_RULES[1]).toMatch(/clinically wrong for this patient[\s\S]*Never give the benefit of the doubt/);
  expect(markPrompt(built)).toMatch(/consultant doctor[\s\S]*clinical reasoning[\s\S]*no benefit of the doubt/);
});

it("keeps what a marker sent that fits the set, and says what did not", () => {
  const { marks, problems } = checkSuggested(built, [
    { part: "1(a)", score: 1, feedback: "STEMI right; pericarditis less likely here.", comments: [{ quote: "pericarditis", comment: "Dissection fits the low BP better." }, { quote: "not in the answer", comment: "x" }], rewrite: "STEMI and aortic dissection" },
    { part: "1 (B)", score: 5, feedback: "Good.", rewrite: "ECG" },
    { part: "3", score: 1 },
  ], "Solid start.", 7);
  expect(marks.parts.map((p) => [p.attemptId, p.label, p.score])).toEqual([["t1", "a", 1], ["t1", "b", 1]]);
  expect(marks.parts[0].comments).toEqual([{ quote: "pericarditis", text: "Dissection fits the low BP better.", start: 10, end: 22 }]);
  expect(marks).toMatchObject({ at: 7, summary: "Solid start." });
  // A rewrite stays where it changes the answer; one that repeats it is dropped.
  expect(marks.parts.map((p) => p.rewrite)).toEqual(["STEMI and aortic dissection", undefined]);
  expect(problems).toHaveLength(3); // the missing quote, the score over the part's marks, the part that does not exist
});

it("reads rich documents as plain lines", () => {
  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  expect(docText({ type: "doc", content: [p("Intro"), { type: "bulletList", content: [{ type: "listItem", content: [p("One"), { type: "bulletList", content: [{ type: "listItem", content: [p("Nested")] }] }] }] }] })).toBe("Intro\n- One\n  - Nested");
});


it("asks the connector to mark a normal set by its own key", () => {
  const prompt = markPrompt(built);
  expect(prompt).toContain('"Set 12: Chest pain" (set id t1)');
  expect(prompt).toContain('getMyAnswers (set: "t1")');
  expect(prompt).toContain('markMyAnswers (set: "t1")');
  expect(prompt).not.toContain("whole exam paper");
});
