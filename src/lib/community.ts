import type { Question, QuestionSet } from "../data/types";
import { loadSharedPack } from "./publicLinks";
import { publishedQuestion } from "./questionIdentity";

export * from "./communityModel";
import { validateCommunityTarget, type CommunityTarget } from "./communityModel";

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
