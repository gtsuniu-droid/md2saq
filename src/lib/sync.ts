import { loadLibrary, readCatalogue } from "./library";
import { syncFromBank } from "./bank";
import { db, getSettings, withRemoteWrites } from "../data/db";
import type { Attempt, Mark, Question, QuestionSet, QuestionRef, Session, Settings } from "../data/types";
import { cloudConfigured, currentUser, idToken, type CloudUser } from "./firebase";
import { loadSessionEnvelope, saveSessionEnvelope } from "./session";
import { syncNotes } from "./notes";
import { belongsToAccount } from "./progressAccount";
import { publishWeeklyCount } from "./leaderboard";
import { newerSocial } from "./social";

/**
 * Offline-first sync of a signed-in person's own records: attempts (drafts
 * included, so a paper's answers are saved to the account as they are typed),
 * marks, settings and the paper in progress. The browser database stays the
 * working copy; records modified since the last push go up, records modified
 * in the account since the last pull come down, newest wins. The account lives
 * in the site's own store (/api/account, see netlify/lib/accountStore.ts), not
 * Firestore, so saving never waits on a read budget or a document size limit.
 * Questions and sets are not synced here; they come from the shared bank, and a
 * record carries a QuestionRef so it can find its question on a device whose
 * question ids differ.
 */

type Rec = Record<string, unknown> & { id: string; _m?: number };
type Table = "attempts" | "marks";
/** About what one call to the account store may carry; the store stops at 6 MB. */
const BYTES_PER_CALL = 3_500_000;
/** A record too big to send at all (pictures pasted by the dozen) stays on the device and is reported, not retried forever. */
const MAX_RECORD_BYTES = 5_000_000;

async function account<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await idToken();
  if (!token) throw new Error("Sign in to sync.");
  const res = await fetch(`/api/account/${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The account store answered ${res.status}.`);
  }
  return (await res.json()) as T;
}

/** Send a device's changes in calls that fit; settings, the paper and deletions travel with the first. Returns how many records were too big to send. */
async function pushToAccount(parts: { attempts: Rec[]; marks: Rec[]; settings?: Rec; session?: Rec; deletes: { id: string; table: Table; at: number }[] }): Promise<number> {
  const bytes = (r: Rec) => new TextEncoder().encode(JSON.stringify(r)).length;
  const items = [...parts.attempts.map((r) => ({ table: "attempts" as Table, r, size: bytes(r) })), ...parts.marks.map((r) => ({ table: "marks" as Table, r, size: bytes(r) }))];
  let skipped = 0; let first = true;
  const send = async (batch: typeof items) => {
    const body = {
      attempts: batch.filter((i) => i.table === "attempts").map((i) => i.r), marks: batch.filter((i) => i.table === "marks").map((i) => i.r),
      ...(first ? { ...(parts.settings ? { settings: parts.settings } : {}), ...(parts.session ? { session: parts.session } : {}), deletes: parts.deletes } : {}),
    };
    first = false;
    await account("push", { method: "POST", body: JSON.stringify(body) });
  };
  let batch: typeof items = []; let size = 0;
  for (const item of items) {
    if (item.size > MAX_RECORD_BYTES) { skipped++; console.warn(`sync: ${item.table} ${item.r.id} is too large to sync (${item.size} bytes); it stays on this device.`); continue; }
    if (batch.length && size + item.size > BYTES_PER_CALL) { await send(batch); batch = []; size = 0; }
    batch.push(item); size += item.size;
  }
  if (batch.length || first) await send(batch);
  return skipped;
}

const CURSOR_PUSH = "sync.pushedAt";
const CURSOR_PULL = "sync.pulledAt";
const SESSION_PUSHED = "sync.sessionPushedM";
/** Set once a device has uploaded everything it holds to the account store (which replaced Firestore). */
const STORE_SEEDED = "sync.accountStoreSeeded";
const SETTINGS_SYNCED: (keyof Settings)[] = [
  "minutesPerMark",
  "autoImportBank",
  "ambossHighlights",
  "ambossOnPaper",
  "social",
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
      // The board follows every push of answers, told once the sync is done so this device's figures are the account's.
      if (pushed.count) void publishWeeklyCount(u.uid).catch(() => undefined);
      return { pushed: pushed.count, pulled: pulled.applied, unresolved: pulled.unresolved + pushed.skipped };
    } catch (error) {
      reportSync({ uid: u.uid, status: "error", message: error instanceof Error ? error.message : "Could not sync history." });
      throw error;
    }
  });
  syncQueue = job;
  running.set(u.uid, job);
  try { return await job; } finally { running.delete(u.uid); }
}

