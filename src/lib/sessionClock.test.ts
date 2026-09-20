import { describe, expect, it } from "vitest";
import type { Session } from "../data/types";
import { pausedSession, remainingSec, resumedSession } from "./sessionClock";

const base: Session = { id: "s", mode: "exam", questionIds: ["q1", "q2"], index: 0, totalSec: 600, startedAt: 1_000_000, attemptIds: [] };

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
