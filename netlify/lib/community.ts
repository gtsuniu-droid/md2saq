import { openNamedStore } from "./store";
import { accessToken, listAll, num, serviceAccount, str, type FsDoc } from "./recount";
import { firebaseEnv } from "../functions/mcp-token";
import { COMMUNITY_PAGE_SIZE, type CommunityChannel, type CommunityPost, type CommunityTarget } from "../../src/lib/communityModel";

/**
 * Reports, suggestions and discussion under each published question, in one blob per
 * question, so reading them never touches Firestore's daily read budget. Posts made while
 * they lived in Firestore are copied across the first time a question's posts are read.
 */
type Thread = { suggestions: CommunityPost[]; discussion: CommunityPost[]; imported?: true };
const KEEP = 500;
const CHANNELS: CommunityChannel[] = ["suggestions", "discussion"];
const store = () => openNamedStore("community");
const key = (t: CommunityTarget) => `q/${t.bankId}/${t.questionId}`;
const newestFirst = (posts: CommunityPost[]) => [...posts].sort((a, b) => b.createdAt - a.createdAt);

/** A question's posts as they were in Firestore, read once with the service account. */
async function fromFirestore(t: CommunityTarget): Promise<Pick<Thread, "suggestions" | "discussion">> {
  const sa = serviceAccount();
  if (!sa) return { suggestions: [], discussion: [] };
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseEnv().projectId ?? sa.project_id}/databases/(default)/documents`;
  const token = await accessToken(sa);
  const post = (d: FsDoc): CommunityPost[] => {
    const f = d.fields;
    const body = str(f?.body), authorId = str(f?.authorId), kind = str(f?.kind);
    if (!f || !body || !authorId || (kind !== "answer" && kind !== "problem" && kind !== "comment")) return [];
    return [{ id: d.name.split("/").pop()!, authorId, authorName: str(f.authorName) || "Member", body, kind, resolved: f.resolved?.booleanValue === true, createdAt: num(f.createdAt) ?? 0 }];
  };
  const [suggestions, discussion] = await Promise.all(CHANNELS.map((c) => listAll(base, token, `questionCommunity/${t.bankId}/questions/${t.questionId}/${c}`)));
  return { suggestions: suggestions.flatMap(post), discussion: discussion.flatMap(post) };
}

/** The question's posts, bringing over its Firestore posts the first time (and again later if Firestore could not be read then). */
export async function readThread(t: CommunityTarget): Promise<Thread> {
  const cur = (await store().get(key(t), { type: "json" })) as Thread | null;
  if (cur?.imported) return cur;
  const old = await fromFirestore(t).catch((e) => { console.warn("community: old posts not read yet:", e); return null; });
  if (!old) return cur ?? { suggestions: [], discussion: [] };
  const merge = (now: CommunityPost[] = [], before: CommunityPost[]) => newestFirst([...now, ...before.filter((p) => !now.some((n) => n.id === p.id))]).slice(0, KEEP);
  return (await store().update<Thread>(key(t), (c) => ({ suggestions: merge(c?.suggestions, old.suggestions), discussion: merge(c?.discussion, old.discussion), imported: true })))!;
}

/** One page of a channel, newest first; `cursor` is where the next page starts. */
export async function readPage(t: CommunityTarget, channel: CommunityChannel, from = 0): Promise<{ posts: CommunityPost[]; cursor?: number }> {
  const posts = newestFirst((await readThread(t))[channel]);
  const end = from + COMMUNITY_PAGE_SIZE;
  return { posts: posts.slice(from, end), ...(end < posts.length ? { cursor: end } : {}) };
}

/** Change a question's posts. `edit` may run more than once when two changes meet, so it starts afresh each time. */
async function change(t: CommunityTarget, edit: (thread: Thread) => Thread | null): Promise<void> {
  await readThread(t);
  await store().update<Thread>(key(t), (cur) => edit(cur ?? { suggestions: [], discussion: [] }));
}

/** Add a post. Sending the same post again (an uncertain retry) changes nothing; reusing its id for something else is refused. */
export async function addPost(t: CommunityTarget, channel: CommunityChannel, post: CommunityPost): Promise<void> {
  let clash = false;
  await change(t, (thread) => {
    clash = false;
    const same = thread[channel].find((p) => p.id === post.id);
    if (same) { clash = same.authorId !== post.authorId || same.body !== post.body || same.kind !== post.kind; return null; }
    return { ...thread, [channel]: newestFirst([post, ...thread[channel]]).slice(0, KEEP) };
  });
  if (clash) throw new Error("This post has already been sent. Refresh the conversation.");
}

/** Remove a post: its author, or a moderator. */
export async function removePost(t: CommunityTarget, channel: CommunityChannel, id: string, by: string, moderator: boolean): Promise<void> {
  let refused = false;
  await change(t, (thread) => {
    refused = false;
    const post = thread[channel].find((p) => p.id === id);
    if (!post) return null;
    if (post.authorId !== by && !moderator) { refused = true; return null; }
    return { ...thread, [channel]: thread[channel].filter((p) => p.id !== id) };
  });
  if (refused) throw new Error("Only its author or a moderator can delete a post.");
}

export async function setResolved(t: CommunityTarget, id: string, resolved: boolean): Promise<void> {
  let missing = false;
  await change(t, (thread) => {
    missing = !thread.suggestions.some((p) => p.id === id);
    if (missing) return null;
    return { ...thread, suggestions: thread.suggestions.map((p) => p.id === id ? { ...p, resolved } : p) };
  });
  if (missing) throw new Error("This suggestion was removed. Refresh the conversation.");
}
