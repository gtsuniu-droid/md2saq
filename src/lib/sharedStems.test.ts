import { describe, expect, it } from "vitest";
import type { Question } from "../data/types";
import { sharedStemGroups, updateSharedStem } from "./sharedStems";

const rich = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Case" }] }, { type: "image", attrs: { src: "data:image/png;base64,example" } }] };
function question(id: string, order: number, stems = ["Case"], stemDocs?: unknown[]): Question {
  return { id, order, setId: "set", text: `Question ${id}`, stems, stemDocs, parts: [], tags: [], presentations: [], createdAt: 1 };
}

describe("shared case stems", () => {
  it("groups the same stage, text and rich content once with all question numbers", () => {
    const questions = [question("first", 0, ["Case"], [rich]), question("second", 1, ["Case", "Later stage"], [rich, null]), question("third", 2, ["Case"], [rich])];
    const groups = sharedStemGroups(questions);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ stemIndex: 0, text: "Case", questionIds: ["first", "second", "third"], questionNumbers: [1, 2, 3], doc: rich });
    expect(groups[1]).toMatchObject({ stemIndex: 1, text: "Later stage", questionIds: ["second"] });
  });

  it("updates earlier and later sharing questions without touching different rich documents, stages or sets", () => {
    const images = [{ id: "image", place: "stem" as const, dataUrl: "data:image/png;base64,kept" }];
    const questions = [
      { ...question("first", 0, ["Case", "Later stage"], [rich, null]), images },
      question("source", 1, ["Case"], [rich]),
      question("last", 2, ["Case"], [rich]),
      question("plain", 3),
      question("other-stage", 4, ["Different", "Case"], [null, rich]),
      { ...question("other-set", 5, ["Case"], [rich]), setId: "other" },
    ];
    const changedDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Updated case" }] }] };
    const updated = updateSharedStem(questions, "source", 0, "Updated case", changedDoc);
    expect(updated.slice(0, 3).map((q) => q.stems?.[0])).toEqual(["Updated case", "Updated case", "Updated case"]);
    expect(updated[0].stemDocs).toEqual([changedDoc, null]);
    expect(updated[0].stems?.[1]).toBe("Later stage");
    expect(updated[0].images).toBe(images);
    expect(updated.slice(3)).toEqual(questions.slice(3));
    expect(questions[0].stems).toEqual(["Case", "Later stage"]);
    expect(questions[0].stemDocs?.[0]).toBe(rich);
  });

  it("treats missing and null rich docs as equivalent and keeps draft-specific properties", () => {
    const questions = [{ ...question("first", 0), key: "draft-first" }, { ...question("second", 1, ["Case"], [null]), key: "draft-second" }];
    expect(sharedStemGroups(questions)).toHaveLength(1);
    const next = updateSharedStem(questions, "second", 0, "New", undefined);
    expect(next.map((q) => [q.key, q.stems?.[0], q.stemDocs?.[0]])).toEqual([["draft-first", "New", null], ["draft-second", "New", null]]);
  });

  it("does not create or shift stages when the requested stem is missing", () => {
    const questions = [question("first", 0, ["Case", "Later stage"], [rich, null])];
    expect(updateSharedStem(questions, "missing", 0, "New", null)).toBe(questions);
    expect(updateSharedStem(questions, "first", 4, "New", null)).toBe(questions);
    expect(sharedStemGroups([question("reordered", 8), question("first", 0)] )[0].questionNumbers).toEqual([1, 2]);
  });

  it("keeps new blank placeholders separate while sharing meaningful image-only stems", () => {
    const empty = { type: "doc", content: [{ type: "paragraph" }] };
    const imageOnly = { type: "doc", content: [{ type: "image", attrs: { src: "data:image/png;base64,example" } }] };
    const questions = [question("first", 0, [""]), question("second", 1, [""]), question("empty-doc", 2, [""], [empty]), question("another-empty-doc", 3, [""], [empty]), question("image", 4, [""], [imageOnly]), question("shared-image", 5, [""], [imageOnly])];
    expect(sharedStemGroups(questions)).toHaveLength(5);
    expect(sharedStemGroups(questions).at(-1)?.questionIds).toEqual(["image", "shared-image"]);
    const next = updateSharedStem(questions, "second", 0, "Only this question", rich);
    expect(next[0].stems).toEqual([""]);
    expect(next[1].stems).toEqual(["Only this question"]);
    expect(updateSharedStem(questions, "shared-image", 0, "Updated image caption", imageOnly).slice(4).map((q) => q.stems)).toEqual([["Updated image caption"], ["Updated image caption"]]);
  });

  it("keeps an established shared stem together through select-all, delete, and replacement typing", () => {
    const questions = [question("first", 0), question("second", 1), question("third", 2), question("new-blank", 3, [""])];
    const original = sharedStemGroups(questions);
    const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
    const cleared = updateSharedStem(questions, "first", 0, "", emptyDoc, original[0].questionIds);
    const afterClear = sharedStemGroups(cleared, original);
    expect(afterClear).toHaveLength(2);
    expect(afterClear[0].questionIds).toEqual(["first", "second", "third"]);
    const typed = updateSharedStem(cleared, afterClear[0].sourceQuestionId, 0, "Replacement", rich, afterClear[0].questionIds);
    expect(typed.map((q) => q.stems?.[0])).toEqual(["Replacement", "Replacement", "Replacement", ""]);
  });
});
