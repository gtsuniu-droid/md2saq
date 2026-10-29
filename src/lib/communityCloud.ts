import { idToken } from "./firebase";
import { communityBody, communitySource, validateCommunityTarget, validCommunityKind, type CommunityChannel, type CommunityKind, type CommunityPage, type CommunityTarget } from "./community";

/**
 * Posts under a question, through the site's own store (/api/community) rather than Firestore,
 * so reading them never runs into Firestore's daily read budget. The author's name and picture
 * come from their sign-in on the server.
 */
async function call(init?: RequestInit, query = ""): Promise<Response> {
  const token = await idToken().catch(() => null);
  if (!token) throw new Error("Sign in first.");
  const res = await fetch(`/api/community${query}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not reach the discussion. Try again.");
  return res;
}

const send = (target: CommunityTarget, channel: CommunityChannel, body: Record<string, unknown>) => {
  validateCommunityTarget(target);
  return call({ method: "POST", body: JSON.stringify({ bank: target.bankId, q: target.questionId, channel, ...body }) });
};

export async function fetchCommunity(target: CommunityTarget, channel: CommunityChannel, cursor?: unknown): Promise<CommunityPage> {
  validateCommunityTarget(target);
  const query = new URLSearchParams({ bank: target.bankId, q: target.questionId, channel, ...(typeof cursor === "number" ? { cursor: String(cursor) } : {}) });
  return (await call(undefined, `?${query}`)).json() as Promise<CommunityPage>;
}

/** A caller-generated ID makes retrying an uncertain send idempotent. */
export async function postCommunity(target: CommunityTarget, channel: CommunityChannel, input: { id: string; body: string; kind: CommunityKind; source?: string; expectedOwner: string }): Promise<void> {
  const body = communityBody(input.body);
  const source = communitySource(input.source);
  if (!validCommunityKind(channel, input.kind) || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.id)) throw new Error("Invalid post.");
  await send(target, channel, { action: "post", id: input.id, body, kind: input.kind, ...(source ? { source } : {}) });
}

export async function deleteCommunityPost(target: CommunityTarget, channel: CommunityChannel, id: string): Promise<void> {
  await send(target, channel, { action: "delete", id });
}

export async function resolveCommunityPost(target: CommunityTarget, id: string, resolved: boolean): Promise<void> {
  await send(target, "suggestions", { action: "resolve", id, resolved });
}
