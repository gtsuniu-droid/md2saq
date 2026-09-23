import type { Mark, ReviewRating, ReviewSchedule } from "../data/types";
import type { HistoryEntry } from "./history";
import { db, getSettings } from "../data/db";
import { belongsToAccount } from "./progressAccount";

const MINUTE = 60_000;
export const NEW_REVIEWS_PER_DAY = 10;
export const REVIEW_BATCH_SIZE = 10;

/** A small SM-2-style scheduler, with short relearning steps. Not Anki's FSRS. */
export function nextReview(previous: ReviewSchedule | undefined, rating: ReviewRating, now: number): ReviewSchedule {
  let ease = previous?.ease ?? 2.5;
  let repetitions = previous?.repetitions ?? 0;
  let lapses = previous?.lapses ?? 0;
  let intervalDays = previous?.intervalDays ?? 0;
  let minutes = 0;
  if (rating === "again") {
    minutes = 5; intervalDays = 0; repetitions = 0; lapses++;
    ease = Math.max(1.3, ease - .2);
  } else if (rating === "hard") {
    ease = Math.max(1.3, ease - .15);
    if (!intervalDays) minutes = 10;
    else intervalDays = Math.max(1, Math.ceil(intervalDays * 1.2));
  } else if (rating === "good") {
    intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.max(intervalDays + 1, Math.round(intervalDays * ease));
    repetitions++;
  } else {
    intervalDays = repetitions === 0 ? 4 : Math.max(intervalDays + 1, Math.round(intervalDays * ease * 1.3));
    repetitions++; ease += .15;
  }
  intervalDays = Math.min(intervalDays, 365);
  const due = new Date(now);
  if (minutes) due.setTime(now + minutes * MINUTE);
  else { due.setDate(due.getDate() + intervalDays); due.setHours(0, 0, 0, 0); }
  return { dueAt: due.getTime(), intervalDays, ease, repetitions, lapses, reviewedAt: now, introducedAt: previous?.introducedAt ?? now, rating };
}

export function reviewIntervalLabel(schedule: ReviewSchedule, now: number): string {
  if (!schedule.intervalDays) return `${Math.round((schedule.dueAt - now) / MINUTE)} min`;
  return `${schedule.intervalDays} ${schedule.intervalDays === 1 ? "day" : "days"}`;
}

export interface ReviewQueueItem { entry: HistoryEntry; topic: string; reasons: string[] }

/** Scheduled work first; introduce at most ten new questions each local day. */
export function reviewQueue(items: ReviewQueueItem[], marks: Mark[], now: number) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const introduced = new Set(marks.filter((m) => m.reviewSchedule && m.reviewSchedule.introducedAt >= start.getTime() && m.reviewSchedule.introducedAt <= now).map((m) => m.questionId));
  const allowance = Math.max(0, NEW_REVIEWS_PER_DAY - introduced.size);
  const scheduled = items.filter((x) => x.entry.mark?.reviewSchedule);
  const due = scheduled.filter((x) => x.entry.mark!.reviewSchedule!.dueAt <= now).sort((a, b) => a.entry.mark!.reviewSchedule!.dueAt - b.entry.mark!.reviewSchedule!.dueAt);
  const fresh = items.filter((x) => !x.entry.mark?.reviewSchedule).sort((a, b) => a.entry.mark!.markedAt - b.entry.mark!.markedAt || a.entry.attempt.id.localeCompare(b.entry.attempt.id));
  const ready = [...due, ...fresh.slice(0, allowance)];
  return {
    ready, visible: ready.slice(0, REVIEW_BATCH_SIZE),
    later: scheduled.filter((x) => x.entry.mark!.reviewSchedule!.dueAt > now).sort((a, b) => a.entry.mark!.reviewSchedule!.dueAt - b.entry.mark!.reviewSchedule!.dueAt),
    waiting: Math.max(0, fresh.length - allowance), allowance,
  };
}

/** Reject stale clicks rather than scheduling twice from two devices/tabs. */
export async function rateReview(markId: string, rating: ReviewRating, expectedStamp: number | undefined, now = Date.now()) {
  const owner = (await getSettings()).cloudUser?.uid ?? "";
  if (!["again", "hard", "good", "easy"].includes(rating)) throw new Error("Choose a review rating.");
  return db.transaction("rw", db.marks, async () => {
    const mark = await db.marks.get(markId);
    if (!mark || !belongsToAccount(mark, owner)) throw new Error("This review belongs to another account.");
    if (mark._m !== expectedStamp) throw new Error("This review has changed. Please rate the refreshed version.");
    const schedule = nextReview(mark.reviewSchedule, rating, now);
    await db.marks.update(markId, { reviewSchedule: schedule });
    return schedule;
  });
}
