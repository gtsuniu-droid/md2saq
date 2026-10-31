import { NICKNAME_JOINED_UNTIL } from "../../netlify/lib/progress";
import { db, getSettings, patchSettings } from "../data/db";
import type { Attempt, Question, SocialSettings } from "../data/types";
import { cloudConfigured, communityServices, idToken, services } from "./firebase";
import { loadLibrary } from "./library";
import { belongsToAccount } from "./progressAccount";
import { isBlankAttempt } from "./blankAttempt";
import { getProgressSyncState, syncNow } from "./sync";

/**
 * A weekly leaderboard, Monday to Sunday in the student's local time, counted by questions
 * answered or by whole sets completed. Each person publishes their own counts under
 * leaderboard/{uid}; nobody can write another's.
 */
export type LeaderboardUnit = "questions" | "sets";
/** This week (Monday to Sunday) or everything the account has ever done. */
export type LeaderboardPeriod = "week" | "all";

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
  /** Everything ever: questions answered and sets completed, as the account's own device counted them. */
  total: number;
  totalSets: number;
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

/** A nickname saved with the join box unticked, from before the box ticked itself: meant as joining (see `NICKNAME_JOINED_UNTIL`). Leaving since then stands. */
export const nicknameMeantJoin = (s: SocialSettings): boolean => !s.leaderboard && !!s.username.trim() && (s.chosenAt ?? 0) < NICKNAME_JOINED_UNTIL;

const DAY = 24 * 3600 * 1000;
/** A sync this recent means the device's answers are the account's. */
const FRESH_MS = 2 * 60_000;

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

// A set clicked through with nothing written is not work done: blank attempts never count.
const counted = (attempts: Attempt[], ownerId: string) => attempts.filter((a) => belongsToAccount(a, ownerId) && a.submittedAt !== undefined && !isBlankAttempt(a));
const inWeek = (attempts: Attempt[], ownerId: string, start: number) => counted(attempts, ownerId).filter((a) => a.submittedAt! >= start && a.submittedAt! < start + 7 * DAY);

/** Sets of which every question is among these attempts. */
function completedSets(attempts: Attempt[], questions: Pick<Question, "id" | "setId">[]): number {
  const setOf = new Map(questions.map((q) => [q.id, q.setId]));
  const size = new Map<string, number>();
  for (const q of questions) size.set(q.setId, (size.get(q.setId) ?? 0) + 1);
  const done = new Map<string, Set<string>>();
  for (const a of attempts) {
    const setId = setOf.get(a.questionId);
    if (!setId) continue;
    done.set(setId, (done.get(setId) ?? new Set()).add(a.questionId));
  }
  let n = 0;
  for (const [setId, ids] of done) if (ids.size >= (size.get(setId) ?? Infinity)) n++;
  return n;
}

/** Everything the account has ever answered (every sitting, as the week counts them), and the sets it completed along the way. */
export function allTimeFigures(attempts: Attempt[], questions: Pick<Question, "id" | "setId">[], ownerId: string): { total: number; totalSets: number } {
  const mine = counted(attempts, ownerId);
  return { total: mine.length, totalSets: completedSets(mine, questions) };
}

/** Distinct questions answered by this account in the week starting at `start`; a resit of the same question is not a second question. */
export function questionsInWeek(attempts: Attempt[], ownerId: string, start: number): number {
  return new Set(inWeek(attempts, ownerId, start).map((a) => a.questionId)).size;
}

/** Sets completed in the week: every question of the set submitted within it. */
export function setsInWeek(attempts: Attempt[], questions: Pick<Question, "id" | "setId">[], ownerId: string, start: number): number {
  return completedSets(inWeek(attempts, ownerId, start), questions);
}

