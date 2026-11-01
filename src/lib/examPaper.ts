import type { Question, QuestionSet } from "../data/types";
import { primaryPresentation } from "./primaryPresentation";
import { PRESENTATIONS } from "../data/presentations";

export const EXAM_STEMS = 6;
export const EXAM_MAX_STEMS = 10;
/** The fixed exam gives 15 minutes reading and 2 hours writing for six sets; other sizes keep the rate. */
export const EXAM_READING_PER_SET = 150;
export const EXAM_WRITING_PER_SET = 20 * 60;
export const EXAM_READING_SEC = EXAM_STEMS * EXAM_READING_PER_SET;
export const EXAM_WRITING_SEC = EXAM_STEMS * EXAM_WRITING_PER_SET;

/** Draw presentations first so a large topic bank is not more likely to appear. */
export function examPresentationPool(sets: QuestionSet[], questions: Question[]) {
  const bySet = new Map<string, Question[]>();
  for (const q of questions) bySet.set(q.setId, [...(bySet.get(q.setId) ?? []), q]);
  const pool = new Map<string, Question[][]>();
  for (const set of sets) {
    const members = (bySet.get(set.id) ?? []).sort((a, b) => a.order - b.order);
    if (!members.length) continue;
    const primary = primaryPresentation(set, members);
    if (!primary || !PRESENTATIONS.some((p) => p.id === primary)) continue;
    pool.set(primary, [...(pool.get(primary) ?? []), members]);
  }
  return pool;
}

export interface ExamOptions {
  /** How many sets, 1 to 10. */
  count?: number;
  /** Draw only from these presentation ids; empty or missing means the whole bank. */
  presentations?: string[];
  /** Ids of sets already sat: the paper takes unattempted sets first and these only when it must. */
  attempted?: ReadonlySet<string>;
}

/** Reading and writing time for a paper of this many sets, at the fixed exam's rate. */
export function examTiming(count: number): { readingSec: number; totalSec: number } {
  return { readingSec: count * EXAM_READING_PER_SET, totalSec: count * EXAM_WRITING_PER_SET };
}

/**
 * Draw the paper: one set per presentation, so a large topic bank is not more likely to appear
 * and no two sets share a presentation. Drawing from the whole bank, a paper wanting more sets
 * than there are presentations fills up with further sets from the same presentations; drawing
 * from chosen presentations never does, so choosing six presentations gives six different ones.
 * Given the sets already sat, unattempted sets come first, and sets sat before fill the paper
 * only when there are not enough of them. Empty when the pool cannot supply the count.
 */
export function buildExamPaper(sets: QuestionSet[], questions: Question[], random = Math.random, options: ExamOptions = {}): Question[] {
  const count = Math.min(EXAM_MAX_STEMS, Math.max(1, Math.round(options.count ?? EXAM_STEMS)));
  const chosen = new Set(options.presentations ?? []);
  const pool = new Map([...examPresentationPool(sets, questions)].filter(([id]) => !chosen.size || chosen.has(id)));
  const shuffle = <T,>(items: T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  const fresh = (members: Question[]) => !options.attempted?.has(members[0].setId);
  // Sets are popped from the end, so unattempted ones go last; presentations with one left go first.
  const freshLast = (cases: Question[][]) => [...cases.filter((c) => !fresh(c)), ...cases.filter(fresh)];
  const freshFirst = (ids: string[]) => [...ids.filter((id) => remaining.get(id)!.some(fresh)), ...ids.filter((id) => !remaining.get(id)!.some(fresh))];
  const remaining = new Map([...pool].map(([id, cases]) => [id, freshLast(shuffle(cases))]));
  const supply = chosen.size ? remaining.size : [...remaining.values()].reduce((n, cases) => n + cases.length, 0);
  if (supply < count) return [];
  const paper: Question[][] = [];
  let order = freshFirst(shuffle([...remaining.keys()]));
  while (paper.length < count) {
    if (!order.length) order = freshFirst(shuffle([...remaining].filter(([, cases]) => cases.length).map(([id]) => id)));
    const id = order.shift()!;
    const cases = remaining.get(id)!;
    if (!cases.length) continue;
    paper.push(cases.pop()!);
  }
  return paper.flat();
}

/** How many sets a paper drawn this way can have: one per chosen presentation that has sets, or every set in the bank. */
export function examSupply(sets: QuestionSet[], questions: Question[], presentations?: string[]): number {
  const chosen = presentations?.length ? presentations : undefined;
  const pool = [...examPresentationPool(sets, questions)].filter(([id]) => !chosen || chosen.includes(id));
  return chosen ? pool.length : pool.reduce((n, [, cases]) => n + cases.length, 0);
}

/**
 * How many of a paper drawn with these options would be unattempted sets: the draw takes one
 * set per presentation a round at a time, presentations with an unattempted set first, so the
 * figure does not depend on the shuffle.
 */
export function examFreshCount(sets: QuestionSet[], questions: Question[], options: ExamOptions = {}): number {
  const count = Math.min(EXAM_MAX_STEMS, Math.max(1, Math.round(options.count ?? EXAM_STEMS)));
  const chosen = new Set(options.presentations ?? []);
  const pool = [...examPresentationPool(sets, questions)].filter(([id]) => !chosen.size || chosen.has(id));
  const left = pool.map(([, cases]) => { const fresh = cases.filter((c) => !options.attempted?.has(c[0].setId)).length; return { fresh, sat: cases.length - fresh }; });
  const supply = chosen.size ? left.length : left.reduce((n, p) => n + p.fresh + p.sat, 0);
  if (supply < count) return 0;
  let need = count, fresh = 0;
  while (need > 0) {
    const round = left.filter((p) => p.fresh + p.sat > 0).sort((a, b) => Number(b.fresh > 0) - Number(a.fresh > 0));
    if (!round.length) break;
    for (const p of round) {
      if (!need) break;
      if (p.fresh) { p.fresh--; fresh++; } else p.sat--;
      need--;
    }
  }
  return fresh;
}
