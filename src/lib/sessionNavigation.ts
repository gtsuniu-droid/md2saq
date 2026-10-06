import type { Question, Session } from "../data/types";
import { answerParts, partLabel } from "./questions";

export interface SessionSetGroup { setId: string; indices: number[] }

/** Keep the selected bank order, with complete sets treated as navigation units. */
export function sessionSetGroups(session: Session, questions: Question[]): SessionSetGroup[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const groups: SessionSetGroup[] = [];
  session.questionIds.forEach((id, index) => {
    const question = byId.get(id);
    if (!question) return;
    const existing = groups.find((group) => group.setId === question.setId);
    if (existing) existing.indices.push(index);
    else groups.push({ setId: question.setId, indices: [index] });
  });
  return groups;
}

export function openedSetCount(session: Session, groups: SessionSetGroup[]): number {
  if (session.examFormat === "six-stem" || session.studyUnit !== "sets") return groups.length;
  const current = groups.findIndex((group) => group.indices.includes(session.index));
  return Math.min(groups.length, Math.max(1, session.openedSetCount ?? 1, current + 1));
}

/** Navigating backwards never hides sets already opened. No extra bank download is needed. */
export function sessionAtQuestion(session: Session, questions: Question[], index: number, activePart = ""): Session {
  const next = { ...session, index: Math.max(0, Math.min(index, session.questionIds.length - 1)), activePart };
  if (session.studyUnit === "sets") {
    const groups = sessionSetGroups(session, questions);
    next.openedSetCount = openedSetCount(next, groups);
  }
  return next;
}

/** Display one case at a time, including when separate cases have identical or empty stems. */
export function paperQuestionGroup(questions: Question[], index: number, stems: (question: Question) => string[]): number[] {
  const question = questions[index];
  if (!question) return [];
  const currentStems = stems(question);
  const key = currentStems.join("\u2029");
  return questions.flatMap((q, i) => q.setId === question.setId && (
    currentStems.length ? stems(q).join("\u2029") === key && JSON.stringify(q.stemDocs ?? []) === JSON.stringify(question.stemDocs ?? []) : i === index || (!stems(q).length && !q.parts.length && !question.parts.length)
  ) ? [i] : []);
}

/** One continuous question list; reveal the next complete set only when it is reached. */
export function sessionQuestionRows(session: Session, questions: Question[], activePart = "") {
  const groups = sessionSetGroups(session, questions);
  const visible = new Set(groups.slice(0, openedSetCount(session, groups)).flatMap((group) => group.indices));
  return questions.flatMap((question, index) => {
    if (!visible.has(index)) return [];
    const parts = answerParts(question);
    const selectedPart = parts.some((part) => part.label === activePart) ? activePart : parts[0]?.label;
    return parts.map((part) => ({
      index, part: part.label,
      label: `${index + 1}${part.label ? ` ${partLabel(part.label)}` : ""}`,
      current: index === session.index && part.label === selectedPart,
    }));
  });
}
