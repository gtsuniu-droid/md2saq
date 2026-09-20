import { db } from "../data/db";
import { PRESENTATION_BY_ID, presentationName } from "../data/presentations";
import { dominantPresentation, numberingGroup } from "./setGroup";
import { nextSetNumber } from "./sets";
import { SEP, displayName } from "./tree";

/**
 * Put a set under a presentation: every question takes it as its first
 * presentation in place of the old one, nested tags that started with the old
 * presentation start with the new one, and the set takes the next number in
 * its new group. Marked as edited so the next publish carries it.
 */
export async function moveSetToPresentation(setId: string, presentationId: string): Promise<void> {
  if (!PRESENTATION_BY_ID.has(presentationId)) throw new Error("Unknown presentation.");
  const set = await db.sets.get(setId);
  if (!set) throw new Error("Set not found.");
  const questions = await db.questions.where("setId").equals(setId).toArray();
  const old = dominantPresentation(questions);
  const oldName = old ? presentationName(old).toLowerCase() : "";
  const newName = presentationName(presentationId);
  const tags = (set.tags ?? []).map((t) => {
    if (!t.includes(SEP)) return t;
    const [top, ...rest] = t.split(SEP);
    return displayName(top).toLowerCase() === oldName ? [newName, ...rest].join(SEP) : t;
  });
  const before = numberingGroup(set.tags, questions);
  const moved = questions.map((q) => ({ ...q, presentations: [presentationId, ...q.presentations.filter((p) => p !== old && p !== presentationId)] }));
  const after = numberingGroup(tags, moved);
  const number = after === before ? set.number : await nextSetNumber(after);
  await db.transaction("rw", db.sets, db.questions, async () => {
    await db.questions.bulkPut(moved);
    await db.sets.update(setId, { tags: tags.length ? tags : undefined, number, updatedAt: Date.now(), dirty: true });
  });
}
