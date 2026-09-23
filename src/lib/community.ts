import type { Question, QuestionSet } from "../data/types";
import { loadSharedPack } from "./publicLinks";
import { publishedQuestion } from "./questionIdentity";

export type CommunityChannel = "suggestions" | "discussion";
export type CommunityKind = "answer" | "problem" | "comment";
export interface CommunityTarget { bankId: string; questionId: string }
export interface CommunityPost {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  kind: CommunityKind;
  resolved: boolean;
  createdAt: number;
}
export interface CommunityPage { posts: CommunityPost[]; cursor?: unknown }
export const COMMUNITY_BODY_LIMIT = 4000;
export const COMMUNITY_PAGE_SIZE = 25;

export function communityBody(text: string): string {
  const body = text.trim();
  if (!body) throw new Error("Write something before posting.");
  if (body.length > COMMUNITY_BODY_LIMIT) throw new Error(`Keep your post to ${COMMUNITY_BODY_LIMIT} characters or fewer.`);
  return body;
}

export function validateCommunityTarget(target: CommunityTarget): void {
  if (![target.bankId, target.questionId].every(id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id))) {
    throw new Error("This question does not have a valid shared reference.");
  }
}

export function validCommunityKind(channel: CommunityChannel, kind: CommunityKind): boolean {
  return channel === "discussion" ? kind === "comment" : channel === "suggestions" && (kind === "answer" || kind === "problem");
}

/** Resolve legacy local IDs against the published bank before attaching public posts. */
export async function communityTarget(set: QuestionSet | undefined, question: Question): Promise<CommunityTarget> {
  if (!set?.bankId) throw new Error("Suggestions and discussion are available after this set is published.");
  if (question.setId !== set.id) throw new Error("This question does not belong to this set.");
  const pack = await loadSharedPack(set.bankId);
  const published = publishedQuestion(pack, question);
  if (!published) throw new Error("This question is not in the published set yet.");
  const target = { bankId: set.bankId, questionId: published.id };
  validateCommunityTarget(target);
  return target;
}

export function communityError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "permission-denied") return "Discussion access is not available yet. Please try again later or let the admin know.";
  if (code === "unavailable" || code === "deadline-exceeded") return "Could not reach the cloud. Your text is still here; try again when connected.";
  return error instanceof Error ? error.message : "Could not complete that action. Please try again.";
}
