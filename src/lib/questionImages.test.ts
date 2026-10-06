import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db } from "../data/db";
import type { Question } from "../data/types";
import { exportSet, importSetPack } from "./exportImport";
import { introducedStems } from "./markingSet";
import { paperQuestionGroup } from "./sessionNavigation";
import { sameQuestion } from "./questionIdentity";
const picture = { type: "doc", content: [{ type: "image", attrs: { src: "data:image/png;base64,test", width: 220, height: 140 } }] };
const q: Question = { id: "q", setId: "s", text: "", textDoc: picture, stems: [""], stemDocs: [picture], parts: [{ label: "a", text: "", textDoc: picture }], order: 0, tags: [], presentations: [], createdAt: 1 };
beforeEach(async () => { await db.questions.clear(); await db.sets.clear(); });
it("retains inline images and their dimensions through the shared-set export/import path", async () => {
  await db.sets.put({ id: "s", name: "Image case", createdAt: 1 });
  await db.questions.put(q);
  const pack = JSON.parse(JSON.stringify(await exportSet("s")));
  const imported = await importSetPack(pack);
  const copied = await db.questions.where("setId").equals(imported).first();
  expect(copied).toMatchObject({ textDoc: picture, stemDocs: [picture], parts: [{ textDoc: picture }] });
});
it("does not hide a different picture-only stem behind an identical plain-text stem", () => {
  const other = { ...q, id: "q2", stemDocs: [{ ...picture, content: [{ type: "image", attrs: { src: "data:image/png;base64,other" } }] }] };
  expect(introducedStems(other, q)).toEqual([{ text: "", index: 0 }]);
  expect(paperQuestionGroup([q, other], 0, x => x.stems ?? [])).toEqual([0]);
  expect(sameQuestion(q, other)).toBe(false);
  expect(introducedStems({ ...q, id: "q3" }, q)).toEqual([]);
});
