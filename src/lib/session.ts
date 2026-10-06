import { db } from "../data/db";
import type { Session } from "../data/types";
import { pausedSession, resumedSession } from "./sessionClock";
import { recordDeletes } from "./sync";

/**
 * The paper in progress. It lives in localStorage so it survives leaving the
 * page, closing the tab and reopening the app; Home and the nav offer a way
 * back in until it is submitted and reviewed, or discarded. Signed in, it
 * follows the account to other devices (see sync.ts), so the envelope carries
 * a change stamp and remembers that a paper ended.
 */
const KEY = "saq-session-v2";
const OWNER_KEY = "saq-session-owner";
const LEGACY_KEYS = ["saq-session"];

export interface SessionEnvelope {
  session: Session | null;
  /** When the session last changed on this device, or the stamp adopted from the cloud. */
  _m: number;
}

const listeners = new Set<() => void>();
let cachedOwner: string | undefined;
let cachedRaw: string | null | undefined;
let cachedEnvelope: SessionEnvelope = { session: null, _m: 0 };

export function sessionOwner(): string {
  try { return localStorage.getItem(OWNER_KEY) ?? ""; } catch { return ""; }
}
function storageKey(ownerId: string): string { return `${KEY}:${encodeURIComponent(ownerId)}`; }

/** Separate unfinished papers when accounts share a browser. */
export function switchSessionAccount(previous: string, next: string): void {
  try {
    // Before this change, one global paper belonged to the last signed-in account.
    if (localStorage.getItem(OWNER_KEY) === null && previous) {
      const legacy = readRaw("");
      if (legacy && !localStorage.getItem(storageKey(previous))) localStorage.setItem(storageKey(previous), legacy);
      localStorage.removeItem(storageKey(""));
    }
    if (!previous && next) {
      const guest = loadSessionEnvelope("");
      const account = loadSessionEnvelope(next);
      if (guest.session && !account.session) {
        localStorage.setItem(storageKey(next), JSON.stringify({ ...guest, session: { ...guest.session, ownerId: next }, _m: Date.now() }));
        localStorage.removeItem(storageKey(""));
      }
    }
    localStorage.setItem(OWNER_KEY, next);
  } catch { /* Remain usable when persistent storage is unavailable. */ }
  cachedOwner = undefined;
  notify();
}

function readRaw(ownerId: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey(ownerId));
    if (raw !== null) return raw;
    // Adopt the old global envelope once, before account-specific storage existed.
    const global = localStorage.getItem(KEY);
    if (global !== null && localStorage.getItem(OWNER_KEY) === null) {
      localStorage.setItem(storageKey(ownerId), global);
      localStorage.removeItem(KEY);
      return global;
    }
    if (localStorage.getItem(OWNER_KEY) !== null) return null;
    // Papers started before sessions were kept across tabs, or before the envelope.
    for (const store of [localStorage, sessionStorage]) {
      for (const k of LEGACY_KEYS) {
        const legacy = store.getItem(k);
        if (legacy === null) continue;
        const migrated = JSON.stringify({ session: JSON.parse(legacy), _m: Date.now() });
        localStorage.setItem(storageKey(ownerId), migrated);
        store.removeItem(k);
        return migrated;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The stored envelope, referentially stable while unchanged. */
export function loadSessionEnvelope(ownerId = sessionOwner()): SessionEnvelope {
  const raw = readRaw(ownerId);
  if (ownerId === cachedOwner && raw === cachedRaw) return cachedEnvelope;
  cachedRaw = raw;
  cachedOwner = ownerId;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<SessionEnvelope>) : null;
    cachedEnvelope = { session: parsed?.session ? { ...parsed.session, ownerId } : null, _m: typeof parsed?._m === "number" ? parsed._m : 0 };
  } catch {
    cachedEnvelope = { session: null, _m: 0 };
  }
  return cachedEnvelope;
}

/** The current session, referentially stable while unchanged (safe for useSyncExternalStore). */
export function loadSession(ownerId = sessionOwner()): Session | null {
  return loadSessionEnvelope(ownerId).session;
}

export function saveSessionEnvelope(env: SessionEnvelope, ownerId = sessionOwner()): void {
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify(env));
  } catch {
    /* storage unavailable; session is simply not persisted */
  }
  notify();
}

export function saveSession(s: Session | null, ownerId = s?.ownerId ?? sessionOwner()): void {
  saveSessionEnvelope({ session: s ? { ...s, ownerId } : null, _m: Date.now() }, ownerId);
}

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to session changes from this tab and others. */
export function subscribeSession(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === OWNER_KEY || e.key === storageKey(sessionOwner())) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function startSession(questionIds: string[], mode: "practice" | "exam", totalSec?: number, studyUnit: "questions" | "sets" = "questions", options: Pick<Session, "readingSec" | "examFormat"> = {}): Session {
  const previous = loadSession();
  if (previous) void dropUnsubmitted(previous.id);
  const s: Session = {
    id: crypto.randomUUID(),
    ownerId: sessionOwner(),
    mode,
    questionIds,
    studyUnit,
    ...options,
    ...(studyUnit === "sets" ? { openedSetCount: 1 } : {}),
    index: 0,
    totalSec,
    startedAt: Date.now(),
    attemptIds: [],
  };
  saveSession(s);
  return s;
}

/** Pause ordinary sessions on exit; fixed-format exams keep their deadline. */
export function pauseSession(ownerId = sessionOwner()): void {
  const s = loadSession(ownerId);
  if (!s || s.pausedAt !== undefined) return;
  saveSession(pausedSession(s, Date.now()));
}

/** Restart the clock on coming back; returns the session to show. */
export function resumeSession(ownerId = sessionOwner()): Session | null {
  const s = loadSession(ownerId);
  if (!s) return null;
  if (s.pausedAt === undefined) return s;
  const next = resumedSession(s, Date.now());
  saveSession(next);
  return next;
}

/** Throw the paper away: unanswered questions are forgotten, submitted ones stay as attempts. */
export async function discardSession(): Promise<void> {
  const s = loadSession();
  saveSession(null);
  if (s) await dropUnsubmitted(s.id);
}

/** Delete a paper's unsubmitted attempts here and, once synced, in the account. */
export async function dropUnsubmitted(sessionId: string): Promise<void> {
  try {
    const ids = (await db.attempts.where("sessionId").equals(sessionId).filter((a) => a.submittedAt === undefined).primaryKeys()) as string[];
    if (ids.length === 0) return;
    await db.attempts.bulkDelete(ids);
    await recordDeletes("attempts", ids);
  } catch {
    /* App start sweeps orphans too */
  }
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
