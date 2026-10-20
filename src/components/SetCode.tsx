import { useEffect, useState } from "react";
import { setLinkCode } from "../lib/shortSetLink";

/** The set's short code, the handle to give Claude or to share. Click to copy. */
export default function SetCode({ bankId }: { bankId?: string }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { let live = true; if (bankId) void setLinkCode(bankId).then((c) => { if (live) setCode(c); }); else setCode(""); return () => { live = false; }; }, [bankId]);
  if (!code) return null;
  return <button type="button" className="set-code" title="The set's code. Click to copy; quote it to Claude or in a share link." onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } }}>
    <span className="muted">Code</span> {code}{copied && <span className="muted"> copied</span>}
  </button>;
}
