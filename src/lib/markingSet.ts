import type { Attempt, Mark, PartMark, Question } from "../data/types";
import { answerParts, stemsOf } from "./questions";

export interface MarkingDraft {
  confidence?: number;
  parts: PartMark[];
  errorTags: Mark["errorTags"];
  learningPoint: string;
  notes: string;
  reviewLater: boolean;
  lookedAtAnswer: boolean;
  /** Parts whose score has been given in this draft (typed, or filled from suggested marks), as against left at nought. */
  scored?: string[];
}

/** Match by part label so editing a question cannot shift a score onto another part. */
export function markingDraft(question: Question, attempt: Attempt, mark?: Mark): MarkingDraft {
  return {
    confidence: attempt.confidence,
    parts: answerParts(question).map((p) => mark?.parts.find((m) => m.label === p.label) ?? { label: p.label, score: 0, maxScore: p.marks ?? 0, pointsHit: [] }),
    errorTags: mark?.errorTags ?? [],
    learningPoint: mark?.learningPoint ?? "",
    notes: mark?.notes ?? "",
    reviewLater: mark?.reviewLater ?? false,
    lookedAtAnswer: mark?.lookedAtAnswer ?? false,
  };
}

export function reconcileMarkingParts(draft: MarkingDraft, question: Question): MarkingDraft {
  const parts = answerParts(question).map((p) => draft.parts.find((m) => m.label === p.label) ?? { label: p.label, score: 0, maxScore: p.marks ?? 0, pointsHit: [] });
  return { ...draft, parts };
}

/** Show a shared stem once, and show only the new details of cumulative case stages. */
export function introducedStems(question: Question, previous?: Question) {
  const stems = stemsOf(question);
  const before = previous?.setId === question.setId ? stemsOf(previous) : [];
  const prefix = before.length <= stems.length && before.every((text, i) => text === stems[i] && JSON.stringify(previous?.stemDocs?.[i] ?? null) === JSON.stringify(question.stemDocs?.[i] ?? null));
  return stems.flatMap((text, index) => prefix && index < before.length ? [] : [{ text, index }]);
}
