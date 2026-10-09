import { loadLibrary, readCatalogue } from "./library";
import { syncFromBank } from "./bank";
import { db, getSettings, withRemoteWrites } from "../data/db";
import type { Attempt, Mark, Question, QuestionSet, QuestionRef, Session, Settings } from "../data/types";
import { cloudConfigured, currentUser, deleteMany, fetchSince, writeMany, type CloudUser } from "./firebase";
import { loadSessionEnvelope, saveSessionEnvelope } from "./session";
import { syncNotes } from "./notes";
import { belongsToAccount } from "./progressAccount";

/**
 * Offline-first sync of a signed-in person's own records: attempts (drafts
 * included, so a paper's answers are saved to the account as they are typed),
 * marks, settings and the paper in progress. The browser database stays the
 * working copy; records modified since the last push go up, records modified
 * in the cloud since the last pull come down, newest wins. Questions and sets
 * are not synced here; they come from the shared bank, and a record carries a
 * QuestionRef so it can find its question on a device whose question ids differ.
 */

const CURSOR_PUSH = "sync.pushedAt";
const CURSOR_PULL = "sync.pulledAt";
const SESSION_PUSHED = "sync.sessionPushedM";
const SETTINGS_SYNCED: (keyof Settings)[] = [
  "minutesPerMark",
  "autoImportBank",
  "ambossHighlights",
  "ambossOnPaper",
];

/** Firestore rejects undefined; drop those fields recursively. Arrays are kept as is. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** The subset of settings that follows the person between devices. */
export function settingsForCloud(s: Settings): Partial<Settings> & { id: "settings" } {
  const out: Record<string, unknown> = { id: "settings", _m: s._m };
  for (const k of SETTINGS_SYNCED) if (s[k] !== undefined) out[k] = s[k];
  return out as Partial<Settings> & { id: "settings" };
}

/**
 * Find the local question a synced record refers to: by id when it exists,
 * otherwise by its position in the same bank set.
 */
export function resolveQuestionId(
  questionId: string,
  qref: QuestionRef | undefined,
  byId: Map<string, Question>,
  byBankAndOrder: Map<string, Question>,
): string | null {
  if (byId.has(questionId)) return questionId;
  if (qref?.bankId) {
    const q = byBankAndOrder.get(`${qref.bankId}#${qref.order}`);
    if (q) return q.id;
  }
  return null;
}

/** The paper in progress as stored in the account: question ids travel as refs. */
export interface CloudSession {
  id: "session";
  _m: number;
  session: Session | null;
  qrefs?: QuestionRef[];
}

/**
 * Rebuild a session from another device on this one, resolving each question
 * by reference. Questions this device lacks drop out; null when none resolve.
 */
export function adoptSession(remote: CloudSession, byId: Map<string, Question>, byBankAndOrder: Map<string, Question>): Session | null {
  const s = remote.session;
  if (!s) return null;
  const questionIds: string[] = [];
  const attemptIds: string[] = [];
  s.questionIds.forEach((qid, i) => {
    const local = resolveQuestionId(qid, remote.qrefs?.[i], byId, byBankAndOrder);
    if (!local) return;
    questionIds.push(local);
    attemptIds.push(s.attemptIds[i] ?? "");
  });
  if (questionIds.length === 0) return null;
  return { ...s, questionIds, attemptIds, index: Math.min(s.index, questionIds.length - 1) };
}

/** Whether a cloud record should replace the local one. */
export function remoteWins(localM: number | undefined, remoteM: number | undefined): boolean {
  return (remoteM ?? 0) > (localM ?? 0);
}

async function cursor(uid: string, id: string): Promise<number> {
  const row = await db.meta.get(`${id}:${uid}`);
  return typeof row?.value === "number" ? row.value : 0;
}
async function setCursor(uid: string, id: string, value: number): Promise<void> {
  await db.meta.put({ id: `${id}:${uid}`, value });
}

/** Remember local deletions so the cloud copy goes too. Call from every delete path. */
export async function recordDeletes(table: "attempts" | "marks", ids: string[]): Promise<void> {
  if (ids.length === 0 || !cloudConfigured()) return;
  const at = Date.now();
  const ownerId = (await getSettings()).cloudUser?.uid ?? "";
  await db.syncDeletes.bulkPut(ids.map((id) => ({ id, table, at, ownerId })));
}

/** Question reference for a record being created, so other devices can place it. */
export async function questionRef(question: Question, knownSet?: QuestionSet): Promise<QuestionRef> {
  const set = knownSet ?? await db.sets.get(question.setId) ?? (await readCatalogue())?.entries.find(e => e.set.id === question.setId)?.set;
  return { setId: question.setId, bankId: set?.bankId, order: question.order, text: (question.text || question.parts[0]?.text || "").slice(0, 200), setName: set?.name, setNumber: set?.number };
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  unresolved: number;
}

