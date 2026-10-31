import { expect, it } from "vitest";
import { adopt, current, figuresFor, joinByNickname, mergeRecord, NICKNAME_JOINED_UNTIL, publicBoard, staleTable, weekKey, weekStart, weeklyFigures, type BoardRecord, type CacheBody, type Posted, type Rec } from "../../netlify/lib/progress";
import { newerSocial } from "./social";

it("counts each account's questions and completed sets this week and last", () => {
  const now = new Date(2026, 9, 28, 12).getTime();
  const start = weekStart(now);
  const a = (uid: string, submittedAt: number, questionId: string, bankId?: string, order?: number) => ({ uid, submittedAt, questionId, bankId, order });
  const rows = [a("g", start + 1, "q1", "B", 0), a("g", start + 2, "q2", "B", 1), a("g", start + 3, "q3", "C", 0), a("g", start - 1000, "q9", "C", 1), a("j", start + 5, "q1", "B", 0), a("g", start + 6, "q1", "B", 0)];
  const counts = new Map([["B", 2], ["C", 3]]);
  expect(figuresFor(rows.filter((r) => r.uid === "g"), counts, start)).toEqual({ questions: 3, sets: 1 });
  const all = weeklyFigures(rows, counts, now);
  expect(all.get("g")).toEqual({ week: { questions: 3, sets: 1 }, last: { questions: 1, sets: 0 } });
  expect(all.get("j")).toEqual({ week: { questions: 1, sets: 0 }, last: { questions: 0, sets: 0 } });
});

it("serves the last table plus what devices posted since when Firestore cannot be read", () => {
  const now = Date.UTC(2026, 9, 28, 12); // Wednesday
  const thisWeek = weekKey(now);
  const last: CacheBody = { at: now - 3 * 3600_000, week: weekStart(now), accounts: 2, rowsWithEmail: [
    { uid: "a", name: "Ava", email: "ava@x", nickname: "Ava", joined: true, questions: 10, sets: 2, prevQuestions: 4, prevSets: 1, source: "server" },
    { uid: "b", name: "Ben", email: "ben@x", joined: false, questions: 3, sets: 0, prevQuestions: 0, prevSets: 0, source: "server" },
  ] };
  const posted = new Map<string, Rec>([
    ["a", { name: "Ava", week: thisWeek, count: 9, sets: 2, prevCount: 4, prevSets: 1, visible: true, at: now - 5 * 3600_000 }], // older than the table: ignored
    ["b", { name: "Benny", week: thisWeek, count: 7, sets: 1, prevCount: 0, prevSets: 0, visible: true, at: now - 60_000 }], // newer: joined, renamed, counted
    ["c", { name: "Cal Smith", week: thisWeek, count: 12, sets: 3, prevCount: 0, prevSets: 0, visible: true, at: now - 30_000 }], // never seen: added
  ]);
  const body = staleTable(last, posted, now, "429");
  expect(body.stale).toBe(true);
  expect(body.asOf).toBe(last.at);
  expect(body.rowsWithEmail.map((r) => [r.uid, r.questions, r.joined, r.nickname ?? "", r.source])).toEqual([
    ["c", 12, true, "Cal Smith", "device"], ["a", 10, true, "Ava", "server"], ["b", 7, true, "Benny", "device"],
  ]);
  expect(body.rowsWithEmail[0].name).toBe("Cal");
  expect(body.rowsWithEmail[2].email).toBe("ben@x");
});

it("rolls a last-week table into last week's column, and stands on posted records alone without one", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const last: CacheBody = { at: now - 8 * 24 * 3600_000, week: weekStart(now) - 7 * 24 * 3600_000, accounts: 1, rowsWithEmail: [
    { uid: "a", name: "Ava", joined: true, questions: 10, sets: 2, prevQuestions: 4, prevSets: 1, source: "server" },
  ] };
  const rolled = staleTable(last, new Map(), now, "429").rowsWithEmail[0];
  expect([rolled.questions, rolled.sets, rolled.prevQuestions, rolled.prevSets]).toEqual([0, 0, 10, 2]);
  const alone = staleTable(null, new Map<string, Rec>([["d", { name: "Dee", week: weekKey(now - 7 * 24 * 3600_000), count: 5, sets: 1, prevCount: 0, prevSets: 0, visible: false, at: now }]]), now, "429");
  expect(alone.asOf).toBeUndefined();
  expect(alone.rowsWithEmail).toEqual([{ uid: "d", name: "Dee", photo: undefined, nickname: "Dee", joined: false, lastSeenAt: now, questions: 0, sets: 0, prevQuestions: 5, prevSets: 1, total: 0, totalSets: 0, source: "device" }]);
});

