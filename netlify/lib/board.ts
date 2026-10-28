import { openNamedStore, type JsonStore } from "./store";
import { mergeRecord, type BoardRecord, type BoardTable, type Posted, type Rec } from "./progress";

/**
 * The board's records, all in one blob of the "board" store. Records used to be one blob per
 * account under board/{uid}; the first time the table is needed and missing, it is built
 * from those.
 */
const TABLE_KEY = "table";
const board = (): JsonStore => openNamedStore("board");

async function legacy(store: JsonStore): Promise<BoardTable> {
  const keys = await store.list("board/");
  const recs = await Promise.all(keys.map(async (k) => [k.slice("board/".length), (await store.get(k, { type: "json" })) as BoardRecord | null] as const));
  return { records: Object.fromEntries(recs.filter((r): r is readonly [string, BoardRecord] => !!r[1] && typeof r[1].at === "number")) };
}

const asMap = (t: BoardTable | null): Map<string, Rec> => new Map(Object.entries(t?.records ?? {}));

/** Every account's latest record. */
export async function readRecords(): Promise<Map<string, Rec>> {
  const store = board();
  const table = (await store.get(TABLE_KEY, { type: "json" })) as BoardTable | null;
  return asMap(table ?? await legacy(store));
}

/** Lay one account's post over its record, and return every record after it. */
export async function postRecord(uid: string, post: Posted): Promise<Map<string, Rec>> {
  const store = board();
  const table = await store.update<BoardTable>(TABLE_KEY, async (t) => {
    const records = { ...(t ?? await legacy(store)).records };
    records[uid] = mergeRecord(records[uid], post);
    return { records };
  });
  return asMap(table);
}
