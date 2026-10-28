import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { browseSetFor } from "../lib/publicLinks";

/**
 * A shared set link (/s/<code>, or the older /shared/<bank id>) opens the set in Browse,
 * where the visitor can look through it, answers hidden until asked for, and practise it.
 */
export default function SharedPage() {
  const { bankId, code } = useParams();
  const [found, setFound] = useState<{ setId: string | null; error?: true }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setFound(undefined);
    void browseSetFor({ code, bankId }).then((setId) => { if (live) setFound({ setId }); }).catch(() => { if (live) setFound({ setId: null, error: true }); });
    return () => { live = false; };
  }, [code, bankId, retry]);
  if (!found) return <p className="muted" role="status">Opening shared set…</p>;
  if (found.setId) return <Navigate to={`/browse?set=${encodeURIComponent(found.setId)}`} replace />;
  return <div>
    <h1>Shared set</h1>
    <p role="alert">{found.error ? "Could not open this set. Check your connection and try again." : "This shared set is no longer available."}</p>
    <div className="row">{found.error && <button onClick={() => setRetry((n) => n + 1)}>Try again</button>}<Link className="button" to="/browse">Browse sets</Link></div>
  </div>;
}
