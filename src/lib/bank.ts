import { db, getSettings } from "../data/db";
import { applyBankUpdate, importSetPack, type SetPack } from "./exportImport";

export interface BankEntry {
  id: string;
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
    if (res.status === 403) throw new BankPasscodeError(text || "Wrong passcode.");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res;
}

const auth = (passcode: string) => ({ "x-passcode": passcode });

export async function listBank(passcode: string): Promise<BankEntry[]> {
  const res = await check(await fetch("/api/bank", { headers: auth(passcode) }));
  const body = (await res.json()) as { sets: BankEntry[] };
  return body.sets;
}

export async function fetchBankSet(id: string, passcode: string): Promise<SetPack> {
  const res = await check(await fetch(`/api/bank?id=${encodeURIComponent(id)}`, { headers: auth(passcode) }));
  return (await res.json()) as SetPack;
}

export async function uploadBankSet(pack: SetPack, passcode: string): Promise<BankEntry> {
  const res = await check(
    await fetch("/api/bank", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(passcode) },
      body: JSON.stringify(pack),
    }),
  );
  return (await res.json()) as BankEntry;
}

export async function updateBankSet(id: string, pack: SetPack, passcode: string): Promise<BankEntry> {
  const res = await check(
    await fetch(`/api/bank?id=${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth(passcode) },
      body: JSON.stringify(pack),
    }),
  );
  return (await res.json()) as BankEntry;
}

export async function deleteBankSet(id: string, passcode: string): Promise<void> {
  await check(await fetch(`/api/bank?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: auth(passcode) }));
}

/**
 * Import every bank set not yet in the library, and refresh local copies of
 * sets that were edited in the bank since they were imported. Returns the
 * number of sets touched, or null when no passcode is saved.
 */
export async function syncFromBank(): Promise<number | null> {
  const passcode = (await getSettings()).bankPasscode;
  if (!passcode) return null;
  const entries = await listBank(passcode);
  const local = await db.sets.toArray();
  const byBankId = new Map(local.filter((s) => s.bankId).map((s) => [s.bankId!, s]));
  let n = 0;
  for (const e of entries) {
    const mine = byBankId.get(e.id);
    if (!mine) {
      const pack = await fetchBankSet(e.id, passcode);
      await importSetPack(pack, e.id, e.updatedAt ?? e.uploadedAt, e.number);
      n++;
    } else {
      if (e.number !== undefined && mine.number !== e.number) await db.sets.update(mine.id, { number: e.number });
      // Never overwrite edits that have not reached the bank yet.
      if (!mine.dirty && e.updatedAt && e.updatedAt > (mine.bankUpdatedAt ?? 0)) {
        const pack = await fetchBankSet(e.id, passcode);
        await applyBankUpdate(mine.id, pack, e.updatedAt);
        n++;
      }
    }
  }
  return n;
}
