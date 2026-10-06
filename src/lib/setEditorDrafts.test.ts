import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../data/types";
import { clearSetEditorDraft, loadSetEditorDraft, writeSetEditorDraft, type SetEditorDraft } from "./setEditorDrafts";
import { sharedStemGroups, updateSharedStem } from "./sharedStems";

const base: QuestionSet = { id: "set", name: "Case set", createdAt: 1, updatedAt: 10, bankUpdatedAt: 8 };
const draft: SetEditorDraft = {
  set: { ...base, name: "Edited title" }, tags: ["New tag"],
  questions: [{ id: "question", setId: "set", order: 0, text: "Edited question", parts: [{ label: "a", text: "Part" }], stems: ["Shared case", "Later stage"], stemDocs: [null, { type: "doc", content: [{ type: "image", attrs: { src: "data:image/png;base64,example" } }] }], presentations: [], tags: [], createdAt: 1 }],
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("set editor recovery", () => {
  it("restores all unsaved edits, staged stems and rich images without changing the saved set", () => {
    expect(writeSetEditorDraft("admin", base, draft)).toBe(true);
    expect(loadSetEditorDraft("admin", base)).toEqual(draft);
    expect(base.name).toBe("Case set");
    expect(base.updatedAt).toBe(10);
  });

  it("isolates each account and set", () => {
    writeSetEditorDraft("admin", base, draft);
    expect(loadSetEditorDraft("other-admin", base)).toBeNull();
    expect(loadSetEditorDraft("", base)).toBeNull();
    expect(loadSetEditorDraft("admin", { ...base, id: "another-set" })).toBeNull();
  });

  it("does not restore stale edits over a newer local save or bank version", () => {
    writeSetEditorDraft("admin", base, draft);
    expect(loadSetEditorDraft("admin", { ...base, updatedAt: 11 })).toBeNull();
    expect(loadSetEditorDraft("admin", { ...base, bankUpdatedAt: 9 })).toBeNull();
    expect(loadSetEditorDraft("admin", base)).toEqual(draft);
  });

  it("clears only the successfully saved draft and preserves newer edits", () => {
    const newer = { ...draft, tags: ["Newer tag"] };
    writeSetEditorDraft("admin", base, newer);
    clearSetEditorDraft("admin", base.id, draft);
    expect(loadSetEditorDraft("admin", base)).toEqual(newer);
    clearSetEditorDraft("admin", base.id, newer);
    expect(loadSetEditorDraft("admin", base)).toBeNull();
  });

  it("restores shared membership when navigation interrupts clearing and replacing a stem", () => {
    const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
    const blankQuestions = ["first", "second", "unrelated"].map((id, order) => ({ ...draft.questions[0], id, order, stems: [""], stemDocs: [emptyDoc] }));
    const pending = { ...draft, questions: blankQuestions, sharedStems: [{ stemIndex: 0, questionIds: ["first", "second"] }, { stemIndex: 0, questionIds: ["unrelated"] }] };
    writeSetEditorDraft("admin", base, pending);
    const restored = loadSetEditorDraft("admin", base)!;
    const groups = sharedStemGroups(restored.questions, restored.sharedStems);
    expect(groups).toHaveLength(2);
    const edited = updateSharedStem(restored.questions, "first", 0, "Replacement", null, groups[0].questionIds);
    expect(edited.map((question) => question.stems)).toEqual([["Replacement"], ["Replacement"], [""]]);
  });

  it("rejects malformed drafts and reports storage failures without crashing", () => {
    vi.spyOn(localStorage, "getItem").mockReturnValue("broken JSON");
    expect(loadSetEditorDraft("admin", base)).toBeNull();
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ updatedAt: 10, bankUpdatedAt: 8, draft: { ...draft, questions: [null] } }));
    expect(loadSetEditorDraft("admin", base)).toBeNull();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    expect(writeSetEditorDraft("admin", base, draft)).toBe(false);
  });
});
