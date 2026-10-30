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

/**
 * A device's leaderboard record as posted to the site's own store. `choiceAt` is when the
 * student last joined or left (0: before that was recorded), which decides between devices
 * that disagree about it.
 */
export interface BoardRecord { name: string; photo?: string; visible: boolean; choiceAt?: number; week: string; count: number; sets: number; prevCount: number; prevSets: number; /** Everything ever, as the device counted it. */ total?: number; totalSets?: number; at: number }
/**
 * What a device posts: `visible` is left out when the device has no say (it never saw the
 * choice). `complete` says the device had synced the account's answers shortly before counting,
 * so its figures are the account's; without it, a device may know less than another did.
 */
export type Posted = Omit<BoardRecord, "visible"> & { visible?: boolean; complete?: boolean };

/**
 * Every account's latest record in one blob, so the board is read in one request and no
 * daily read budget applies to it.
 */
export type BoardTable = { records: Record<string, BoardRecord> };

/**
 * The stored record updated with a new post. Figures and nickname come from the post; whether
 * the account is on the board follows the newer choice, and with no dates to go by (records
 * from before choices were dated) joining wins. So a phone that never saw the student join
 * cannot take them off, while leaving from Settings still does.
 */
export function mergeRecord(stored: BoardRecord | undefined, post: Posted): BoardRecord {
  const keep = { visible: stored?.visible ?? false, choiceAt: stored?.choiceAt ?? 0 };
  const said = post.visible === undefined ? null : { visible: post.visible, choiceAt: post.choiceAt ?? 0 };
  const theirs = !!said && (said.choiceAt > keep.choiceAt || (said.choiceAt === keep.choiceAt && said.visible));
  // The nickname goes with the choice: a device that has not seen the student's choice, or
  // saw an older one, posts their first name, which must not replace the nickname they chose.
  const name = stored?.name && !theirs ? stored.name : post.name;
  const { complete: _complete, ...record } = post; void _complete;
  // A device that has not synced may be behind the one that answered: within the week it can
  // only raise the figures. A synced device's figures stand, lower included (a discarded set).
  const higher = stored && !post.complete && stored.week === post.week ? {
    count: Math.max(stored.count, post.count), sets: Math.max(stored.sets, post.sets),
    prevCount: Math.max(stored.prevCount, post.prevCount), prevSets: Math.max(stored.prevSets, post.prevSets),
    total: Math.max(stored.total ?? 0, post.total ?? 0), totalSets: Math.max(stored.totalSets ?? 0, post.totalSets ?? 0),
  } : {};
  return { ...record, ...higher, ...(theirs ? said : keep), name };
}

/**
 * Until the Settings page ticked the join box itself when a nickname was typed, students
 * picked a nickname and saved with the box unticked, meaning to be seen: a nickname saved
 * before this moment with the box unticked counts as joining. A choice saved since is explicit.
 */
export const NICKNAME_JOINED_UNTIL = Date.UTC(2026, 9, 29, 23, 30);

/**
 * The account's record joined, when its name is a chosen nickname (not the account's first
 * name) under a "no" from before nicknames meant joining; null when the record stands.
 */
export function joinByNickname(r: BoardRecord, accountName: string | undefined): BoardRecord | null {
  const first = (accountName ?? "").trim().split(/\s+/)[0].toLowerCase();
  const name = r.name.trim().toLowerCase();
  if (r.visible || !first || !name || name === first || (r.choiceAt ?? 0) >= NICKNAME_JOINED_UNTIL) return null;
  return { ...r, visible: true };
}
/**
 * A record from Firestore (where records were kept before the site's own store) taken into the
 * table. An account the table has no record of gets this one; one it has keeps its own figures
 * and nickname, and only takes the Firestore record's join under the usual rule (an undated join
 * beats an undated "no"), so nobody who joined is left off for having been seen by a stale device.
 */
export function adopt(stored: BoardRecord | undefined, legacy: Rec): BoardRecord {
  const visible = legacy.visible !== false;
  if (!stored) return { ...legacy, name: legacy.name || "Student", visible, choiceAt: 0 };
  return mergeRecord(stored, { ...stored, visible, choiceAt: 0 });
}

