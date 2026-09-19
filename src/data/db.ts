import Dexie, { type EntityTable } from "dexie";
import { DEFAULT_SETTINGS, type Attempt, type Mark, type Question, type QuestionSet, type Settings } from "./types";

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

/** Read settings, falling back to defaults when the row does not exist yet. */
export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get("settings")) ?? {}) };
}

/** Merge a patch into settings, creating the row if needed. */
export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  await db.settings.put({ ...(await getSettings()), ...patch });
}
