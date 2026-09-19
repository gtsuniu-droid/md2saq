import { db, patchSettings } from "../data/db";
import { applyBankUpdate, importSetPack, type SetPack } from "./exportImport";

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
 * sets that were edited in the bank since they were imported. Open to
 * everyone. Returns the number of sets touched.
 */
export async function syncFromBank(): Promise<number | null> {
  const entries = await listBank();
  const local = await db.sets.toArray();
  const byBankId = new Map(local.filter((s) => s.bankId).map((s) => [s.bankId!, s]));
  let n = 0;
  for (const e of entries) {
    let mine = byBankId.get(e.id);
    if (!mine && e.setId) {
      // The same set, already on this device under its own id (created here or imported before linking existed).
      const sameId = local.find((s) => s.id === e.setId);
      if (sameId) {
        await db.sets.update(sameId.id, { bankId: e.id, number: e.number ?? sameId.number });
        mine = { ...sameId, bankId: e.id };
        byBankId.set(e.id, mine);
      }
    }
    if (!mine) {
      const pack = await fetchBankSet(e.id);
      await importSetPack(pack, e.id, e.updatedAt ?? e.uploadedAt, e.number);
      n++;
    } else {
      if (e.number !== undefined && mine.number !== e.number) await db.sets.update(mine.id, { number: e.number });
      // Never overwrite edits that have not reached the bank yet.
      if (!mine.dirty && e.updatedAt && e.updatedAt > (mine.bankUpdatedAt ?? 0)) {
        const pack = await fetchBankSet(e.id);
        await applyBankUpdate(mine.id, pack, e.updatedAt);
        n++;
      }
    }
  }
  return n;
}
