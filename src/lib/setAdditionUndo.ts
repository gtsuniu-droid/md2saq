import { db, getSettings } from "../data/db";
import type { Question, QuestionSet, SetAdditionBatch } from "../data/types";
import { deleteBankSet, listBank } from "./bank";
import { isAdmin } from "./admin";

export interface AdditionAction { id: string; label: string }

/** Creation and its undo record commit together, including partially completed imports. */
export async function saveAddedSet(set: QuestionSet, questions: Question[], action: AdditionAction) {
  const ownerId = (await getSettings()).cloudUser?.uid ?? "";
  await db.transaction("rw", db.sets, db.questions, db.setAdditions, async () => {
    await db.sets.add(set);
    await db.questions.bulkAdd(questions);
    const batch = await db.setAdditions.get(action.id);
    if (batch && (batch.ownerId !== ownerId || batch.status !== "saved")) throw new Error("This import is no longer active.");
    await db.setAdditions.put(batch ? { ...batch, items: [...batch.items, { set, questions }] } : {
      id: action.id, label: action.label, ownerId, createdAt: Date.now(), items: [{ set, questions }], undoneIds: [], status: "saved",
    });
  });
}

async function ownedBatch(id: string) {
  const settings = await getSettings();
  const batch = await db.setAdditions.get(id);
  if (!isAdmin(settings) || !batch || batch.ownerId !== (settings.cloudUser?.uid ?? "")) throw new Error("This addition belongs to another account or device.");
  return { batch, settings };
}

function content(set: QuestionSet, questions: Question[]) {
  // Publication may assign a number/version without changing what the admin added.
  const { bankId, bankUpdatedAt, dirty, number, updatedAt, ...fields } = set;
  void bankId; void bankUpdatedAt; void dirty; void number; void updatedAt;
  return JSON.stringify({ set: fields, questions: [...questions].sort((a, b) => a.id.localeCompare(b.id)) });
}

async function checkUnchanged(item: SetAdditionBatch["items"][number]) {
  const set = await db.sets.get(item.set.id);
  if (!set) throw new Error("A set in this addition has already been removed. Restore or manage the remaining sets individually.");
  const questions = await db.questions.where("setId").equals(set.id).toArray();
  if (content(set, questions) !== content(item.set, item.questions)) throw new Error("A set has been edited since this addition. Undo stopped to keep those edits.");
  const ids = questions.map((q) => q.id);
  if (ids.length && await db.attempts.where("questionId").anyOf(ids).count()) throw new Error("A set has been used in a study session. Undo stopped to keep its answers and history.");
  return set;
}

/** A failed cloud deletion leaves the local set in place and can be retried. */
export async function undoSetAddition(id: string) {
  const { batch, settings } = await ownedBatch(id);
  if (batch.status === "undone") return;
  if (batch.status === "restored") throw new Error("These sets were restored. Their original addition has already been undone.");
  const remaining = batch.items.filter((item) => !batch.undoneIds.includes(item.set.id));
  const sets = await Promise.all(remaining.map(checkUnchanged));
  const published = sets.filter((set) => set.bankId);
  if (published.length && !settings.bankPasscode) throw new Error("Unlock Admin before undoing published sets.");
  // Refuse to erase a newer version published by another device.
  if (published.length) {
    const bank = await listBank();
    for (const set of published) {
      const entry = bank.find((e) => e.id === set.bankId);
      if (entry && (set.bankUpdatedAt === undefined || (entry.updatedAt ?? entry.uploadedAt) > set.bankUpdatedAt)) throw new Error("A published set has changed on another device. Refresh the library before deciding what to remove.");
    }
  }
  await db.setAdditions.update(id, { status: "undoing" });
  for (const item of remaining) {
    const set = await checkUnchanged(item);
    if (set.bankId) {
      try { await deleteBankSet(set.bankId, settings.bankPasscode!); }
      catch (e) { if (!(e instanceof Error && /not found/i.test(e.message))) throw e; }
    }
    await db.transaction("rw", db.sets, db.questions, db.attempts, db.setAdditions, async () => {
      await checkUnchanged(item);
      await db.questions.where("setId").equals(set.id).delete();
      await db.sets.delete(set.id);
      const current = (await db.setAdditions.get(id))!;
      const undoneIds = [...new Set([...current.undoneIds, set.id])];
      await db.setAdditions.update(id, { undoneIds, status: undoneIds.length === current.items.length ? "undone" : "undoing" });
    });
  }
}

/** Recovery is local; the admin explicitly publishes again if desired. */
export async function restoreSetAddition(id: string) {
  const { batch } = await ownedBatch(id);
  const items = batch.items.filter((item) => batch.undoneIds.includes(item.set.id));
  if (!items.length) return;
  await db.transaction("rw", db.sets, db.questions, db.setAdditions, async () => {
    for (const item of items) {
      if (await db.sets.get(item.set.id) || await db.questions.where("id").anyOf(item.questions.map((q) => q.id)).count()) throw new Error("A restored set already exists. Nothing was overwritten.");
      await db.sets.add({ ...item.set, bankId: undefined, bankUpdatedAt: undefined, dirty: true });
      await db.questions.bulkAdd(item.questions);
    }
    await db.setAdditions.update(id, { status: "restored", undoneIds: [] });
  });
}
