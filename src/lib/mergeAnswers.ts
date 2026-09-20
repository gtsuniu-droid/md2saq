import { db } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { applyAnswers, type ParsedAnswers } from "./caseBank";

export interface AnswerMatch {
  answers: ParsedAnswers;
  /** Best local set, or null when nothing fits; the UI lets the person choose. */
  setId: string | null;
  reason: "case number" | "title" | "none";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pair each answer guide with a local set: by "Case NN" in the set's title, then by title text. */
export function matchAnswers(answers: ParsedAnswers[], sets: QuestionSet[]): AnswerMatch[] {
  return answers.map((a) => {
    const num = String(a.number).padStart(2, "0");
    const byNumber = sets.filter((s) => new RegExp(`\\b(?:case|set|paper)\\s*0*${a.number}\\b`, "i").test(s.source ?? "") || (s.source ?? "").startsWith(`Case ${num}`));
    if (byNumber.length === 1) return { answers: a, setId: byNumber[0].id, reason: "case number" };
    const byTitle = sets.filter((s) => norm(s.source ?? "").includes(norm(a.title)) || norm(a.title).includes(norm((s.source ?? "").replace(/^case\s*\d+:\s*/i, ""))) && a.title.length > 8);
    if (byTitle.length === 1) return { answers: a, setId: byTitle[0].id, reason: "title" };
    if (byNumber.length > 1) return { answers: a, setId: byNumber[0].id, reason: "case number" };
    return { answers: a, setId: null, reason: "none" };
  });
}

/** Write the answers into the set's questions, in question order. Returns how many questions gained answers. */
export async function mergeAnswersIntoSet(setId: string, answers: ParsedAnswers): Promise<number> {
  const questions = (await db.questions.where("setId").equals(setId).sortBy("order")) as Question[];
  const n = applyAnswers(questions, answers.byQuestion);
  await db.transaction("rw", db.sets, db.questions, async () => {
    await db.questions.bulkPut(questions);
    await db.sets.update(setId, {
      markingNotes: answers.markingNotes,
      debrief: answers.debrief,
      updatedAt: Date.now(),
      dirty: true,
    });
  });
  return n;
}
