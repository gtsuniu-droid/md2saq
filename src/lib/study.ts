import { db, getSettings } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { syncFromBank } from "./bank";
import { cloudConfigured, communityServices, idToken } from "./firebase";
import { loadLibrary } from "./library";
import { belongsToAccount } from "./progressAccount";
import { setLabel } from "./sets";

/**
 * Study with friends: the host publishes a fixed list of questions under a six-digit code.
 * Anyone who enters the code sits the same questions in the same order, with the host's
 * time, and afterwards everyone's answers can be compared side by side.
 *
 * The code itself (making it, looking it up, joining) lives in the site's own store, so it
 * works whatever Firestore's daily read budget says. A copy is written to Firestore too, which
 * the shared answers and comments under the code still use.
 */
export type { StudyParticipant, StudyQuestion, StudySession } from "./studyTypes";
import type { StudyParticipant, StudyQuestion, StudySession } from "./studyTypes";
export interface StudyOptions { mode: "practice" | "exam"; minutes?: number; readingSec?: number; totalSec?: number; presentations: string[] }
export interface SharedAnswer { index: number; text: string; score?: number; maxScore?: number }
export interface SharedAnswers { uid: string; name: string; photo?: string; answers: SharedAnswer[]; sharedAt: number }
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
  for (const r of rows) { try { out.push(JSON.parse(String(r.value)) as StudyRecord); } catch { /* damaged */ } }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export async function studyRecord(code: string): Promise<StudyRecord | null> {
  return (await studyRecords()).find((r) => r.code === code) ?? null;
}

export async function attachSession(code: string, sessionId: string): Promise<void> {
  const r = await studyRecord(code);
  if (r) await remember({ ...r, sessionId });
}

