import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db } from "../data/db";
import type { Question, SubPart } from "../data/types";
import { answerDocument, hasModelAnswer, mergeModelAnswers } from "./modelAnswer";
import { applyAnswers } from "./caseBank";
import { answerParts } from "./questions";
import { exportSet, importSetPack, applyBankUpdate, type SetPack } from "./exportImport";

const rich = { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "First point", marks: [{ type: "textStyle", attrs: { color: "#7e22ce", fontSize: "24px" } }] }] },
  { type: "image", attrs: { src: "data:image/png;base64,cGljdHVyZQ==", width: 240, height: 120, alt: "Diagram" } },
] };
const question: Question = { id: "rich-q", setId: "rich-set", order: 0, text: "Question", parts: [], modelAnswer: "First point", modelAnswerDoc: rich, tags: [], presentations: [], createdAt: 1 };

beforeEach(async () => { await db.delete(); await db.open(); });

it("keeps legacy line breaks and treats literal HTML as text", () => {
  const doc = answerDocument({ modelAnswer: "First point\n\n<b>Second</b>" });
  expect(doc.content).toHaveLength(3);
  expect(doc.content?.[2].content?.[0].text).toBe("<b>Second</b>");
  expect(hasModelAnswer({ modelAnswer: "First point" })).toBe(true);
  expect(hasModelAnswer({ modelAnswerDoc: { type: "doc", content: [{ type: "paragraph" }] } })).toBe(false);
  expect(hasModelAnswer({ modelAnswerDoc: { type: "doc", content: [rich.content[1]] } })).toBe(true);
});

it("preserves formatted answers and resized pictures through storage, export, import and bank refresh", async () => {
  await db.sets.add({ id: "rich-set", name: "Rich answers", number: 1, createdAt: 1 });
  await db.questions.add({ ...question, parts: [{ label: "a", text: "Part", modelAnswer: "First point", modelAnswerDoc: rich }] });
  const pack = JSON.parse(JSON.stringify(await exportSet("rich-set"))) as SetPack;
  const importedId = await importSetPack(pack);
  const imported = await db.questions.where("setId").equals(importedId).first();
  expect(imported?.modelAnswerDoc).toEqual(rich);
  expect(imported?.parts[0].modelAnswerDoc).toEqual(rich);
  await applyBankUpdate(importedId, { ...pack, questions: [{ ...question, modelAnswer: "Replacement", modelAnswerDoc: undefined }] }, 2);
  expect((await db.questions.where("setId").equals(importedId).first())?.modelAnswerDoc).toBeUndefined();
});

it("keeps rich whole-question answers available to the marking screen", () => {
  expect(answerParts(question)[0].modelAnswerDoc).toEqual(rich);
  const merged = mergeModelAnswers(question, { modelAnswer: "Second point" });
  expect(merged.modelAnswer).toBe("First point\nSecond point");
  expect(answerDocument(merged).content).toHaveLength(3);
  expect(answerDocument(merged).content?.[1]).toEqual(rich.content[1]);
});

it("replaces stale formatting only for answers replaced by a plain-text answer guide", () => {
  const questions = [{ ...question, parts: [
    { label: "a", text: "Part a", modelAnswer: "Old a", modelAnswerDoc: rich },
    { label: "b", text: "Part b", modelAnswer: "Old b", modelAnswerDoc: rich },
    { label: "c", text: "Part c", modelAnswer: "Untouched", modelAnswerDoc: rich },
  ] as SubPart[] }];
  applyAnswers(questions, new Map([[1, "(a) New a\n(b) New b"]]));
  expect(questions[0].modelAnswerDoc).toBeUndefined();
  expect(questions[0].parts[0].modelAnswer).toBe("New a");
  expect(questions[0].parts[0].modelAnswerDoc).toBeUndefined();
  expect(questions[0].parts[2].modelAnswerDoc).toEqual(rich);
});
