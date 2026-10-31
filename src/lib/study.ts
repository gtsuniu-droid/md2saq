import { db, getSettings } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { syncFromBank } from "./bank";
import { cloudConfigured, idToken } from "./firebase";
import { loadLibrary } from "./library";
import { belongsToAccount } from "./progressAccount";
import { setLabel } from "./sets";

/**
 * Study with friends: the host publishes a fixed list of questions under a six-digit code.
 * Anyone who enters the code sits the same questions in the same order, with the host's
 * time, and afterwards everyone's answers can be compared side by side.
 *
 * Codes, shared answers, the marks friends give each other and the comments all live in the
 * site's own store (netlify/lib/studyStore.ts), reached through /api/study: nothing here
 * waits on Firestore, whose daily read budget used to leave the page empty.
 */
export type { PeerMark, PeerPartMark, SharedAnswer, SharedAnswers, SharedPart, StudyComment, StudyParticipant, StudyQuestion, StudyRoomView, StudySession } from "./studyTypes";
import type { PeerPartMark, SharedAnswer, SharedPart, StudyQuestion, StudyRoomView, StudySession } from "./studyTypes";
export interface StudyOptions { mode: "practice" | "exam"; minutes?: number; readingSec?: number; totalSec?: number; presentations: string[] }
/** What this device remembers about a code it created or joined. */
export interface StudyRecord { code: string; questionIds: string[]; startedAt: number; role: "host" | "guest"; sessionId?: string; hostName: string; questionCount: number }

export const STUDY_DAYS = 7;
const META = "study:";

export const normaliseCode = (raw: string): string => raw.replace(/\D/g, "").slice(0, 6);
export const formatCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

export function newCode(random: () => number = Math.random): string {
  return String(100000 + Math.floor(random() * 900000));
}

async function displayName(): Promise<{ name: string; photo?: string }> {
  const s = await getSettings();
  const u = s.cloudUser;
  const name = s.social?.username || u?.name?.split(" ")[0] || "Student";
  const photo = u?.photo && /^https:\/\//.test(u.photo) ? u.photo.slice(0, 2000) : undefined;
  return { name: name.slice(0, 40), photo };
}

async function remember(record: StudyRecord): Promise<void> {
  await db.meta.put({ id: `${META}${record.code}`, value: JSON.stringify(record) });
}

