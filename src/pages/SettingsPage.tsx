import { setProgressAccount } from "../lib/progressAccount";
import AmbossSettings from "../components/AmbossSettings";
import ConfirmDialog from "../components/ConfirmDialog";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { db, patchSettings, getSettings } from "../data/db";
import { DEFAULT_SETTINGS } from "../data/types";
import { downloadText, exportAll, exportLearningPointsTsv, importAll, readFileText, type ExportFile } from "../lib/exportImport";
import { formatDate } from "../lib/questions";
import { syncFromBank } from "../lib/bank";
import { hideRemovedCopies, libraryBreakdown, type LibraryBreakdown } from "../lib/library";
import { saveSocialSettings, USERNAME_MAX } from "../lib/social";
import { ambossLogout } from "../lib/amboss";
import { cloudConfigured, signOutCloud } from "../lib/firebase";
import SignInPanel from "../components/SignInPanel";
import ClaudeConnect from "../components/ClaudeConnect";
import { isAdmin } from "../lib/admin";
import { recordDeletes, syncNow } from "../lib/sync";

function Row({ title, help, children, danger }: { title: string; help?: string; children?: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`setting-row${danger ? " danger" : ""}`}>
      <div><strong>{title}</strong>{help && <p>{help}</p>}</div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

export default function SettingsPage() {
  const settings = useLiveQuery(async () => await getSettings(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [libraryMsg, setLibraryMsg] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<LibraryBreakdown | null>(null);
  const [social, setSocial] = useState<{ username: string; leaderboard: boolean } | null>(null);
  const [socialMsg, setSocialMsg] = useState("");
  const [socialBusy, setSocialBusy] = useState(false);
  useEffect(() => { void libraryBreakdown().then(setBreakdown); }, [libraryMsg]);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeCloud, setWipeCloud] = useState(false);
  const [wipeBusy, setWipeBusy] = useState(false);
  const [dangerMsg, setDangerMsg] = useState<string | null>(null);

  if (!settings) return null;
  const stamp = new Date().toISOString().slice(0, 10);
  const admin = isAdmin(settings);

  const exportJson = async () => {
    setBackupMsg("Preparing backup…");
    try {
      const data = await exportAll();
      downloadText(`saq-practice-${stamp}.json`, JSON.stringify(data));
      setBackupMsg("Exported everything.");
    } catch (error) { setBackupMsg(error instanceof Error ? error.message : "Could not complete the backup. Try again."); }
  };
  const exportAnki = async () => {
    const tsv = await exportLearningPointsTsv();
    if (!tsv) return setBackupMsg("No learning points yet.");
    downloadText(`saq-learning-points-${stamp}.txt`, tsv, "text/tab-separated-values");
    setBackupMsg("Exported learning points. In Anki: File → Import, fields separated by Tab, front = question, back = learning point, third field = tags.");
  };
  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await readFileText(file)) as ExportFile;
      const n = await importAll(data);
      setBackupMsg(`Imported ${n.sets} sets, ${n.questions} questions, ${n.attempts} attempts, ${n.marks} marks, ${n.notes} notes.`);
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const wipe = async () => {
    setWipeBusy(true);
    try {
      const goneAttempts = (await db.attempts.toCollection().primaryKeys()) as string[];
      const goneMarks = (await db.marks.toCollection().primaryKeys()) as string[];
      await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
        await Promise.all([db.sets.clear(), db.questions.clear(), db.attempts.clear(), db.marks.clear()]);
      });
      if (settings.cloudUser && wipeCloud) {
        await recordDeletes("attempts", goneAttempts);
        await recordDeletes("marks", goneMarks);
        await syncNow().catch(() => undefined);
      }
      await ambossLogout();
      setDangerMsg("Deleted. The saved AMBOSS login was removed from this device too.");
      setWiping(false);
    } finally {
      setWipeBusy(false);
    }
  };

  const sections = [
    { id: "practice", label: "Practice" },
    { id: "account", label: "Account" },
    ...(cloudConfigured() ? [{ id: "social", label: "Leaderboard" }] : []),
    { id: "amboss", label: "AMBOSS" },
    { id: "library", label: "Question library" },
    ...(cloudConfigured() ? [{ id: "claude", label: "AI assistants" }] : []),
    { id: "backup", label: "Backup" },
    ...(admin ? [{ id: "admin", label: "Admin" }] : []),
    { id: "danger", label: "Danger zone", danger: true },
  ];

  return (
    <div>
      <header className="settings-head"><h1>Settings</h1><p>How practice is timed, where your work is kept, and what follows you between devices.</p></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((s) => <a key={s.id} href={`#${s.id}`} className={s.danger ? "danger" : undefined}>{s.label}</a>)}
        </nav>
        <div>
          <section className="settings-section" id="practice" aria-labelledby="settings-practice">
            <h2 id="settings-practice">Practice</h2>
            <p className="muted">Defaults for new sessions. You can override the time on each set.</p>
            <div className="card">
              <Row title="Minutes per mark" help="The suggested time for a paper is its total marks multiplied by this. A paper that states its own time uses that instead.">
                <input aria-label="Minutes per mark" type="number" step={0.25} min={0.25} value={settings.minutesPerMark}
                  onChange={(e) => patchSettings({ minutesPerMark: Number(e.target.value) || DEFAULT_SETTINGS.minutesPerMark })} />
              </Row>
            </div>
          </section>

          <section className="settings-section" id="account" aria-labelledby="settings-account">
            <h2 id="settings-account">Account</h2>
            <p className="muted">Signed in, your attempts, marks, notes and settings follow you between devices. Questions always come from the shared bank.</p>
            <div className="card">
              {!cloudConfigured() ? (
                <Row title="Cloud sync is not configured" help="This site has no sign-in set up, so everything stays on this device." />
              ) : settings.cloudUser ? (
                <>
                  <Row title="Signed in">
                    <span className="account-identity">
                      {settings.cloudUser.photo ? <img src={settings.cloudUser.photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{(settings.cloudUser.name ?? settings.cloudUser.email ?? "?").charAt(0).toUpperCase()}</span>}
                      <span><strong>{settings.cloudUser.name ?? settings.cloudUser.email ?? "Your account"}</strong><span className="muted">{settings.cloudUser.email}{settings.cloudUser.provider === "password" ? (settings.cloudUser.verified ? ", email account" : ", email not confirmed yet") : ""}</span></span>
                    </span>
                  </Row>
                  <Row title="Sync" help="Runs on its own after sign-in, when the tab comes back into view, and shortly after anything is saved.">
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
                  </Row>
                </>
              ) : (
                <div className="setting-row stacked">
                  <div><strong>Not signed in</strong><p>Sign in to keep your progress across devices. Nothing is uploaded until you do.</p></div>
                  <SignInPanel onDone={(u) => setCloudMsg(`Signed in as ${u.email ?? u.name ?? "your account"}.`)} />
                </div>
              )}
              {cloudMsg && <p className="settings-message" role="status">{cloudMsg}</p>}
            </div>
          </section>

          {cloudConfigured() && (
            <section className="settings-section" id="social" aria-labelledby="settings-social">
              <h2 id="settings-social">Leaderboard</h2>
              <p className="muted">Everyone can see the weekly board; joining puts you on it under a nickname, your first name unless you pick another. Your own figures are kept either way.</p>
              <div className="card">
                {!settings.cloudUser ? <Row title="Sign in first" help="The leaderboard is tied to your account." /> : (() => {
                  const form = social ?? { username: settings.social?.username ?? "", leaderboard: settings.social?.leaderboard === true };
                  const save = async () => {
                    setSocialBusy(true); setSocialMsg("");
                    try { await saveSocialSettings(form); setSocial(null); setSocialMsg("Saved."); }
                    catch (e) { setSocialMsg(e instanceof Error ? e.message : "Could not save."); }
                    finally { setSocialBusy(false); }
                  };
                  return (
                    <>
                      <Row title="Join the leaderboard" help="Show your week to other students. Off keeps you out of the public board; admins can still see your figures.">
                        <input type="checkbox" aria-label="Join the leaderboard" checked={form.leaderboard} onChange={(e) => setSocial({ ...form, leaderboard: e.target.checked })} />
                      </Row>
                      <Row title="Nickname" help={`Shown instead of your name. Leave blank to use your first name. Up to ${USERNAME_MAX} characters.`}>
                        <input aria-label="Nickname" maxLength={USERNAME_MAX} placeholder={settings.cloudUser.name?.split(" ")[0] ?? "Your first name"} value={form.username} onChange={(e) => setSocial({ ...form, username: e.target.value })} />
                      </Row>
                      <Row title="Save">
                        <button className="primary small" disabled={socialBusy || !social} onClick={() => void save()}>{socialBusy ? "Saving…" : "Save"}</button>
                      </Row>
                      {socialMsg && <p className={`settings-message${/Saved/.test(socialMsg) ? "" : " field-error"}`} role="status">{socialMsg}</p>}
                    </>
                  );
                })()}
              </div>
            </section>
          )}
          <div className="settings-section" id="amboss">
            <AmbossSettings settings={settings} />
          </div>

          <section className="settings-section" id="library" aria-labelledby="settings-library">
            <h2 id="settings-library">Question library</h2>
            <p className="muted">Published sets reach every device. Your attempts stay attached when a set is updated.</p>
            <div className="card">
              <Row title="Keep my library up to date" help="Pull new and changed sets from the shared bank whenever the app opens.">
                <input type="checkbox" aria-label="Keep my library up to date" checked={settings.autoImportBank !== false} onChange={(e) => patchSettings({ autoImportBank: e.target.checked })} />
              </Row>
              <Row title="Check now" help="Fetch anything published since the app last opened.">
                <button className="small" onClick={async () => {
                  try {
                    const n = await syncFromBank();
                    setLibraryMsg(n ? `Library updated: ${n} new or changed set${n === 1 ? "" : "s"}.` : "Library is up to date.");
                  }
                  catch { setLibraryMsg("The server is not reachable from here."); }
                }}>Check for new sets</button>
              </Row>
              {breakdown && <Row title="On this device" help={`${breakdown.published} published ${breakdown.published === 1 ? "set" : "sets"} from the shared bank` + (breakdown.unpublished ? `, ${breakdown.unpublished} of your own not yet published` : "") + (breakdown.removed ? `, and ${breakdown.removed} edited ${breakdown.removed === 1 ? "copy" : "copies"} of ${breakdown.removed === 1 ? "a set" : "sets"} since removed from the bank. Only the published sets are the same on every device.` : ". Only the published sets are the same on every device.")}>
                {breakdown.removed > 0 && <button className="small" onClick={async () => { const n = await hideRemovedCopies(); setLibraryMsg(`${n} ${n === 1 ? "copy" : "copies"} hidden. Your attempts on ${n === 1 ? "it" : "them"} are kept in History.`); }}>Hide removed {breakdown.removed === 1 ? "copy" : "copies"}</button>}
              </Row>}
              {libraryMsg && <p className="settings-message" role="status">{libraryMsg}</p>}
            </div>
          </section>

          {cloudConfigured() && (
            <section className="settings-section" id="claude" aria-labelledby="settings-claude">
              <h2 id="settings-claude">AI assistants</h2>
              <p className="muted">Let Claude or ChatGPT read the question bank, search it, and (for admins) edit questions and answers, straight from the chat.</p>
              <ClaudeConnect />
            </section>
          )}

          <section className="settings-section" id="backup" aria-labelledby="settings-backup">
            <h2 id="settings-backup">Backup</h2>
            <p className="muted">{settings.lastExportAt ? `Last export ${formatDate(settings.lastExportAt)}.` : "Never exported."} A backup holds your sets, attempts, marks and notes.</p>
            <div className="card">
              <Row title="Export everything" help="One JSON file you can import again here or on another device.">
                <button className="small" onClick={exportJson}>Export JSON</button>
                <button className="small" onClick={() => fileRef.current?.click()}>Import JSON</button>
                <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
              </Row>
              <Row title="Learning points for Anki" help="A tab-separated file: question, learning point, tags.">
                <button className="small" onClick={exportAnki}>Export for Anki</button>
              </Row>
              {backupMsg && <p className="settings-message" role="status">{backupMsg}</p>}
            </div>
          </section>

          {admin && (
            <section className="settings-section" id="admin" aria-labelledby="settings-admin">
              <h2 id="settings-admin">Admin</h2>
              <p className="muted">The shared library is built on the Admin page: add, edit, move and delete sets for everyone.</p>
              <div className="card">
                <Row title="Admin passcode" help={settings.bankPasscode ? "Unlocked on this device. Every edit you make publishes straight away." : "Locked. The Admin page asks for the passcode and remembers it on this device."}>
                  <span className={`status-pill${settings.bankPasscode ? " on" : ""}`}>{settings.bankPasscode ? "Unlocked" : "Locked"}</span>
                  {settings.bankPasscode && <button className="small" onClick={() => patchSettings({ bankPasscode: undefined })}>Lock</button>}
                  <Link className="button small" to="/admin">Open Admin</Link>
                </Row>
              </div>
            </section>
          )}

          <section className="settings-section" id="danger" aria-labelledby="settings-danger">
            <h2 id="settings-danger">Danger zone</h2>
            <p className="muted">Nothing here can be undone. Export a backup first.</p>
            <div className="card">
              <Row title="Delete all data on this device" help="Removes every set, attempt and mark stored in this browser, and the saved AMBOSS login." danger>
                <button className="danger" onClick={() => { setWipeCloud(false); setWiping(true); }}>Delete all data</button>
              </Row>
              {dangerMsg && <p className="settings-message" role="status">{dangerMsg}</p>}
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog open={wiping} title="Delete all data on this device?" confirmLabel="Delete everything" destructive busy={wipeBusy} onCancel={() => setWiping(false)} onConfirm={() => void wipe()}>
        <p>Every question set, attempt and mark in this browser will be deleted, along with the saved AMBOSS login. Published sets come back from the shared bank; your answers do not.</p>
        {settings.cloudUser && <label className="check"><input type="checkbox" checked={wipeCloud} onChange={(e) => setWipeCloud(e.target.checked)} /><span>Also delete my synced answers and marks in the cloud. Leave this off to keep them for your other devices.</span></label>}
      </ConfirmDialog>
    </div>
  );
}
