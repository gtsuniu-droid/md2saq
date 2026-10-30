import { describe, expect, it } from "vitest";
import type { Session } from "../data/types";
import { pausedSession, perSetClocks, remainingSec, resumedSession, setOvertimeSec, setRemainingSec, withSetClock } from "./sessionClock";

// A timed practice paper: the only kind that pauses. Exams run on regardless.
const base: Session = { id: "s", mode: "practice", questionIds: ["q1", "q2"], index: 0, totalSec: 600, startedAt: 1_000_000, attemptIds: [] };

describe("session clock", () => {
  it("freezes the clock while paused and hands the time back on resume", () => {
    const paused = pausedSession(base, base.startedAt + 100_000);
    expect(remainingSec(paused, base.startedAt + 100_000)).toBe(500);
    // An hour away changes nothing while paused.
    expect(remainingSec(paused, base.startedAt + 3_700_000)).toBe(500);
    const resumed = resumedSession(paused, base.startedAt + 3_700_000);
    expect(resumed.pausedAt).toBeUndefined();
    expect(remainingSec(resumed, base.startedAt + 3_700_000)).toBe(500);
    expect(remainingSec(resumed, base.startedAt + 3_760_000)).toBe(440);
  });

  it("pausing twice keeps the first pause time; resuming an unpaused session is a no-op", () => {
    const once = pausedSession(base, 5);
    expect(pausedSession(once, 99).pausedAt).toBe(5);
    expect(resumedSession(base, 99)).toEqual(base);
  });

  it("untimed papers have no remaining time", () => {
    expect(remainingSec({ ...base, totalSec: undefined }, 0)).toBeNull();
  });

  it("never goes below zero", () => {
    expect(remainingSec(base, base.startedAt + 601_000)).toBe(0);
  });
});

it("auto-submits only timed exams, including when reopened after expiry", async () => {
  const { shouldAutoSubmit, overtimeSec } = await import("./sessionClock");
  const after = base.startedAt + 630_000;
  const timedExam: Session = { ...base, mode: "exam" };
  expect(shouldAutoSubmit(timedExam, after)).toBe(true);
  expect(shouldAutoSubmit(timedExam, base.startedAt + 599_000)).toBe(false);
  expect(shouldAutoSubmit({ ...timedExam, totalSec: undefined }, after)).toBe(false);
  const practice = { ...base, mode: "practice" as const };
  expect(remainingSec(practice, after)).toBe(0);
  expect(shouldAutoSubmit(practice, after)).toBe(false);
  expect(overtimeSec(practice, after)).toBe(30);
  const paused = pausedSession(practice, after);
  expect(overtimeSec(paused, after + 60_000)).toBe(30);
  expect(shouldAutoSubmit(resumedSession(paused, after + 60_000), after + 61_000)).toBe(false);
});

describe("six-stem exam phases", () => {
  const exam: Session = { ...base, mode: "exam", examFormat: "six-stem", readingSec: 900, totalSec: 7200 };
  it("locks reading for 15 minutes then gives a full two hours to write", async () => {
    const { readingRemainingSec, canWriteAnswers, shouldAutoSubmit } = await import("./sessionClock");
    expect(readingRemainingSec(exam, exam.startedAt)).toBe(900);
    expect(remainingSec(exam, exam.startedAt + 899_999)).toBe(7200);
    expect(canWriteAnswers(exam, exam.startedAt + 899_999)).toBe(false);
    expect(canWriteAnswers(exam, exam.startedAt + 900_000)).toBe(true);
    expect(remainingSec(exam, exam.startedAt + 900_000)).toBe(7200);
    expect(shouldAutoSubmit(exam, exam.startedAt + 8_099_999)).toBe(false);
    expect(shouldAutoSubmit(exam, exam.startedAt + 8_100_000)).toBe(true);
    expect(canWriteAnswers(exam, exam.startedAt + 8_100_000)).toBe(false);
  });
  it("keeps deadlines after leaving, serializing, and resuming in either phase", () => {
    const left = pausedSession(exam, exam.startedAt + 60_000);
    expect(left.pausedAt).toBeUndefined();
    const restored = resumedSession(JSON.parse(JSON.stringify(left)), exam.startedAt + 1_000_000);
    expect(restored.startedAt).toBe(exam.startedAt);
    expect(remainingSec(restored, exam.startedAt + 1_000_000)).toBe(7100);
    expect(remainingSec({ ...restored, pausedAt: exam.startedAt }, exam.startedAt + 8_101_000)).toBe(0);
  });
});