export async function studyRecords(): Promise<StudyRecord[]> {
  const rows = await db.meta.where("id").startsWith(META).toArray();
  const out: StudyRecord[] = [];
  const stale: string[] = [];
  const cutoff = Date.now() - (STUDY_DAYS + 30) * 24 * 3600 * 1000;
  for (const r of rows) {
    if (r.id.startsWith(`${META}shared:`)) continue;
    try { const rec = JSON.parse(String(r.value)) as StudyRecord; if (rec.startedAt < cutoff) stale.push(rec.code); else out.push(rec); } catch { stale.push(r.id.slice(META.length)); }
  }
  // Codes long gone take their records and the copy of what was shared with them.
  if (stale.length) await db.meta.bulkDelete(stale.flatMap((code) => [`${META}${code}`, `${META}shared:${code}`])).catch(() => undefined);
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export async function studyRecord(code: string): Promise<StudyRecord | null> {
  return (await studyRecords()).find((r) => r.code === code) ?? null;
}

export async function attachSession(code: string, sessionId: string): Promise<void> {
  const r = await studyRecord(code);
  if (r) await remember({ ...r, sessionId });
}

/** The site's study endpoint, signed in: `path` is "" for the code itself or "/room", "/share", "/mark", "/comment", "/uncomment". */
async function studyApi(init?: RequestInit, path = "", query = ""): Promise<Response> {
  const token = await idToken().catch(() => null);
  if (!token) throw new Error("Sign in first.");
  return fetch(`/api/study${path}${query}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
}

/** A reply's JSON, or the plain sentence the server gave for refusing. */
async function replyOf<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? fallback);
  return body as T;
}

/** Publish the chosen questions under a fresh code. Every question must come from a published set. */
export async function createStudySession(questions: Question[], sets: QuestionSet[], options: StudyOptions): Promise<StudySession> {
  const { mode, presentations } = options;
  const minutes = options.minutes ?? 0;
  if (!cloudConfigured()) throw new Error("Study codes need the cloud, which is not configured on this site.");
  if (!questions.length) throw new Error("Choose some questions first.");
  if (questions.length > 60) throw new Error("Keep a study session to 60 questions.");
  const bySet = new Map(sets.map((s) => [s.id, s]));
  const list: StudyQuestion[] = questions.map((q) => {
    const set = bySet.get(q.setId);
    if (!set?.bankId) throw new Error("Only questions from published sets can be shared with a code.");
    return { bankId: set.bankId, order: q.order, text: (q.text || q.parts[0]?.text || "").slice(0, 400), marks: q.marks ?? (q.parts.length ? q.parts.reduce((t, p) => t + (p.marks ?? 0), 0) : undefined), setLabel: setLabel(set) };
  });
  const { name, photo } = await displayName();
  const timing = mode === "exam" ? { readingSec: options.readingSec ?? 0, totalSec: options.totalSec ?? 0 } : {};
  const res = await studyApi({ method: "POST", body: JSON.stringify({ create: { presentations: presentations.slice(0, 50), questions: list, mode, minutes, ...timing, hostName: name, ...(photo ? { photo } : {}) } }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not make a code. Try again.");
  const study = (await res.json()) as StudySession;
  await remember({ code: study.code, questionIds: questions.map((q) => q.id), startedAt: Date.now(), role: "host", hostName: name, questionCount: list.length });
  return study;
}

export async function fetchStudySession(raw: string): Promise<StudySession | null> {
  const code = normaliseCode(raw);
  if (code.length !== 6) throw new Error("A study code has six digits.");
  const res = await studyApi(undefined, "", `?code=${code}`);
  if (!res.ok && res.status !== 404) throw new Error("Could not look that code up. Try again in a moment.");
  const study = res.ok ? (await res.json()) as StudySession : null;
  if (!study) return null;
  if (study.expiresAt && Date.now() > study.expiresAt) throw new Error("That code has expired. Codes last seven days.");
  return study;
}

/** The local question ids for a study's questions, in order; throws when some set is not in the library. */
export async function resolveStudyQuestions(study: StudySession): Promise<string[]> {
  let library = await loadLibrary();
  const map = () => {
    const bankOfSet = new Map(library.sets.map((s) => [s.id, s.bankId]));
    return new Map(library.questions.flatMap((q) => { const b = bankOfSet.get(q.setId); return b ? [[`${b}#${q.order}`, q.id] as const] : []; }));
  };
  let byRef = map();
  if (study.questions.some((sq) => !byRef.has(`${sq.bankId}#${sq.order}`))) {
    await syncFromBank().catch(() => undefined);
    library = await loadLibrary();
    byRef = map();
  }
  const ids = study.questions.map((sq) => byRef.get(`${sq.bankId}#${sq.order}`));
  const missing = ids.filter((id) => !id).length;
  if (missing) throw new Error(`${missing} of these questions ${missing === 1 ? "is" : "are"} from a set that is no longer in the bank.`);
  return ids as string[];
}

/** Put this person on the code's list the moment the code is accepted, so everyone sees them arrive; the study as it now stands. */
export async function announceJoin(study: StudySession): Promise<StudySession> {
  const me = (await getSettings()).cloudUser?.uid;
  if (!me || study.participants.some((p) => p.uid === me)) return study;
  const { name, photo } = await displayName();
  const res = await studyApi({ method: "POST", body: JSON.stringify({ join: study.code, name, ...(photo ? { photo } : {}) }) });
  return res.ok ? (await res.json()) as StudySession : study;
}

/** Join: add this person to the list and remember the questions locally. */
export async function joinStudySession(study: StudySession): Promise<string[]> {
  const questionIds = await resolveStudyQuestions(study);
  const me = (await getSettings()).cloudUser?.uid;
  if (me && !study.participants.some((p) => p.uid === me)) {
    const { name, photo } = await displayName();
    await studyApi({ method: "POST", body: JSON.stringify({ join: study.code, name, ...(photo ? { photo } : {}) }) }).catch(() => undefined);
  }
  const existing = await studyRecord(study.code);
  await remember({ code: study.code, questionIds, startedAt: Date.now(), role: existing?.role ?? "guest", hostName: study.hostName, questionCount: study.questions.length, sessionId: existing?.sessionId });
  return questionIds;
}

/**
 * Push this person's latest submitted answers to the code's questions, with any self-marked
 * scores, and bring back the room as it now stands. Null when this device never sat the code,
 * or has nothing submitted for it yet.
 */
export async function shareMyAnswers(code: string): Promise<StudyRoomView | null> {
  const record = await studyRecord(code);
  if (!record) return null;
  const settings = await getSettings();
  const uid = settings.cloudUser?.uid;
  if (!uid) return null;
  const since = record.startedAt - 60_000;
  const answers: SharedAnswer[] = [];
  for (const [index, questionId] of record.questionIds.entries()) {
    const attempts = (await db.attempts.where("questionId").equals(questionId).toArray()).filter((a) => belongsToAccount(a, uid) && a.submittedAt !== undefined && a.startedAt >= since).sort((a, b) => b.submittedAt! - a.submittedAt!);
    const a = attempts[0];
    if (!a) continue;
    const mark = (await db.marks.where("attemptId").equals(a.id).toArray()).find((m) => belongsToAccount(m, uid));
    // Each part's formatted document comes along when it is small, so friends see the answer as it was written.
    const parts: SharedPart[] = a.answers.map((p) => ({ label: (p.label ?? "").slice(0, 10), text: (p.text ?? "").trim().slice(0, 4000), ...(p.doc && JSON.stringify(p.doc).length <= 60_000 ? { doc: p.doc } : {}) })).filter((p) => p.text || p.doc);
    const text = parts.map((p) => (p.label ? `(${p.label}) ` : "") + p.text).join("\n").slice(0, 4000);
    answers.push({ index, text, parts: parts.slice(0, 12), ...(mark ? { score: mark.score, maxScore: mark.maxScore } : {}) });
  }
  if (!answers.length) return null;
  const { name, photo } = await displayName();
  const body = JSON.stringify({ code, name, ...(photo ? { photo } : {}), answers });
  // Opening the page again with nothing new to say reads the room rather than writing the same answers over.
  const sentKey = `${META}shared:${code}`;
  if ((await db.meta.get(sentKey))?.value === body) return fetchRoom(code);
  const res = await studyApi({ method: "POST", body }, "/share");
  const room = await replyOf<StudyRoomView>(res, "Could not share your answers. Try again in a moment.");
  await db.meta.put({ id: sentKey, value: body });
  return room;
}

/** The code, everyone's shared answers, marks and comments; null when no code matches. */
export async function fetchRoom(raw: string): Promise<StudyRoomView | null> {
  const code = normaliseCode(raw);
  if (code.length !== 6) throw new Error("A study code has six digits.");
  const res = await studyApi(undefined, "/room", `?code=${code}`);
  if (res.status === 404) return null;
  return replyOf<StudyRoomView>(res, "Could not reach the study service. Try again in a moment.");
}

type Room = Pick<StudyRoomView, "marks" | "comments">;

/** Mark one person's answer to one question out of `maxScore`, part by part when the question has parts; null takes your mark away. */
export async function giveMark(code: string, index: number, targetUid: string, score: number | null, maxScore: number, parts?: PeerPartMark[]): Promise<Room> {
  const res = await studyApi({ method: "POST", body: JSON.stringify({ code, index, targetUid, score, maxScore, ...(parts ? { parts } : {}) }) }, "/mark");
  return replyOf<Room>(res, "Could not save that mark. Try again in a moment.");
}

/** Say something about one person's answer to one question. */
export async function postComment(code: string, index: number, targetUid: string, text: string): Promise<Room> {
  const body = text.trim().slice(0, 1000);
  if (!body) throw new Error("Write something first.");
  const { name, photo } = await displayName();
  const res = await studyApi({ method: "POST", body: JSON.stringify({ code, index, targetUid, text: body, name, ...(photo ? { photo } : {}) }) }, "/comment");
  return replyOf<Room>(res, "Could not post that. Try again in a moment.");
}

export async function deleteComment(code: string, id: string): Promise<Room> {
  const res = await studyApi({ method: "POST", body: JSON.stringify({ code, id }) }, "/uncomment");
  return replyOf<Room>(res, "Could not remove that comment.");
}
