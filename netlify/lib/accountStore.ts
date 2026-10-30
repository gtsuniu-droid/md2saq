import { openNamedStore, type JsonStore } from "./store";
import type { AttemptRow } from "./progress";

/**
 * Each account's own records (attempts, marks, settings, the paper in progress) in the site's
 * blob store, so that saving answers and syncing them between devices never waits on a
 * Firestore read budget or trips its document size limit. One blob per record, plus a small
 * index per account that says what exists and when it last changed: a device asks the index
 * for what changed since its last pull, then reads just those records.
 *
 * Newest wins by the record's own change stamp `_m`, as it does on devices. A deletion is a
 * tombstone in the index with the time it was made; a record edited after that comes back.
 */
export type Table = "attempts" | "marks";
export type Rec = Record<string, unknown> & { id: string; _m?: number };

export interface Entry {
  t: Table;
  _m: number;
  /** When the store took this version in (server clock): what "changed since" goes by, so a record stamped earlier by a slow device is never missed. */
  a?: number;
  del?: true;
  /** Attempts only, so the board can be counted from the index alone: when it was submitted, its question, the bank set it sits in, and whether nothing was written. */
  s?: number; q?: string; b?: string; o?: number; e?: true;
}
export interface AccountIndex {
  v: 1;
  /** The newest stamp anywhere in the account. */
  _m: number;
  entries: Record<string, Entry>;
  settings?: Rec;
  session?: Rec;
  /** When settings and the paper last arrived (server clock). */
  settingsAt?: number;
  sessionAt?: number;
  /** The Firestore import: done when `imported` is set; otherwise how far it got, when it was last claimed, and when it last failed. */
  imported?: number;
  importTried?: number;
  importFailedAt?: number;
  importState?: { stage: number; pageToken?: string };
}
export interface PushBody { attempts?: Rec[]; marks?: Rec[]; settings?: Rec; session?: Rec; deletes?: { id: string; table: Table; at: number }[] }
export interface Change { id: string; table: Table; _m: number; deleted?: true }
/** `next` is the cursor for the following pull: a little before now, so a version taken in while this reply was being made is seen next time rather than never. */
export interface Changes { at: number; next: number; entries: Change[]; settings?: Rec; session?: Rec }

