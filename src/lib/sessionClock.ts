import type { Session } from "../data/types";

/**
 * Pure clock arithmetic for a paper that can be left and come back to. The
 * exam timer is a deadline (startedAt + totalSec); pausing records when the
 * paper was left, and resuming pushes startedAt forward by the time away, so
 * the deadline moves with it and no exam time is lost while marking, browsing
 * or with the tab closed.
 */

export function pausedSession(s: Session, now: number): Session {
  if (s.pausedAt !== undefined) return s;
  return { ...s, pausedAt: now };
}

export function resumedSession(s: Session, now: number): Session {
  if (s.pausedAt === undefined) return s;
  const away = Math.max(0, now - s.pausedAt);
  const { pausedAt: _dropped, ...rest } = s;
  void _dropped;
  return { ...rest, startedAt: s.startedAt + away };
}

/** Seconds left on the exam clock, frozen while paused; null when untimed. */
export function remainingSec(s: Session, now: number): number | null {
  if (!s.totalSec) return null;
  const at = s.pausedAt ?? now;
  return Math.max(0, Math.ceil((s.startedAt + s.totalSec * 1000 - at) / 1000));
}
