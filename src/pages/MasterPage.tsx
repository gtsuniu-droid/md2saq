import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { db, getSettings, patchSettings } from "../data/db";
import PasscodeGate from "../components/PasscodeGate";
import { CreateTools } from "./CreatePage";
import { BankPasscodeError, deleteBankSet, listBank, syncFromBank, type BankEntry } from "../lib/bank";
import { formatDate } from "../lib/questions";
import { loadSummaries } from "../lib/sets";
import { fullLabel } from "../lib/tree";
import { bankErrorMessage, pushToBank } from "../lib/share";
import { recordDeletes } from "../lib/sync";

/**
 * The single place for building the bank: add sets (drop or paste), edit,
 * delete. Everything saved here is pushed to the shared bank when the site
 * can reach it, and everyone's library follows.
 */
export default function MasterPage() {
  return (
    <PasscodeGate title="Admin" blurb="Enter the admin passcode to add, edit and remove question sets for everyone.">
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
      setBank(await listBank());
      await syncFromBank();
      setBankError(null);
    } catch (e) {
      setBank(null);
      if (e instanceof BankPasscodeError) {
        // The saved passcode is wrong: forget it so the gate asks again.
        await patchSettings({ bankPasscode: undefined });
        return;
      }
      setBankError("The server is not reachable from here, so changes stay on this device until it is.");
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
      setMessage(n ? `Published ${n} set${n === 1 ? "" : "s"}.` : "Everything is already published.");
      await refreshBank();
    } catch (e) {
      setMessage(`Could not publish: ${bankErrorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (setId: string) => {
    const s = summaries.find((x) => x.set.id === setId);
    if (!s) return;
    if (!confirm(`Delete ${fullLabel(s)} for everyone, with every attempt and mark on this device?`)) return;
    setBusy(setId);
    try {
      if (s.set.bankId && bankById.has(s.set.bankId)) {
        const code = (await getSettings()).bankPasscode ?? "";
        await deleteBankSet(s.set.bankId, code);
      }
      const qids = s.questions.map((q) => q.id);
      const goneAttempts = (await db.attempts.where("questionId").anyOf(qids).primaryKeys()) as string[];
      const goneMarks = (await db.marks.where("questionId").anyOf(qids).primaryKeys()) as string[];
      await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
        await db.marks.where("questionId").anyOf(qids).delete();
        await db.attempts.where("questionId").anyOf(qids).delete();
        await db.questions.bulkDelete(qids);
        await db.sets.delete(setId);
      });
      await recordDeletes("attempts", goneAttempts);
      await recordDeletes("marks", goneMarks);
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
        <h1 style={{ margin: 0 }}>Admin</h1>
        <span className="muted">{bank ? `${bank.length} sets published` : bankError ? "offline" : "checking…"}</span>
      </div>
      {bankError && <p className="muted">{bankError}</p>}
      {message && <p>{message}</p>}

      <h2>Add</h2>
      <CreateTools embedded onSaved={() => void refreshBank()} />

      <h2>Sets</h2>
      <div className="row" style={{ marginBottom: "0.5rem" }}>
        <button className="small" onClick={pushAll} disabled={busy !== null || !bank}>Publish local changes</button>
      </div>
      <table>
        <thead>
          <tr><th>Set</th><th>Questions</th><th>Status</th><th>Updated</th><th></th></tr>
        </thead>
        <tbody>
          {[...summaries].sort((a, b) => fullLabel(a).localeCompare(fullLabel(b), undefined, { numeric: true })).map((s) => {
            const entry = bankById.get(s.set.bankId ?? "");
            const status = !s.set.bankId ? "not published" : !bank ? "" : !entry ? "not found on the server" : s.set.dirty ? "edits not published" : "published";
            return (
              <tr key={s.set.id}>
                <td>
                  <Link to={`/set/${s.set.id}`}>{fullLabel(s)}</Link>
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
