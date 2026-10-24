import type { QuestionSet } from "../data/types";

/** A bank refresh used to copy the publisher's dirty flag into the local cache.
 * That refresh also stamped updatedAt with bankUpdatedAt, unlike a local edit.
 * Treat only that identifiable legacy state as clean; ambiguous edits stay protected.
 */
export function hasUnpublishedEdits(set: QuestionSet): boolean {
  return !!set.dirty && !(set.bankUpdatedAt !== undefined && set.updatedAt === set.bankUpdatedAt);
}
