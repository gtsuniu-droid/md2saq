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
