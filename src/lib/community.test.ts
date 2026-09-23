import { describe, expect, it, vi } from "vitest";
import { communityBody, communityTarget, validateCommunityTarget, validCommunityKind } from "./community";
import { loadSharedPack } from "./publicLinks";
import type { Question } from "../data/types";
vi.mock("./publicLinks", () => ({ loadSharedPack: vi.fn() }));
const q: Question = { id: "local-q", bankQuestionId: "public-q", setId: "s", order: 0, text: "Question", parts: [], tags: [], presentations: [], createdAt: 1 };
describe("question conversations", () => {
  it("validates body length and empty posts without changing plain text into HTML", () => {
    expect(communityBody("  <b>My reasoning</b>  ")).toBe("<b>My reasoning</b>");
    expect(() => communityBody(" \n ")).toThrow();
    expect(() => communityBody("x".repeat(4001))).toThrow();
    expect(communityBody("x".repeat(4000))).toHaveLength(4000);
  });
  it("keeps suggestions separate from discussion and rejects path injection", () => {
    expect(validCommunityKind("suggestions", "answer")).toBe(true);
    expect(validCommunityKind("suggestions", "problem")).toBe(true);
    expect(validCommunityKind("suggestions", "comment")).toBe(false);
    expect(validCommunityKind("discussion", "answer")).toBe(false);
    expect(() => validateCommunityTarget({ bankId: "../users", questionId: "q" })).toThrow();
  });
  it("resolves remapped IDs without using the question's changing position", async () => {
    vi.mocked(loadSharedPack).mockResolvedValue({ format: "saq-practice-set", version: 1, set: { id: "s", name: "Set", createdAt: 1 }, questions: [{ ...q, id: "public-q", order: 4 }] });
    expect(await communityTarget({ id: "s", name: "Set", bankId: "bank", createdAt: 1 }, q)).toEqual({ bankId: "bank", questionId: "public-q" });
    await expect(communityTarget(undefined, q)).rejects.toThrow("published");
    await expect(communityTarget({ id: "s", name: "Set", bankId: "bank", createdAt: 1 }, { ...q, bankQuestionId: "new" })).rejects.toThrow("not in the published set");
  });
});
