import { db, patchSettings, getSettings } from "../data/db";
import { BankPasscodeError, ensureSetContent, deleteBankSet, updateBankSet, uploadBankSet } from "./bank";
import { recordDeletes } from "./sync";
import { exportSet } from "./exportImport";
import { isAdmin } from "./admin";

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
  if (local && entry.number !== undefined && entry.number !== local.number) await db.sets.update(setId, { number: entry.number });
}

/** A short, human line for a failed bank push. */
export function bankErrorMessage(e: unknown): string {
  if (e instanceof BankPasscodeError) return "the server rejected the admin passcode.";
  const msg = e instanceof Error ? e.message : String(e);
  if (/blobs|environment|fetch|network|500|502|503|504/i.test(msg)) return "the server is not reachable from here right now.";
  return msg;
}

/**
 * Delete a set from the shared library before removing local content.
 * A failed or locked cloud deletion must leave the local copy intact.
 */
export async function deleteSetEverywhere(setId: string): Promise<{ local: boolean; published: boolean }> {
  const settings = await getSettings();
  if (!isAdmin(settings)) throw new Error("Only admins can delete sets.");
  await ensureSetContent(setId);
  const set = await db.sets.get(setId);
  if (!set) return { local: false, published: false };
  let published = false;
  if (set.bankId) {
    const passcode = settings.bankPasscode;
    if (!passcode) throw new Error("Unlock Admin in Settings to delete a shared set.");
    try {
      await deleteBankSet(set.bankId, passcode);
      published = true;
    } catch (e) {
      // Already gone from the library: nothing to remove there.
      if (!(e instanceof Error && /not found/i.test(e.message))) throw e;
    }
  }
  const qids = (await db.questions.where("setId").equals(setId).primaryKeys()) as string[];
  const goneAttempts = qids.length ? ((await db.attempts.where("questionId").anyOf(qids).primaryKeys()) as string[]) : [];
  const goneMarks = qids.length ? ((await db.marks.where("questionId").anyOf(qids).primaryKeys()) as string[]) : [];
  await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
    await db.marks.bulkDelete(goneMarks);
    await db.attempts.bulkDelete(goneAttempts);
    await db.questions.bulkDelete(qids);
    await db.sets.delete(setId);
  });
  await recordDeletes("attempts", goneAttempts);
  await recordDeletes("marks", goneMarks);
  return { local: true, published };
}
