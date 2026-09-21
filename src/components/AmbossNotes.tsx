import AmbossLogo from "./AmbossLogo";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import type { JSONContent } from "@tiptap/react";
import { getSettings } from "../data/db";
import { ambossPhrases } from "../lib/amboss";
import { ambossTextFingerprint, annotateAmbossHtml, noteLookupText } from "../lib/ambossNotes";
import type { Term } from "../lib/ambossMatch";
import { openAmbossPanel } from "../lib/ambossPanel";

const pending = new Map<string, Promise<Term[]>>();

export function AmbossNotesStatus() {
  const settings = useLiveQuery(getSettings, []);
  return <p className="amboss-notes-status muted"><AmbossLogo /><span>{settings?.ambossToken && settings.ambossHighlights ? "Hover over an underlined term for pictures and an explanation. Click to keep the reference beside your notes." : <Link to="/settings#amboss">{settings?.ambossToken ? "Enable medical term links in Settings" : "Connect in Settings to link medical terms"}</Link>}</span></p>;
}

export function useAmbossNoteHtml(doc: unknown, html: string) {
  const settings = useLiveQuery(getSettings, []);
  const [terms, setTerms] = useState<Term[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const text = useMemo(() => noteLookupText(doc as JSONContent), [doc]);
  const active = !!settings?.ambossToken && !!settings.ambossHighlights;
  const key = `note:${settings?.ambossUser?.eid ?? "user"}:${ambossTextFingerprint(text)}`;
  useEffect(() => {
    setTerms([]); setError("");
    if (!active || !text.trim()) return;
    let cancelled = false;
    let request = pending.get(key);
    if (!request) {
      request = ambossPhrases(key, text.match(/[\s\S]{1,18000}/g) ?? []);
      pending.set(key, request);
      void request.finally(() => pending.delete(key)).catch(() => undefined);
    }
    void request.then((found) => { if (!cancelled) setTerms(found); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "AMBOSS is unavailable."); });
    return () => { cancelled = true; };
  }, [active, key, text, settings?.ambossToken, retry]);
  return { html: useMemo(() => annotateAmbossHtml(html, active ? terms : []), [html, terms, active]), error, retry: () => setRetry((n) => n + 1) };
}

export function openNoteTerm(target: EventTarget) {
  if (!(target instanceof Element)) return;
  const term = target.closest<HTMLButtonElement>("button[data-phrase-id]");
  if (term?.dataset.phraseId && term.dataset.phraseTerm) openAmbossPanel({ pgId: term.dataset.phraseId, term: term.dataset.phraseTerm });
}
