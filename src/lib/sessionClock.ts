import type { Session } from "../data/types";

/**
 * Pure clock arithmetic for a paper that can be left and come back to. The
 * fixed exam runs continuously through reading and writing. Other papers can
 * pause: pausing records when the
 * paper was left, and resuming pushes startedAt forward by the time away, so
 * the deadline moves with it and no exam time is lost while marking, browsing
 * or with the tab closed.
 */

export function pausedSession(s: Session, now: number): Session {
  if (s.examFormat === "six-stem" || s.pausedAt !== undefined) return s;
  return { ...s, pausedAt: now };
}

export function resumedSession(s: Session, now: number): Session {
  if (s.pausedAt === undefined) return s;
  if (s.examFormat === "six-stem") { const { pausedAt: _paused, ...running } = s; void _paused; return running; }
  const away = Math.max(0, now - s.pausedAt);
  const { pausedAt: _dropped, ...rest } = s;
  void _dropped;
  return { ...rest, startedAt: s.startedAt + away };
}

/** Seconds left on the exam clock, frozen while paused; null when untimed. */
export function remainingSec(s: Session, now: number): number | null {
  if (!s.totalSec) return null;
  const at = s.examFormat === "six-stem" ? now : s.pausedAt ?? now;
  return Math.min(s.totalSec, Math.max(0, Math.ceil((s.startedAt + ((s.readingSec ?? 0) + s.totalSec) * 1000 - at) / 1000)));
}

/** Practice timers are guidance; only exam deadlines submit and lock answers. */
export function shouldAutoSubmit(s: Session, now: number): boolean {
  return s.mode === "exam" && remainingSec(s, now) === 0;
}

export function overtimeSec(s: Session, now: number): number {
  if (!s.totalSec) return 0;
  return Math.max(0, Math.floor(((s.pausedAt ?? now) - s.startedAt) / 1000) - s.totalSec);
}

/** Reading and writing deadlines use the saved start and never reset on reload. */
export function readingRemainingSec(s: Session, now: number): number {
  if (!s.readingSec) return 0;
  const at = s.examFormat === "six-stem" ? now : s.pausedAt ?? now;
  return Math.max(0, Math.ceil((s.startedAt + (s.readingSec ?? 0) * 1000 - at) / 1000));
}

export function canWriteAnswers(s: Session, now: number): boolean {
  return readingRemainingSec(s, now) === 0 && !shouldAutoSubmit(s, now);
}
