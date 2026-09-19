import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { getSettings } from "../data/db";
import type { AmbossPhraseGroup } from "../data/types";
import { AmbossAuthError, ambossPhraseGroup, destinationUrl } from "../lib/amboss";
import { closeAmbossPanel, subscribeAmbossPanel, type PanelRequest } from "../lib/ambossPanel";

/** Right-hand pane with an AMBOSS definition. Opens when a term is clicked; closes with ×, Escape, or a click on the backdrop. */
export default function AmbossPanel() {
  const [req, setReq] = useState<PanelRequest | null>(null);
  const [group, setGroup] = useState<AmbossPhraseGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = useLiveQuery(getSettings, []);

  useEffect(() => subscribeAmbossPanel(setReq), []);

  useEffect(() => {
    setGroup(null);
    setError(null);
    if (!req) return;
    let cancelled = false;
    ambossPhraseGroup(req.pgId)
      .then((g) => {
        if (!cancelled) setGroup(g);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof AmbossAuthError ? e.message : "Could not load this term.");
      });
    return () => {
      cancelled = true;
    };
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAmbossPanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;
  const access = settings?.ambossAccess;

  return (
    <>
      <div className="amboss-backdrop" onClick={closeAmbossPanel} />
      <aside className="amboss-pane" role="dialog" aria-label="AMBOSS">
        <div className="amboss-pane-head">
          <span className="muted">AMBOSS</span>
          <button className="small link" onClick={closeAmbossPanel} aria-label="Close">×</button>
        </div>
        <div className="amboss-pane-body">
          {!group && !error && <p className="muted">Loading {req.term}…</p>}
          {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
          {group && (
            <>
              <h2 style={{ margin: "0 0 0.3rem", textTransform: "none", letterSpacing: 0, color: "var(--fg)", fontSize: "1.15rem" }}>{group.title}</h2>
              {group.synonyms.length > 0 && <p className="muted" style={{ marginTop: 0 }}>{group.synonyms.join(", ")}</p>}
              {group.translation && <p className="muted">{group.translation}</p>}
              {group.abstract ? (
                <div className="amboss-abstract pane" dangerouslySetInnerHTML={{ __html: group.abstract }} />
              ) : (
                <p className="muted">{group.paywalled ? "Definition requires an active AMBOSS membership." : "No definition available."}</p>
              )}
              {group.media.length > 0 && (
                <div className="amboss-media pane">
                  {group.media.map((m) =>
                    m.canonicalUrl ? (
                      <a key={m.eid} href={m.canonicalUrl} target="_blank" rel="noreferrer" title={m.title ?? ""}>
                        <img src={m.canonicalUrl} alt={m.title ?? ""} loading="lazy" />
                      </a>
                    ) : null,
                  )}
                </div>
              )}
              {group.destinations.length > 0 && (
                <div className="amboss-dest">
                  {group.destinations.map((d, i) => {
                    const url = destinationUrl(d, access, req.term);
                    return url ? (
                      <a key={i} href={url} target="_blank" rel="noreferrer">{d.label || "Open in AMBOSS"} ↗</a>
                    ) : (
                      <span key={i} className="muted">{d.label}</span>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
