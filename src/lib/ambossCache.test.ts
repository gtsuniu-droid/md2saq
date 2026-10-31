import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { db } from "../data/db";
import { sweepAmbossCache } from "./amboss";

const DAY = 24 * 3600 * 1000;
it("sweeps terms older than a month and definitions older than a week, and keeps the rest", async () => {
  const now = Date.now();
  await db.ambossPhrases.bulkPut([{ key: "fresh", terms: [], fetchedAt: now - 29 * DAY }, { key: "stale", terms: [], fetchedAt: now - 31 * DAY }]);
  await db.ambossGroups.bulkPut([
    { eid: "fresh", title: "T", synonyms: [], destinations: [], media: [], fetchedAt: now - 6 * DAY },
    { eid: "stale", title: "T", synonyms: [], destinations: [], media: [], fetchedAt: now - 8 * DAY },
  ]);
  expect(await sweepAmbossCache(now)).toBe(2);
  expect((await db.ambossPhrases.toArray()).map((r) => r.key)).toEqual(["fresh"]);
  expect((await db.ambossGroups.toArray()).map((r) => r.eid)).toEqual(["fresh"]);
  expect(await sweepAmbossCache(now)).toBe(0);
});
