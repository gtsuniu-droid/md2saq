import { hasAnswerContent } from "./answerContent";

/**
 * An attempt with nothing written in any part: a set clicked through rather than done. It
 * counts for nothing on the board, and the paper offers to skip it rather than submit it.
 */
export const isBlankAttempt = (a: { answers: { text?: string; doc?: unknown }[] }): boolean =>
  a.answers.every((x) => !hasAnswerContent(x));