export function weekLabel(start: number): string {
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${fmt(start)} to ${fmt(start + 6 * DAY)}`;
}

/**
 * Publish this week's figures for the signed-in person. Always kept; shown to others only once
 * they opt in. Resolves with the board as it stands with these figures in it, when the site
 * could hand it back, so opening the board takes one request; null means read it yourself.
 * With `ifChanged`, nothing is sent when the same figures went up in the last quarter hour.
 * Every board that comes back is passed to the views listening with `onBoard`.
 */
export async function publishWeeklyCount(uid: string, opts: { ifChanged?: boolean } = {}): Promise<BoardRead | null> {
  if (!cloudConfigured()) return null;
  let settings = await getSettings();
  if (settings.cloudUser?.uid !== uid) return null;
  // Count from the account's answers, not just this device's: pull first unless a sync just
  // ran or is running now (sync itself publishes after pushing), waiting a few seconds at most
  // so a stalled sync cannot hold the board. A device whose pull is fresh speaks for the
  // account; one whose is not can only raise the week's figures.
  const synced = (state = getProgressSyncState()) => state.uid === uid && state.status === "synced" && Date.now() - (state.at ?? 0) < FRESH_MS;
  if (!synced() && getProgressSyncState().status !== "syncing") await Promise.race([syncNow(settings.cloudUser).catch(() => null), new Promise((r) => setTimeout(r, 4000))]);
  const complete = synced();
  if (settings.social && nicknameMeantJoin(settings.social)) {
    const social = { ...settings.social, leaderboard: true, chosenAt: Date.now() };
    await patchSettings({ social });
    settings = { ...settings, social };
  }
  const [attempts, library] = await Promise.all([db.attempts.filter((a) => belongsToAccount(a, uid) && a.submittedAt !== undefined).toArray(), loadLibrary()]);
  const start = weekStart(Date.now());
  const photo = settings.cloudUser?.photo && /^https:\/\//.test(settings.cloudUser.photo) ? settings.cloudUser.photo.slice(0, 2000) : undefined;
  // Whether to be on the board is said only by a device that has seen the student choose.
  const social = settings.social;
  const row = {
    uid, name: boardName(settings), week: weekKey(Date.now()), ...(photo ? { photo } : {}),
    count: questionsInWeek(attempts, uid, start), sets: setsInWeek(attempts, library.questions, uid, start),
    prevCount: questionsInWeek(attempts, uid, start - 7 * DAY), prevSets: setsInWeek(attempts, library.questions, uid, start - 7 * DAY),
    ...allTimeFigures(attempts, library.questions, uid),
  };
  // Two copies: the site's own store, which the board is served from and which has no daily
  // read budget, and Firestore, kept for the Admin page and as a fallback. Only the first is
  // waited for, and Firestore is written only when the figures changed or every few hours.
  const choice = social ? { visible: social.leaderboard === true } : null;
  const cloud = (async () => {
    if (!choice) return;
    const doc_ = { ...row, ...choice };
    const key = `leaderboard.written.${uid}`; const sig = JSON.stringify(doc_);
    try { const was = JSON.parse(localStorage.getItem(key) ?? "null") as { sig: string; at: number } | null; if (was?.sig === sig && Date.now() - was.at < 6 * 3600_000) return; } catch { /* write it */ }
    const { firestore } = await communityServices();
    const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
    await setDoc(doc(firestore, "leaderboard", uid), { ...doc_, updatedAt: serverTimestamp() });
    try { localStorage.setItem(key, JSON.stringify({ sig, at: Date.now() })); } catch { /* fine */ }
  })();
  cloud.catch(() => undefined); // finishes in the background; only matters below if the post fails
  const body = JSON.stringify({ ...row, ...(complete ? { complete } : {}), ...(choice ? { ...choice, choiceAt: social?.chosenAt ?? 0 } : {}) });
  if (opts.ifChanged && lastPost?.uid === uid && lastPost.body === body && Date.now() - lastPost.at < 15 * 60_000) return null;
  lastPost = { uid, body, at: Date.now() };
  try {
    const token = await idToken();
    if (!token) throw new Error("Sign in first.");
    const res = await fetch("/api/board", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body });
    if (!res.ok) throw new Error(`The board store answered ${res.status}.`);
    const board = boardFrom(await res.json());
    for (const listener of listeners) listener(board);
    return board;
  } catch (e) {
    lastPost = null;
    await cloud.catch(() => { throw e; });
    return null;
  }
}

/** The last figures sent, so moving between pages only posts when they changed. */
let lastPost: { uid: string; body: string; at: number } | null = null;

function withMine(board: BoardRead): BoardRead {
  if (!lastPost) return board;
  const mine = JSON.parse(lastPost.body) as { count: number; sets: number; week: string };
  if (mine.week !== weekKey(Date.now())) return board;
  const uid = lastPost.uid;
  return { ...board, rows: board.rows.map((r) => r.uid === uid ? { ...r, count: Math.max(r.count, mine.count), sets: Math.max(r.sets, mine.sets) } : r) };
}
const listeners = new Set<(board: BoardRead) => void>();
/** Hear about every board a post brings back, wherever in the app it was made. */
export function onBoard(listener: (board: BoardRead) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type BoardBody = { stale?: boolean; asOf?: number; rows: { uid: string; name: string; photo?: string; questions: number; sets: number; prevQuestions: number; prevSets: number; total?: number; totalSets?: number }[] };
const boardFrom = (body: BoardBody): BoardRead => ({
  rows: body.rows.map((r) => ({ uid: r.uid, name: r.name, count: r.questions, sets: r.sets, prevCount: r.prevQuestions, prevSets: r.prevSets, total: r.total ?? 0, totalSets: r.totalSets ?? 0, photo: r.photo, visible: true, updatedAt: Date.now() })),
  ...(body.stale ? { staleSince: body.asOf ?? null } : {}),
});

/** The board as read. `staleSince` is set when it is the last full count plus what devices reported since (null: no full count yet); the board itself never says so, only the Admin table. */
export interface BoardRead { rows: LeaderboardRow[]; staleSince?: number | null }

export function staleNote(staleSince: number | null | undefined): string | null {
  if (staleSince === undefined) return null;
  if (!staleSince) return "No full count yet: showing what devices have reported.";
  const at = new Date(staleSince);
  const when = at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `Last fully counted at ${when}; newer activity added from devices' records.`;
}

