import type { PeerMark, SharedAnswer, SharedAnswers, StudyComment, StudySession } from "./studyTypes";

/**
 * The marking page's arithmetic: who is in the room, what each answer was given, and how
 * far the marking has got. Pure, so the page stays a view.
 */
export interface RoomPerson { uid: string; name: string; photo?: string; shared?: SharedAnswers }

/** Everyone who joined or shared, the signed-in person first, then by name. */
export function peopleOf(study: StudySession, shared: SharedAnswers[], me?: string): RoomPerson[] {
  const byUid = new Map<string, RoomPerson>(study.participants.map((p) => [p.uid, { uid: p.uid, name: p.name, photo: p.photo }]));
  for (const s of shared) {
    const cur = byUid.get(s.uid);
    byUid.set(s.uid, { uid: s.uid, name: cur?.name ?? s.name, photo: cur?.photo ?? s.photo, shared: s });
  }
  return [...byUid.values()].sort((a, b) => (a.uid === me ? -1 : b.uid === me ? 1 : a.name.localeCompare(b.name)));
}

export const answerAt = (p: RoomPerson, index: number): SharedAnswer | undefined => p.shared?.answers.find((a) => a.index === index);

/** The marks friends gave one answer, newest last. */
export const marksOn = (marks: PeerMark[], index: number, targetUid: string): PeerMark[] => marks.filter((m) => m.index === index && m.targetUid === targetUid).sort((a, b) => a.at - b.at);

export const commentsOn = (comments: StudyComment[], index: number, targetUid: string): StudyComment[] => comments.filter((c) => c.index === index && c.targetUid === targetUid).sort((a, b) => a.createdAt - b.createdAt);

/** The mean of the marks given, to one decimal place; null when there are none. */
export function average(marks: Pick<PeerMark, "score">[]): number | null {
  if (!marks.length) return null;
  return Math.round((marks.reduce((t, m) => t + m.score, 0) / marks.length) * 10) / 10;
}

/** How many marks an answer is out of: the question's, else what its owner marked it out of, else ten. */
export function maxFor(question: { marks?: number } | undefined, answer: SharedAnswer | undefined): number {
  const m = question?.marks ?? answer?.maxScore;
  return m && m > 0 ? m : 10;
}

/** A question counts as marked by `me` once every friend's shared answer there has my mark. */
export function markedByMe(people: RoomPerson[], marks: PeerMark[], index: number, me: string): boolean {
  const others = people.filter((p) => p.uid !== me && answerAt(p, index));
  return others.length > 0 && others.every((p) => marks.some((m) => m.index === index && m.targetUid === p.uid && m.by === me));
}