/** About what one function call may carry each way; Netlify stops at 6 MB. */
export const BYTES_PER_CALL = 3_500_000;
/** How many records one fetch may name; the rest are handed back for the next call. */
export const KEYS_PER_CALL = 400;
export const CURSOR_MARGIN_MS = 5_000;
/** Any id a device may have minted over the years, bar the key separator: a push is never refused for an old-style id. */
const ID = /^[^/\\?#\s]{1,200}$/;

export const accounts = (): JsonStore => openNamedStore("accounts");
const indexKey = (uid: string) => `${uid}/index`;
const recordKey = (uid: string, table: Table, id: string) => `${uid}/${table}/${id}`;
const empty = (): AccountIndex => ({ v: 1, _m: 0, entries: {} });

export async function readIndex(uid: string, store = accounts()): Promise<AccountIndex | null> {
  const got = (await store.get(indexKey(uid), { type: "json" })) as AccountIndex | null;
  return got && got.v === 1 && got.entries ? got : null;
}

const hasImage = (node: unknown): boolean => !!node && typeof node === "object" && ((node as { type?: unknown }).type === "image" || (Array.isArray((node as { content?: unknown }).content) && ((node as { content: unknown[] }).content).some(hasImage)));

/** What the index keeps of a record, beyond its stamp. */
export function summarise(table: Table, r: Rec): Partial<Entry> {
  if (table !== "attempts") return {};
  const answers = Array.isArray(r.answers) ? (r.answers as { text?: unknown; doc?: unknown }[]) : [];
  const blank = answers.length === 0 || answers.every((a) => !(typeof a.text === "string" && a.text.trim()) && !hasImage(a.doc));
  const qref = r.qref && typeof r.qref === "object" ? (r.qref as { bankId?: unknown; order?: unknown }) : {};
  return {
    ...(typeof r.submittedAt === "number" ? { s: r.submittedAt } : {}),
    ...(typeof r.questionId === "string" ? { q: r.questionId } : {}),
    ...(typeof qref.bankId === "string" ? { b: qref.bankId } : {}),
    ...(typeof qref.order === "number" ? { o: qref.order } : {}),
    ...(blank ? { e: true as const } : {}),
  };
}

export const validId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
const validRecord = (r: unknown): r is Rec => !!r && typeof r === "object" && !Array.isArray(r) && typeof (r as Rec).id === "string" && ID.test((r as Rec).id) && (typeof (r as Rec)._m === "number" || (r as Rec)._m === undefined);

/** A posted body, checked; null when it would not pass. */
export function validPush(b: unknown): PushBody | null {
  if (!b || typeof b !== "object") return null;
  const p = b as Record<string, unknown>;
  const list = (v: unknown): Rec[] | null => v === undefined ? [] : Array.isArray(v) && v.length <= 2000 && v.every(validRecord) ? (v as Rec[]) : null;
  const attempts = list(p.attempts); const marks = list(p.marks);
  if (!attempts || !marks) return null;
  if (p.settings !== undefined && !validRecord(p.settings)) return null;
  if (p.session !== undefined && !validRecord(p.session)) return null;
  const deletes = p.deletes === undefined ? [] : Array.isArray(p.deletes) && p.deletes.length <= 5000 && p.deletes.every((d) => d && typeof d === "object" && typeof d.id === "string" && ID.test(d.id) && (d.table === "attempts" || d.table === "marks") && typeof d.at === "number") ? (p.deletes as PushBody["deletes"]) : null;
  if (!deletes) return null;
  return { attempts, marks, ...(p.settings ? { settings: p.settings as Rec } : {}), ...(p.session ? { session: p.session as Rec } : {}), deletes };
}

/** Whether a record stamped `m` replaces the index's entry `cur` (none, older, or a tombstone it postdates). */
const newer = (cur: Entry | undefined, m: number) => !cur || m > cur._m || (m === cur._m && !cur.del);

/**
 * Take a device's changes in: records newer than what is kept are written and indexed,
 * deletions become tombstones, settings and the paper follow their own stamps.
 */
export async function push(uid: string, body: PushBody, now = Date.now(), store = accounts()): Promise<{ at: number }> {
  const incoming: [Table, Rec][] = [...(body.attempts ?? []).map((r): [Table, Rec] => ["attempts", r]), ...(body.marks ?? []).map((r): [Table, Rec] => ["marks", r])];
  const before = (await readIndex(uid, store)) ?? empty();
  const deleted = new Map((body.deletes ?? []).map((d) => [d.id, d]));
  // A record and its own deletion in one push: the later of the two wins.
  const writes = incoming.filter(([, r]) => newer(before.entries[r.id], r._m ?? 0) && !((deleted.get(r.id)?.at ?? -1) >= (r._m ?? 0)));
  // A deletion applies unless the record was edited (or deleted) later than it was made.
  const drops = (body.deletes ?? []).filter((d) => { const cur = before.entries[d.id]; return !cur || cur._m <= d.at; });
  for (let i = 0; i < writes.length; i += 16) await Promise.all(writes.slice(i, i + 16).map(([t, r]) => store.setJSON(recordKey(uid, t, r.id), r)));
  for (let i = 0; i < drops.length; i += 16) await Promise.all(drops.slice(i, i + 16).map((d) => store.delete(recordKey(uid, d.table, d.id)).catch(() => undefined)));
  await store.update<AccountIndex>(indexKey(uid), (current) => {
    const index = current && current.v === 1 ? { ...current, entries: { ...current.entries } } : empty();
    for (const [t, r] of writes) {
      const m = r._m ?? 0;
      if (newer(index.entries[r.id], m)) index.entries[r.id] = { t, _m: m, a: now, ...summarise(t, r) };
    }
    for (const d of drops) {
      const cur = index.entries[d.id];
      if (!cur || cur._m <= d.at) index.entries[d.id] = { t: d.table, _m: d.at, a: now, del: true };
    }
    if (body.settings && (body.settings._m ?? 0) > (index.settings?._m ?? 0)) { index.settings = body.settings; index.settingsAt = now; }
    if (body.session && (body.session._m ?? 0) > (index.session?._m ?? 0)) { index.session = body.session; index.sessionAt = now; }
    index._m = Math.max(index._m, ...Object.values(index.entries).map((e) => e._m), index.settings?._m ?? 0, index.session?._m ?? 0);
    return index;
  });
  return { at: now };
}

/** What arrived since a device's last pull (by the store's clock): the index's view, small enough to send whole. */
export async function changes(uid: string, since: number, now = Date.now(), store = accounts(), index?: AccountIndex | null): Promise<Changes> {
  const idx = index === undefined ? await readIndex(uid, store) : index;
  const next = now - CURSOR_MARGIN_MS;
  if (!idx) return { at: now, next, entries: [] };
  const arrived = (e: { a?: number; _m: number }) => e.a ?? e._m;
  const entries: Change[] = Object.entries(idx.entries).filter(([, e]) => arrived(e) > since).map(([id, e]) => ({ id, table: e.t, _m: e._m, ...(e.del ? { deleted: true as const } : {}) }));
  return {
    at: now, next, entries,
    ...(idx.settings && (idx.settingsAt ?? idx.settings._m ?? 0) > since ? { settings: idx.settings } : {}),
    ...(idx.session && (idx.sessionAt ?? idx.session._m ?? 0) > since ? { session: idx.session } : {}),
  };
}

/** The records asked for, as many as fit in one reply; the rest are named for the next call. */
export async function fetchRecords(uid: string, keys: { table: Table; id: string }[], limitBytes = BYTES_PER_CALL, store = accounts()): Promise<{ records: { table: Table; record: Rec }[]; remaining: { table: Table; id: string }[] }> {
  const records: { table: Table; record: Rec }[] = [];
  // Keys past this call's share are handed straight back, never dropped.
  if (keys.length > KEYS_PER_CALL) { const page = await fetchRecords(uid, keys.slice(0, KEYS_PER_CALL), limitBytes, store); return { records: page.records, remaining: [...page.remaining, ...keys.slice(KEYS_PER_CALL)] }; }
  let bytes = 0; let i = 0;
  while (i < keys.length) {
    const batch = keys.slice(i, i + 16);
    const got = await Promise.all(batch.map((k) => store.get(recordKey(uid, k.table, k.id), { type: "json" }) as Promise<Rec | null>));
    for (let j = 0; j < batch.length; j++) {
      const r = got[j];
      if (!r) { i++; continue; }
      const size = JSON.stringify(r).length;
      if (records.length && bytes + size > limitBytes) return { records, remaining: keys.slice(i) };
      records.push({ table: batch[j].table, record: r }); bytes += size; i++;
    }
  }
  return { records, remaining: [] };
}

/**
 * Submitted, non-blank attempts of the account since `since`, read from the index alone (for
 * the board's full count), and whether the account's Firestore records have been folded in,
 * so the caller knows if Firestore may still hold more. Null for an account the store has not seen.
 */
export async function attemptRows(uid: string, since: number, store = accounts()): Promise<{ imported: boolean; rows: { id: string; row: AttemptRow }[] } | null> {
  const index = await readIndex(uid, store);
  if (!index) return null;
  const rows = Object.entries(index.entries).flatMap(([id, e]) => e.t === "attempts" && !e.del && !e.e && e.s !== undefined && e.s >= since
    ? [{ id, row: { uid, submittedAt: e.s, questionId: e.q ?? "", bankId: e.b, order: e.o } }] : []);
  return { imported: !!index.imported, rows };
}