/**
 * This week's board. The server adds it up from everyone's submitted answers when it can
 * (joined accounts only), so nobody is missing because their device has not been opened;
 * otherwise the rows students published themselves. Admins may ask for hidden rows too.
 */
export async function fetchLeaderboard(includeHidden = false): Promise<BoardRead> {
  if (!includeHidden) {
    try {
      // The same for everyone, so no sign-in is sent, and the copy may be up to half a minute
      // old: this device's own figures, if it posted newer ones since, are kept.
      const res = await fetch("/api/progress?board=1");
      if (res.ok) return withMine(boardFrom(await res.json()));
    } catch { /* fall back to the published rows */ }
  }
  // Fallback: the records students' own devices published. Someone who joined but has not
  // opened the site this week keeps their place with a zero, rather than vanishing.
  const { firestore } = await services();
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
    return { uid: d.id, name: typeof v.name === "string" ? v.name : "Student", count: current ? n("count") : 0, sets: current ? n("sets") : 0, prevCount: prev.count, prevSets: prev.sets, total: n("total"), totalSets: n("totalSets"), photo: typeof v.photo === "string" && /^https:\/\//.test(v.photo) ? v.photo : undefined, visible: v.visible !== false, updatedAt: at?.toMillis?.() ?? 0 };
  });
  return { rows };
}

export const score = (row: LeaderboardRow, unit: LeaderboardUnit, period: LeaderboardPeriod = "week"): number =>
  period === "all" ? (unit === "sets" ? row.totalSets : row.total) : unit === "sets" ? row.sets : row.count;
const previous = (row: LeaderboardRow, unit: LeaderboardUnit): number => (unit === "sets" ? row.prevSets : row.prevCount);

export function sortRows(rows: LeaderboardRow[], unit: LeaderboardUnit, period: LeaderboardPeriod = "week"): LeaderboardRow[] {
  return [...rows].sort((a, b) => score(b, unit, period) - score(a, unit, period) || a.name.localeCompare(b.name));
}

export function trend(row: LeaderboardRow, unit: LeaderboardUnit): "up" | "down" | "same" {
  const now = score(row, unit); const was = previous(row, unit);
  return now > was ? "up" : now < was ? "down" : "same";
}

/** The first sentence of a standing line, for tight spaces. */
export const firstSentence = (line: string): string => line.split(". ")[0].replace(/\.$/, "") + ".";

const ordinal = (n: number): string => { const s = ["th", "st", "nd", "rd"]; const v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };

/** One sentence about where the signed-in person stands, or null when they are not on the board. */
export function standing(sorted: LeaderboardRow[], uid: string, unit: LeaderboardUnit, period: LeaderboardPeriod = "week"): string | null {
  const i = sorted.findIndex((r) => r.uid === uid);
  if (i < 0) return null;
  const me = score(sorted[i], unit, period);
  const word = unit === "sets" ? (me === 1 ? "set" : "sets") : (me === 1 ? "question" : "questions");
  const when = period === "all" ? "all time" : "this week";
  if (i === 0) {
    const next = sorted[1];
    return next ? `You lead ${when} with ${me} ${word}. ${next.name} is ${me - score(next, unit, period)} behind.` : `You lead ${when} with ${me} ${word}.`;
  }
  const above = sorted[i - 1];
  const gap = score(above, unit, period) - me + 1;
  return `You're ${ordinal(i + 1)} with ${me} ${word}. ${gap} more to pass ${above.name}.`;
}
