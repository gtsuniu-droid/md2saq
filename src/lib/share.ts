import { db } from "../data/db";
import { BankPasscodeError, uploadBankSet } from "./bank";
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
  await db.settings.update("settings", { bankPasscode: passcode });
  return { name: pack.set.name, questions: pack.questions.length };
}

export async function savedPasscode(): Promise<string> {
  return (await db.settings.get("settings"))?.bankPasscode ?? "";
}

export async function forgetPasscode(): Promise<void> {
  await db.settings.update("settings", { bankPasscode: undefined });
}
