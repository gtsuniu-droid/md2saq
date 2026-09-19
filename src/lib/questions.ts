import type { Question, SubPart } from "../data/types";

/** Answerable parts of a question: its sub-parts, or one implicit part for the stem. */
export function answerParts(q: Question): SubPart[] {
  if (q.parts.length > 0) return q.parts;
  return [{ label: "", text: "", marks: q.marks, modelAnswer: q.modelAnswer }];
}

export function partLabel(label: string): string {
  if (!label) return "";
  return /^\d+$/.test(label) ? `${label})` : `(${label})`;
}

export function questionNumber(q: Question): string {
  return String(q.order + 1);
}

export function totalMarks(q: Question): number | undefined {
  if (q.marks !== undefined) return q.marks;
  const sum = q.parts.reduce((acc, p) => acc + (p.marks ?? 0), 0);
  return sum > 0 ? sum : undefined;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function truncate(text: string, n = 110): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
