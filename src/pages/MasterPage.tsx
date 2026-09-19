import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { db, getSettings } from "../data/db";
import PasscodeGate from "../components/PasscodeGate";
import { CreateTools } from "./CreatePage";
import { deleteBankSet, listBank, syncFromBank, type BankEntry } from "../lib/bank";
import { formatDate } from "../lib/questions";
import { loadSummaries, setLabel } from "../lib/sets";
import { bankErrorMessage, pushToBank } from "../lib/share";

/**
 * The single place for building the bank: add sets (drop or paste), edit,
 * delete. Everything saved here is pushed to the shared bank when the site
 * can reach it, and everyone's library follows.
 */
export default function MasterPage() {
  return (
    <PasscodeGate title="Master" blurb="The bank's control room. Enter the bank passcode to add, edit and remove question sets for everyone.">
      <MasterContents />
    </PasscodeGate>
  );
}

function MasterContents() {
  const nav = useNavigate();
  const summaries = useLiveQuery(loadSummaries, []);
  const [bank, setBank] = useState<BankEntry[] | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshBank = async () => {
    try {
      const code = (await getSettings()).bankPasscode ?? "";
      await syncFromBank();
      setBank(await listBank(code));
      setBankError(null);
    } catch {
      setBank(null);
      setBankError("The shared bank is not reachable from here, so changes stay on this device until it is.");
    }
  };
  useEffect(() => { void refreshBank(); }, []);

  if (!summaries) return null;
  const bankById = new Map((bank ?? []).map((e) => [e.id, e]));

  const pushAll = async () => {
    setBusy("push");
    setMessage(null);
    let n = 0;
    try {
      for (const s of summaries) {
        const entry = bankById.get(s.set.bankId ?? "");
        // Never shared, edited since, or removed from the bank behind our back.
        const stale = !s.set.bankId || s.set.dirty || !entry;
        if (stale) {
          await pushToBank(s.set.id);
          n++;
        }
      }
      setMessage(n ? `Pushed ${n} set${n === 1 ? "" : "s"} to the bank.` : "Everything is already in the bank.");
      await refreshBank();
    } catch (e) {
      setMessage(`Could not push: ${bankErrorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (setId: string) => {
    const s = summaries.find((x) => x.set.id === setId);
    if (!s) return;
    if (!confirm(`Delete ${setLabel(s.set)} everywhere: from the bank, from this device, with every attempt and mark?`)) return;
    setBusy(setId);
    try {
      if (s.set.bankId && bankById.has(s.set.bankId)) {
        const code = (await getSettings()).bankPasscode ?? "";
        await deleteBankSet(s.set.bankId, code);
      }
      const qids = s.questions.map((q) => q.id);
      await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
        await db.marks.where("questionId").anyOf(qids).delete();
        await db.attempts.where("questionId").anyOf(qids).delete();
        await db.questions.bulkDelete(qids);
        await db.sets.delete(setId);
      });
      await refreshBank();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Master</h1>
        <span className="muted">{bank ? `${bank.length} sets in the bank` : bankError ? "bank offline" : "checking the bank…"}</span>
      </div>
      {bankError && <p className="muted">{bankError}</p>}
      {message && <p>{message}</p>}

      <h2>Add</h2>
      <CreateTools embedded onSaved={() => void refreshBank()} />

      <h2>Sets</h2>
      <div className="row" style={{ marginBottom: "0.5rem" }}>
        <button className="small" onClick={pushAll} disabled={busy !== null || !bank}>Push local changes to the bank</button>
      </div>
      <table>
        <thead>
          <tr><th>Set</th><th>Questions</th><th>Bank</th><th>Updated</th><th></th></tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const entry = bankById.get(s.set.bankId ?? "");
            const status = !s.set.bankId ? "local only" : !bank ? "" : !entry ? "removed from bank" : s.set.dirty ? "local edits not pushed" : "in the bank";
            return (
              <tr key={s.set.id}>
                <td>
                  <Link to={`/set/${s.set.id}`}>{setLabel(s.set)}</Link>
                  <div className="muted">{[(s.set.tags ?? []).join(", "), s.set.source].filter(Boolean).join(", ")}</div>
                </td>
                <td>{s.questions.length}</td>
                <td className="muted">{status}</td>
                <td className="muted">{formatDate(s.set.updatedAt ?? s.set.createdAt)}</td>
                <td className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="small" onClick={() => nav(`/set/${s.set.id}/edit`)}>Edit</button>
                  <button className="small danger" onClick={() => remove(s.set.id)} disabled={busy !== null}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {summaries.length === 0 && <p className="muted">No sets yet. Drop a folder or paste a paper above.</p>}
    </div>
  );
}
