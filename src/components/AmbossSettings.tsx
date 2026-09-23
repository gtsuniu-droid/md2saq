import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Settings } from "../data/types";
import { patchSettings } from "../data/db";
import { ambossCheck, ambossLogin, ambossLogout } from "../lib/amboss";
import { forgetAmbossLogin, getRememberedAmbossLogin } from "../lib/ambossCredentials";
import AmbossLogo from "./AmbossLogo";

export default function AmbossSettings({ settings }: { settings: Settings }) {
  const saved = useLiveQuery(getRememberedAmbossLogin, []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [editLogin, setEditLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (saved) { setUsername(saved.username); setRemember(true); }
  }, [saved?.revision]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect to AMBOSS."); }
    finally { setBusy(false); }
  };
  return <section aria-label="AMBOSS connection">
    <h2 id="amboss" className="amboss-settings-heading"><AmbossLogo /></h2>
    <div className="card amboss-settings-card">
      {settings.ambossToken ? <>
        <div className="amboss-account-row"><span>Logged in{settings.ambossUser?.firstName ? ` as ${settings.ambossUser.firstName}` : ""}</span><span className="row">
          <button className="small" disabled={busy} onClick={() => void run(async () => {
            if (!await ambossCheck()) throw new Error("AMBOSS could not reconnect. Update your login below.");
            setMessage("AMBOSS is connected.");
          })}>Check connection</button>
          <button className="small" disabled={busy} onClick={() => void run(async () => { await ambossLogout(); setPassword(""); setRemember(false); setEditLogin(false); setMessage("Logged out. Saved login removed from this browser."); })}>Log out</button>
        </span></div>
        <div className="amboss-preferences">
          <label className="check"><input type="checkbox" checked={settings.ambossHighlights} onChange={(e) => void patchSettings({ ambossHighlights: e.target.checked })} /><span>Link medical terms<small>In notes, questions and marking</small></span></label>
          <label className="check"><input type="checkbox" checked={settings.ambossOnPaper} onChange={(e) => void patchSettings({ ambossOnPaper: e.target.checked })} /><span>Show AMBOSS during a paper</span></label>
        </div>
      </> : <p className="muted">Connect AMBOSS to open medical references beside your notes.</p>}
      {(saved || settings.ambossToken) && <div className="amboss-login-row">
        <div><span>Automatic sign-in</span><small>{saved ? saved.needsAttention ? "Saved login needs updating" : "Enabled on this device" : "Not enabled on this device"}</small>{saved && <small>{saved.username}</small>}</div>
        <div className="row">
          {settings.ambossToken && !editLogin && <button className="small" disabled={busy} onClick={() => { setRemember(true); setEditLogin(true); setMessage(""); setError(""); }}>{saved ? "Update login" : "Remember login"}</button>}
          {saved && <button className="small link" disabled={busy} onClick={() => void run(async () => { await forgetAmbossLogin(); setRemember(false); setMessage("Saved password removed. Your current session stays connected."); })}>Forget login</button>}
        </div>
      </div>}
      {(!settings.ambossToken || editLogin) && <form className="stack amboss-login-form" onSubmit={(e) => { e.preventDefault(); void run(async () => {
        const user = await ambossLogin(username, password, remember);
        setPassword(""); setEditLogin(false);
        setMessage(remember ? "Login saved in this browser. AMBOSS will reconnect automatically when its session expires." : `Connected${user.firstName ? ` as ${user.firstName}` : ""}.`);
      }); }}>
        <label>AMBOSS email<input aria-label="AMBOSS email" type="email" autoComplete="username" value={username} required disabled={busy} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>AMBOSS password<input aria-label="AMBOSS password" type="password" autoComplete="current-password" value={password} required disabled={busy} onChange={(e) => setPassword(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} />Remember on this device and sign in automatically</label>
        <p className="muted" style={{ margin: 0 }}>When enabled, your password is saved encrypted in this browser. It is sent only to AMBOSS through this website’s login connection and is excluded from cloud sync and backups. Use this on your own device.</p>
        <div className="row"><button className="primary" disabled={busy}>{busy ? "Connecting…" : settings.ambossToken ? "Save login" : "Log in"}</button>{settings.ambossToken && <button type="button" disabled={busy} onClick={() => { setEditLogin(false); setPassword(""); }}>Cancel</button>}</div>
      </form>}
      {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
      {message && <p role="status" style={{ margin: 0 }}>{message}</p>}
    </div>
  </section>;
}
