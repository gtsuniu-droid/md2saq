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
const LEGACY_KEYS = ["saq-session"];

export interface SessionEnvelope {
  session: Session | null;
  /** When the session last changed on this device, or the stamp adopted from the cloud. */
  _m: number;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedEnvelope: SessionEnvelope = { session: null, _m: 0 };

function readRaw(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return raw;
    // Papers started before sessions were kept across tabs, or before the envelope.
    for (const store of [localStorage, sessionStorage]) {
      for (const k of LEGACY_KEYS) {
        const legacy = store.getItem(k);
        if (legacy === null) continue;
        const migrated = JSON.stringify({ session: JSON.parse(legacy), _m: Date.now() });
        localStorage.setItem(KEY, migrated);
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
export function loadSessionEnvelope(): SessionEnvelope {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedEnvelope;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<SessionEnvelope>) : null;
    cachedEnvelope = { session: parsed?.session ?? null, _m: typeof parsed?._m === "number" ? parsed._m : 0 };
  } catch {
    cachedEnvelope = { session: null, _m: 0 };
  }
  return cachedEnvelope;
}

/** The current session, referentially stable while unchanged (safe for useSyncExternalStore). */
export function loadSession(): Session | null {
  return loadSessionEnvelope().session;
}

export function saveSessionEnvelope(env: SessionEnvelope): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(env));
  } catch {
    /* storage unavailable; session is simply not persisted */
  }
  notify();
}

export function saveSession(s: Session | null): void {
  saveSessionEnvelope({ session: s, _m: Date.now() });
}

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to session changes from this tab and others. */
export function subscribeSession(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function startSession(questionIds: string[], mode: "practice" | "exam", totalSec?: number): Session {
  const previous = loadSession();
  if (previous) void dropUnsubmitted(previous.id);
  const s: Session = {
    id: crypto.randomUUID(),
    mode,
    questionIds,
    index: 0,
    totalSec,
    startedAt: Date.now(),
    attemptIds: [],
  };
  saveSession(s);
  return s;
}

/** Stop the exam clock: called whenever the paper is left. Idempotent. */
export function pauseSession(): void {
  const s = loadSession();
  if (!s || s.pausedAt !== undefined) return;
  saveSession(pausedSession(s, Date.now()));
}

/** Restart the clock on coming back; returns the session to show. */
export function resumeSession(): Session | null {
  const s = loadSession();
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
