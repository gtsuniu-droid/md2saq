import type { Question } from "../data/types";
import { hasModelAnswer } from "./modelAnswer";

export interface SharedStemGroup {
  id: string;
  sourceQuestionId: string;
  stemIndex: number;
  text: string;
  doc: unknown;
  questionIds: string[];
  questionNumbers: number[];
}
export type SharedStemMembership = Pick<SharedStemGroup, "stemIndex" | "questionIds">;

function sameStem(a: Question, b: Question, index: number, establishedQuestionIds: string[] = []): boolean {
  return a.setId === b.setId && a.stems?.[index] !== undefined && b.stems?.[index] === a.stems[index]
    && (a.id === b.id || !!a.stems[index].trim() || hasModelAnswer({ modelAnswerDoc: a.stemDocs?.[index] })
      || establishedQuestionIds.includes(a.id) && establishedQuestionIds.includes(b.id))
    && JSON.stringify(a.stemDocs?.[index] ?? null) === JSON.stringify(b.stemDocs?.[index] ?? null);
}

/** Stage position and rich content both matter: identical text may describe different cases. */
export function sharedStemGroups(questions: Question[], established: SharedStemMembership[] = []): SharedStemGroup[] {
  const groups: SharedStemGroup[] = [];
  questions.forEach((question, index) => {
    (question.stems ?? []).forEach((text, stemIndex) => {
      const existing = groups.find((group) => {
        const membership = established.find((item) => item.stemIndex === stemIndex && item.questionIds.includes(group.sourceQuestionId) && item.questionIds.includes(question.id));
        return group.stemIndex === stemIndex && sameStem(questions.find((q) => q.id === group.sourceQuestionId)!, question, stemIndex, membership?.questionIds);
      });
      if (existing) {
        existing.questionIds.push(question.id);
        existing.questionNumbers.push(index + 1);
      } else {
        groups.push({
          id: `stem-${question.id}-${stemIndex}`, sourceQuestionId: question.id, stemIndex,
          text, doc: question.stemDocs?.[stemIndex] ?? null,
          questionIds: [question.id], questionNumbers: [index + 1],
        });
      }
    });
  });
  return groups;
}

/** Update all exact-sharing siblings, including questions before the selected question. */
export function updateSharedStem<T extends Question>(questions: T[], sourceQuestionId: string, stemIndex: number, text: string, doc: unknown, establishedQuestionIds?: string[]): T[] {
  const source = questions.find((question) => question.id === sourceQuestionId);
  if (!source || source.stems?.[stemIndex] === undefined) return questions;
  return questions.map((question) => sameStem(source, question, stemIndex, establishedQuestionIds) ? {
    ...question,
    stems: question.stems!.map((value, index) => index === stemIndex ? text : value),
    stemDocs: question.stems!.map((_, index) => index === stemIndex ? doc ?? null : question.stemDocs?.[index] ?? null),
  } : question);
}
