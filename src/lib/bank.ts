import type { SetPack } from "./exportImport";

export interface BankEntry {
  id: string;
  name: string;
  source?: string;
  questionCount: number;
  presentations: string[];
  uploadedAt: number;
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res;
}

export async function listBank(): Promise<BankEntry[]> {
  const res = await check(await fetch("/api/bank"));
  const body = (await res.json()) as { sets: BankEntry[] };
  return body.sets;
}

export async function fetchBankSet(id: string): Promise<SetPack> {
  const res = await check(await fetch(`/api/bank?id=${encodeURIComponent(id)}`));
  return (await res.json()) as SetPack;
}

export async function uploadBankSet(pack: SetPack, passcode: string): Promise<BankEntry> {
  const res = await check(
    await fetch("/api/bank", {
      method: "POST",
      headers: { "content-type": "application/json", "x-passcode": passcode },
      body: JSON.stringify(pack),
    }),
  );
  return (await res.json()) as BankEntry;
}
