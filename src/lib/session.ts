import type { Session } from "../data/types";

const KEY = "saq-session";

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable; session is simply not persisted */
  }
}

export function startSession(questionIds: string[], mode: "practice" | "exam", totalSec?: number): Session {
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

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