const running = new Map<string, Promise<SyncResult>>();
let syncQueue: Promise<unknown> = Promise.resolve();
export type ProgressSyncState = { uid?: string; status: "idle" | "syncing" | "synced" | "error"; at?: number; message?: string };
let syncState: ProgressSyncState = { status: "idle" };
const syncListeners = new Set<() => void>();
export const getProgressSyncState = () => syncState;
export function subscribeProgressSync(fn: () => void) { syncListeners.add(fn); return () => { syncListeners.delete(fn); }; }
function reportSync(state: ProgressSyncState) { syncState = state; syncListeners.forEach((fn) => fn()); }

/** Push local changes, then pull remote ones. Safe to call often; concurrent calls share one run. */
export async function syncNow(user?: CloudUser | null): Promise<SyncResult | null> {
  const u = user ?? (await currentUser());
  if (!u) return null;
  const active = running.get(u.uid);
  if (active) return active;
  // Serialize accounts as well: remote-write timestamp suppression is shared.
  const job = syncQueue.catch(() => undefined).then(async () => {
    reportSync({ uid: u.uid, status: "syncing" });
    try {
      const notesResult = syncNotes(u).then(() => null, (error: unknown) => error);
      const pushed = await push(u.uid);
      const pulled = await pull(u.uid);
      const notesError = await notesResult;
      if (notesError) throw notesError;
      reportSync({ uid: u.uid, status: "synced", at: Date.now() });
      return { pushed, pulled: pulled.applied, unresolved: pulled.unresolved };
    } catch (error) {
      reportSync({ uid: u.uid, status: "error", message: error instanceof Error ? error.message : "Could not sync history." });
      throw error;
    }
  });
  syncQueue = job;
  running.set(u.uid, job);
  try { return await job; } finally { running.delete(u.uid); }
}

async function push(uid: string): Promise<number> {
  const since = await cursor(uid, CURSOR_PUSH);
  const started = Date.now();
  const [attempts, marks, settings, deletes] = await Promise.all([
    db.attempts.where("_m").above(since).filter((a) => belongsToAccount(a, uid)).toArray(),
    db.marks.where("_m").above(since).filter((m) => belongsToAccount(m, uid)).toArray(),
    db.settings.get("settings"),
    db.syncDeletes.filter((d) => belongsToAccount(d, uid)).toArray(),
  ]);
  const attemptDocs = attempts.map((a) => stripUndefined(a) as unknown as Record<string, unknown>);
  const markDocs = marks.map((m) => stripUndefined(m) as unknown as Record<string, unknown>);
  await writeMany(uid, "attempts", attemptDocs);
  await writeMany(uid, "marks", markDocs);
  if (settings?.cloudUser?.uid === uid && (settings._m ?? 0) > since) {
    await writeMany(uid, "settings", [stripUndefined(settingsForCloud(settings)) as unknown as Record<string, unknown>]);
  }
  const env = loadSessionEnvelope(uid);
  if (env._m > 0 && env._m !== (await cursor(uid, SESSION_PUSHED))) {
    const qrefs: QuestionRef[] = [];
    const library = await loadLibrary();
    const byId = new Map(library.questions.map(q => [q.id, q]));
    const bySet = new Map(library.sets.map(s => [s.id, s]));
    for (const qid of env.session?.questionIds ?? []) {
      const q = byId.get(qid);
      qrefs.push(q ? await questionRef(q, bySet.get(q.setId)) : { setId: "", order: -1 });
    }
    const doc: CloudSession = { id: "session", _m: env._m, session: env.session, qrefs };
    await writeMany(uid, "settings", [stripUndefined(doc) as unknown as Record<string, unknown>]);
    await setCursor(uid, SESSION_PUSHED, env._m);
  }
  if (deletes.length) {
    const byTable = { attempts: deletes.filter((d) => d.table === "attempts"), marks: deletes.filter((d) => d.table === "marks") };
    await deleteMany(uid, "attempts", byTable.attempts.map((d) => d.id));
    await deleteMany(uid, "marks", byTable.marks.map((d) => d.id));
    await writeMany(uid, "deleted", deletes.map((d) => ({ id: d.id, table: d.table, _m: d.at })));
    await db.syncDeletes.bulkDelete(deletes.map((d) => d.id));
  }
  await setCursor(uid, CURSOR_PUSH, started);
  return attemptDocs.length + markDocs.length;
}

