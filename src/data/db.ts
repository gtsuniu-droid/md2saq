import Dexie, { type EntityTable } from "dexie";
import type { DBCore, DBCoreMutateRequest, DBCoreTable } from "dexie";
import { DEFAULT_SETTINGS, type AmbossPhraseGroup, type AmbossPhrases, type Attempt, type Mark, type Meta, type Question, type QuestionSet, type Settings, type SyncDelete } from "./types";

export class SaqDatabase extends Dexie {
  sets!: EntityTable<QuestionSet, "id">;
  questions!: EntityTable<Question, "id">;
  attempts!: EntityTable<Attempt, "id">;
  marks!: EntityTable<Mark, "id">;
  settings!: EntityTable<Settings, "id">;
  ambossPhrases!: EntityTable<AmbossPhrases, "key">;
  ambossGroups!: EntityTable<AmbossPhraseGroup, "eid">;
  syncDeletes!: EntityTable<SyncDelete, "id">;
  meta!: EntityTable<Meta, "id">;

  constructor() {
    super("saq-practice");
    this.version(1).stores({
      sets: "id, createdAt, bankId",
      questions: "id, setId, order, *presentations, *tags, createdAt",
      attempts: "id, questionId, submittedAt, sessionId",
      marks: "id, attemptId, questionId, markedAt",
      settings: "id",
    });
    this.version(2).stores({
      ambossPhrases: "key, fetchedAt",
      ambossGroups: "eid, fetchedAt",
    });
    this.version(3).stores({
      attempts: "id, questionId, submittedAt, sessionId, _m",
      marks: "id, attemptId, questionId, markedAt, _m",
      syncDeletes: "id, at",
      meta: "id",
    });
    this.use({ stack: "dbcore", name: "modifiedStamp", create: stampModified });
  }
}

/** Tables whose records sync to the cloud and therefore carry a modified stamp. */
const SYNCED_TABLES = new Set(["attempts", "marks", "settings"]);

/** Set while records arriving from the cloud are written, so they are not stamped and echoed back. */
let applyingRemote = false;
export async function withRemoteWrites<T>(fn: () => Promise<T>): Promise<T> {
  applyingRemote = true;
  try {
    return await fn();
  } finally {
    applyingRemote = false;
  }
}

function stampModified(core: DBCore): DBCore {
  return {
    ...core,
    table(name: string): DBCoreTable {
      const table = core.table(name);
      if (!SYNCED_TABLES.has(name)) return table;
      return {
        ...table,
        mutate(req: DBCoreMutateRequest) {
          if (applyingRemote || (req.type !== "add" && req.type !== "put")) return table.mutate(req);
          const now = Date.now();
          const values = req.values.map((v) => (v && typeof v === "object" ? { ...v, _m: now } : v));
          if (req.type === "add") return table.mutate({ ...req, values });
          return table.mutate({
            ...req,
            values,
            changeSpec: req.changeSpec ? { ...req.changeSpec, _m: now } : req.changeSpec,
            updates: req.updates ? { ...req.updates, changeSpecs: req.updates.changeSpecs.map((c) => ({ ...c, _m: now })) } : req.updates,
          });
        },
      };
    },
  };
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