it("an exam clock keeps running while the tab is away and submits the moment it reaches zero", async () => {
  const { pausedSession, remainingSec, resumedSession, shouldAutoSubmit } = await import("./sessionClock");
  const exam = { id: "e", mode: "exam" as const, questionIds: ["q"], attemptIds: ["a"], index: 0, startedAt: 1_000_000, totalSec: 600 };
  const paused = pausedSession(exam, exam.startedAt + 100_000);
  expect(paused.pausedAt).toBeUndefined();
  expect(remainingSec({ ...exam, pausedAt: exam.startedAt + 100_000 }, exam.startedAt + 400_000)).toBe(200);
  expect(resumedSession({ ...exam, pausedAt: exam.startedAt + 100_000 }, exam.startedAt + 400_000).startedAt).toBe(exam.startedAt);
  expect(shouldAutoSubmit(exam, exam.startedAt + 600_000)).toBe(true);
  expect(shouldAutoSubmit({ ...exam, mode: "practice" }, exam.startedAt + 600_000)).toBe(false);
});

it("runs a clock per set for timed practice in whole sets, which pauses and resumes with the paper", () => {
    const sets: Session = { ...base, studyUnit: "sets" };
    expect(perSetClocks(sets)).toBe(true);
    expect(perSetClocks(base)).toBe(false);
    expect(perSetClocks({ ...sets, mode: "exam" })).toBe(false);
    expect(perSetClocks({ ...sets, totalSec: undefined })).toBe(false);
    expect(setRemainingSec(sets, "q1", base.startedAt)).toBeNull();
    const started = withSetClock(sets, "q1", 300, base.startedAt + 50_000);
    expect(setRemainingSec(started, "q1", base.startedAt + 110_000)).toBe(240);
    // Opening the set again does not restart its clock.
    expect(withSetClock(started, "q1", 900, base.startedAt + 200_000).setClocks?.q1.totalSec).toBe(300);
    expect(setOvertimeSec(started, "q1", base.startedAt + 400_000)).toBe(50);
    const paused = pausedSession(started, base.startedAt + 110_000);
    const resumed = resumedSession(paused, base.startedAt + 1_000_000);
    expect(setRemainingSec(resumed, "q1", base.startedAt + 1_000_000)).toBe(240);
});

it("a set opened while the paper is paused for marking starts its clock the moment the paper resumes", () => {
  const sets: Session = { ...base, studyUnit: "sets" };
  // The first set was submitted and the paper paused while it is marked; marking took ten minutes.
  const paused = pausedSession(withSetClock(sets, "q1", 300, base.startedAt), base.startedAt + 100_000);
  const opened = withSetClock(paused, "q2", 300, base.startedAt + 700_000);
  expect(setRemainingSec(opened, "q2", base.startedAt + 700_000)).toBe(300);
  const resumed = resumedSession(opened, base.startedAt + 700_000);
  expect(setRemainingSec(resumed, "q2", base.startedAt + 700_000)).toBe(300);
  // It runs from then, not after the ten minutes of marking have passed again.
  expect(setRemainingSec(resumed, "q2", base.startedAt + 760_000)).toBe(240);
  // The earlier set's clock keeps its remaining time across the pause and runs on from the resume.
  expect(setRemainingSec(resumed, "q1", base.startedAt + 700_000)).toBe(200);
  expect(setRemainingSec(resumed, "q1", base.startedAt + 760_000)).toBe(140);
});

it("a timer the student sets replaces the set's clock, shows on untimed papers too, and can be cleared", async () => {
  const { withManualSetClock, withoutSetClock, usesSetClock } = await import("./sessionClock");
  const untimed: Session = { ...base, studyUnit: "sets", totalSec: undefined };
  expect(usesSetClock(untimed, "q1")).toBe(false);
  const timed = withManualSetClock(untimed, "q1", 600, base.startedAt);
  expect(usesSetClock(timed, "q1")).toBe(true);
  expect(timed.setClocks?.q1.manual).toBe(true);
  expect(setRemainingSec(timed, "q1", base.startedAt + 60_000)).toBe(540);
  // Setting it again restarts from now with the new length, even over an automatic clock.
  const again = withManualSetClock(withSetClock(untimed, "q1", 300, base.startedAt), "q1", 120, base.startedAt + 30_000);
  expect(setRemainingSec(again, "q1", base.startedAt + 30_000)).toBe(120);
  // Set while paused, it waits for the paper to resume.
  const whilePaused = withManualSetClock(pausedSession(untimed, base.startedAt), "q1", 120, base.startedAt + 50_000);
  expect(setRemainingSec(resumedSession(whilePaused, base.startedAt + 50_000), "q1", base.startedAt + 50_000)).toBe(120);
  expect(usesSetClock(withoutSetClock(timed, "q1"), "q1")).toBe(false);
  expect(usesSetClock(timed, undefined)).toBe(false);
});
