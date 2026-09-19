import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../data/db";
import { PasscodeError, forgetPasscode, savedPasscode, shareSet } from "../lib/share";

interface Props {
  setId: string;
  className?: string;
}

/** One-click share of a set to the bank. Asks for the passcode the first time, then remembers it. */
export default function ShareSetButton({ setId, className = "" }: Props) {
  const set = useLiveQuery(() => db.sets.get(setId), [setId]);
  const [asking, setAsking] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!set) return null;
  if (set.bankId) return <span className="muted">Shared to bank ✓</span>;

  const go = async (code: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await shareSet(setId, code);
      setMessage(`Shared "${r.name}" (${r.questions} questions).`);
      setAsking(false);
    } catch (e) {
      if (e instanceof PasscodeError) {
        await forgetPasscode();
        setPasscode("");
        setAsking(true);
        setMessage("Wrong passcode.");
      } else {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const onClick = async () => {
    const saved = await savedPasscode();
    if (saved) await go(saved);
    else setAsking(true);
  };

  return (
    <span className="row" style={{ display: "inline-flex" }}>
      {asking ? (
        <>
          <input type="password" placeholder="Bank passcode" value={passcode} autoFocus
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && passcode) void go(passcode); }} />
          <button className={"primary " + className} disabled={!passcode || busy} onClick={() => go(passcode)}>Share</button>
          <button className={className} onClick={() => setAsking(false)}>Cancel</button>
        </>
      ) : (
        <button className={className} disabled={busy} onClick={onClick}>{busy ? "Sharing…" : "Share to bank"}</button>
      )}
      {message && <span className={"muted"} style={{ color: message.startsWith("Shared") ? "var(--ok)" : "var(--bad)" }}>{message}</span>}
    </span>
  );
}
