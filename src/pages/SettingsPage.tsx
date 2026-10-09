import { setProgressAccount } from "../lib/progressAccount";
import AmbossSettings from "../components/AmbossSettings";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db, patchSettings, getSettings } from "../data/db";
import { DEFAULT_SETTINGS } from "../data/types";
import { downloadText, exportAll, exportLearningPointsTsv, importAll, readFileText, type ExportFile } from "../lib/exportImport";
import { formatDate } from "../lib/questions";
import { syncFromBank } from "../lib/bank";
import MasterPage from "./MasterPage";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { ambossLogout } from "../lib/amboss";
import { cloudConfigured, signInWithGoogle, signOutCloud } from "../lib/firebase";
import { isAdmin } from "../lib/admin";
import { recordDeletes, resetCursors, syncNow } from "../lib/sync";

export default function SettingsPage() {
  const settings = useLiveQuery(async () => await getSettings(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);

  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "#admin" || hash === "#master") setTimeout(() => document.getElementById("admin")?.scrollIntoView({ block: "start" }), 300);
  }, [hash]);

  if (!settings) return null;
  const stamp = new Date().toISOString().slice(0, 10);

  const exportJson = async () => {
    setMessage("Preparing backup…");
    try {
      const data = await exportAll();
      downloadText(`saq-practice-${stamp}.json`, JSON.stringify(data));
      setMessage("Exported everything.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not complete the backup. Try again."); }
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
      setMessage(`Imported ${n.sets} sets, ${n.questions} questions, ${n.attempts} attempts, ${n.marks} marks, ${n.notes} notes.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const wipe = async () => {
    if (!confirm("Delete every question, attempt and mark on this device? Export first if you want to keep them.")) return;
    const goneAttempts = (await db.attempts.toCollection().primaryKeys()) as string[];
    const goneMarks = (await db.marks.toCollection().primaryKeys()) as string[];
    await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
      await Promise.all([db.sets.clear(), db.questions.clear(), db.attempts.clear(), db.marks.clear()]);
    });
    if (settings.cloudUser && confirm("Also delete your synced answers and marks in the cloud? Cancel keeps them for your other devices.")) {
      await recordDeletes("attempts", goneAttempts);
      await recordDeletes("marks", goneMarks);
      await syncNow().catch(() => undefined);
    }
    await ambossLogout();
    setMessage("Deleted. Saved AMBOSS login removed from this device.");
  };

  return (
    <div>
      <h1>Settings</h1>
      <div className="card stack">
        <div className="row">
          <label style={{ margin: 0 }}>Minutes per mark</label>
          <input type="number" step={0.25} min={0.25} value={settings.minutesPerMark}
            onChange={(e) => patchSettings({ minutesPerMark: Number(e.target.value) || DEFAULT_SETTINGS.minutesPerMark })} />

        </div>
      </div>

      <h2>Account</h2>
      <div className="card stack">
        {!cloudConfigured() ? (
          <p className="muted" style={{ margin: 0 }}>
            Cloud sync is not configured.
          </p>
        ) : settings.cloudUser ? (
          <div className="row spread">
            <span className="row">
              {settings.cloudUser.photo && <img src={settings.cloudUser.photo} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: "50%" }} />}
              <span>Signed in as {settings.cloudUser.email ?? settings.cloudUser.name ?? "Google account"}</span>
            </span>
            <span className="row">
              <button className="small" disabled={cloudBusy} onClick={async () => {
                setCloudBusy(true);
                try {
                  const r = await syncNow();
                  if (!r) setCloudMsg("Not signed in.");
                  else if (r.pushed === 0 && r.pulled === 0 && r.unresolved === 0) setCloudMsg("Up to date.");
                  else setCloudMsg(`Synced${r.pushed ? `, ${r.pushed} sent` : ""}${r.pulled ? `, ${r.pulled} received` : ""}${r.unresolved ? `, ${r.unresolved} waiting for their question set` : ""}.`);
                } catch (e) {
                  setCloudMsg(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setCloudBusy(false);
                }
              }}>Sync now</button>
              <button className="small" disabled={cloudBusy} onClick={async () => {
                await signOutCloud();
                await setProgressAccount(null);
                setCloudMsg("Signed out. Your data stays on this device.");
              }}>Sign out</button>
            </span>
          </div>
        ) : (
          <div className="row">
            <button className="primary" disabled={cloudBusy} onClick={async () => {
              setCloudBusy(true);
              setCloudMsg(null);
              try {
                const u = await signInWithGoogle();
                await setProgressAccount(u);
                await resetCursors();
                const r = await syncNow(u);
                const moved = r && (r.pushed || r.pulled) ? ` ${[r.pushed ? `${r.pushed} sent` : "", r.pulled ? `${r.pulled} received` : ""].filter(Boolean).join(", ")}.` : "";
                setCloudMsg(`Signed in as ${u.email ?? u.name ?? "Google account"}.${moved}`);
              } catch (e) {
                setCloudMsg(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
              } finally {
                setCloudBusy(false);
              }
            }}>Sign in with Google</button>
            <span className="muted">Your answers, marks and settings then follow you between devices.</span>
          </div>
        )}
        {cloudMsg && <p style={{ margin: 0 }}>{cloudMsg}</p>}
      </div>

      <AmbossSettings settings={settings} />

      <h2>Question library</h2>
      <div className="card stack">
        <label style={{ margin: 0, display: "flex", gap: "0.5rem", alignItems: "center", color: "var(--fg)" }}>
          <input type="checkbox" checked={settings.autoImportBank !== false}
            onChange={(e) => patchSettings({ autoImportBank: e.target.checked })} />
          Keep my library in step with the published sets when the app opens
        </label>
        {isAdmin(settings) && <div className="row">
          <label style={{ margin: 0 }}>Admin passcode</label>
          <input type="password" placeholder="not saved" value={settings.bankPasscode ?? ""}
            onChange={(e) => patchSettings({ bankPasscode: e.target.value || undefined })} />
          <span className="muted">unlocks Admin; remembered on this device</span>
          {settings.bankPasscode && <button className="small" onClick={() => patchSettings({ bankPasscode: undefined })}>Lock</button>}
        </div>}
        <div className="row">
          <button onClick={async () => {
            try {
              const n = await syncFromBank();
              setMessage(n ? `Library updated: ${n} new or changed set${n === 1 ? "" : "s"}.` : "Library is up to date.");
            }
            catch { setMessage("The server is not reachable from here."); }
          }}>Check for new sets</button>
        </div>
      </div>

      <h2>Backup</h2>
      <p className="muted">
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

      {isAdmin(settings) && (
        <div id="admin" style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}>
          <MasterPage />
        </div>
      )}
    </div>
  );
}
