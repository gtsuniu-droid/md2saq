import { wordDiff } from "./wordDiff";

/**
 * Tracked changes for an answer being revised after the model answer was read: where the
 * current text differs from what was submitted, as ranges in the editor. Pure; the editor
 * extension supplies the plain text and a map from each plain-text offset to its position.
 */
export interface Changes {
  /** Added words, as editor positions [from, to). */
  inserted: { from: number; to: number }[];
  /** Removed words, shown struck through at the position they were. */
  deleted: { at: number; text: string }[];
}

export function changesBetween(original: string, current: string, positions: number[]): Changes {
  const inserted: Changes["inserted"] = []; const deleted: Changes["deleted"] = [];
  const end = positions[positions.length - 1] ?? 0;
  let offset = 0;
  for (const part of wordDiff(original, current)) {
    if (part.kind === "del") { deleted.push({ at: positions[offset] ?? end, text: part.text }); continue; }
    if (part.kind === "ins") {
      const from = positions[offset]; const to = (positions[offset + part.text.length - 1] ?? end - 1) + 1;
      if (from !== undefined && to > from) inserted.push({ from, to });
    }
    offset += part.text.length;
  }
  return { inserted, deleted };
}
