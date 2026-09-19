import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";

/**
 * Guards against the schema upgrade dropping user data: a database created at
 * version 1 (before the AMBOSS cache tables) must keep its sets and questions
 * when opened with the current schema.
 */
describe("database upgrade", () => {
  it("keeps version 1 data when the AMBOSS tables are added", async () => {
    const name = "saq-practice-upgrade-test";
    const v1 = new Dexie(name);
    v1.version(1).stores({
      sets: "id, createdAt, bankId",
      questions: "id, setId, order, *presentations, *tags, createdAt",
      attempts: "id, questionId, submittedAt, sessionId",
      marks: "id, attemptId, questionId, markedAt",
      settings: "id",
    });
    await v1.table("sets").add({ id: "s1", name: "Old set", createdAt: 1 });
    await v1.table("questions").add({ id: "q1", setId: "s1", order: 0, text: "Q?", parts: [], presentations: ["cough"], tags: [], createdAt: 1 });
    v1.close();

    const v2 = new Dexie(name);
    v2.version(1).stores({
      sets: "id, createdAt, bankId",
      questions: "id, setId, order, *presentations, *tags, createdAt",
      attempts: "id, questionId, submittedAt, sessionId",
      marks: "id, attemptId, questionId, markedAt",
      settings: "id",
    });
    v2.version(2).stores({
      ambossPhrases: "key, fetchedAt",
      ambossGroups: "eid, fetchedAt",
    });
    await v2.open();
    expect(v2.verno).toBe(2);
    expect(await v2.table("sets").count()).toBe(1);
    expect(await v2.table("questions").count()).toBe(1);
    expect(v2.tables.map((t) => t.name).sort()).toContain("ambossPhrases");
    v2.close();
  });
});
