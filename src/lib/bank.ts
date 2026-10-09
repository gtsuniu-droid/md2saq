import { legacyQuestionIds, catalogueEntry, CATALOGUE_KEY, type BankCatalogue } from "./bankCatalogue";
import { loadLibrary, readCatalogue } from "./library";
import { db, patchSettings } from "../data/db";
import { applyBankUpdate, type SetPack } from "./exportImport";

export interface BankEntry {
  id: string;
  setId?: string;
  number?: number;
  name: string;
  source?: string;
  collection?: string;
  tags?: string[];
  questionCount: number;
  presentations: string[];
  uploadedAt: number;
  updatedAt?: number;
}

export class BankPasscodeError extends Error {}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 403) {
      // A saved passcode the bank rejects is worse than none: forget it so the gate asks again.
      await patchSettings({ bankPasscode: undefined }).catch(() => undefined);
      throw new BankPasscodeError(text || "Wrong passcode.");
    }
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res;
}

const auth = (passcode: string) => ({ "x-passcode": passcode });

/** Everyone can read the bank; no passcode needed. */
export async function listBank(): Promise<BankEntry[]> {
  const res = await check(await fetch("/api/bank"));
  const body = (await res.json()) as { sets: BankEntry[] };
  return body.sets;
}

export async function fetchBankSet(id: string): Promise<SetPack> {
  const res = await check(await fetch(`/api/bank?id=${encodeURIComponent(id)}`));
  return (await res.json()) as SetPack;
}

/** True when the passcode unlocks editing. Throws BankPasscodeError when it does not. */
export async function verifyPasscode(passcode: string): Promise<boolean> {
  await check(await fetch("/api/bank?verify=1", { headers: auth(passcode) }));
  return true;
}

export async function uploadBankSet(pack: SetPack, passcode: string): Promise<BankEntry> {
  const res = await check(
    await fetch("/api/bank", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(passcode) },
      body: JSON.stringify(pack),
    }),
  );
  const entry = await res.json() as BankEntry;
  await rememberPublished(entry, pack);
  return entry;
}

export async function updateBankSet(id: string, pack: SetPack, passcode: string): Promise<BankEntry> {
  const res = await check(
    await fetch(`/api/bank?id=${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth(passcode) },
      body: JSON.stringify(pack),
    }),
  );
  const entry = await res.json() as BankEntry;
  await rememberPublished(entry, pack);
  return entry;
}

export async function deleteBankSet(id: string, passcode: string): Promise<void> {
  await check(await fetch(`/api/bank?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: auth(passcode) }));
  await db.transaction("rw", db.meta, async () => {
    const catalogue = await readCatalogue();
    if (catalogue) await db.meta.put({ id: CATALOGUE_KEY, value: JSON.stringify({ ...catalogue, entries: catalogue.entries.filter(e => e.id !== id) }) });
  });
}

async function rememberPublished(entry: BankEntry, pack: SetPack) {
  await db.transaction("rw", db.meta, async () => {
    const catalogue = await readCatalogue();
    // A partial catalogue must never masquerade as the full library on a new device.
    if (!catalogue) return;
    const summary = catalogueEntry(entry.id, entry.updatedAt ?? entry.uploadedAt, pack, entry.number);
    const entries = catalogue.entries.filter(e => e.id !== entry.id);
    entries.push(summary);
    await db.meta.put({ id: CATALOGUE_KEY, value: JSON.stringify({ ...catalogue, entries }) });
  });
}

// A library refresh fetches only the catalogue; it never downloads every set.
let bankSync: Promise<number | null> | undefined;
export function syncFromBank(): Promise<number | null> {
  if (!bankSync) bankSync = refreshCatalogue().finally(() => { bankSync = undefined; });
  return bankSync;
}
async function refreshCatalogue(): Promise<number> {
  const res = await check(await fetch("/api/bank?catalogue=1"));
  const catalogue = await res.json() as BankCatalogue;
  if (catalogue.version !== 1 || !Array.isArray(catalogue.entries)) throw new Error("Could not read the question catalogue.");
  const old = await readCatalogue();
  const versions = new Map(old?.entries.map(e => [e.id, e.revision]));
  const changed = catalogue.entries.filter(e => versions.get(e.id) !== e.revision).length;
  if (JSON.stringify(old) !== JSON.stringify(catalogue)) await db.meta.put({ id: CATALOGUE_KEY, value: JSON.stringify(catalogue) });
  return changed;
}

