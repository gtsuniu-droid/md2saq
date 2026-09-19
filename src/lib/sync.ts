import { db, withRemoteWrites } from "../data/db";
import type { Attempt, Mark, Question, QuestionRef, Settings } from "../data/types";
import { cloudConfigured, currentUser, deleteMany, fetchSince, writeMany, type CloudUser } from "./firebase";

/**
 * Offline-first sync of a signed-in person's own records: attempts, marks and
 * settings. The browser database stays the working copy; records modified
 * since the last push go up, records modified in the cloud since the last pull
 * come down, newest wins. Questions and sets are not synced here; they come
 * from the shared bank, and a record carries a QuestionRef so it can find its
 * question on a device whose question ids differ.
 */

const CURSOR_PUSH = "sync.pushedAt";
const CURSOR_PULL = "sync.pulledAt";
const SETTINGS_SYNCED: (keyof Settings)[] = [
  "minutesPerMark",
  "autoImportBank",
  "ambossToken",
  "ambossUser",
  "ambossAccess",
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

/** Whether a cloud record should replace the local one. */
export function remoteWins(localM: number | undefined, remoteM: number | undefined): boolean {
  return (remoteM ?? 0) > (localM ?? 0);
}

async function cursor(id: string): Promise<number> {
  const row = await db.meta.get(id);
  return typeof row?.value === "number" ? row.value : 0;
}
async function setCursor(id: string, value: number): Promise<void> {
  await db.meta.put({ id, value });
}

/** Remember local deletions so the cloud copy goes too. Call from every delete path. */
export async function recordDeletes(table: "attempts" | "marks", ids: string[]): Promise<void> {
  if (ids.length === 0 || !cloudConfigured()) return;
  const at = Date.now();
  await db.syncDeletes.bulkPut(ids.map((id) => ({ id, table, at })));
}

/** Question reference for a record being created, so other devices can place it. */
export async function questionRef(question: Question): Promise<QuestionRef> {
  const set = await db.sets.get(question.setId);
  return { setId: question.setId, bankId: set?.bankId, order: question.order };
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  unresolved: number;
}

let running: Promise<SyncResult> | null = null;

/** Push local changes, then pull remote ones. Safe to call often; concurrent calls share one run. */
export async function syncNow(user?: CloudUser | null): Promise<SyncResult | null> {
  const u = user ?? (await currentUser());
  if (!u) return null;
  if (running) return running;
  running = (async () => {
    try {
      const pushed = await push(u.uid);
      const pulled = await pull(u.uid);
      return { pushed, pulled: pulled.applied, unresolved: pulled.unresolved };
    } finally {
      running = null;
    }
  })();
  return running;
}

async function push(uid: string): Promise<number> {
  const since = await cursor(CURSOR_PUSH);
  const started = Date.now();
  const [attempts, marks, settings, deletes] = await Promise.all([
    db.attempts.where("_m").above(since).toArray(),
    db.marks.where("_m").above(since).toArray(),
    db.settings.get("settings"),
    db.syncDeletes.toArray(),
  ]);
  // Unsubmitted attempts are drafts of the current paper; they sync once submitted.
  const attemptDocs = attempts.filter((a) => a.submittedAt !== undefined).map((a) => stripUndefined(a) as unknown as Record<string, unknown>);
  const markDocs = marks.map((m) => stripUndefined(m) as unknown as Record<string, unknown>);
  await writeMany(uid, "attempts", attemptDocs);
  await writeMany(uid, "marks", markDocs);
  if (settings && (settings._m ?? 0) > since) {
    await writeMany(uid, "settings", [stripUndefined(settingsForCloud(settings)) as unknown as Record<string, unknown>]);
  }
  if (deletes.length) {
    const byTable = { attempts: deletes.filter((d) => d.table === "attempts"), marks: deletes.filter((d) => d.table === "marks") };
    await deleteMany(uid, "attempts", byTable.attempts.map((d) => d.id));
    await deleteMany(uid, "marks", byTable.marks.map((d) => d.id));
    await writeMany(uid, "deleted", deletes.map((d) => ({ id: d.id, table: d.table, _m: d.at })));
    await db.syncDeletes.bulkDelete(deletes.map((d) => d.id));
  }
  await setCursor(CURSOR_PUSH, started);
  return attemptDocs.length + markDocs.length;
}

async function pull(uid: string): Promise<{ applied: number; unresolved: number }> {
  const since = await cursor(CURSOR_PULL);
  const started = Date.now();
  const [attempts, marks, settingsDocs, deleted] = await Promise.all([
    fetchSince(uid, "attempts", since),
    fetchSince(uid, "marks", since),
    fetchSince(uid, "settings", since),
    fetchSince(uid, "deleted", since),
  ]);
  const questions = await db.questions.toArray();
  const byId = new Map(questions.map((q) => [q.id, q]));
  const sets = await db.sets.toArray();
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
        if (!qid) {
          unresolved++;
          continue;
        }
        const local = await db.attempts.get(raw.id);
        if (local && !remoteWins(local._m, raw._m)) continue;
        await db.attempts.put({ ...raw, questionId: qid });
        applied++;
      }
      for (const raw of marks as unknown as Mark[]) {
        const qid = resolveQuestionId(raw.questionId, raw.qref, byId, byBankAndOrder);
        if (!qid) {
          unresolved++;
          continue;
        }
        const local = await db.marks.get(raw.id);
        if (local && !remoteWins(local._m, raw._m)) continue;
        await db.marks.put({ ...raw, questionId: qid });
        applied++;
      }
      const remoteSettings = settingsDocs[0] as (Partial<Settings> & { _m?: number }) | undefined;
      if (remoteSettings) {
        const local = await db.settings.get("settings");
        if (!local || remoteWins(local._m, remoteSettings._m)) {
          const merged = { ...(local ?? {}), ...remoteSettings, id: "settings" as const };
          await db.settings.put(merged as Settings);
          applied++;
        }
      }
      for (const d of deleted as { id: string; table: "attempts" | "marks" }[]) {
        if (d.table === "attempts") await db.attempts.delete(d.id);
        else await db.marks.delete(d.id);
      }
    });
  });
  await setCursor(CURSOR_PULL, started);
  return { applied, unresolved };
}

/** Forget the cursors, so the next sync compares everything again (used after sign-in on a device with history). */
export async function resetCursors(): Promise<void> {
  await db.meta.bulkDelete([CURSOR_PUSH, CURSOR_PULL]);
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
