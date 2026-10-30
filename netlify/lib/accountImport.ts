import { accounts, push, readIndex, type AccountIndex, type Rec, type Table } from "./accountStore";
import { accessToken, listPage, serviceAccount, type FsValue } from "./recount";
import { firebaseEnv } from "../functions/mcp-token";
import type { JsonStore } from "./store";

/**
 * Records an account kept in Firestore before the site's own store existed, folded into it
 * once: attempts, marks, settings, the paper in progress and the deletions recorded there.
 * Newest wins against anything a device has pushed since, so a student who has been using
 * the new store loses nothing to the old copy.
 *
 * It runs a page at a time, in the background of a pull, and remembers how far it got: an
 * account with years of answers is imported over a few pulls rather than in one call that a
 * function's time limit would cut short. Firestore's read budget can refuse; the import is
 * then left alone for ten minutes before it is tried again.
 */
export const IMPORT_RETRY_MS = 10 * 60_000;
/** Two pulls in quick succession do not both import. */
const CLAIM_MS = 30_000;
const STAGES = ["attempts", "marks", "settings", "deleted"] as const;
const PAGE = 200;

/** A Firestore REST value as plain JSON. */
export function decode(v: FsValue | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return Date.parse(v.timestampValue);
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(decode);
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x)]));
  return undefined;
}

/** Whether the account's Firestore records still need folding in, and the attempt may be made now. */
export function importDue(index: Pick<AccountIndex, "imported" | "importTried" | "importFailedAt"> | null, now: number): boolean {
  if (index?.imported) return false;
  if (index?.importFailedAt && now - index.importFailedAt < IMPORT_RETRY_MS) return false;
  return !index?.importTried || now - index.importTried >= CLAIM_MS;
}

type Progress = { done: boolean; imported: number };

export async function importFromFirestore(uid: string, now = Date.now(), store: JsonStore = accounts(), budgetMs = 4_000, clock: () => number = Date.now): Promise<Progress | null> {
  const sa = serviceAccount();
  if (!sa) return null;
  if (!importDue(await readIndex(uid, store), now)) return null;
  const indexKey = `${uid}/index`;
  const blank = (): AccountIndex => ({ v: 1, _m: 0, entries: {} });
  // Claim the attempt first, so a burst of devices does not import the same account at once.
  const claimed = await store.update<AccountIndex>(indexKey, (cur) => cur && !importDue(cur, now) ? null : { ...(cur ?? blank()), importTried: now });
  if (claimed === null) return null;
  const { projectId } = firebaseEnv();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId ?? sa.project_id}/databases/(default)/documents/users/${uid}`;
  let state = claimed.importState ?? { stage: 0 };
  let imported = 0;
  const started = clock();
  try {
    const token = await accessToken(sa);
    while (state.stage < STAGES.length) {
      const collection = STAGES[state.stage];
      const { docs, nextPageToken } = await listPage(base, token, collection, state.pageToken, PAGE);
      const recs: Rec[] = docs.map((d) => {
        const rec = decode({ mapValue: { fields: d.fields ?? {} } }) as Record<string, unknown>;
        const id = d.name.split("/").pop()!;
        return { ...rec, id: typeof rec.id === "string" ? rec.id : id } as Rec;
      });
      // Stamped with the time of arrival, so a device pulling while the import runs sees each page.
      if (collection === "attempts") await push(uid, { attempts: recs, marks: [], deletes: [] }, clock(), store);
      else if (collection === "marks") await push(uid, { attempts: [], marks: recs, deletes: [] }, clock(), store);
      else if (collection === "settings") {
        const settings = recs.find((d) => d.id === "settings"); const session = recs.find((d) => d.id === "session");
        if (settings || session) await push(uid, { attempts: [], marks: [], ...(settings ? { settings } : {}), ...(session ? { session } : {}), deletes: [] }, clock(), store);
      } else {
        const deletes = recs.flatMap((d) => (d.table === "attempts" || d.table === "marks") && typeof d._m === "number" ? [{ id: d.id, table: d.table as Table, at: d._m }] : []);
        if (deletes.length) await push(uid, { attempts: [], marks: [], deletes }, clock(), store);
      }
      imported += collection === "settings" || collection === "deleted" ? 0 : recs.length;
      state = nextPageToken ? { stage: state.stage, pageToken: nextPageToken } : { stage: state.stage + 1 };
      await store.update<AccountIndex>(indexKey, (cur) => ({ ...(cur ?? blank()), importState: state }));
      if (state.stage < STAGES.length && clock() - started > budgetMs) return { done: false, imported };
    }
    await store.update<AccountIndex>(indexKey, (cur) => { const { importState: _s, importFailedAt: _f, ...rest } = cur ?? blank(); void _s; void _f; return { ...rest, imported: now }; });
    return { done: true, imported };
  } catch (e) {
    await store.update<AccountIndex>(indexKey, (cur) => ({ ...(cur ?? blank()), importFailedAt: now })).catch(() => undefined);
    throw e;
  }
}
