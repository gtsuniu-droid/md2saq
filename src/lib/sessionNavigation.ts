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

/** Navigating backwards never hides sets already opened. */
export function sessionAtQuestion(session: Session, questions: Question[], index: number, activePart = ""): Session {
  const next = { ...session, index: Math.max(0, Math.min(index, session.questionIds.length - 1)), activePart };
  if (session.studyUnit === "sets") {
    const groups = sessionSetGroups(session, questions);
    next.openedSetCount = openedSetCount(next, groups);
  }
  return next;
}

/**
 * The questions shown together: every question of this set whose case information is the
 * opening of the current question's, so earlier questions stay on the page as more is
 * revealed, and nothing from a later reveal shows early. Separate cases with identical or
 * empty stems never merge.
 */
export function paperQuestionGroup(questions: Question[], index: number, stems: (question: Question) => string[]): number[] {
  const question = questions[index];
  if (!question) return [];
  const currentStems = stems(question);
  const currentDocs = question.stemDocs ?? [];
  return questions.flatMap((q, i) => {
    if (q.setId !== question.setId) return [];
    if (!currentStems.length) return i === index || (!stems(q).length && !q.parts.length && !question.parts.length) ? [i] : [];
    const qs = stems(q);
    const opening = qs.length > 0 && qs.length <= currentStems.length && qs.every((text, k) => text === currentStems[k])
      && JSON.stringify((q.stemDocs ?? []).slice(0, qs.length)) === JSON.stringify(currentDocs.slice(0, qs.length));
    return opening ? [i] : [];
  });
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
