import type { JSONContent } from "@tiptap/react";

export interface ModelAnswer {
  modelAnswer?: string;
  modelAnswerDoc?: unknown;
}

export function richAnswerDocument(answer: ModelAnswer): JSONContent | undefined {
  const doc = answer.modelAnswerDoc as JSONContent | undefined;
  return doc?.type === "doc" && Array.isArray(doc.content) ? doc : undefined;
}

export function answerDocument(answer: ModelAnswer): JSONContent {
  return richAnswerDocument(answer) ?? {
    type: "doc",
    content: (answer.modelAnswer ?? "").split(/\r?\n/).map((line) => ({
      type: "paragraph", content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

function hasContent(node: JSONContent): boolean {
  return !!node.text?.trim() || ["image", "table", "horizontalRule"].includes(node.type ?? "") || !!node.content?.some(hasContent);
}

export function hasModelAnswer(answer: ModelAnswer): boolean {
  const doc = richAnswerDocument(answer);
  return doc ? hasContent(doc) : !!answer.modelAnswer?.trim();
}

/** Preserve pictures and formatting when combining question drafts. */
export function mergeModelAnswers(...answers: ModelAnswer[]): ModelAnswer {
  return {
    modelAnswer: answers.map((a) => a.modelAnswer).filter(Boolean).join("\n") || undefined,
    modelAnswerDoc: answers.some(richAnswerDocument) ? {
      type: "doc", content: answers.filter(hasModelAnswer).flatMap((a) => answerDocument(a).content ?? []),
    } : undefined,
  };
}
