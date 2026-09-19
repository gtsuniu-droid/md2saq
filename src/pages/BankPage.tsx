import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { db } from "../data/db";
import { presentationName } from "../data/presentations";
import { fetchBankSet, listBank, type BankEntry } from "../lib/bank";
import { importSetPack } from "../lib/exportImport";
import ShareSetButton from "../components/ShareSetButton";
import { formatDate } from "../lib/questions";

export default function BankPage() {
  const nav = useNavigate();
  const [entries, setEntries] = useState<BankEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const local = useLiveQuery(async () => ({ sets: await db.sets.orderBy("createdAt").reverse().toArray() }), []);

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
      {(local?.sets ?? []).filter((s) => !s.bankId).length === 0 && <p className="muted">Every set in your library is already shared.</p>}
      <table>
        <tbody>
          {(local?.sets ?? []).filter((s) => !s.bankId).map((s) => (
            <tr key={s.id}>
              <td>{s.name}{s.source && <div className="muted">{s.source}</div>}</td>
              <td style={{ textAlign: "right" }}><ShareSetButton setId={s.id} className="small" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Sharing asks for the bank passcode once and remembers it. Questions only are shared, never your answers or marks.</p>
    </div>
  );
}
