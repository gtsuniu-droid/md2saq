import type { Session } from "../data/types";

/**
 * Pure clock arithmetic for a paper that can be left and come back to. The
 * fixed exam runs continuously through reading and writing. Other papers can
 * pause: pausing records when the
 * paper was left, and resuming pushes startedAt forward by the time away, so
 * the deadline moves with it and no exam time is lost while marking, browsing
 * or with the tab closed.
 */

/** Exams run continuously, whatever the student does with the tab; practice papers can pause. */
export function continuousClock(s: Pick<Session, "mode" | "examFormat">): boolean {
  return s.mode === "exam" || s.examFormat === "six-stem";
}

export function pausedSession(s: Session, now: number): Session {
  if (continuousClock(s) || s.pausedAt !== undefined) return s;
  return { ...s, pausedAt: now };
}

export function resumedSession(s: Session, now: number): Session {
  if (s.pausedAt === undefined) return s;
  if (continuousClock(s)) { const { pausedAt: _paused, ...running } = s; void _paused; return running; }
  const away = Math.max(0, now - s.pausedAt);
  const { pausedAt: _dropped, ...rest } = s;
  void _dropped;
  // Every set's clock moves with the paper's.
  const setClocks = s.setClocks ? Object.fromEntries(Object.entries(s.setClocks).map(([k, c]) => [k, { ...c, startedAt: c.startedAt + away }])) : undefined;
  return { ...rest, startedAt: s.startedAt + away, ...(setClocks ? { setClocks } : {}) };
}

/** Timed practice in whole sets runs a clock per set rather than one for the paper. */
export function perSetClocks(s: Pick<Session, "mode" | "studyUnit" | "totalSec" | "examFormat">): boolean {
  return s.mode === "practice" && s.studyUnit === "sets" && !!s.totalSec && !s.examFormat;
}

/** Seconds left on one set's clock, frozen while paused; null before the set is opened. */
export function setRemainingSec(s: Session, key: string, now: number): number | null {
  const clock = s.setClocks?.[key];
  if (!clock) return null;
  const at = s.pausedAt ?? now;
  return Math.min(clock.totalSec, Math.max(0, Math.ceil((clock.startedAt + clock.totalSec * 1000 - at) / 1000)));
}

export function setOvertimeSec(s: Session, key: string, now: number): number {
  const clock = s.setClocks?.[key];
  if (!clock) return 0;
  return Math.max(0, Math.floor(((s.pausedAt ?? now) - clock.startedAt) / 1000) - clock.totalSec);
}

/**
 * The session with a clock started for a set, given its share of the paper's time; an open
 * clock stays. A set opened while the paper is paused (it is, while the last set is being
 * marked) gets a clock frozen at the pause, which resuming moves to the moment of resuming.
 */
export function withSetClock(s: Session, key: string, totalSec: number, now: number): Session {
  if (s.setClocks?.[key]) return s;
  return { ...s, setClocks: { ...s.setClocks, [key]: { startedAt: s.pausedAt ?? now, totalSec: Math.max(60, Math.round(totalSec)) } } };
}

/** A clock the student set for this set ("finish this in ten minutes"), replacing whatever ran. */
export function withManualSetClock(s: Session, key: string, totalSec: number, now: number): Session {
  return { ...s, setClocks: { ...s.setClocks, [key]: { startedAt: s.pausedAt ?? now, totalSec: Math.max(60, Math.round(totalSec)), manual: true } } };
}

export function withoutSetClock(s: Session, key: string): Session {
  if (!s.setClocks?.[key]) return s;
  const { [key]: _gone, ...rest } = s.setClocks; void _gone;
  return { ...s, setClocks: rest };
}

/** Whether the set's own clock is the one to show: the paper runs per set, or the student set one. */
export function usesSetClock(s: Session, key: string | undefined): boolean {
  return !!key && (perSetClocks(s) || !!s.setClocks?.[key]);
}

/** Seconds left on the exam clock, frozen while paused; null when untimed. */
export function remainingSec(s: Session, now: number): number | null {
  if (!s.totalSec) return null;
  const at = continuousClock(s) ? now : s.pausedAt ?? now;
  return Math.min(s.totalSec, Math.max(0, Math.ceil((s.startedAt + ((s.readingSec ?? 0) + s.totalSec) * 1000 - at) / 1000)));
}

/** Practice timers are guidance; only exam deadlines submit and lock answers. */
export function shouldAutoSubmit(s: Session, now: number): boolean {
  return s.mode === "exam" && remainingSec(s, now) === 0;
}

export function overtimeSec(s: Session, now: number): number {
  if (!s.totalSec) return 0;
  return Math.max(0, Math.floor(((continuousClock(s) ? now : s.pausedAt ?? now) - s.startedAt) / 1000) - s.totalSec);
}

/** Reading and writing deadlines use the saved start and never reset on reload. */
export function readingRemainingSec(s: Session, now: number): number {
  if (!s.readingSec) return 0;
  const at = continuousClock(s) ? now : s.pausedAt ?? now;
  return Math.max(0, Math.ceil((s.startedAt + (s.readingSec ?? 0) * 1000 - at) / 1000));
}

export function canWriteAnswers(s: Session, now: number): boolean {
  return readingRemainingSec(s, now) === 0 && !shouldAutoSubmit(s, now);
}
