import AmbossLogo from "./AmbossLogo";
import AmbossImages from "./AmbossImages";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import DOMPurify from "dompurify";
import { getSettings } from "../data/db";
import type { AmbossPhraseGroup } from "../data/types";
import { AmbossAuthError, ambossPhraseGroup, destinationUrl } from "../lib/amboss";
import { closeAmbossPanel, subscribeAmbossPanel, type PanelRequest } from "../lib/ambossPanel";

/** A reference stays beside the notes; reading it never navigates away from an answer. */
export default function AmbossPanel() {
  const [req, setReq] = useState<PanelRequest | null>(null);
  const [group, setGroup] = useState<AmbossPhraseGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<PanelRequest[]>([]);
  const [textSize, setTextSize] = useState(100);
  const [tab, setTab] = useState<"summary" | "articles" | "images">("summary");
  const close = useRef<HTMLButtonElement>(null);
  const settings = useLiveQuery(getSettings, []);

  useEffect(() => subscribeAmbossPanel((next) => {
    setReq(next); setTab("summary");
    if (next) setHistory((items) => [next, ...items.filter((item) => item.pgId !== next.pgId)].slice(0, 8));
  }), []);

  useEffect(() => {
    setGroup(null); setError(null);
    if (!req) return;
    let cancelled = false;
    ambossPhraseGroup(req.pgId).then((g) => { if (!cancelled) setGroup(g); }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof AmbossAuthError ? e.message : "Could not load this reference. Check your connection and try again.");
    });
    return () => { cancelled = true; };
  }, [req, retry, settings?.ambossToken]);

  useEffect(() => {
    if (!req) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAmbossPanel(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [!!req]);

  if (!req) return null;
  const destinations = (group?.destinations ?? []).map((d) => ({ ...d, url: destinationUrl(d, settings?.ambossAccess, req.term) })).filter((d) => d.url);
  const fullArticle = destinations[0]?.url;
  const media = group?.media.filter((m) => m.canonicalUrl?.startsWith("https://")) ?? [];
  return <aside className="amboss-pane amboss-reference" aria-label="AMBOSS reference">
    <div className="amboss-pane-head"><span className="amboss-wordmark"><AmbossLogo /><small>Reference</small></span><button ref={close} className="small link" onClick={closeAmbossPanel} aria-label="Close AMBOSS reference">×</button></div>
    <div className="amboss-reference-heading">
      <h2>{group?.title ?? req.term}</h2>
      {!!group?.synonyms.length && <p className="muted">{group.synonyms.join(", ")}</p>}
      <div className="row spread">
        {fullArticle && <a className="amboss-article-link" href={fullArticle} target="saq-amboss-article" rel="noopener noreferrer">Read full article ↗</a>}
        <div className="row" role="group" aria-label="AMBOSS text size"><button className="small" aria-label="Smaller AMBOSS text" disabled={textSize <= 85} onClick={() => setTextSize(textSize - 15)}>−</button><button className="small" aria-label="Reset AMBOSS text size" onClick={() => setTextSize(100)}>{textSize}%</button><button className="small" aria-label="Larger AMBOSS text" disabled={textSize >= 175} onClick={() => setTextSize(textSize + 15)}>+</button></div>
      </div>
    </div>
    <div className="amboss-reference-tabs" role="group" aria-label="Reference view">
      <button aria-pressed={tab === "summary"} onClick={() => setTab("summary")}>Overview</button>
      <button aria-pressed={tab === "articles"} onClick={() => setTab("articles")}>Article sections {destinations.length || ""}</button>
      <button aria-pressed={tab === "images"} onClick={() => setTab("images")}>Images {media.length || ""}</button>
    </div>
    <div className="amboss-pane-body" style={{ fontSize: `${textSize / 100}em` }}>
      {!group && !error && <p role="status" className="muted">Loading {req.term}…</p>}
      {error && <div role="alert"><p>{error}</p><div className="row"><button className="small" onClick={() => setRetry(retry + 1)}>Try again</button><Link to="/settings#amboss" onClick={closeAmbossPanel}>AMBOSS settings</Link></div></div>}
      {group && tab === "summary" && <>
        <AmbossImages key={group.eid} media={media} title={group.title} preview onViewAll={() => setTab("images")} />
        {group.translation && <p className="muted">{group.translation}</p>}
        {group.abstract ? <div className="amboss-abstract pane" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(group.abstract, { ADD_ATTR: ["target"] }) }} onClick={(e) => {
          const a = (e.target as Element).closest("a");
          if (a) { e.preventDefault(); try { const url = new URL(a.href); if (url.protocol === "https:") window.open(url.href, "_blank", "noopener,noreferrer"); } catch { /* Invalid upstream link. */ } }
        }} /> : <p>{group.paywalled ? "This reference requires an active AMBOSS membership." : "No overview is available for this term. See the linked article sections."}</p>}
        <div className="amboss-reference-source"><strong>Source: AMBOSS</strong><p className="muted">This is the connector’s reference overview. The full article opens in AMBOSS.</p></div>
      </>}
      {group && tab === "articles" && <><p className="muted">Open the relevant section in your AMBOSS account.</p><div className="amboss-article-sections">{destinations.map((d, i) => <a key={i} href={d.url!} target="saq-amboss-article" rel="noopener noreferrer"><span>{d.label || group.title}</span><span aria-hidden="true">↗</span></a>)}</div>{!destinations.length && <p>No linked articles are available for this term.</p>}</>}
      {group && tab === "images" && <><AmbossImages key={group.eid} media={media} title={group.title} />{!media.length && <p>No images are available for this term.</p>}</>}
    </div>
    {history.length > 1 && <div className="amboss-recent"><label>Recent references<select aria-label="Recent AMBOSS references" value={req.pgId} onChange={(e) => { const item = history.find((h) => h.pgId === e.target.value); if (item) { setReq(item); setTab("summary"); } }}>{history.map((item) => <option key={item.pgId} value={item.pgId}>{item.term}</option>)}</select></label></div>}
  </aside>;
}