async function push(uid: string): Promise<{ count: number; skipped: number }> {
  // The first push to the account store sends everything this device holds, whatever was pushed
  // to Firestore before: nothing a student has on any device is left behind by the move.
  const seeded = (await db.meta.get(`${STORE_SEEDED}:${uid}`))?.value === 1;
  const since = seeded ? await cursor(uid, CURSOR_PUSH) : -1;
  const started = Date.now();
  const [attempts, marks, settings, deletes] = await Promise.all([
    db.attempts.where("_m").above(since).filter((a) => belongsToAccount(a, uid)).toArray(),
    db.marks.where("_m").above(since).filter((m) => belongsToAccount(m, uid)).toArray(),
    db.settings.get("settings"),
    db.syncDeletes.filter((d) => belongsToAccount(d, uid)).toArray(),
  ]);
  const attemptDocs = attempts.map((a) => stripUndefined(a) as unknown as Rec);
  const markDocs = marks.map((m) => stripUndefined(m) as unknown as Rec);
  const settingsDoc = settings?.cloudUser?.uid === uid && (settings._m ?? 0) > since ? (stripUndefined(settingsForCloud(settings)) as unknown as Rec) : undefined;
  const env = loadSessionEnvelope(uid);
  let sessionDoc: Rec | undefined;
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
    sessionDoc = stripUndefined(doc) as unknown as Rec;
  }
  const deleteDocs = deletes.map((d) => ({ id: d.id, table: d.table as Table, at: d.at }));
  const skipped = attemptDocs.length || markDocs.length || settingsDoc || sessionDoc || deleteDocs.length
    ? await pushToAccount({ attempts: attemptDocs, marks: markDocs, settings: settingsDoc, session: sessionDoc, deletes: deleteDocs })
    : 0;
  if (sessionDoc) await setCursor(uid, SESSION_PUSHED, env._m);
  if (deletes.length) await db.syncDeletes.bulkDelete(deletes.map((d) => d.id));
  // A record stamped in the same millisecond the push began is caught next time.
  await setCursor(uid, CURSOR_PUSH, started - 1);
  if (!seeded) await db.meta.put({ id: `${STORE_SEEDED}:${uid}`, value: 1 });
  return { count: attemptDocs.length + markDocs.length - skipped, skipped };
}

async function pull(uid: string): Promise<{ applied: number; unresolved: number }> {
  const since = await cursor(uid, CURSOR_PULL);
  // The store says what arrived since the last pull, by its own clock, and gives the cursor for the next one.
  const changed = await account<{ at: number; next: number; entries: { id: string; table: Table; _m: number; deleted?: true }[]; settings?: Rec; session?: Rec }>(`changes?since=${since}`);
  const started = changed.next;
  // The records that changed, a bounded page per call; whatever did not fit comes back as remaining.
  const fetched: { table: Table; record: Rec }[] = [];
  let keys = changed.entries.filter((e) => !e.deleted).map((e) => ({ table: e.table, id: e.id }));
  while (keys.length) {
    const page = await account<{ records: { table: Table; record: Rec }[]; remaining: { table: Table; id: string }[] }>("fetch", { method: "POST", body: JSON.stringify({ keys: keys.slice(0, 400) }) });
    fetched.push(...page.records);
    const left = [...page.remaining, ...keys.slice(400)];
    if (left.length >= keys.length) throw new Error("The account store returned nothing for a page of records.");
    keys = left;
  }
  const attempts = fetched.filter((f) => f.table === "attempts").map((f) => f.record);
  const marks = fetched.filter((f) => f.table === "marks").map((f) => f.record);
  const settingsDocs = [changed.settings, changed.session].filter((d): d is Rec => !!d);
  const deleted = changed.entries.filter((e) => e.deleted).map((e) => ({ id: e.id, table: e.table }));
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
          // The leaderboard choice goes by its own date, not the whole document's. When this
          // device's is the one kept, date the document now so the next push corrects the cloud copy.
          const social = newerSocial(local?.social, remoteSettings.social);
          if (social !== remoteSettings.social) Object.assign(merged, { social, _m: Date.now() });
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
  if (uid) await db.meta.bulkDelete([CURSOR_PUSH, CURSOR_PULL, SESSION_PUSHED, STORE_SEEDED].map((key) => `${key}:${uid}`));
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
