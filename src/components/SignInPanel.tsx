import { useState, type FormEvent } from "react";
import { setProgressAccount } from "../lib/progressAccount";
import { authErrorMessage, cloudConfigured, resendVerification, sendPasswordReset, signInWithEmail, signInWithGoogle, signUpWithEmail, type CloudUser } from "../lib/firebase";
import { resetCursors, syncNow } from "../lib/sync";

type Mode = "signin" | "create" | "reset" | "verify";

interface Props {
  /** Called once a sign-in has completed (not after sending a reset link). */
  onDone?: (user: CloudUser) => void;
}

function GoogleMark() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" /><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" /><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" /><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" /></svg>;
}

/** Sign in with Google or with an email address and password; create an account; reset a password. */
export default function SignInPanel({ onDone }: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (!cloudConfigured()) return <p className="muted">Sign-in is not set up on this site.</p>;

  const finish = async (user: CloudUser) => {
    await setProgressAccount(user);
    await resetCursors();
    void syncNow(user).catch(() => undefined);
    onDone?.(user);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (e) { setError(authErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const google = () => run(async () => { await finish(await signInWithGoogle()); });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "signin") void run(async () => { await finish(await signInWithEmail(email, password)); });
    else if (mode === "create") void run(async () => {
      if (password.length < 8) throw new Error("Choose a password of at least 8 characters.");
      const user = await signUpWithEmail(email, password, name);
      await setProgressAccount(user);
      await resetCursors();
      setMode("verify");
      onDone?.(user);
    });
    else if (mode === "reset") void run(async () => { await sendPasswordReset(email); setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`); });
  };

  if (mode === "verify") {
    return <div className="signin-panel">
      <h3>Check your inbox</h3>
      <p>We sent a link to <strong>{email.trim()}</strong>. Open it to confirm your address. You can start practising now; comments and suggestions unlock once it is confirmed.</p>
      <div className="row"><button className="small" disabled={busy} onClick={() => void run(async () => { await resendVerification(); setNotice("Sent again."); })}>Resend link</button></div>
      {notice && <p className="muted" role="status">{notice}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>;
  }

  return <div className="signin-panel">
    {mode === "signin" && <>
      <button type="button" className="signin-google" disabled={busy} onClick={() => void google()}><GoogleMark />Continue with Google</button>
      <div className="signin-divider"><span>or with email</span></div>
    </>}
    <form className="signin-form" onSubmit={submit}>
      {mode === "create" && <label>Name<input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="How you'll appear in comments" /></label>}
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {mode !== "reset" && <label>Password<input type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} required minLength={mode === "create" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />{mode === "create" && <small className="muted">At least 8 characters.</small>}</label>}
      <button type="submit" className="primary" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "create" ? "Create account" : "Send reset link"}</button>
    </form>
    {error && <p className="field-error" role="alert">{error}</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
    <div className="signin-links">
      {mode === "signin" && <><button type="button" className="link small" onClick={() => { setMode("create"); setError(""); }}>Create an account</button><button type="button" className="link small" onClick={() => { setMode("reset"); setError(""); }}>Forgot password?</button></>}
      {mode !== "signin" && <button type="button" className="link small" onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Back to sign in</button>}
    </div>
  </div>;
}
