import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { db } from "../data/db";
import { presentationName } from "../data/presentations";
import { fetchBankSet, listBank, uploadBankSet, type BankEntry } from "../lib/bank";
import { exportSet, importSetPack } from "../lib/exportImport";
import { formatDate } from "../lib/questions";

export default function BankPage() {
  const nav = useNavigate();
  const [entries, setEntries] = useState<BankEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadSet, setUploadSet] = useState("");
  const [passcode, setPasscode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const local = useLiveQuery(async () => {
    const sets = await db.sets.orderBy("createdAt").reverse().toArray();
    const settings = await db.settings.get("settings");
    return { sets, passcode: settings?.bankPasscode ?? "" };
  }, []);

  useEffect(() => {
    if (local && !passcode) setPasscode(local.passcode);
  }, [local, passcode]);

  const refresh = async () => {
    setError(null);
    try {
      setEntries(await listBank());
    } catch (e) {
      setEntries([]);
      setError("The shared bank is not reachable. It only works on the deployed Netlify site.");
      void e;
    }
  };
  useEffect(() => { void refresh(); }, []);

  const importEntry = async (entry: BankEntry) => {
    setBusy(entry.id);
    try {
      const pack = await fetchBankSet(entry.id);
      const setId = await importSetPack(pack, entry.id);
      nav(`/library?set=${setId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    if (!uploadSet) return;
    setBusy("upload");
    setMessage(null);
    try {
      const pack = await exportSet(uploadSet);
      await uploadBankSet(pack, passcode);
      await db.settings.update("settings", { bankPasscode: passcode });
      setMessage(`Uploaded "${pack.set.name}" with ${pack.questions.length} questions.`);
      setUploadSet("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importedIds = new Set((local?.sets ?? []).map((s) => s.bankId).filter(Boolean));

  return (
    <div>
      <h1>Shared bank</h1>
      <p className="muted">Question sets shared by everyone using this site. New sets are imported into your library automatically when the app opens (see Settings). Your answers stay on your device.</p>
      {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
      {entries && entries.length === 0 && !error && <p className="muted">Nothing shared yet.</p>}
      {entries && entries.length > 0 && (
        <table>
          <thead><tr><th>Set</th><th>Questions</th><th>Presentations</th><th>Shared</th><th></th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.name}{e.source && <div className="muted">{e.source}</div>}</td>
                <td>{e.questionCount}</td>
                <td>{e.presentations.slice(0, 4).map((p) => <span key={p} className="chip static">{presentationName(p)}</span>)}{e.presentations.length > 4 ? <span className="muted">+{e.presentations.length - 4}</span> : null}</td>
                <td>{formatDate(e.uploadedAt)}</td>
                <td>
                  <button className="small" onClick={() => importEntry(e)} disabled={busy !== null}>
                    {importedIds.has(e.id) ? "Import again" : "Import"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Share one of your sets</h2>
      <div className="row">
        <select value={uploadSet} onChange={(e) => setUploadSet(e.target.value)}>
          <option value="">Choose a set</option>
          {(local?.sets ?? []).filter((s) => !s.bankId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="password" placeholder="Upload passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        <button className="primary" onClick={upload} disabled={!uploadSet || !passcode || busy !== null}>Upload</button>
      </div>
      {message && <p style={{ color: "var(--ok)" }}>{message}</p>}
      <p className="muted">Uploads need the passcode set in the site's Netlify environment as BANK_PASSCODE. Questions only are shared, never your answers or marks.</p>
    </div>
  );
}
