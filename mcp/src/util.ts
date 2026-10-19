import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BankError, PasscodeMissingError, ReadOnlyModeError } from "./client.js";
import type { BankEntry, Question, SetPack, SubPart } from "./types.js";

/** Success: the object as JSON text plus structuredContent, so clients can show either. */
export function ok(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/** Failure: isError with a plain message and, where useful, a hint about what to do instead. */
export function fail(error: unknown, context: Record<string, unknown> = {}): CallToolResult {
  const data: Record<string, unknown> = { success: false, error: error instanceof Error ? error.message : String(error), ...context };
  if (error instanceof ReadOnlyModeError) data.hint = "Start the server without --read-only (and without SAQ_READ_ONLY) to allow changes.";
  else if (error instanceof PasscodeMissingError) data.hint = "Add SAQ_PASSCODE to the server's environment; it is the admin passcode from the site's Netlify settings.";
  else if (error instanceof BankError && error.status === 403) data.hint = "The passcode must match BANK_PASSCODE on the site exactly.";
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: true };
}

export function setLabel(entry: Pick<BankEntry, "number" | "name" | "presentations" | "group">): string {
  const number = entry.number !== undefined ? `Set ${String(entry.number).padStart(2, "0")}` : entry.name;
  const where = entry.group ?? entry.presentations[0];
  return where ? `${presentationName(where)} — ${number}` : number;
}

export function presentationName(id: string): string {
  return id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function partLabel(label: string): string {
  return label ? `(${label})` : "";
}

/** A compact, readable view of one question, with ids so edits can target it. */
export function describeQuestion(q: Question, index: number) {
  return {
    number: index + 1,
    questionId: q.id,
    stems: q.stems ?? [],
    text: q.text,
    marks: q.marks,
    modelAnswer: q.modelAnswer,
    hasRichText: !!q.textDoc,
    hasRichModelAnswer: !!q.modelAnswerDoc,
    parts: q.parts.map((p) => ({ label: p.label, text: p.text, marks: p.marks, modelAnswer: p.modelAnswer, hasRichText: !!p.textDoc, hasRichModelAnswer: !!p.modelAnswerDoc })),
    presentations: q.presentations,
    images: (q.images as { id: string; caption?: string; place: string }[] | undefined)?.map((im) => ({ id: im.id, place: im.place, caption: im.caption })) ?? [],
  };
}

/** Find a question in a pack by its 1-based number or its id. */
export function findQuestion(pack: SetPack, ref: { number?: number; questionId?: string }): { question: Question; index: number } {
  const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
  let index = -1;
  if (ref.questionId) index = ordered.findIndex((q) => q.id === ref.questionId);
  else if (ref.number !== undefined) index = ref.number - 1;
  if (index < 0 || index >= ordered.length) throw new BankError(`No question ${ref.questionId ?? ref.number} in this set; it has ${ordered.length}. getSet lists them with their numbers and ids.`, 404);
  return { question: ordered[index], index };
}

export function findPart(question: Question, label: string): SubPart {
  const part = question.parts.find((p) => p.label.toLowerCase() === label.toLowerCase());
  if (!part) throw new BankError(`Question has no part "${label}". Its parts are: ${question.parts.map((p) => p.label).join(", ") || "none"}.`, 404);
  return part;
}

export function plainText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

/** Everything in the set's text that a search should look at. */
export function searchableText(pack: SetPack): string {
  const parts = [pack.set.name, pack.set.source ?? "", pack.set.collection ?? "", ...(pack.set.tags ?? [])];
  for (const q of pack.questions) parts.push(...(q.stems ?? []), q.text, q.modelAnswer ?? "", ...q.parts.flatMap((p) => [p.text, p.modelAnswer ?? ""]));
  return parts.join("\n").toLowerCase();
}
