import { db, getSettings } from "../data/db";
import type { Attempt, Question } from "../data/types";
import { cloudConfigured, communityServices, idToken } from "./firebase";
import { loadLibrary } from "./library";
import { belongsToAccount } from "./progressAccount";

/**
 * A weekly leaderboard, Monday to Sunday in the student's local time, counted by questions
 * answered or by whole sets completed. Each person publishes their own counts under
 * leaderboard/{uid}; nobody can write another's.
 */
export type LeaderboardUnit = "questions" | "sets";

export interface LeaderboardRow {
  uid: string;
  name: string;
  /** Questions answered this week. */
  count: number;
  /** Whole sets completed this week. */
  sets: number;
  /** Last week's figures, for the trend arrows. */
  prevCount: number;
  prevSets: number;
  /** The account's Google picture, when it has one. */
  photo?: string;
  /** Opted in: shown to other students. Other rows reach admins only. */
  visible: boolean;
  updatedAt: number;
}

/** The nickname shown on the board: the chosen one, else the first name from the account. */
export function boardName(settings: { social?: { username?: string }; cloudUser?: { name?: string; email?: string } }): string {
  const chosen = settings.social?.username?.trim();
  const first = settings.cloudUser?.name?.trim().split(/\s+/)[0] || settings.cloudUser?.email?.split("@")[0] || "Student";
  return (chosen || first).slice(0, 20);
}

const DAY = 24 * 3600 * 1000;

