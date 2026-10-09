import { useEffect, useState } from "react";
import { getSettings } from "../data/db";
import { syncFromBank } from "../lib/bank";

export default function LibraryStatus() {
  const [status, setStatus] = useState("Loading library…");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      if ((await getSettings()).autoImportBank !== false) await syncFromBank();
      if (active) setStatus("");
    })().catch(() => { if (active) setStatus("Could not refresh the library."); });
    return () => { active = false; };
  }, [retry]);
  if (!status) return null;
  return <div role="status" className="muted">{status}{status.startsWith("Could") && <> <button className="small" onClick={() => { setStatus("Loading library…"); setRetry(n => n + 1); }}>Retry</button></>}</div>;
}
