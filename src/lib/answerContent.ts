import type { JSONContent } from "@tiptap/react";

/** A picture-only answer still counts as an answer. */
export function hasAnswerContent(answer?: { text?: string; doc?: unknown }): boolean {
  if (answer?.text?.trim()) return true;
  const containsImage = (node: JSONContent): boolean => node.type === "image" || !!node.content?.some(containsImage);
  return !!answer?.doc && typeof answer.doc === "object" && containsImage(answer.doc as JSONContent);
}
