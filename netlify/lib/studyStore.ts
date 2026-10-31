import { randomInt, randomUUID } from "node:crypto";
import { openNamedStore, type JsonStore } from "./store";
import type { PeerMark, PeerPartMark, SharedAnswer, SharedAnswers, SharedPart, StudyComment, StudyParticipant, StudyRoom, StudyRoomView, StudySession } from "../../src/lib/studyTypes";

/**
 * Study with friends, all in the site's own store, so nothing here waits on Firestore:
 *   codes/{code}          the code: its questions, timing and who joined
 *   shared/{code}/{uid}   one person's answers to those questions, with their self-marked scores
 *   room/{code}           the marks people gave each other's answers, and the comments
 * A code and everything under it lasts STUDY_DAYS; the limits match what a device can send.
 */
export const STUDY_DAYS = 7;
/** How long after a code expires its answers, marks and comments stay readable (and markable) before the store forgets them. */
export const KEEP_AFTER_EXPIRY_MS = 30 * 24 * 3600 * 1000;
/** The most a room reply may weigh; above it, formatted documents give way to plain text, largest share first. */
export const ROOM_BYTES = 3_500_000;
export const expired = (study: StudySession, now = Date.now()): boolean => !!study.expiresAt && now > study.expiresAt;
export const MAX_COMMENTS = 500;
/** The most a shared part's formatted document may weigh; larger ones travel as text. */
export const DOC_BYTES = 60_000;
const store = () => openNamedStore("study");
const key = (code: string) => `codes/${code}`;
const sharedKey = (code: string, uid: string) => `shared/${code}/${uid}`;
const roomKey = (code: string) => `room/${code}`;
const emptyRoom = (): StudyRoom => ({ marks: [], comments: [], updatedAt: 0 });

export type NewStudy = Pick<StudySession, "presentations" | "questions" | "mode" | "minutes" | "readingSec" | "totalSec"> & { hostName: string; photo?: string };

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const int = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** A posted study, checked; null when it would not pass. */
export function validStudy(b: unknown): NewStudy | null {
  if (!b || typeof b !== "object") return null;
  const s = b as Record<string, unknown>;
  const questions = s.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 60) return null;
  if (!questions.every((q) => q && typeof q === "object" && str(q.bankId, 200) && !!q.bankId && int(q.order, 1000) && str(q.text, 400) && str(q.setLabel, 300) && (q.marks === undefined || (typeof q.marks === "number" && q.marks >= 0 && q.marks <= 1000)))) return null;
  if (!Array.isArray(s.presentations) || s.presentations.length > 50 || !s.presentations.every((p) => str(p, 100))) return null;
  if (s.mode !== "practice" && s.mode !== "exam") return null;
  if (typeof s.minutes !== "number" || s.minutes < 0 || s.minutes > 600) return null;
  if ((s.readingSec !== undefined && !int(s.readingSec, 7200)) || (s.totalSec !== undefined && !int(s.totalSec, 36000))) return null;
  if (!str(s.hostName, 40) || !s.hostName.trim()) return null;
  return {
    presentations: s.presentations as string[], mode: s.mode, minutes: s.minutes,
    questions: questions.map((q) => ({ bankId: q.bankId, order: q.order, text: q.text, setLabel: q.setLabel, ...(q.marks !== undefined ? { marks: q.marks } : {}) })),
    ...(s.mode === "exam" ? { readingSec: (s.readingSec as number | undefined) ?? 0, totalSec: (s.totalSec as number | undefined) ?? 0 } : {}),
    hostName: s.hostName.trim(), ...(str(s.photo, 2000) && /^https:\/\//.test(s.photo) ? { photo: s.photo } : {}),
  };
}

/** Keep a new study under a fresh six-digit code; a code still in use (or kept and expired) is never reused. */
export async function createStudy(uid: string, s: NewStudy, now = Date.now()): Promise<StudySession> {
  const { hostName, photo, ...rest } = s;
  const host: StudyParticipant = { uid, name: hostName, ...(photo ? { photo } : {}) };
  for (let tries = 0; tries < 10; tries++) {
    const code = String(randomInt(100000, 1000000));
    const study: StudySession = { code, hostUid: uid, hostName, createdAt: now, expiresAt: now + STUDY_DAYS * 24 * 3600 * 1000, ...rest, participants: [host] };
    // Written only if no code of that number exists yet.
    if (await store().update<StudySession>(key(code), (cur) => cur ? null : study)) return study;
  }
  throw new Error("Could not find a free code. Try again.");
}

export async function readStudy(code: string, s: JsonStore = store(), now = Date.now()): Promise<StudySession | null> {
  const study = (await s.get(key(code), { type: "json" })) as StudySession | null;
  if (study && study.expiresAt && now > study.expiresAt + KEEP_AFTER_EXPIRY_MS) { await forgetStudy(code, s); return null; }
  return study;
}