it("serves the last count with every device record over it, keeping the higher count", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const thisWeek = weekKey(now);
  const table: CacheBody = { at: now - 60_000, week: weekStart(now), accounts: 2, rowsWithEmail: [
    { uid: "a", name: "Ava", email: "ava@x", nickname: "Ava", joined: true, questions: 10, sets: 2, prevQuestions: 4, prevSets: 1, source: "server" },
    { uid: "b", name: "Ben", email: "ben@x", joined: false, questions: 3, sets: 0, prevQuestions: 0, prevSets: 0, source: "server" },
  ] };
  const rec = (count: number, visible = true): Rec => ({ name: "Benny", week: thisWeek, count, sets: 0, prevCount: 0, prevSets: 0, visible, at: now });
  const raised = current(table, new Map([["b", rec(14)]]), now);
  expect(raised.at).toBe(table.at); // still due a full count on time
  expect(raised.rowsWithEmail.map((r) => [r.uid, r.questions, r.joined, r.source])).toEqual([["b", 14, true, "device"], ["a", 10, true, "server"]]);
  expect(raised.rowsWithEmail[0].email).toBe("ben@x");
  expect(publicBoard(raised).rows.map((r) => [r.name, r.questions])).toEqual([["Benny", 14], ["Ava", 10]]);
  // A device behind the server (answers from another device not pulled yet) does not lower it.
  expect(current(table, new Map([["b", rec(1)]]), now).rowsWithEmail.find((r) => r.uid === "b")).toMatchObject({ questions: 3, source: "server", joined: true });
  // The device records decide who is on the board, and accounts the count never saw are added.
  expect(publicBoard(current(table, new Map([["b", rec(14, false)], ["c", { ...rec(2), name: "Cal Smith" }]]), now)).rows.map((r) => r.uid)).toEqual(["a", "c"]);
  // With no full count at all, the records alone make the board.
  expect(publicBoard(current(null, new Map([["c", rec(2)]]), now)).rows).toHaveLength(1);
});

it("keeps a student on the board unless they left more recently than they joined", () => {
  const post = (visible?: boolean, choiceAt?: number): Posted => ({ name: "Gabe", week: "2026-W44", count: 5, sets: 0, prevCount: 0, prevSets: 0, at: 1, ...(visible === undefined ? {} : { visible, choiceAt }) });
  const joinedLongAgo: BoardRecord = { ...post(), visible: true, at: 0 };
  // A phone that never saw the choice, or saw it before choices were dated, cannot take them off.
  expect(mergeRecord(joinedLongAgo, post()).visible).toBe(true);
  expect(mergeRecord(joinedLongAgo, post(false, 0)).visible).toBe(true);
  // Leaving from Settings does, and a device still showing the older join cannot undo that.
  const left = mergeRecord(joinedLongAgo, post(false, 500));
  expect([left.visible, left.choiceAt]).toEqual([false, 500]);
  expect(mergeRecord(left, post(true, 0)).visible).toBe(false);
  expect(mergeRecord(left, post(true, 900)).visible).toBe(true);
  // Figures always come from the newest post; someone new with no say starts off the board.
  expect(mergeRecord(left, { ...post(), count: 9 }).count).toBe(9);
  expect(mergeRecord(undefined, post()).visible).toBe(false);
  // The nickname goes with the choice: a device without the student's choice, or with an older one, posts their first name and must not replace the nickname.
  const nicknamed: BoardRecord = { ...post(true, 500), name: "Ball clapper", visible: true, choiceAt: 500 };
  expect(mergeRecord(nicknamed, post()).name).toBe("Ball clapper");
  expect(mergeRecord(nicknamed, post(true, 0)).name).toBe("Ball clapper");
  expect(mergeRecord(nicknamed, { ...post(true, 900), name: "Bally" }).name).toBe("Bally");
  expect(mergeRecord(undefined, post()).name).toBe("Gabe");
  // Devices' own settings merge the same way.
  expect(newerSocial({ username: "", leaderboard: true }, { username: "", leaderboard: false })?.leaderboard).toBe(true);
  expect(newerSocial({ username: "", leaderboard: true }, { username: "", leaderboard: false, chosenAt: 5 })?.leaderboard).toBe(false);
  expect(newerSocial(undefined, { username: "x", leaderboard: true })?.username).toBe("x");
});

it("takes students who joined in Firestore onto the site's table without losing newer figures", () => {
  const fs = (visible: boolean | undefined, count = 3): Rec => ({ name: "Ball clapper", week: "2026-W44", count, sets: 0, prevCount: 0, prevSets: 0, at: 1, visible });
  // Never seen by the site: added as they were, joined (records from before the flag count as joined).
  expect(adopt(undefined, fs(true))).toMatchObject({ name: "Ball clapper", visible: true, choiceAt: 0, count: 3 });
  expect(adopt(undefined, fs(undefined)).visible).toBe(true);
  expect(adopt(undefined, fs(false)).visible).toBe(false);
  // Known to the site: its own figures stay; an undated "no" from a stale device gives way to the join.
  const stale: BoardRecord = { name: "Bally", week: "2026-W44", count: 9, sets: 1, prevCount: 0, prevSets: 0, at: 5, visible: false, choiceAt: 0 };
  expect(adopt(stale, fs(true))).toMatchObject({ name: "Bally", count: 9, visible: true });
  // A leave chosen in Settings stands.
  expect(adopt({ ...stale, choiceAt: 500 }, fs(true)).visible).toBe(false);
});