/** The site's study code endpoint, signed in. */
async function studyApi(init?: RequestInit, query = ""): Promise<Response> {
  const token = await idToken().catch(() => null);
  if (!token) throw new Error("Sign in first.");
  return fetch(`/api/study${query}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
}

/** Firestore stalls rather than failing when its daily budget is spent: give up after a while. */
const withinSeconds = <T,>(p: Promise<T>, seconds: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Could not reach the study service. Try again in a moment.")), seconds * 1000))]);

/** The Firestore copy of a code, for the shared answers and comments under it. Best effort. */
async function mirror(study: StudySession): Promise<void> {
  const { firestore } = await communityServices();
  const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
  const { code, hostUid, hostName, expiresAt, presentations, questions, mode, minutes, readingSec, totalSec, participants } = study;
  await setDoc(doc(firestore, "studySessions", code), { code, hostUid, hostName, createdAt: serverTimestamp(), expiresAt, presentations, questions, mode, minutes, ...(mode === "exam" ? { readingSec: readingSec ?? 0, totalSec: totalSec ?? 0 } : {}), participants });
}

function fromDoc(code: string, v: Record<string, unknown>): StudySession {
  const at = (x: unknown) => (x as { toMillis?: () => number } | undefined)?.toMillis?.() ?? (typeof x === "number" ? x : 0);
  return {
    code,
    hostUid: String(v.hostUid ?? ""), hostName: String(v.hostName ?? "Host"),
    createdAt: at(v.createdAt), expiresAt: typeof v.expiresAt === "number" ? v.expiresAt : 0,
    presentations: Array.isArray(v.presentations) ? (v.presentations as string[]) : [],
    questions: Array.isArray(v.questions) ? (v.questions as StudyQuestion[]) : [],
    mode: v.mode === "exam" ? "exam" : "practice",
    minutes: typeof v.minutes === "number" ? v.minutes : 0,
    readingSec: typeof v.readingSec === "number" ? v.readingSec : undefined,
    totalSec: typeof v.totalSec === "number" ? v.totalSec : undefined,
    participants: Array.isArray(v.participants) ? (v.participants as StudyParticipant[]) : [],
  };
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
  void mirror(study).catch(() => undefined);
  return study;
}

export async function fetchStudySession(raw: string): Promise<StudySession | null> {
  const code = normaliseCode(raw);
  if (code.length !== 6) throw new Error("A study code has six digits.");
  const res = await studyApi(undefined, `?code=${code}`);
  if (!res.ok && res.status !== 404) throw new Error("Could not look that code up. Try again in a moment.");
  let study = res.ok ? (await res.json()) as StudySession : null;
  if (!study) {
    // Codes made before they moved to the site's own store are only in Firestore.
    const { firestore } = await communityServices();
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await withinSeconds(getDoc(doc(firestore, "studySessions", code)), 8);
    if (!snap.exists()) return null;
    study = fromDoc(code, snap.data() as Record<string, unknown>);
  }
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

/** Join: add this person to the list and remember the questions locally. */
export async function joinStudySession(study: StudySession): Promise<string[]> {
  const questionIds = await resolveStudyQuestions(study);
  const { firestore, auth } = await communityServices();
  const me = auth.currentUser!;
  if (!study.participants.some((p) => p.uid === me.uid)) {
    const { name, photo } = await displayName();
    const who = { uid: me.uid, name, ...(photo ? { photo } : {}) };
    await studyApi({ method: "POST", body: JSON.stringify({ join: study.code, ...who }) }).catch(() => undefined);
    // The Firestore copy's list too, which the shared answers under the code go by. Best effort.
    void import("firebase/firestore").then(({ arrayUnion, doc, updateDoc }) => updateDoc(doc(firestore, "studySessions", study.code), { participants: arrayUnion(who) })).catch(() => undefined);
  }
  const existing = await studyRecord(study.code);
  await remember({ code: study.code, questionIds, startedAt: Date.now(), role: existing?.role ?? "guest", hostName: study.hostName, questionCount: study.questions.length, sessionId: existing?.sessionId });
  return questionIds;
}

/** Push this person's latest submitted answers (and self-marked scores) for the code's questions. */
export async function shareMyAnswers(code: string): Promise<SharedAnswers | null> {
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
    const text = a.answers.map((p) => (p.label ? `(${p.label}) ` : "") + (p.text ?? "").trim()).filter((t) => t.trim()).join("\n").slice(0, 4000);
    answers.push({ index, text, ...(mark ? { score: mark.score, maxScore: mark.maxScore } : {}) });
  }
  if (!answers.length) return null;
  const { firestore } = await communityServices();
  const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
  const { name, photo } = await displayName();
  const body = { uid, name, ...(photo ? { photo } : {}), answers, sharedAt: serverTimestamp() };
  await setDoc(doc(firestore, "studySessions", code, "answers", uid), body);
  return { uid, name, photo, answers, sharedAt: Date.now() };
}

export interface StudyComment { id: string; uid: string; name: string; photo?: string; index: number; targetUid: string; text: string; createdAt: number }

/** Say something about one person's answer to one question. */
export async function postComment(code: string, index: number, targetUid: string, text: string): Promise<void> {
  const body = text.trim().slice(0, 1000);
  if (!body) return;
  const settings = await getSettings();
  const uid = settings.cloudUser?.uid;
  if (!uid) throw new Error("Sign in first.");
  const { firestore } = await communityServices();
  const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
  const { name, photo } = await displayName();
  await addDoc(collection(firestore, "studySessions", code, "comments"), { uid, name, ...(photo ? { photo } : {}), index, targetUid, text: body, createdAt: serverTimestamp() });
}

export async function deleteComment(code: string, id: string): Promise<void> {
  const { firestore } = await communityServices();
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(firestore, "studySessions", code, "comments", id));
}

/** Every comment in a session, live, oldest first. Resolves the unsubscribe function. */
export async function subscribeComments(code: string, cb: (rows: StudyComment[]) => void, onError: (message: string) => void): Promise<() => void> {
  const { firestore } = await communityServices();
  const { collection, limit, onSnapshot, query } = await import("firebase/firestore");
  return onSnapshot(query(collection(firestore, "studySessions", code, "comments"), limit(500)), (snap) => {
    cb(snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>; const at = v.createdAt as { toMillis?: () => number } | null | undefined;
      return { id: d.id, uid: String(v.uid ?? ""), name: String(v.name ?? "Student"), photo: typeof v.photo === "string" ? v.photo : undefined, index: typeof v.index === "number" ? v.index : -1, targetUid: String(v.targetUid ?? ""), text: String(v.text ?? ""), createdAt: at?.toMillis?.() ?? Date.now() };
    }).sort((a, b) => a.createdAt - b.createdAt));
  }, (e) => onError(e.message));
}

/** Everyone's shared answers for a code, live. Resolves the unsubscribe function. */
export async function subscribeSharedAnswers(code: string, cb: (rows: SharedAnswers[]) => void, onError: (message: string) => void): Promise<() => void> {
  const { firestore } = await communityServices();
  const { collection, limit, onSnapshot, query } = await import("firebase/firestore");
  return onSnapshot(query(collection(firestore, "studySessions", code, "answers"), limit(50)), (snap) => {
    cb(snap.docs.map((d) => { const v = d.data() as Record<string, unknown>; const at = v.sharedAt as { toMillis?: () => number } | undefined; return { uid: d.id, name: String(v.name ?? "Student"), photo: typeof v.photo === "string" ? v.photo : undefined, answers: Array.isArray(v.answers) ? (v.answers as SharedAnswer[]) : [], sharedAt: at?.toMillis?.() ?? 0 }; }));
  }, (e) => onError(e.message));
}
