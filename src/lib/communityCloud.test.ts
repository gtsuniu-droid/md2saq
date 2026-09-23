import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: { uid: "author", displayName: "Test member" }, existing: undefined as undefined | Record<string, unknown>, set: vi.fn(), remove: vi.fn(), update: vi.fn(), query: vi.fn(), getDocs: vi.fn() }));
vi.mock("./firebase", () => ({ communityServices: async () => ({ auth: { currentUser: mocks.user }, firestore: {} }) }));
vi.mock("firebase/firestore", () => ({
  doc: (_: unknown, ...parts: string[]) => parts.join("/"), collection: (_: unknown, ...parts: string[]) => parts.join("/"),
  serverTimestamp: () => "SERVER_TIME", orderBy: (...args: unknown[]) => args, limit: (n: number) => ({ limit: n }), startAfter: (cursor: unknown) => ({ cursor }),
  query: (...args: unknown[]) => { mocks.query(...args); return args; }, getDocsFromServer: mocks.getDocs,
  runTransaction: async (_: unknown, fn: (tx: unknown) => unknown) => fn({ get: async () => ({ exists: () => !!mocks.existing, data: () => mocks.existing }), set: mocks.set, delete: mocks.remove, update: mocks.update }),
}));
import { fetchCommunity, postCommunity, deleteCommunityPost, resolveCommunityPost } from "./communityCloud";
const target = { bankId: "bank", questionId: "question" };
beforeEach(() => { vi.clearAllMocks(); mocks.existing = undefined; mocks.getDocs.mockResolvedValue({ docs: [], size: 0 }); });
describe("shared cloud post operations", () => {
  it("writes only an explicit post, with the current user and server timestamp", async () => {
    await postCommunity(target, "discussion", { id: "post", body: "  Reasoning  ", kind: "comment", expectedOwner: "author" });
    expect(mocks.set).toHaveBeenCalledWith("questionCommunity/bank/questions/question/discussion/post", { authorId: "author", authorName: "Test member", body: "Reasoning", kind: "comment", resolved: false, createdAt: "SERVER_TIME" });
  });
  it("does not publish under a different signed-in account or wrong channel", async () => {
    await expect(postCommunity(target, "discussion", { id: "post", body: "Text", kind: "comment", expectedOwner: "previous-user" })).rejects.toThrow("account changed");
    await expect(postCommunity(target, "suggestions", { id: "post", body: "Text", kind: "comment", expectedOwner: "author" })).rejects.toThrow("Invalid post");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("retries a committed post without creating duplicates or overwriting someone else", async () => {
    mocks.existing = { authorId: "author", body: "Text", kind: "comment" };
    await postCommunity(target, "discussion", { id: "post", body: "Text", kind: "comment", expectedOwner: "author" });
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.existing.authorId = "someone-else";
    await expect(postCommunity(target, "discussion", { id: "post", body: "Text", kind: "comment", expectedOwner: "author" })).rejects.toThrow("already been sent");
  });
  it("loads a bounded page on demand and uses a cursor for older posts", async () => {
    await fetchCommunity(target, "discussion", "cursor");
    expect(mocks.query).toHaveBeenCalledWith("questionCommunity/bank/questions/question/discussion", ["createdAt", "desc"], { limit: 25 }, { cursor: "cursor" });
  });
  it("uses transactions for removal and resolution, preserving post content", async () => {
    mocks.existing = { body: "Text" };
    await deleteCommunityPost(target, "discussion", "post");
    expect(mocks.remove).toHaveBeenCalledWith("questionCommunity/bank/questions/question/discussion/post");
    await resolveCommunityPost(target, "post", true);
    expect(mocks.update).toHaveBeenCalledWith("questionCommunity/bank/questions/question/suggestions/post", { resolved: true });
  });
});
