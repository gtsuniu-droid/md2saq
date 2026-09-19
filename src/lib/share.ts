import { db, patchSettings, getSettings } from "../data/db";
import { BankPasscodeError, updateBankSet, uploadBankSet } from "./bank";
import { exportSet } from "./exportImport";

export { BankPasscodeError as PasscodeError };

/**
 * Upload a local set to the shared bank and record the bank id on it,
 * so it shows as shared and auto-import never pulls it back as a duplicate.
 */
export async function shareSet(setId: string, passcode: string): Promise<{ name: string; questions: number }> {
  const pack = await exportSet(setId);
  const entry = await uploadBankSet(pack, passcode);
  await db.sets.update(setId, { bankId: entry.id });
  await patchSettings({ bankPasscode: passcode });
  return { name: pack.set.name, questions: pack.questions.length };
}

export async function savedPasscode(): Promise<string> {
  return (await getSettings()).bankPasscode ?? "";
}

export async function forgetPasscode(): Promise<void> {
  await patchSettings({ bankPasscode: undefined });
}

/**
 * Create or update this set in the bank with the passcode saved on the device.
 * Records the bank id and version on the local set.
 */
export async function pushToBank(setId: string): Promise<void> {
  const passcode = await savedPasscode();
  if (!passcode) throw new Error("No bank passcode saved.");
  const pack = await exportSet(setId);
  const local = await db.sets.get(setId);
  if (local?.bankId) {
    try {
      const entry = await updateBankSet(local.bankId, pack, passcode);
      await db.sets.update(setId, { bankUpdatedAt: entry.updatedAt ?? Date.now(), dirty: false });
      return;
    } catch (e) {
      // Removed from the bank in the meantime: fall through and create it again.
      if (!(e instanceof Error && /not found/i.test(e.message))) throw e;
    }
  }
  const entry = await uploadBankSet(pack, passcode);
  await db.sets.update(setId, { bankId: entry.id, bankUpdatedAt: entry.updatedAt ?? entry.uploadedAt, number: entry.number ?? local?.number, dirty: false });
}

/** A short, human line for a failed bank push. */
export function bankErrorMessage(e: unknown): string {
  if (e instanceof BankPasscodeError) return "the bank rejected the passcode.";
  const msg = e instanceof Error ? e.message : String(e);
  if (/blobs|environment|fetch|network|500|502|503|504/i.test(msg)) return "the bank is not reachable from here right now.";
  return msg;
}
