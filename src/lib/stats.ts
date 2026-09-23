import type { Attempt, Mark, Question } from "../data/types";

/** Local calendar day key, YYYY-MM-DD. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DayCount {
  day: string;
  answered: number;
}

/** Questions submitted per local day. */
export function answeredPerDay(attempts: Attempt[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of attempts) {
    if (a.submittedAt === undefined) continue;
    const k = dayKey(a.submittedAt);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

export interface Summary {
  answered: number;
  /** Mean score percentage over marked attempts, or null when nothing is marked. */
  correctPct: number | null;
  /** Answered per active day. */
  dailyAvg: number;
  /** Mean seconds per answered question, or null. */
  secondsPerQuestion: number | null;
  activeDays: number;
}

export function summarise(attempts: Attempt[], marks: Mark[], from?: number, to?: number): Summary {
  const inRange = attempts.filter((a) => a.submittedAt !== undefined && (from === undefined || a.submittedAt >= from) && (to === undefined || a.submittedAt < to));
  const ids = new Set(inRange.map((a) => a.id));
  const marked = marks.filter((m) => ids.has(m.attemptId) && m.maxScore > 0);
  const days = new Set(inRange.map((a) => dayKey(a.submittedAt!)));
  const withTime = inRange.filter((a) => a.elapsedSec > 0);
  return {
    answered: inRange.length,
    correctPct: marked.length ? Math.round((100 * marked.reduce((acc, m) => acc + m.score / m.maxScore, 0)) / marked.length) : null,
    dailyAvg: days.size ? Math.round((inRange.length / days.size) * 10) / 10 : 0,
    secondsPerQuestion: withTime.length ? Math.round(withTime.reduce((acc, a) => acc + a.elapsedSec, 0) / withTime.length) : null,
    activeDays: days.size,
  };
}

export interface HeatCell {
  day: string;
  ts: number;
  count: number;
  /** 0 for none, 1-4 for increasing activity. */
  level: number;
}

export interface HeatGrid {
  /** Columns are weeks, each with 7 cells Monday to Sunday. Cells before the start are null. */
  weeks: (HeatCell | null)[][];
  /** Month labels by column index. */
  months: { col: number; label: string }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** A GitHub-style grid covering the `days` days ending at `end` (inclusive). */
export function heatGrid(perDay: Map<string, number>, end: number, days: number): HeatGrid {
  const endDay = startOfDay(end);
  const start = new Date(endDay);
  start.setDate(start.getDate() - (days - 1));
  // Back up to Monday so every column is a full week.
  const mondayOffset = (start.getDay() + 6) % 7;
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - mondayOffset);

  // Fixed daily thresholds keep colours comparable across date ranges.
  const level = (n: number) => n >= 20 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : n >= 1 ? 1 : 0;

  const weeks: (HeatCell | null)[][] = [];
  const months: { col: number; label: string }[] = [];
  let cursor = new Date(gridStart);
  let lastMonth = -1;
  while (cursor <= endDay) {
    const week: (HeatCell | null)[] = [];
    for (let i = 0; i < 7; i++) {
      if (cursor < start || cursor > endDay) {
        week.push(null);
      } else {
        const key = dayKey(cursor.getTime());
        const count = perDay.get(key) ?? 0;
        week.push({ day: key, ts: cursor.getTime(), count, level: level(count) });
        if (cursor.getMonth() !== lastMonth && cursor.getDate() <= 7) {
          if (!months.some((m) => m.col === weeks.length)) months.push({ col: weeks.length, label: MONTHS[cursor.getMonth()] });
          lastMonth = cursor.getMonth();
        }
      }
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return { weeks, months };
}

export interface PresentationProgress {
  id: string;
  total: number;
  attempted: number;
  marked: number;
  /** Mean score percentage over marked questions, or null. */
  meanPct: number | null;
}

/** Presentation ids a question counts toward: its own, plus the parents of any child ids. */
export function effectivePresentations(q: Question, parentOf: Map<string, string>): string[] {
  const out = new Set(q.presentations);
  for (const p of q.presentations) {
    const parent = parentOf.get(p);
    if (parent) out.add(parent);
  }
  return [...out];
}

export function presentationProgress(questions: Question[], attempts: Attempt[], marks: Mark[], ids: string[], parentOf: Map<string, string> = new Map()): Map<string, PresentationProgress> {
  const attemptedQ = new Set(attempts.filter((a) => a.submittedAt !== undefined).map((a) => a.questionId));
  const lastMark = new Map<string, Mark>();
  for (const m of [...marks].sort((a, b) => a.markedAt - b.markedAt)) lastMark.set(m.questionId, m);
  const out = new Map<string, PresentationProgress>(ids.map((id) => [id, { id, total: 0, attempted: 0, marked: 0, meanPct: null }]));
  const sums = new Map<string, { sum: number; n: number }>();
  for (const q of questions) {
    for (const pid of effectivePresentations(q, parentOf)) {
      const p = out.get(pid);
      if (!p) continue;
      p.total++;
      if (attemptedQ.has(q.id)) p.attempted++;
      const m = lastMark.get(q.id);
      if (m) {
        p.marked++;
        if (m.maxScore > 0) {
          const s = sums.get(pid) ?? { sum: 0, n: 0 };
          s.sum += m.score / m.maxScore;
          s.n++;
          sums.set(pid, s);
        }
      }
    }
  }
  for (const [pid, s] of sums) out.get(pid)!.meanPct = Math.round((100 * s.sum) / s.n);
  return out;
}

/**
 * Compile a session from the chosen presentations: random pick of `count`
 * questions (or all), optionally unattempted only, then ordered by set and
 * position so cases stay together.
 */
export function compileQuestions(
  questions: Question[],
  attempts: Attempt[],
  presentationIds: string[],
  options: { count?: number; newOnly?: boolean; random: () => number; parentOf?: Map<string, string> },
): Question[] {
  const chosen = new Set(presentationIds);
  const parentOf = options.parentOf ?? new Map<string, string>();
  const attemptedQ = new Set(attempts.filter((a) => a.submittedAt !== undefined).map((a) => a.questionId));
  let pool = questions.filter((q) => effectivePresentations(q, parentOf).some((p) => chosen.has(p)));
  if (options.newOnly) pool = pool.filter((q) => !attemptedQ.has(q.id));
  // Fisher-Yates with the supplied random source.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(options.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (options.count && options.count > 0) pool = pool.slice(0, options.count);
  const setOrder = new Map<string, number>();
  for (const q of pool) if (!setOrder.has(q.setId)) setOrder.set(q.setId, setOrder.size);
  return pool.sort((a, b) => setOrder.get(a.setId)! - setOrder.get(b.setId)! || a.order - b.order);
}
