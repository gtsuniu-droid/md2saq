/**
 * Weekly figures for every account, computed from their submitted attempts: questions
 * answered, and whole sets completed (every question of a bank set submitted in the week).
 * Pure, so it can be tested; the function feeds it rows read with a service account.
 */
export interface AttemptRow { uid: string; submittedAt: number; questionId: string; bankId?: string; order?: number }
export interface Figures { questions: number; sets: number }

const DAY = 24 * 3600 * 1000;

export function weekStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function figuresFor(attempts: AttemptRow[], questionCount: Map<string, number>, start: number): Figures {
  const inWeek = attempts.filter((a) => a.submittedAt >= start && a.submittedAt < start + 7 * DAY);
  const bySet = new Map<string, Set<number>>();
  for (const a of inWeek) if (a.bankId && a.order !== undefined) bySet.set(a.bankId, (bySet.get(a.bankId) ?? new Set()).add(a.order));
  let sets = 0;
  for (const [bankId, orders] of bySet) if (orders.size >= (questionCount.get(bankId) ?? Infinity)) sets++;
  return { questions: new Set(inWeek.map((a) => a.questionId)).size, sets };
}

/** This week and last week, per account. */
export function weeklyFigures(attempts: AttemptRow[], questionCount: Map<string, number>, now: number): Map<string, { week: Figures; last: Figures }> {
  const start = weekStart(now);
  const byUid = new Map<string, AttemptRow[]>();
  for (const a of attempts) byUid.set(a.uid, [...(byUid.get(a.uid) ?? []), a]);
  const out = new Map<string, { week: Figures; last: Figures }>();
  for (const [uid, rows] of byUid) out.set(uid, { week: figuresFor(rows, questionCount, start), last: figuresFor(rows, questionCount, start - 7 * DAY) });
  return out;
}

/** A device's leaderboard record as posted to the site's own store. */
export interface BoardRecord { name: string; photo?: string; visible: boolean; week: string; count: number; sets: number; prevCount: number; prevSets: number; at: number }
/** A device's record, whichever store it came from. */
export type Rec = Omit<BoardRecord, "name" | "visible"> & { name?: string; visible?: boolean };
export type Pair = { week: { questions: number; sets: number }; last: { questions: number; sets: number } };
const zero: Pair = { week: { questions: 0, sets: 0 }, last: { questions: 0, sets: 0 } };
export interface Row { uid: string; name: string; email?: string; photo?: string; nickname?: string; joined: boolean; questions: number; sets: number; prevQuestions: number; prevSets: number; lastSeenAt?: number; source: "server" | "device" | "none" }
export type CacheBody = { at: number; week: number; accounts: number; rowsWithEmail: Row[]; stale?: true; asOf?: number; reason?: string };
/** The board table every visitor is served, kept in the bank's store; a full count is redone once it is this old. */
export const CACHE_KEY = "progress-cache";
export const CACHE_MS = 10 * 60_000;
export const sortRows = (rows: Row[]) => rows.sort((a, b) => b.questions - a.questions || a.name.localeCompare(b.name));

/** A device's record as this week's and last week's figures, given which week it describes. */
export function fromRecord(n: Rec | undefined, now: number): Pair {
  if (!n) return zero;
  if (n.week === weekKey(now)) return { week: { questions: n.count, sets: n.sets }, last: { questions: n.prevCount, sets: n.prevSets } };
  if (n.week === weekKey(now - 7 * 24 * 3600 * 1000)) return { week: { questions: 0, sets: 0 }, last: { questions: n.count, sets: n.sets } };
  return zero;
}

/**
 * An account's row with its device's record laid over it: the nickname, photo and joined flag
 * from the record, and the higher of the two counts (counts only grow within a week, and the
 * device may know of answers the server has not been sent yet, or the reverse).
 */
export function overlay(cur: Row | undefined, uid: string, p: Rec, now: number): Row {
  const f = fromRecord(p, now);
  const device = { questions: f.week.questions, sets: f.week.sets, prevQuestions: f.last.questions, prevSets: f.last.sets };
  if (!cur) return { uid, name: (p.name ?? "").trim().split(/\s+/)[0] || "Student", photo: p.photo, nickname: p.name, joined: p.visible !== false, lastSeenAt: p.at, ...device, source: "device" };
  const raised = device.questions > cur.questions || device.sets > cur.sets;
  return {
    ...cur, nickname: p.name ?? cur.nickname, photo: p.photo ?? cur.photo, joined: p.visible !== false, lastSeenAt: Math.max(cur.lastSeenAt ?? 0, p.at),
    questions: Math.max(cur.questions, device.questions), sets: Math.max(cur.sets, device.sets),
    prevQuestions: Math.max(cur.prevQuestions, device.prevQuestions), prevSets: Math.max(cur.prevSets, device.prevSets),
    source: raised ? "device" : cur.source,
  };
}

/**
 * The cached table with one record just posted laid over it, so a student who opens the board
 * sees their own count straight away and everyone else sees it on their next read. Null when
 * the table is from an earlier week: only a full count can start a new one.
 */
export function withRecord(table: CacheBody | null, uid: string, p: Rec, now: number): CacheBody | null {
  if (!table || table.week !== weekStart(now)) return null;
  const rows = table.rowsWithEmail.filter((r) => r.uid !== uid);
  rows.push(overlay(table.rowsWithEmail.find((r) => r.uid === uid), uid, p, now));
  return { ...table, accounts: rows.length, rowsWithEmail: sortRows(rows) };
}

/** What the public board shows: joined accounts only, under their nicknames, no emails. */
export function publicBoard(body: CacheBody) {
  const state = body.stale ? { stale: true, asOf: body.asOf, reason: body.reason } : {};
  return { week: body.week, ...state, rows: body.rowsWithEmail.filter((r) => r.joined).map((r) => ({ uid: r.uid, name: r.nickname || r.name, photo: r.photo, questions: r.questions, sets: r.sets, prevQuestions: r.prevQuestions, prevSets: r.prevSets })) };
}

/**
 * When Firestore cannot be read: the last full table, with every record posted since it was
 * made laid over it (newer figures, a new nickname, joining), and accounts it never saw added
 * from their records. Nothing is cached from this, so the next request tries Firestore again.
 */
export function staleTable(last: CacheBody | null, posted: Map<string, Rec>, now: number, reason: string): CacheBody {
  const sameWeek = last?.week === weekStart(now);
  const rows = new Map<string, Row>();
  for (const r of last?.rowsWithEmail ?? []) rows.set(r.uid, sameWeek ? { ...r } : { ...r, questions: 0, sets: 0, prevQuestions: r.questions, prevSets: r.sets });
  for (const [uid, p] of posted) {
    const cur = rows.get(uid);
    if (cur && p.at <= (last?.at ?? 0)) continue;
    rows.set(uid, overlay(cur, uid, p, now));
  }
  const rowsWithEmail = sortRows([...rows.values()]);
  return { at: now, week: weekStart(now), accounts: rowsWithEmail.length, rowsWithEmail, stale: true, asOf: last?.at, reason };
}

/** The ISO week id, matching what devices write on their rows. */
export function weekKey(ts: number): string {
  const d = new Date(weekStart(ts));
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3);
  const year = thursday.getFullYear();
  const firstWeekStart = weekStart(new Date(year, 0, 4).getTime());
  const week = Math.round((weekStart(thursday.getTime()) - firstWeekStart) / (7 * 24 * 3600 * 1000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