/** A device's record, whichever store it came from. */
export type Rec = Omit<BoardRecord, "name" | "visible"> & { name?: string; visible?: boolean };
export type Pair = { week: { questions: number; sets: number }; last: { questions: number; sets: number } };
const zero: Pair = { week: { questions: 0, sets: 0 }, last: { questions: 0, sets: 0 } };
export interface Row { uid: string; name: string; email?: string; photo?: string; nickname?: string; joined: boolean; questions: number; sets: number; prevQuestions: number; prevSets: number; total?: number; totalSets?: number; lastSeenAt?: number; source: "server" | "device" | "none" }
export type CacheBody = { at: number; week: number; accounts: number; rowsWithEmail: Row[]; stale?: true; asOf?: number; reason?: string };
/** The board table every visitor is served, kept in the bank's store; a full count is redone once it is this old. */
export const CACHE_KEY = "progress-cache";
/** The Admin table recounts once it is older than this; the public board only ever asks for a background recount, less often. */
export const CACHE_MS = 60 * 60_000;
export const RECOUNT_MS = 12 * 60 * 60_000;
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
  if (!cur) return { uid, name: (p.name ?? "").trim().split(/\s+/)[0] || "Student", photo: p.photo, nickname: p.name, joined: p.visible !== false, lastSeenAt: p.at, ...device, total: p.total ?? 0, totalSets: p.totalSets ?? 0, source: "device" };
  const raised = device.questions > cur.questions || device.sets > cur.sets;
  return {
    ...cur, nickname: p.name ?? cur.nickname, photo: p.photo ?? cur.photo, joined: p.visible !== false, lastSeenAt: Math.max(cur.lastSeenAt ?? 0, p.at),
    questions: Math.max(cur.questions, device.questions), sets: Math.max(cur.sets, device.sets),
    prevQuestions: Math.max(cur.prevQuestions, device.prevQuestions), prevSets: Math.max(cur.prevSets, device.prevSets),
    // All-time figures only grow; the device's own count is the fuller one.
    total: Math.max(cur.total ?? 0, p.total ?? 0), totalSets: Math.max(cur.totalSets ?? 0, p.totalSets ?? 0),
    source: raised ? "device" : cur.source,
  };
}

/** What the public board shows: joined accounts only, under their nicknames, no emails. */
export function publicBoard(body: CacheBody) {
  const state = body.stale ? { stale: true, asOf: body.asOf, reason: body.reason } : {};
  return { week: body.week, ...state, rows: body.rowsWithEmail.filter((r) => r.joined).map((r) => ({ uid: r.uid, name: r.nickname || r.name, photo: r.photo, questions: r.questions, sets: r.sets, prevQuestions: r.prevQuestions, prevSets: r.prevSets, total: r.total ?? 0, totalSets: r.totalSets ?? 0 })) };
}

/**
 * The board as it stands: the last full count (rolled into last week's column if it is from
 * an earlier week), with every account's latest device record laid over it, and accounts the
 * count never saw added from their records. Device records decide who is on the board.
 */
export function combine(last: CacheBody | null, posted: Map<string, Rec>, now: number): Row[] {
  const sameWeek = last?.week === weekStart(now);
  const rows = new Map<string, Row>();
  for (const r of last?.rowsWithEmail ?? []) rows.set(r.uid, sameWeek ? { ...r } : { ...r, questions: 0, sets: 0, prevQuestions: r.questions, prevSets: r.sets });
  for (const [uid, p] of posted) rows.set(uid, overlay(rows.get(uid), uid, p, now));
  return sortRows([...rows.values()]);
}

/** The table served between full counts. */
export function current(last: CacheBody | null, posted: Map<string, Rec>, now: number): CacheBody {
  const rowsWithEmail = combine(last, posted, now);
  return { at: last?.at ?? 0, week: weekStart(now), accounts: rowsWithEmail.length, rowsWithEmail };
}

/** When Firestore cannot be read for a full count: the same, marked as such for the Admin table. */
export function staleTable(last: CacheBody | null, posted: Map<string, Rec>, now: number, reason: string): CacheBody {
  return { ...current(last, posted, now), at: now, stale: true, asOf: last?.at, reason };
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