/** Everything kept under a code: the code, everyone's answers and the room. */
export async function forgetStudy(code: string, s: JsonStore = store()): Promise<void> {
  const shared = await s.list(`shared/${code}/`);
  await Promise.all([s.delete(key(code)), s.delete(roomKey(code)), ...shared.map((k) => s.delete(k))]);
}

/** Add someone to a code's list of who joined (once, up to 50). */
export async function joinStudy(code: string, who: StudyParticipant, s: JsonStore = store(), now = Date.now()): Promise<StudySession | null> {
  return s.update<StudySession>(key(code), (cur) => {
    if (!cur || cur.participants.some((p) => p.uid === who.uid) || cur.participants.length >= 50) return null;
    if (expired(cur, now)) throw new Error("This code has expired. Friends can join and share for seven days.");
    return { ...cur, participants: [...cur.participants, who] };
  }).then(async (st) => st ?? readStudy(code, s));
}

/** Who someone is, as a device sends it: a short name and perhaps a Google picture. */
export function validWho(b: Record<string, unknown>): { name: string; photo?: string } | null {
  if (!str(b.name, 40) || !b.name.trim()) return null;
  return { name: b.name.trim(), ...(str(b.photo, 2000) && /^https:\/\//.test(b.photo) ? { photo: b.photo } : {}) };
}

/** A device's shared answers, checked; null when they would not pass. */
export function validShared(b: unknown): SharedAnswer[] | null {
  if (!Array.isArray(b) || b.length > 60) return null;
  const out: SharedAnswer[] = [];
  for (const a of b) {
    if (!a || typeof a !== "object") return null;
    const x = a as Record<string, unknown>;
    if (!int(x.index, 59) || !str(x.text, 4000)) return null;
    if (x.parts !== undefined && !(Array.isArray(x.parts) && x.parts.length <= 12 && x.parts.every((p) => p && typeof p === "object" && str((p as Record<string, unknown>).label, 10) && str((p as Record<string, unknown>).text, 4000)))) return null;
    const score = typeof x.score === "number" && x.score >= 0 && x.score <= 1000 ? x.score : undefined;
    const maxScore = typeof x.maxScore === "number" && x.maxScore >= 0 && x.maxScore <= 1000 ? x.maxScore : undefined;
    // A part's formatted document comes along when it is small; a picture-heavy one falls back to its text.
    const parts = (x.parts as SharedPart[] | undefined)?.map((p) => ({ label: p.label, text: p.text, ...(p.doc && typeof p.doc === "object" && JSON.stringify(p.doc).length <= DOC_BYTES ? { doc: p.doc } : {}) }));
    out.push({ index: x.index, text: x.text, ...(parts ? { parts } : {}), ...(score !== undefined ? { score } : {}), ...(maxScore !== undefined ? { maxScore } : {}) });
  }
  return out;
}

/** Keep one person's answers under the code, and count them among those who joined. Null when there is no such code; throws once the code has expired. */
export async function shareAnswers(code: string, uid: string, who: { name: string; photo?: string }, answers: SharedAnswer[], now = Date.now(), s: JsonStore = store()): Promise<SharedAnswers | null> {
  const study = await readStudy(code, s);
  if (!study) return null;
  if (expired(study, now)) throw new Error("This code has expired. Friends can join and share for seven days.");
  const shared: SharedAnswers = { uid, ...who, answers, sharedAt: now };
  await s.setJSON(sharedKey(code, uid), shared);
  if (!study.participants.some((p) => p.uid === uid)) await joinStudy(code, { uid, ...who }, s);
  return shared;
}

/** The code, everyone's shared answers and the room, for the marking page. Null when there is no such code. */
export async function readRoom(code: string, s: JsonStore = store()): Promise<StudyRoomView | null> {
  const study = await readStudy(code, s);
  if (!study) return null;
  const [keys, room] = await Promise.all([s.list(`shared/${code}/`), s.get(roomKey(code), { type: "json" }) as Promise<StudyRoom | null>]);
  const shared = (await Promise.all(keys.map((k) => s.get(k, { type: "json" }) as Promise<SharedAnswers | null>))).filter((x): x is SharedAnswers => !!x && Array.isArray(x.answers));
  shared.sort((a, b) => a.sharedAt - b.sharedAt);
  return { study, shared: fitShared(shared), marks: room?.marks ?? [], comments: room?.comments ?? [] };
}

/** Everyone's answers within one reply: while they weigh too much, the heaviest share loses its formatted documents and keeps its text. */
export function fitShared(shared: SharedAnswers[], limit = ROOM_BYTES): SharedAnswers[] {
  const out = shared.map((x) => ({ ...x }));
  const weight = (x: SharedAnswers) => JSON.stringify(x).length;
  let total = out.reduce((n, x) => n + weight(x), 0);
  while (total > limit) {
    const heavy = out.filter((x) => x.answers.some((a) => a.parts?.some((p) => p.doc))).sort((a, b) => weight(b) - weight(a))[0];
    if (!heavy) break;
    const before = weight(heavy);
    heavy.answers = heavy.answers.map((a) => (a.parts ? { ...a, parts: a.parts.map(({ doc: _d, ...p }) => { void _d; return p; }) } : a));
    total -= before - weight(heavy);
  }
  return out;
}

/** Whether a mark or comment points at something in the room: a question the code has, and a person who joined or shared. */
export async function inRoom(study: StudySession, code: string, index: number, targetUid: string, s: JsonStore = store()): Promise<boolean> {
  if (index >= study.questions.length) return false;
  if (study.participants.some((p) => p.uid === targetUid)) return true;
  return (await s.list(`shared/${code}/`)).includes(sharedKey(code, targetUid));
}

const sameMark = (m: PeerMark, index: number, targetUid: string, by: string) => m.index === index && m.targetUid === targetUid && m.by === by;

/** Per-part marks as a device sends them, checked; undefined when absent, null when they would not pass. */
export function validPartMarks(b: unknown): PeerPartMark[] | null | undefined {
  if (b === undefined) return undefined;
  if (!Array.isArray(b) || b.length > 12) return null;
  const out: PeerPartMark[] = [];
  for (const p of b) {
    if (!p || typeof p !== "object") return null;
    const x = p as Record<string, unknown>;
    if (!str(x.label, 10) || typeof x.score !== "number" || typeof x.maxScore !== "number" || x.score < 0 || x.maxScore < 0 || x.score > 1000 || x.maxScore > 1000) return null;
    if (!Array.isArray(x.pointsHit) || x.pointsHit.length > 100 || !x.pointsHit.every((i) => int(i, 10_000))) return null;
    out.push({ label: x.label, score: x.score, maxScore: x.maxScore, pointsHit: x.pointsHit as number[] });
  }
  return out;
}

/** Mark someone's answer to one question; a null score takes the marker's mark away. Null when there is no such code. */
export async function giveMark(code: string, by: string, mark: { index: number; targetUid: string; score: number | null; maxScore: number; parts?: PeerPartMark[] }, now = Date.now(), s: JsonStore = store()): Promise<StudyRoom | null> {
  const study = await readStudy(code, s);
  if (!study) return null;
  if (!(await inRoom(study, code, mark.index, mark.targetUid, s))) throw new Error("That answer is not in this session.");
  return s.update<StudyRoom>(roomKey(code), (cur) => {
    const room = cur ?? emptyRoom();
    const marks = room.marks.filter((m) => !sameMark(m, mark.index, mark.targetUid, by));
    if (mark.score !== null) marks.push({ index: mark.index, targetUid: mark.targetUid, by, score: mark.score, maxScore: mark.maxScore, ...(mark.parts ? { parts: mark.parts } : {}), at: now });
    return { ...room, marks, updatedAt: now };
  });
}

/** Say something about one person's answer. Null when there is no such code; throws when the room is full. */
export async function addComment(code: string, who: StudyParticipant, c: { index: number; targetUid: string; text: string }, now = Date.now(), s: JsonStore = store()): Promise<StudyRoom | null> {
  const study = await readStudy(code, s);
  if (!study) return null;
  if (!(await inRoom(study, code, c.index, c.targetUid, s))) throw new Error("That answer is not in this session.");
  const comment: StudyComment = { id: randomUUID(), uid: who.uid, name: who.name, ...(who.photo ? { photo: who.photo } : {}), index: c.index, targetUid: c.targetUid, text: c.text, createdAt: now };
  return s.update<StudyRoom>(roomKey(code), (cur) => {
    const room = cur ?? emptyRoom();
    if (room.comments.length >= MAX_COMMENTS) throw new Error("This session has all the comments it can hold.");
    return { ...room, comments: [...room.comments, comment], updatedAt: now };
  });
}

/** Take a comment back: its writer may, and so may the host. Null when there is no such code. */
export async function removeComment(code: string, uid: string, id: string, now = Date.now(), s: JsonStore = store()): Promise<StudyRoom | null> {
  const study = await readStudy(code, s);
  if (!study) return null;
  return s.update<StudyRoom>(roomKey(code), (cur) => {
    const room = cur ?? emptyRoom();
    const comments = room.comments.filter((c) => !(c.id === id && (c.uid === uid || study.hostUid === uid)));
    return comments.length === room.comments.length ? null : { ...room, comments, updatedAt: now };
  }).then((r) => r ?? ((s.get(roomKey(code), { type: "json" }) as Promise<StudyRoom | null>).then((x) => x ?? emptyRoom())));
}
