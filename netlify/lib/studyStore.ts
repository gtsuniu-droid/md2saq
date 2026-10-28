import { randomInt } from "node:crypto";
import { openNamedStore } from "./store";
import type { StudyParticipant, StudySession } from "../../src/lib/studyTypes";

/**
 * Study codes, one blob per code, so making, looking up and joining a code never waits on
 * Firestore's daily read budget. The same limits as the Firestore rules for the copy kept there.
 */
export const STUDY_DAYS = 7;
const store = () => openNamedStore("study");
const key = (code: string) => `codes/${code}`;

export type NewStudy = Pick<StudySession, "presentations" | "questions" | "mode" | "minutes" | "readingSec" | "totalSec"> & { hostName: string; photo?: string };

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const int = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** A posted study, checked; null when it would not pass. */
export function validStudy(b: unknown): NewStudy | null {
  if (!b || typeof b !== "object") return null;
  const s = b as Record<string, unknown>;
  const questions = s.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 60) return null;
  if (!questions.every((q) => q && typeof q === "object" && str(q.bankId, 200) && !!q.bankId && int(q.order, 1000) && str(q.text, 400) && str(q.setLabel, 300) && (q.marks === undefined || (typeof q.marks === "number" && q.marks >= 0 && q.marks <= 1000)))) return null;
  if (!Array.isArray(s.presentations) || s.presentations.length > 50 || !s.presentations.every((p) => str(p, 100))) return null;
  if (s.mode !== "practice" && s.mode !== "exam") return null;
  if (typeof s.minutes !== "number" || s.minutes < 0 || s.minutes > 600) return null;
  if ((s.readingSec !== undefined && !int(s.readingSec, 7200)) || (s.totalSec !== undefined && !int(s.totalSec, 36000))) return null;
  if (!str(s.hostName, 40) || !s.hostName.trim()) return null;
  return {
    presentations: s.presentations as string[], mode: s.mode, minutes: s.minutes,
    questions: questions.map((q) => ({ bankId: q.bankId, order: q.order, text: q.text, setLabel: q.setLabel, ...(q.marks !== undefined ? { marks: q.marks } : {}) })),
    ...(s.mode === "exam" ? { readingSec: (s.readingSec as number | undefined) ?? 0, totalSec: (s.totalSec as number | undefined) ?? 0 } : {}),
    hostName: s.hostName.trim(), ...(str(s.photo, 2000) && /^https:\/\//.test(s.photo) ? { photo: s.photo } : {}),
  };
}

/** Keep a new study under a fresh six-digit code; a code still in use (or kept and expired) is never reused. */
export async function createStudy(uid: string, s: NewStudy, now = Date.now()): Promise<StudySession> {
  const { hostName, photo, ...rest } = s;
  const host: StudyParticipant = { uid, name: hostName, ...(photo ? { photo } : {}) };
  for (let tries = 0; tries < 10; tries++) {
    const code = String(randomInt(100000, 1000000));
    const study: StudySession = { code, hostUid: uid, hostName, createdAt: now, expiresAt: now + STUDY_DAYS * 24 * 3600 * 1000, ...rest, participants: [host] };
    // Written only if no code of that number exists yet.
    if (await store().update<StudySession>(key(code), (cur) => cur ? null : study)) return study;
  }
  throw new Error("Could not find a free code. Try again.");
}

export async function readStudy(code: string): Promise<StudySession | null> {
  return (await store().get(key(code), { type: "json" })) as StudySession | null;
}

/** Add someone to a code's list of who joined (once, up to 50). */
export async function joinStudy(code: string, who: StudyParticipant): Promise<StudySession | null> {
  return store().update<StudySession>(key(code), (cur) => {
    if (!cur || cur.participants.some((p) => p.uid === who.uid) || cur.participants.length >= 50) return null;
    return { ...cur, participants: [...cur.participants, who] };
  }).then(async (s) => s ?? readStudy(code));
}
