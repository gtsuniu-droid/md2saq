import { useLiveQuery } from "dexie-react-hooks";
import { useState, type ReactNode } from "react";
import { getSettings, patchSettings } from "../data/db";
import { BankPasscodeError, listBank } from "../lib/bank";

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
    try {
      await listBank(passcode);
      await patchSettings({ bankPasscode: passcode });
    } catch (e) {
      if (e instanceof BankPasscodeError) {
        setError("Wrong passcode.");
      } else {
        // Bank unreachable: accept unverified so local development still works.
        await patchSettings({ bankPasscode: passcode });
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
        <input type="password" placeholder="Bank passcode" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && passcode) void submit(); }} />
        <button className="primary" disabled={!passcode || busy} onClick={submit}>Unlock</button>
      </div>
      {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
    </div>
  );
}
