import Dexie, { type EntityTable } from "dexie";
import type { Attempt, Mark, Question, QuestionSet, Settings } from "./types";

export class SaqDatabase extends Dexie {
  sets!: EntityTable<QuestionSet, "id">;
  questions!: EntityTable<Question, "id">;
  attempts!: EntityTable<Attempt, "id">;
  marks!: EntityTable<Mark, "id">;
  settings!: EntityTable<Settings, "id">;

  constructor() {
    super("saq-practice");
    this.version(1).stores({
      sets: "id, createdAt, bankId",
      questions: "id, setId, order, *presentations, *tags, createdAt",
      attempts: "id, questionId, submittedAt, sessionId",
      marks: "id, attemptId, questionId, markedAt",
      settings: "id",
    });
  }
}

export const db = new SaqDatabase();

export function newId(): string {
  return crypto.randomUUID();
}
