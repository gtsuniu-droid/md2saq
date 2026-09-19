import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { getSettings } from "../data/db";
import { ambossPhrases } from "../lib/amboss";
import { openAmbossPanel } from "../lib/ambossPanel";
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
            onClick={() => openAmbossPanel({ pgId: s.pgId!, term: s.term! })}
          >
            {inner}
          </span>
        ) : (
          <span key={i}>{inner}</span>
        );
      })}
    </span>
  );
}
