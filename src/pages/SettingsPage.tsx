import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db } from "../data/db";
import { DEFAULT_SETTINGS } from "../data/types";
import { downloadText, exportAll, exportLearningPointsTsv, importAll, readFileText, type ExportFile } from "../lib/exportImport";
import { formatDate } from "../lib/questions";
import { syncFromBank } from "../lib/bank";

export default function SettingsPage() {
  const settings = useLiveQuery(async () => (await db.settings.get("settings")) ?? DEFAULT_SETTINGS, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!settings) return null;
  const stamp = new Date().toISOString().slice(0, 10);

  const exportJson = async () => {
    const data = await exportAll();
    downloadText(`saq-practice-${stamp}.json`, JSON.stringify(data));
    setMessage("Exported everything.");
  };
  const exportAnki = async () => {
    const tsv = await exportLearningPointsTsv();
    if (!tsv) return setMessage("No learning points yet.");
    downloadText(`saq-learning-points-${stamp}.txt`, tsv, "text/tab-separated-values");
    setMessage("Exported learning points. In Anki: File → Import, fields separated by Tab, front = question, back = learning point, third field = tags.");
  };
  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await readFileText(file)) as ExportFile;
      const n = await importAll(data);
      setMessage(`Imported ${n.sets} sets, ${n.questions} questions, ${n.attempts} attempts, ${n.marks} marks.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const wipe = async () => {
    if (!confirm("Delete every question, attempt and mark on this device? Export first if you want to keep them.")) return;
    await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
      await Promise.all([db.sets.clear(), db.questions.clear(), db.attempts.clear(), db.marks.clear()]);
    });
    setMessage("Deleted.");
  };

  return (
    <div>
      <h1>Settings</h1>
      <div className="card stack">
        <div className="row">
          <label style={{ margin: 0 }}>Minutes per mark</label>
          <input type="number" step={0.25} min={0.25} value={settings.minutesPerMark}
            onChange={(e) => db.settings.put({ ...settings, minutesPerMark: Number(e.target.value) || DEFAULT_SETTINGS.minutesPerMark })} />
          <span className="muted">used to suggest timer lengths</span>
        </div>
      </div>

      <h2>Shared bank</h2>
      <div className="card stack">
        <label style={{ margin: 0, display: "flex", gap: "0.5rem", alignItems: "center", color: "var(--fg)" }}>
          <input type="checkbox" checked={settings.autoImportBank !== false}
            onChange={(e) => db.settings.put({ ...settings, autoImportBank: e.target.checked })} />
          Automatically import new bank sets when the app opens
        </label>
        <div className="row">
          <label style={{ margin: 0 }}>Bank passcode</label>
          <input type="password" placeholder="not saved" value={settings.bankPasscode ?? ""}
            onChange={(e) => db.settings.put({ ...settings, bankPasscode: e.target.value || undefined })} />
          <span className="muted">needed to share sets; remembered on this device</span>
        </div>
        <div className="row">
          <button onClick={async () => {
            try { const n = await syncFromBank(); setMessage(n ? `Imported ${n} new set${n === 1 ? "" : "s"} from the bank.` : "Nothing new in the bank."); }
            catch { setMessage("The bank is not reachable from here."); }
          }}>Check the bank now</button>
        </div>
      </div>

      <h2>Backup</h2>
      <p className="muted">
        Everything lives in this browser only. Export regularly.{" "}
        {settings.lastExportAt ? `Last export ${formatDate(settings.lastExportAt)}.` : "Never exported."}
      </p>
      <div className="row">
        <button onClick={exportJson}>Export everything (JSON)</button>
        <button onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
        <button onClick={exportAnki}>Export learning points for Anki</button>
      </div>
      {message && <p>{message}</p>}

      <h2>Danger</h2>
      <button className="danger" onClick={wipe}>Delete all data on this device</button>
    </div>
  );
}
