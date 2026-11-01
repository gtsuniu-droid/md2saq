import type { Question } from "../data/types";
import { introducedStems } from "./markingSet";
import { answerParts } from "./questions";
import { modelOf, partId, type MarkingQuestion, type SetForMarking, type SuggestedMarks } from "./setForMarking";
import { formatCode } from "./study";
import { answerAt, type RoomPerson } from "./studyRoom";
import type { PeerPartMark, StudyRoomView } from "./studyTypes";

/**
 * Mark together, marked by the student's assistant: each friend's shared answers are laid out
 * as a set for marking, kept in the student's store like their own sets, and the marks that come
 * back become the student's marks on each friend's answers in the room. Pure, so it is tested
 * without the room.
 */

/** The store key of one friend's answers in a study session. */
export const roomSetKey = (code: string, uid: string): string => `study:${code}:${uid}`;

/** A friend's answer to one question, named so the marks sent back find it again. */
export const roomAttemptId = (uid: string, index: number): string => `${uid}#${index}`;

const parseRoomAttemptId = (id: string): { uid: string; index: number } | null => {
  const at = id.lastIndexOf("#");
  const index = Number(id.slice(at + 1));
  return at > 0 && Number.isInteger(index) ? { uid: id.slice(0, at), index } : null;
};

/**
 * One set for marking per friend who shared answers: every question they answered, with the case
 * and model answers when the set is in this library. The signed-in student's own answers are left
 * out; their own set's marking page marks those.
 */
export function buildRoomSetsForMarking(room: StudyRoomView, people: RoomPerson[], local: (Question | undefined)[], me: string): SetForMarking[] {
  const code = room.study.code;
  return people.filter((p) => p.uid !== me && p.shared?.answers.length).map((person) => {
    const questions: MarkingQuestion[] = [];
    let previous: Question | undefined;
    room.study.questions.forEach((sq, index) => {
      const lq = local[index];
      const answer = answerAt(person, index);
      if (!answer) { previous = lq ?? previous; return; }
      const number = index + 1;
      const sharedPart = (label: string) => answer.parts?.find((p) => p.label === label);
      const parts = lq
        ? answerParts(lq).map((p) => ({ id: partId(number, p.label), label: p.label, marks: p.marks ?? 0, prompt: p.text.trim(), answer: (sharedPart(p.label)?.text ?? (lq.parts.length ? "" : answer.text)).trim(), model: modelOf(p) }))
        : (answer.parts && answer.parts.length > 1 ? answer.parts : [{ label: "", text: answer.text }]).map((sp) => ({ id: partId(number, sp.label), label: sp.label, marks: answer.parts && answer.parts.length > 1 ? 0 : sq.marks ?? 0, prompt: "", answer: sp.text.trim(), model: "" }));
      const whole = lq && lq.parts.length > 0 && !parts.some((p) => p.model) ? modelOf(lq) : "";
      questions.push({ attemptId: roomAttemptId(person.uid, index), number, stems: lq ? introducedStems(lq, previous).map((s) => s.text.trim()) : [], text: (lq?.text ?? sq.text).trim(), model: whole, parts });
      previous = lq ?? previous;
    });
    return { key: roomSetKey(code, person.uid), name: `${person.name}, Mark together ${formatCode(code)}`, at: person.shared!.sharedAt, questions };
  });
}

export interface RoomSuggestion { index: number; targetUid: string; score: number; maxScore: number; parts: PeerPartMark[]; /** The assistant's feedback by part label, for the student to read or post. */ feedback: Record<string, string> }

/**
 * Marks sent back for a friend's set, as the student's marks on that friend's answers: one per
 * question with a suggestion, every part of it (a part the assistant skipped is left at zero for
 * the student to fill in), scores capped at the part's marks.
 */
export function roomSuggestionsToMarks(set: SetForMarking, marks: SuggestedMarks): RoomSuggestion[] {
  const out: RoomSuggestion[] = [];
  for (const q of set.questions) {
    const suggested = marks.parts.filter((p) => p.attemptId === q.attemptId);
    const ref = parseRoomAttemptId(q.attemptId);
    if (!suggested.length || !ref) continue;
    const parts: PeerPartMark[] = q.parts.map((p) => {
      const s = suggested.find((x) => x.label === p.label);
      const score = s ? Math.max(0, p.marks ? Math.min(s.score, p.marks) : s.score) : 0;
      // A part whose marks are unknown (the set is not in this library) is out of what it was given.
      return { label: p.label, score, maxScore: p.marks || score, pointsHit: [] };
    });
    const feedback = Object.fromEntries(suggested.filter((s) => s.feedback.trim()).map((s) => [s.label, s.feedback.trim()]));
    out.push({ index: ref.index, targetUid: ref.uid, score: parts.reduce((t, p) => t + p.score, 0), maxScore: parts.reduce((t, p) => t + p.maxScore, 0), parts, feedback });
  }
  return out;
}

/** What to say to an assistant with the connector so it marks every friend's answers and sends them back to Mark together. */
export function markTogetherPrompt(code: string, sets: SetForMarking[]): string {
  const list = sets.map((s) => `"${s.key}" (${s.name.split(",")[0]})`).join(", ");
  return [
    `Using the SAQ Practice connector: mark my friends' answers from our study session ${formatCode(code)}.`,
    `There ${sets.length === 1 ? "is one set" : `are ${sets.length} sets`}, one per friend: ${list}. For each in turn, read it with getMyAnswers (set: its id) and mark every part strictly, as an expert, evidence-based consultant doctor examining finals would, following its howToMark with your own clinical reasoning: marks for points the model answer credits, or an expert consultant would accept as their clinical equivalent on current evidence, stated specifically; nothing for vague points, for items beyond the number asked, or for points wrong for this patient; no benefit of the doubt.`,
    "Quote the passages you comment on and end each part's feedback with one high-yield clinical pearl as a plain sentence; then send that friend's marks with markMyAnswers (set: the same id) before moving to the next.",
    "I will check them on the Mark together page, where they become my marks on each friend's answers.",
  ].join("\n");
}
