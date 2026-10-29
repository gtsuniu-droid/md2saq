import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./firebase", () => ({ idToken: async () => "token" }));
import { fetchCommunity, postCommunity, deleteCommunityPost, resolveCommunityPost } from "./communityCloud";

const target = { bankId: "bank", questionId: "question" };
const calls: { url: string; init?: RequestInit }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ posts: [], ok: true })); }));
});
const sent = () => JSON.parse(String(calls[0].init?.body));

describe("posts under a question, through the site's store", () => {
  it("sends only the post itself, signed in; the server adds who wrote it", async () => {
    await postCommunity(target, "suggestions", { id: "post", body: "  Wrong dose  ", kind: "problem", source: " BNF, aspirin ", expectedOwner: "author" });
    expect(calls[0].url).toBe("/api/community");
    expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer token" });
    expect(sent()).toEqual({ bank: "bank", q: "question", channel: "suggestions", action: "post", id: "post", body: "Wrong dose", kind: "problem", source: "BNF, aspirin" });
  });
  it("refuses a post of the wrong kind for its channel, or an overlong source, before sending", async () => {
    await expect(postCommunity(target, "suggestions", { id: "post", body: "Text", kind: "comment", expectedOwner: "author" })).rejects.toThrow("Invalid post");
    await expect(postCommunity(target, "suggestions", { id: "post", body: "Text", kind: "problem", source: "x".repeat(501), expectedOwner: "author" })).rejects.toThrow("500 characters");
    expect(calls).toHaveLength(0);
  });
  it("reads a page at a time, and removes or resolves by id", async () => {
    await fetchCommunity(target, "discussion", 25);
    expect(calls[0].url).toBe("/api/community?bank=bank&q=question&channel=discussion&cursor=25");
    calls.length = 0;
    await deleteCommunityPost(target, "discussion", "post");
    expect(sent()).toMatchObject({ channel: "discussion", action: "delete", id: "post" });
    calls.length = 0;
    await resolveCommunityPost(target, "post", true);
    expect(sent()).toMatchObject({ channel: "suggestions", action: "resolve", id: "post", resolved: true });
  });
});
