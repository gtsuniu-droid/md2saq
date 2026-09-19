import { useLiveQuery } from "dexie-react-hooks";
import { useState, type ReactNode } from "react";
import { getSettings, patchSettings } from "../data/db";
import { BankPasscodeError, verifyPasscode } from "../lib/bank";

interface Props {
  title: string;
  blurb: string;
  children: ReactNode;
}

/**
 * Shows its children only once the bank passcode is saved on this device.
 * The passcode is checked against the bank. If the bank cannot be reached at all
 * (local development), the passcode is accepted unverified so the tools stay usable.
 */
export default function PasscodeGate({ title, blurb, children }: Props) {
  const settings = useLiveQuery(getSettings, []);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (settings === undefined) return null;
  if (settings.bankPasscode) return <>{children}</>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const code = passcode.trim();
    try {
      await verifyPasscode(code);
      await patchSettings({ bankPasscode: code });
    } catch (e) {
      if (e instanceof BankPasscodeError) {
        setError("That passcode was rejected. It must match BANK_PASSCODE in the Netlify site settings exactly.");
      } else if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        // Local development has no bank: accept unverified so the tools stay usable.
        await patchSettings({ bankPasscode: code });
      } else {
        setError(`The server could not be reached to check the passcode: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>{title}</h1>
      <p className="muted">{blurb}</p>
      <div className="row">
        <input type="password" placeholder="Admin passcode" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && passcode) void submit(); }} />
        <button className="primary" disabled={!passcode || busy} onClick={submit}>Unlock</button>
      </div>
      {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
    </div>
  );
}