async function pull(uid: string): Promise<{ applied: number; unresolved: number }> {
  const since = await cursor(uid, CURSOR_PULL);
  const started = Date.now();
  const [attempts, marks, settingsDocs, deleted] = await Promise.all([
    fetchSince(uid, "attempts", since),
    fetchSince(uid, "marks", since),
    fetchSince(uid, "settings", since),
    fetchSince(uid, "deleted", since),
  ]);
  if (!await readCatalogue()) await syncFromBank().catch(() => undefined);
  const { questions, sets } = await loadLibrary();
  const byId = new Map(questions.map((q) => [q.id, q]));
  const bankOfSet = new Map(sets.filter((s) => s.bankId).map((s) => [s.id, s.bankId!]));
  const byBankAndOrder = new Map<string, Question>();
  for (const q of questions) {
    const bankId = bankOfSet.get(q.setId);
    if (bankId) byBankAndOrder.set(`${bankId}#${q.order}`, q);
  }

  let applied = 0;
  let unresolved = 0;
  await withRemoteWrites(async () => {
    await db.transaction("rw", db.attempts, db.marks, db.settings, async () => {
      for (const raw of attempts as unknown as Attempt[]) {
        const qid = resolveQuestionId(raw.questionId, raw.qref, byId, byBankAndOrder);
        if (!qid) unresolved++;
        const local = await db.attempts.get(raw.id);
        if (local && (!belongsToAccount(local, uid) || (!remoteWins(local._m, raw._m) && (!qid || local.questionId === qid)))) continue;
        const latest = local && !remoteWins(local._m, raw._m) ? local : raw;
        await db.attempts.put({ ...latest, ownerId: uid, questionId: qid ?? raw.questionId });
        applied++;
      }
      for (const raw of marks as unknown as Mark[]) {
        const qid = resolveQuestionId(raw.questionId, raw.qref, byId, byBankAndOrder);
        if (!qid) unresolved++;
        const local = await db.marks.get(raw.id);
        if (local && (!belongsToAccount(local, uid) || (!remoteWins(local._m, raw._m) && (!qid || local.questionId === qid)))) continue;
        const latest = local && !remoteWins(local._m, raw._m) ? local : raw;
        await db.marks.put({ ...latest, ownerId: uid, questionId: qid ?? raw.questionId });
        applied++;
      }
      const remoteSettings = settingsDocs.find((d) => d.id === "settings") as (Partial<Settings> & { _m?: number }) | undefined;
      if (remoteSettings) {
        const local = await db.settings.get("settings");
        if (local?.cloudUser?.uid === uid && remoteWins(local._m, remoteSettings._m)) {
          const merged = { ...(local ?? {}), ...settingsForCloud(remoteSettings as Settings), id: "settings" as const };
          await db.settings.put(merged as Settings);
          applied++;
        }
      }
      for (const d of deleted as { id: string; table: "attempts" | "marks" }[]) {
        const table = d.table === "attempts" ? db.attempts : d.table === "marks" ? db.marks : null;
        const local = await table?.get(d.id);
        if (local && belongsToAccount(local, uid)) await table?.delete(d.id);
      }
    });
  });
  // The paper in progress follows the account: a newer one from another device replaces this device's.
  const remoteSession = settingsDocs.find((d) => d.id === "session") as CloudSession | undefined;
  if (remoteSession && remoteWins(loadSessionEnvelope(uid)._m, remoteSession._m)) {
    const adopted = adoptSession(remoteSession, byId, byBankAndOrder);
    if (remoteSession.session && !adopted) unresolved++;
    else {
      saveSessionEnvelope({ session: adopted ? { ...adopted, ownerId: uid } : null, _m: remoteSession._m }, uid);
      await setCursor(uid, SESSION_PUSHED, remoteSession._m);
      applied++;
    }
  }
  // Retry unresolved references after this device downloads the relevant question set.
  if (!unresolved) await setCursor(uid, CURSOR_PULL, started);
  return { applied, unresolved };
}

/** Forget the cursors, so the next sync compares everything again (used after sign-in on a device with history). */
export async function resetCursors(): Promise<void> {
  const uid = (await getSettings()).cloudUser?.uid;
  if (uid) await db.meta.bulkDelete([CURSOR_PUSH, CURSOR_PULL, SESSION_PUSHED].map((key) => `${key}:${uid}`));
}

let requested: number | undefined;
/** Sync soon, once typing pauses: called after each saved answer and session change. */
export function requestSync(delayMs = 4000): void {
  if (!cloudConfigured() || typeof window === "undefined") return;
  if (requested) window.clearTimeout(requested);
  requested = window.setTimeout(() => {
    requested = undefined;
    if (navigator.onLine) void syncNow().catch(() => undefined);
  }, delayMs);
}

/** Start background syncing: on sign-in, when the tab becomes visible, and every couple of minutes. */
export function startSyncLoop(getUser: () => CloudUser | null): () => void {
  const tick = () => {
    const u = getUser();
    if (u && navigator.onLine) void syncNow(u).catch(() => undefined);
  };
  const interval = window.setInterval(tick, 120_000);
  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", tick);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", tick);
  };
}
