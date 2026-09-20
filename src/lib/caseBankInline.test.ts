import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasQuestionChunks, isCaseBank, parseAnswersOnly, parseCaseBank, type CaseFile } from "./caseBank";
import { markingPoints } from "./marking";

const F = new URL("./__fixtures__/vomiting/", import.meta.url).pathname;
const read = (rel: string): CaseFile => ({ name: rel.split("/").pop()!, text: readFileSync(F + rel, "utf8") });

function check(bank: ReturnType<typeof parseCaseBank>, withTags: boolean) {
  expect(bank.cases).toHaveLength(1);
  const c = bank.cases[0];
  expect(c.number).toBe(1);
  expect(c.title).toBe("Acute vomiting and diarrhoea");
  expect(c.marks).toBe(23);
  expect(c.stem.startsWith("Ella, a 24-year-old woman")).toBe(true);
  expect(c.questions).toHaveLength(6);
  expect(c.hasAnswers).toBe(true);
  expect(c.conditions).toEqual(withTags ? ["Gastroenteritis/foodborne illness", "Dehydration", "Sepsis", "Basic fluid treatment", "Antiemetics and adverse effects"] : []);
  const [q1, q2, , q4] = c.questions;
  expect(q1.marks).toBe(3);
  expect(q1.parts.map((p) => [p.label, p.marks])).toEqual([["a", 1], ["b", 2]]);
  expect(markingPoints(q1.parts[0].modelAnswer!)).toEqual(["Acute infectious gastroenteritis."]);
  expect(markingPoints(q1.parts[1].modelAnswer!)).toHaveLength(3);
  expect(q2.parts).toHaveLength(0);
  expect(q2.marks).toBe(4);
  expect(q2.text.startsWith("Two people who shared a meal")).toBe(true);
  expect(markingPoints(q2.modelAnswer!)).toHaveLength(6);
  expect(q4.parts.map((p) => p.label)).toEqual(["a", "b", "c", "d"]);
  expect(markingPoints(q4.parts[0].modelAnswer!)).toEqual(["Intravenous fluid replacement.", "She cannot retain enough oral fluid."]);
  // Teaching notes and specific marking lines go to the debrief, labelled; generic marking lines are dropped.
  expect(c.debrief).toContain("Q1 (a): Foodborne infection or toxin-related illness");
  expect(c.debrief).toContain("Q4 (a) marking: 1 mark for IV replacement");
  expect(c.debrief).not.toContain("Award 1 mark per correct point");
  for (const q of c.questions) for (const p of q.parts) expect(p.modelAnswer ?? "").not.toMatch(/Teaching note|Marking:/);
}

describe("case bank with coded headers and inline answers", () => {
  const folder = [read("questions/vomiting_01_questions.txt"), read("explained_answers/vomiting_01_explained_answers.txt"), read("contents_and_tags.txt")];

  it("is detected, with questions", () => {
    expect(isCaseBank(folder)).toBe(true);
    expect(hasQuestionChunks(folder)).toBe(true);
    expect(hasQuestionChunks([read("contents_and_tags.txt")])).toBe(false);
  });

  it("parses the folder: questions file, explained answers file and contents", () => {
    const bank = parseCaseBank(folder);
    expect(bank.collection).toBe("Vomiting");
    check(bank, true);
    expect(bank.cases[0].debrief).toContain("REFERENCES");
  });

  it("parses one file holding the questions with answers under each part", () => {
    const bank = parseCaseBank([read("questions_and_answers.txt")]);
    expect(bank.collection).toBe("Vomiting SAQs");
    check(bank, false);
  });

  it("offers the explained answers on their own for merging", () => {
    const only = parseAnswersOnly([read("explained_answers/vomiting_01_explained_answers.txt")]);
    expect(only).toHaveLength(1);
    expect(only[0].number).toBe(1);
    expect([...only[0].byQuestion.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(only[0].byQuestion.get(2)).toContain("Pulse rate.");
  });
});