/** Midnight at the start of the Monday of the week containing `ts`, local time. */
export function weekStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/** The ISO week id of a moment, e.g. "2026-W44". */
export function weekKey(ts: number): string {
  const d = new Date(weekStart(ts));
  // ISO weeks are numbered by the year of their Thursday.
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3);
  const year = thursday.getFullYear();
  const firstWeekStart = weekStart(new Date(year, 0, 4).getTime());
  const week = Math.round((weekStart(thursday.getTime()) - firstWeekStart) / (7 * DAY)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const inWeek = (attempts: Attempt[], ownerId: string, start: number) =>
  attempts.filter((a) => belongsToAccount(a, ownerId) && a.submittedAt !== undefined && a.submittedAt >= start && a.submittedAt < start + 7 * DAY);

/** Questions submitted by this account in the week starting at `start`. */
export function questionsInWeek(attempts: Attempt[], ownerId: string, start: number): number {
  return inWeek(attempts, ownerId, start).length;
}

/** Sets completed in the week: every question of the set submitted within it. */
export function setsInWeek(attempts: Attempt[], questions: Pick<Question, "id" | "setId">[], ownerId: string, start: number): number {
  const setOf = new Map(questions.map((q) => [q.id, q.setId]));
  const size = new Map<string, number>();
  for (const q of questions) size.set(q.setId, (size.get(q.setId) ?? 0) + 1);
  const done = new Map<string, Set<string>>();
  for (const a of inWeek(attempts, ownerId, start)) {
    const setId = setOf.get(a.questionId);
    if (!setId) continue;
    done.set(setId, (done.get(setId) ?? new Set()).add(a.questionId));
  }
  let n = 0;
  for (const [setId, ids] of done) if (ids.size >= (size.get(setId) ?? Infinity)) n++;
  return n;
}

export function weekLabel(start: number): string {
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${fmt(start)} to ${fmt(start + 6 * DAY)}`;
}

/** Publish this week's figures for the signed-in person. Always kept; shown to others only once they opt in. */
export async function publishWeeklyCount(uid: string): Promise<void> {
  if (!cloudConfigured()) return;
  const settings = await getSettings();
  if (settings.cloudUser?.uid !== uid) return;
  const [attempts, library] = await Promise.all([db.attempts.filter((a) => belongsToAccount(a, uid) && a.submittedAt !== undefined).toArray(), loadLibrary()]);
  const start = weekStart(Date.now());
  const photo = settings.cloudUser?.photo && /^https:\/\//.test(settings.cloudUser.photo) ? settings.cloudUser.photo.slice(0, 2000) : undefined;
  const row = {
    uid, name: boardName(settings), visible: settings.social?.leaderboard === true, week: weekKey(Date.now()), ...(photo ? { photo } : {}),
    count: questionsInWeek(attempts, uid, start), sets: setsInWeek(attempts, library.questions, uid, start),
    prevCount: questionsInWeek(attempts, uid, start - 7 * DAY), prevSets: setsInWeek(attempts, library.questions, uid, start - 7 * DAY),
  };
  // Two copies: Firestore, and the site's own store, which keeps taking records (and can be
  // read) while Firestore's daily read budget is spent. One of the two must succeed.
  const [cloud, posted] = await Promise.allSettled([
    (async () => {
      const { firestore } = await communityServices();
      const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
      await setDoc(doc(firestore, "leaderboard", uid), { ...row, updatedAt: serverTimestamp() });
    })(),
    (async () => {
      const token = await idToken();
      if (!token) throw new Error("Sign in first.");
      const res = await fetch("/api/board", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(row) });
      if (!res.ok) throw new Error(`The board store answered ${res.status}.`);
    })(),
  ]);
  if (cloud.status === "rejected" && posted.status === "rejected") throw cloud.reason;
}

/** The board as read: `staleSince` is set when it is the last full count plus what devices reported since (null: no full count at all). */
export interface BoardRead { rows: LeaderboardRow[]; staleSince?: number | null }

export function staleNote(staleSince: number | null | undefined): string | null {
  if (staleSince === undefined) return null;
  if (!staleSince) return "The board cannot be fully counted right now. Showing what devices have reported.";
  const at = new Date(staleSince);
  const when = at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `Last fully counted at ${when}. Newer activity is added as devices report it.`;
}

/**
 * This week's board. The server adds it up from everyone's submitted answers when it can
 * (joined accounts only), so nobody is missing because their device has not been opened;
 * otherwise the rows students published themselves. Admins may ask for hidden rows too.
 */
export async function fetchLeaderboard(includeHidden = false): Promise<BoardRead> {
  if (!includeHidden) {
    try {
      const token = await idToken();
      const res = token ? await fetch("/api/progress?board=1", { headers: { authorization: `Bearer ${token}` } }) : null;
      if (res?.ok) {
        const body = (await res.json()) as { stale?: boolean; asOf?: number; rows: { uid: string; name: string; photo?: string; questions: number; sets: number; prevQuestions: number; prevSets: number }[] };
        return { rows: body.rows.map((r) => ({ uid: r.uid, name: r.name, count: r.questions, sets: r.sets, prevCount: r.prevQuestions, prevSets: r.prevSets, photo: r.photo, visible: true, updatedAt: Date.now() })), ...(body.stale ? { staleSince: body.asOf ?? null } : {}) };
      }
    } catch { /* fall back to the published rows */ }
  }
  // Fallback: the records students' own devices published. Someone who joined but has not
  // opened the site this week keeps their place with a zero, rather than vanishing.
  const { firestore } = await communityServices();
  const { collection, getDocs, limit, query, where } = await import("firebase/firestore");
  const filters = includeHidden ? [] : [where("visible", "==", true)];
  const snap = await getDocs(query(collection(firestore, "leaderboard"), ...filters, limit(200)));
  const thisWeek = weekKey(Date.now()); const lastWeek = weekKey(Date.now() - 7 * DAY);
  const rows = snap.docs.map((d) => {
    const v = d.data() as Record<string, unknown>;
    const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : 0);
    const at = v.updatedAt as { toMillis?: () => number } | undefined;
    const week = typeof v.week === "string" ? v.week : "";
    const current = week === thisWeek;
    const prev = current ? { count: n("prevCount"), sets: n("prevSets") } : week === lastWeek ? { count: n("count"), sets: n("sets") } : { count: 0, sets: 0 };
    return { uid: d.id, name: typeof v.name === "string" ? v.name : "Student", count: current ? n("count") : 0, sets: current ? n("sets") : 0, prevCount: prev.count, prevSets: prev.sets, photo: typeof v.photo === "string" && /^https:\/\//.test(v.photo) ? v.photo : undefined, visible: v.visible !== false, updatedAt: at?.toMillis?.() ?? 0 };
  });
  return { rows };
}

export const score = (row: LeaderboardRow, unit: LeaderboardUnit): number => (unit === "sets" ? row.sets : row.count);
const previous = (row: LeaderboardRow, unit: LeaderboardUnit): number => (unit === "sets" ? row.prevSets : row.prevCount);

export function sortRows(rows: LeaderboardRow[], unit: LeaderboardUnit): LeaderboardRow[] {
  return [...rows].sort((a, b) => score(b, unit) - score(a, unit) || a.name.localeCompare(b.name));
}

export function trend(row: LeaderboardRow, unit: LeaderboardUnit): "up" | "down" | "same" {
  const now = score(row, unit); const was = previous(row, unit);
  return now > was ? "up" : now < was ? "down" : "same";
}

/** The first sentence of a standing line, for tight spaces. */
export const firstSentence = (line: string): string => line.split(". ")[0].replace(/\.$/, "") + ".";

const ordinal = (n: number): string => { const s = ["th", "st", "nd", "rd"]; const v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };

/** One sentence about where the signed-in person stands, or null when they are not on the board. */
export function standing(sorted: LeaderboardRow[], uid: string, unit: LeaderboardUnit): string | null {
  const i = sorted.findIndex((r) => r.uid === uid);
  if (i < 0) return null;
  const me = score(sorted[i], unit);
  const word = unit === "sets" ? (me === 1 ? "set" : "sets") : (me === 1 ? "question" : "questions");
  if (i === 0) {
    const next = sorted[1];
    return next ? `You lead this week with ${me} ${word}. ${next.name} is ${me - score(next, unit)} behind.` : `You lead this week with ${me} ${word}.`;
  }
  const above = sorted[i - 1];
  const gap = score(above, unit) - me + 1;
  return `You're ${ordinal(i + 1)} with ${me} ${word}. ${gap} more to pass ${above.name}.`;
}
