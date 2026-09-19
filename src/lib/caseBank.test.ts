import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { caseSetName, isCaseBank, parseCaseBank, type CaseFile } from "./caseBank";

const F = new URL("./__fixtures__/casebank/", import.meta.url).pathname;
const read = (rel: string): CaseFile => ({ name: rel.split("/").pop()!, text: readFileSync(F + rel, "utf8") });

describe("case bank", () => {
  const files = [
    read("questions/case_02_questions.txt"),
    read("questions/case_03_questions.txt"),
    read("explained_answers/case_02_explained_answers.txt"),
    read("explained_answers/case_03_explained_answers.txt"),
    read("contents_and_coverage.txt"),
  ];

  it("detects the format", () => {
    expect(isCaseBank(files)).toBe(true);
    expect(isCaseBank([{ name: "x.txt", text: "1. What is this?" }])).toBe(false);
  });

  it("parses cases with stems, questions, parts, marks and time", () => {
    const bank = parseCaseBank(files);
    expect(bank.collection).toBe("Dizziness SAQ Bank");
    expect(bank.cases.map((c) => c.number)).toEqual([2, 3]);
    const c2 = bank.cases[0];
    expect(c2.title).toBe("Dizziness after a recent respiratory illness");
    expect(c2.marks).toBe(25);
    expect(c2.minutes).toBe(31);
    expect(c2.instructions).toMatch(/^- Answer the numbered questions/);
    expect(c2.stem).toMatch(/^Daniel Reed/);
    expect(c2.questions).toHaveLength(4);
    expect(c2.questions.map((q) => q.marks)).toEqual([9, 5, 6, 5]);
    expect(c2.questions[0].stems).toEqual([c2.stem]);
    expect(c2.questions[0].text).toMatch(/^List THREE \(3\) plausible diagnoses/);
    expect(c2.questions[0].text).toContain("Mark allocation");
    expect(c2.questions[1].text).toMatch(/^Symptoms have been continuous/);
    expect(c2.questions[1].parts.map((p) => [p.label, p.marks])).toEqual([["a", 2], ["b", 2], ["c", 1]]);
    expect(caseSetName(bank.collection, c2)).toBe("Dizziness SAQ Bank 02: Dizziness after a recent respiratory illness");
  });

  it("attaches model answers per question and per part, and case-level notes", () => {
    const c2 = parseCaseBank(files).cases[0];
    expect(c2.hasAnswers).toBe(true);
    expect(c2.questions[0].modelAnswer).toContain("Vestibular neuritis");
    expect(c2.questions[0].modelAnswer).toContain("Posterior circulation ischaemic stroke");
    const a = c2.questions[1].parts[0].modelAnswer ?? "";
    expect(a).toContain("Left vestibular neuritis");
    expect(a).not.toMatch(/^State the most likely diagnosis/);
    expect(c2.questions[3].parts[2].modelAnswer).toContain("HINTS-type interpretation");
    expect(c2.markingNotes).toContain("Apply the explicit part caps");
    expect(c2.debrief).toMatch(/^COMMON REASONING ERRORS/);
    expect(c2.debrief).toContain("CLINICAL REFERENCES");
  });

  it("reads conditions from the coverage file", () => {
    const bank = parseCaseBank(files);
    expect(bank.cases[0].conditions).toEqual(["Vestibular neuritis", "Labyrinthitis", "Posterior circulation stroke", "Drug-induced vestibular symptoms"]);
    expect(bank.cases[1].conditions).toContain("Cerebellar haemorrhage");
  });

  it("works from the combined files too", () => {
    const combined = [
      { name: "all_questions.txt", text: "DIZZINESS SAQ BANK — CASES 02–16\n\n==========\n\n" + files[0].text + "\n==========\n" + files[1].text },
      { name: "all_explained_answers.txt", text: "DIZZINESS SAQ BANK — EXPLAINED ANSWERS\n\n" + files[2].text + "\n==========\n" + files[3].text },
    ];
    const bank = parseCaseBank(combined);
    expect(bank.cases).toHaveLength(2);
    expect(bank.cases[1].questions[0].modelAnswer).toBeTruthy();
    expect(bank.cases[0].conditions).toEqual([]);
  });
});
