import { communityServices } from "./firebase";
import { communityBody, validateCommunityTarget, validCommunityKind, COMMUNITY_PAGE_SIZE, type CommunityChannel, type CommunityKind, type CommunityTarget, type CommunityPage, type CommunityPost } from "./community";
import type { QueryDocumentSnapshot, QueryConstraint } from "firebase/firestore";

function path(target: CommunityTarget, channel: CommunityChannel): [string, string, string, string, string] {
  validateCommunityTarget(target);
  if (channel !== "suggestions" && channel !== "discussion") throw new Error("Unknown conversation.");
  return ["questionCommunity", target.bankId, "questions", target.questionId, channel];
}

export async function fetchCommunity(target: CommunityTarget, channel: CommunityChannel, cursor?: unknown): Promise<CommunityPage> {
  const collectionPath = path(target, channel);
  const { firestore } = await communityServices();
  const { collection, query, orderBy, limit, startAfter, getDocsFromServer } = await import("firebase/firestore");
  const constraints: QueryConstraint[] = [orderBy("createdAt", "desc"), limit(COMMUNITY_PAGE_SIZE)];
  if (cursor) constraints.push(startAfter(cursor as QueryDocumentSnapshot));
  const snapshot = await getDocsFromServer(query(collection(firestore, ...collectionPath), ...constraints));
  return {
    posts: snapshot.docs.map(d => {
      const value = d.data();
      return { id: d.id, authorId: value.authorId, authorName: value.authorName, body: value.body, kind: value.kind, resolved: value.resolved, createdAt: value.createdAt.toMillis() } as CommunityPost;
    }),
    cursor: snapshot.size === COMMUNITY_PAGE_SIZE ? snapshot.docs.at(-1) : undefined,
  };
}

/** A caller-generated ID makes retrying an uncertain send idempotent. */
export async function postCommunity(target: CommunityTarget, channel: CommunityChannel, input: { id: string; body: string; kind: CommunityKind; expectedOwner: string }): Promise<void> {
  const collectionPath = path(target, channel);
  const body = communityBody(input.body);
  if (!validCommunityKind(channel, input.kind) || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.id)) throw new Error("Invalid post.");
  const { firestore, auth } = await communityServices();
  const user = auth.currentUser!;
  if (user.uid !== input.expectedOwner) throw new Error("Your account changed. Reopen the conversation before posting.");
  const { doc, runTransaction, serverTimestamp } = await import("firebase/firestore");
  const ref = doc(firestore, ...collectionPath, input.id);
  await runTransaction(firestore, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      const value = existing.data();
      if (value.authorId !== user.uid || value.body !== body || value.kind !== input.kind) throw new Error("This post has already been sent. Refresh the conversation.");
      return;
    }
    tx.set(ref, { authorId: user.uid, authorName: (user.displayName?.trim() || "Member").slice(0, 80), body, kind: input.kind, resolved: false, createdAt: serverTimestamp() });
  });
}

export async function deleteCommunityPost(target: CommunityTarget, channel: CommunityChannel, id: string): Promise<void> {
  const collectionPath = path(target, channel);
  const { firestore } = await communityServices();
  const { doc, runTransaction } = await import("firebase/firestore");
  const ref = doc(firestore, ...collectionPath, id);
  await runTransaction(firestore, async tx => { if ((await tx.get(ref)).exists()) tx.delete(ref); });
}

export async function resolveCommunityPost(target: CommunityTarget, id: string, resolved: boolean): Promise<void> {
  const collectionPath = path(target, "suggestions");
  const { firestore } = await communityServices();
  const { doc, runTransaction } = await import("firebase/firestore");
  const ref = doc(firestore, ...collectionPath, id);
  await runTransaction(firestore, async tx => {
    if (!(await tx.get(ref)).exists()) throw new Error("This suggestion was removed. Refresh the conversation.");
    tx.update(ref, { resolved });
  });
}
