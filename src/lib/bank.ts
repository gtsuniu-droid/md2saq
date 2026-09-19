import { db } from "../data/db";
import { importSetPack, type SetPack } from "./exportImport";

export interface BankEntry {
  id: string;
  name: string;
  source?: string;
  questionCount: number;
  presentations: string[];
  uploadedAt: number;
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

/** Import every bank set that is not yet in the library. Returns the number imported, or null when no passcode is saved. */
export async function syncFromBank(): Promise<number | null> {
  const passcode = (await db.settings.get("settings"))?.bankPasscode;
  if (!passcode) return null;
  const entries = await listBank(passcode);
  const have = new Set((await db.sets.toArray()).map((s) => s.bankId).filter(Boolean));
  let n = 0;
  for (const e of entries) {
    if (have.has(e.id)) continue;
    const pack = await fetchBankSet(e.id, passcode);
    await importSetPack(pack, e.id);
    n++;
  }
  return n;
}
