import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { getSettings } from "../data/db";
import type { AmbossPhraseGroup } from "../data/types";
import { AmbossAuthError, ambossPhraseGroup, ambossPhrases, destinationUrl } from "../lib/amboss";
import { markTerms, type Segment, type Term } from "../lib/ambossMatch";
import { splitByRanges, type Piece, type Range } from "../lib/highlights";

interface Props {
  /** Cache key, normally the question id. Texts sharing a key are sent to AMBOSS together. */
  cacheKey: string;
  /** Every text of this question, so one phrase-finder call covers them all. */
  texts: string[];
  /** The text this instance renders (one of `texts`). */
  text: string;
  /** Force highlighting off, e.g. during the paper unless the setting allows it. */
  disabled?: boolean;
  className?: string;
  /** Candidate highlights to paint over the text. */
  highlights?: Range[];
  /** Attribute hook so a parent can find this block, e.g. data-stem="1". */
  dataStem?: number;
}

/** Shared per-key request within the page, so the parts of one question do not each hit the API. */
const inflight = new Map<string, Promise<Term[]>>();

export default function AmbossText({ cacheKey, texts, text, disabled = false, className = "pre", highlights, dataStem }: Props) {
  const settings = useLiveQuery(getSettings, []);
  const [terms, setTerms] = useState<Term[]>([]);
  const [popup, setPopup] = useState<{ pgId: string; term: string; anchor: HTMLElement } | null>(null);
  const active = !!settings?.ambossToken && settings.ambossHighlights && !disabled;
  const textsKey = texts.join("\n---\n");

  useEffect(() => {
    if (!active) {
      setTerms([]);
      return;
    }
    let cancelled = false;
    let p = inflight.get(cacheKey);
    if (!p) {
      p = ambossPhrases(cacheKey, texts).catch(() => [] as Term[]);
      inflight.set(cacheKey, p);
      void p.finally(() => setTimeout(() => inflight.delete(cacheKey), 5000));
    }
    void p.then((t) => {
      if (!cancelled) setTerms(t);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cacheKey, textsKey]);

  const base: Segment[] = active ? markTerms(text, terms) : [{ text }];
  const segments: Piece[] = highlights?.length ? splitByRanges(base, highlights) : base;

  return (
    <span className={className} style={{ position: "relative", display: "block" }} data-stem={dataStem}>
      {segments.map((s, i) => {
        const inner = s.hl ? <mark className="user-hl">{s.text}</mark> : s.text;
        return s.pgId ? (
          <span
            key={i}
            className="amboss-marker"
            data-phrase-id={s.pgId}
            data-phrase-term={s.term}
            onClick={(e) => setPopup(popup?.pgId === s.pgId ? null : { pgId: s.pgId!, term: s.term!, anchor: e.currentTarget })}
          >
            {inner}
          </span>
        ) : (
          <span key={i}>{inner}</span>
        );
      })}
      {popup && (
        <AmbossPopup pgId={popup.pgId} term={popup.term} anchor={popup.anchor} access={settings?.ambossAccess} onClose={() => setPopup(null)} />
      )}
    </span>
  );
}

interface PopupProps {
  pgId: string;
  term: string;
  anchor: HTMLElement;
  access?: string;
  onClose: () => void;
}

function AmbossPopup({ pgId, term, anchor, access, onClose }: PopupProps) {
  const [group, setGroup] = useState<AmbossPhraseGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    ambossPhraseGroup(pgId)
      .then((g) => {
        if (!cancelled) setGroup(g);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof AmbossAuthError ? e.message : "Could not load this term.");
      });
    return () => {
      cancelled = true;
    };
  }, [pgId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  // Position under the clicked term, relative to the AmbossText container.
  const parent = anchor.offsetParent as HTMLElement | null;
  const top = anchor.offsetTop + anchor.offsetHeight + 6;
  const left = Math.max(0, Math.min(anchor.offsetLeft, (parent?.clientWidth ?? 400) - 360));

  return (
    <div ref={ref} className="amboss-popup" style={{ top, left }} onClick={(e) => e.stopPropagation()}>
      {!group && !error && <div className="muted">Loading…</div>}
      {error && <div style={{ color: "var(--bad)" }}>{error}</div>}
      {group && (
        <>
          <div className="amboss-popup-head">
            <strong>{group.title}</strong>
            {group.synonyms.length > 0 && <div className="muted">{group.synonyms.join(", ")}</div>}
            {group.translation && <div className="muted">{group.translation}</div>}
          </div>
          {group.abstract ? (
            <div className="amboss-abstract" dangerouslySetInnerHTML={{ __html: group.abstract }} />
          ) : (
            <div className="muted">{group.paywalled ? "Definition requires an active AMBOSS membership." : "No definition available."}</div>
          )}
          {group.media.length > 0 && (
            <div className="amboss-media">
              {group.media.slice(0, 4).map((m) =>
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
                const url = destinationUrl(d, access, term);
                return url ? (
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    {d.label || "Open in AMBOSS"} ↗
                  </a>
                ) : (
                  <span key={i} className="muted">
                    {d.label}
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