const loadingSets = new Map<string, Promise<string>>();
/** Materialise one complete set before reading/editing/marking it. */
export function ensureSetContent(setId: string): Promise<string> {
  const current = loadingSets.get(setId);
  if (current) return current;
  const job = loadLatestSetContent(setId).finally(() => { loadingSets.delete(setId); });
  loadingSets.set(setId, job);
  return job;
}
async function loadLatestSetContent(setId: string): Promise<string> {
  const id = await loadSetContent(setId);
  const [catalogue, local] = await Promise.all([readCatalogue(), db.sets.get(id)]);
  const latest = catalogue?.entries.find(e => e.id === local?.bankId || e.set.id === id);
  // If a publication arrived during the download, all callers await the latest version.
  if (latest && local && !local.dirty && (local.bankUpdatedAt ?? 0) < latest.revision) return loadLatestSetContent(id);
  return id;
}

async function loadSetContent(setId: string): Promise<string> {
  const catalogue = await readCatalogue();
  const local = await db.sets.get(setId);
  const entry = catalogue?.entries.find(e => e.id === local?.bankId || e.set.id === setId);
  if (!entry) {
    if (local) return local.id;
    throw new Error("Set not found. Refresh the library and try again.");
  }
  if (local && (local.dirty || (local.bankUpdatedAt ?? 0) >= entry.revision)) {
    if (local.bankId !== entry.id || local.number !== entry.set.number) await db.sets.update(local.id, { bankId: entry.id, number: entry.set.number ?? local.number });
    return local.id;
  }
  const res = await fetch(`/api/bank?content=${encodeURIComponent(entry.id)}&v=${entry.revision}`);
  if (res.status === 409) {
    await syncFromBank();
    throw new Error("This set was updated. Please try again.");
  }
  const pack = await (await check(res)).json() as SetPack;
  if (pack.format !== "saq-practice-set" || !pack.set?.id || !Array.isArray(pack.questions)) throw new Error("Could not read this set.");
  // Compute legacy fingerprints outside IndexedDB transactions (WebCrypto is asynchronous).
  const legacy = await legacyQuestionIds(entry, local ? await db.questions.where("setId").equals(local.id).toArray() : []);
  return db.transaction("rw", db.sets, db.questions, async () => {
    // Recheck after the network wait: don't overwrite edits or a concurrent import.
    const mine = await db.sets.where("bankId").equals(entry.id).first() ?? await db.sets.get(setId);
    if (mine) {
      if (!mine.dirty && (mine.bankUpdatedAt ?? 0) < entry.revision) {
        for (const [canonical, id] of legacy) await db.questions.update(id, { bankQuestionId: canonical });
        await applyBankUpdate(mine.id, pack, entry.revision);
        await db.sets.update(mine.id, { bankId: entry.id, number: entry.set.number ?? mine.number });
      }
      return mine.id;
    }
    const questions = [];
    for (const q of pack.questions) {
      const canonical = q.bankQuestionId ?? q.id;
      const id = await db.questions.get(canonical) ? `bank:${entry.id}:${canonical}` : canonical;
      questions.push({ ...q, id, bankQuestionId: canonical, setId: entry.set.id });
    }
    await db.sets.add({ ...pack.set, id: entry.set.id, bankId: entry.id, bankUpdatedAt: entry.revision, number: entry.set.number, dirty: false });
    await db.questions.bulkAdd(questions);
    return entry.set.id;
  });
}

export async function ensureQuestionContent(questionIds: string[]): Promise<void> {
  const library = await loadLibrary();
  const wanted = new Set(questionIds);
  const ids = [...new Set(library.questions.filter(q => wanted.has(q.id)).map(q => q.setId))];
  for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(ensureSetContent));
}

/** Retry/open previews use this too; prefetched sets share the same in-flight request. */
export function prefetchSet(setId: string | undefined): void {
  if (setId) void ensureSetContent(setId).catch(() => undefined);
}
