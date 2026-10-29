/**
 * Suggestions, problem reports and discussion under a published question: the shape of a post
 * and the limits on it, shared by the site and its functions.
 */
export type CommunityChannel = "suggestions" | "discussion";
export type CommunityKind = "answer" | "problem" | "comment";
export interface CommunityTarget { bankId: string; questionId: string }
export interface CommunityPost {
  id: string;
  authorId: string;
  authorName: string;
  /** The author's picture from their Google or Facebook sign-in. */
  authorPhoto?: string;
  body: string;
  /** Where a report or suggestion comes from: a guideline, a textbook page, a link. */
  source?: string;
  kind: CommunityKind;
  resolved: boolean;
  createdAt: number;
}
export interface CommunityPage { posts: CommunityPost[]; cursor?: unknown }
export const COMMUNITY_BODY_LIMIT = 4000;
export const COMMUNITY_PAGE_SIZE = 25;
export const COMMUNITY_SOURCE_LIMIT = 500;

export function communityBody(text: string): string {
  const body = text.trim();
  if (!body) throw new Error("Write something before posting.");
  if (body.length > COMMUNITY_BODY_LIMIT) throw new Error(`Keep your post to ${COMMUNITY_BODY_LIMIT} characters or fewer.`);
  return body;
}

/** An optional source, trimmed; "" when none was given. */
export function communitySource(text: string | undefined): string {
  const source = (text ?? "").trim();
  if (source.length > COMMUNITY_SOURCE_LIMIT) throw new Error(`Keep the source to ${COMMUNITY_SOURCE_LIMIT} characters or fewer.`);
  return source;
}

export function validateCommunityTarget(target: CommunityTarget): void {
  if (![target.bankId, target.questionId].every(id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id))) {
    throw new Error("This question does not have a valid shared reference.");
  }
}

export function validCommunityKind(channel: CommunityChannel, kind: CommunityKind): boolean {
  return channel === "discussion" ? kind === "comment" : channel === "suggestions" && (kind === "answer" || kind === "problem");
}