it("joins an account whose record carries a chosen nickname under an old no, and leaves every other record alone", () => {
  const rec = (name: string, visible: boolean, choiceAt?: number): BoardRecord => ({ name, week: "2026-W44", count: 3, sets: 0, prevCount: 0, prevSets: 0, at: 1, visible, choiceAt });
  expect(joinByNickname(rec("Ball clapper", false), "Gabriel Tsun")).toMatchObject({ visible: true, name: "Ball clapper" });
  expect(joinByNickname(rec("Ball clapper", false, NICKNAME_JOINED_UNTIL - 1), "Gabriel Tsun")?.visible).toBe(true);
  // The first name is no nickname; an account with no name on file gives nothing to compare; a "no" since nicknames meant joining, or a join already, stands.
  expect(joinByNickname(rec("gabriel", false), "Gabriel Tsun")).toBeNull();
  expect(joinByNickname(rec("Ball clapper", false), undefined)).toBeNull();
  expect(joinByNickname(rec("Ball clapper", false, NICKNAME_JOINED_UNTIL), "Gabriel Tsun")).toBeNull();
  expect(joinByNickname(rec("Ball clapper", true), "Gabriel Tsun")).toBeNull();
});

it("lets a device that has not synced raise the week's figures but not lower them, while a synced device's figures stand", () => {
  const rec = (count: number, extra: Partial<BoardRecord> = {}): BoardRecord => ({ name: "Gabe", week: "2026-W44", count, sets: 1, prevCount: 2, prevSets: 0, total: 50, totalSets: 9, at: 1, visible: true, ...extra });
  const stored = rec(12);
  // Behind: a phone that has not pulled the laptop's answers yet.
  expect(mergeRecord(stored, { ...rec(7), total: 40 }).count).toBe(12);
  expect(mergeRecord(stored, { ...rec(7), total: 40 }).total).toBe(50);
  expect(mergeRecord(stored, rec(15)).count).toBe(15);
  // Synced: what it says goes, even downwards (a set was discarded).
  expect(mergeRecord(stored, { ...rec(7), complete: true }).count).toBe(7);
  expect("complete" in mergeRecord(stored, { ...rec(7), complete: true })).toBe(false);
  // A new week starts from the post whatever the device knows.
  expect(mergeRecord(stored, rec(3, { week: "2026-W45" })).count).toBe(3);
});

it("a device synced since the last full count speaks for the account, a lowered figure included; an unsynced one only raises", async () => {
  const { overlay, mergeRecord: merge } = await import("../../netlify/lib/progress");
  const now = Date.UTC(2026, 9, 28, 12);
  const week = weekKey(now);
  const counted = { uid: "u", name: "Eiden", joined: true, questions: 5, sets: 1, prevQuestions: 0, prevSets: 0, source: "server" as const };
  const base: Posted = { name: "Eiden", week, count: 0, sets: 0, prevCount: 0, prevSets: 0, at: now + 60_000 };
  // The device discarded the set after the count ran, and had synced first: the board drops to 0.
  const complete = merge(undefined, { ...base, complete: true });
  expect(complete.completeAt).toBe(base.at);
  expect(overlay(counted, "u", complete, now, now)).toMatchObject({ questions: 0, sets: 0, source: "device" });
  // Without a sync behind it, the lower figure is only a device that knows less: the count stands.
  const partial = merge(undefined, base);
  expect(partial.completeAt).toBeUndefined();
  expect(overlay(counted, "u", partial, now, now)).toMatchObject({ questions: 5, sets: 1 });
  // A complete post from before the count was made is superseded by the count.
  expect(overlay(counted, "u", { ...complete, completeAt: now - 60_000 }, now, now)).toMatchObject({ questions: 5 });
  // Figures raised later by an unsynced device keep the record trusted (they only ever went up).
  const raised = merge(complete, { ...base, count: 2, at: now + 120_000 });
  expect(raised).toMatchObject({ count: 2, completeAt: base.at });
});

it("turns the week over at midnight on Monday where the students are, whatever the function's clock", async () => {
  const { weekStart, weekKey } = await import("../../netlify/lib/progress");
  // 07:00 on Monday 2 November 2026 in Melbourne (AEDT, UTC+11) is still Sunday evening in UTC.
  const mondayMorning = Date.UTC(2026, 10, 1, 20, 0, 0);
  expect(new Date(weekStart(mondayMorning)).toISOString()).toBe("2026-11-01T13:00:00.000Z");
  expect(weekKey(mondayMorning)).toBe("2026-W45");
  // A minute before that midnight belongs to the week before.
  expect(weekKey(Date.UTC(2026, 10, 1, 12, 59, 0))).toBe("2026-W44");
  // Across the daylight-saving change in April the Monday is still at local midnight.
  expect(new Date(weekStart(Date.UTC(2026, 3, 8, 0, 0, 0))).toISOString()).toBe("2026-04-05T14:00:00.000Z");
});
