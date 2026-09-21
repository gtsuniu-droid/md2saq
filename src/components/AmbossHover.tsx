import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import DOMPurify from "dompurify";
import { getSettings } from "../data/db";
import type { AmbossPhraseGroup } from "../data/types";
import { ambossPhraseGroup, destinationUrl } from "../lib/amboss";
import { openAmbossPanel, subscribeAmbossPanel, type PanelRequest } from "../lib/ambossPanel";
import AmbossImages from "./AmbossImages";
import AmbossLogo from "./AmbossLogo";
import articleIcon from "../assets/amboss-ui/article.svg";
import arrowIcon from "../assets/amboss-ui/arrow.svg";
import pointerIcon from "../assets/amboss-ui/pointer.svg";

interface HoverRequest extends PanelRequest { anchor: HTMLElement }

function termAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(".amboss-marker[data-phrase-id][data-phrase-term]") : null;
}

/** One delegated preview serves notes, question text and model answers. */
export default function AmbossHover() {
  const [request, setRequest] = useState<HoverRequest | null>(null);
  const [group, setGroup] = useState<AmbossPhraseGroup | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const popup = useRef<HTMLDivElement>(null);
  const imageOpen = useRef(false);
  const dismiss = useRef(() => {});
  const settings = useLiveQuery(getSettings, []);
  const active = !!settings?.ambossToken && !!settings.ambossHighlights;
  const onImageOpen = useCallback((open: boolean) => { imageOpen.current = open; }, []);

  useEffect(() => {
    let opening: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    let anchor: HTMLElement | null = null;
    const cancelClose = () => { clearTimeout(closing); };
    const clear = () => {
      clearTimeout(opening); cancelClose(); anchor = null; setRequest(null);
    };
    dismiss.current = clear;
    if (!active) { clear(); return; }
    const insidePopup = (target: EventTarget | null) => target instanceof Node && !!popup.current?.contains(target);
    const leave = () => {
      clearTimeout(opening); cancelClose();
      closing = setTimeout(() => {
        if (imageOpen.current || popup.current?.contains(document.activeElement)) return;
        clear();
      }, 220);
    };
    const enter = (next: HTMLElement) => {
      cancelClose();
      if (next === anchor && popup.current) return;
      clearTimeout(opening); anchor = next;
      opening = setTimeout(() => {
        if (!next.isConnected || imageOpen.current) return;
        setRequest({ anchor: next, pgId: next.dataset.phraseId!, term: next.dataset.phraseTerm! });
      }, 280);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch" || imageOpen.current) return;
      if (insidePopup(e.target)) { cancelClose(); return; }
      const next = termAt(e.target);
      if (next && next !== termAt(e.relatedTarget)) enter(next);
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (insidePopup(e.relatedTarget) || termAt(e.relatedTarget) === anchor) return;
      if (termAt(e.target) || insidePopup(e.target)) leave();
    };
    const focusIn = (e: FocusEvent) => {
      if (insidePopup(e.target)) { cancelClose(); return; }
      const next = termAt(e.target);
      if (next) enter(next);
    };
    const focusOut = (e: FocusEvent) => {
      if (!insidePopup(e.relatedTarget) && termAt(e.relatedTarget) !== anchor) leave();
    };
    const onDown = (e: PointerEvent) => { if (!insidePopup(e.target) && !imageOpen.current) clear(); };
    const onKey = (e: KeyboardEvent) => {
      if (imageOpen.current || !popup.current) return;
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        if (popup.current.contains(document.activeElement)) anchor?.focus({ preventScroll: true });
        clear();
      }
      else if (e.key === "ArrowDown" && termAt(e.target) === anchor) {
        e.preventDefault(); popup.current.querySelector<HTMLElement>("button, a")?.focus();
      }
    };
    const onScroll = (e: Event) => { if (!insidePopup(e.target) && !imageOpen.current) clear(); };
    const stopPanel = subscribeAmbossPanel(() => clear());
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("visibilitychange", clear);
    window.addEventListener("resize", clear);
    return () => {
      clearTimeout(opening); cancelClose(); stopPanel();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("resize", clear);
    };
  }, [active]);

  useEffect(() => {
    setGroup(null); setError("");
    if (!request) return;
    let cancelled = false;
    ambossPhraseGroup(request.pgId).then((value) => { if (!cancelled) setGroup(value); }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this reference.");
    });
    return () => { cancelled = true; };
  }, [request, retry]);

  useLayoutEffect(() => {
    if (!request) return;
    const rect = request.anchor.getBoundingClientRect();
    const width = Math.min(520, window.innerWidth - 24);
    const above = Math.max(0, rect.top - 20);
    const below = Math.max(0, window.innerHeight - rect.bottom - 20);
    const useBelow = below >= Math.min(400, above);
    const centre = (rect.left + rect.right) / 2;
    const left = Math.max(12, Math.min(centre - width / 2, window.innerWidth - width - 12));
    setPosition({ width, left,
      top: useBelow ? rect.bottom + 8 : undefined, bottom: useBelow ? undefined : window.innerHeight - rect.top + 8,
      "--hover-max-height": `${Math.min(620, useBelow ? below : above)}px`, "--hover-arrow-left": `${Math.max(20, Math.min(width - 20, centre - left))}px`, "--hover-arrow-turn": useBelow ? "0deg" : "180deg",
      "--hover-arrow-top": useBelow ? "-23px" : "auto", "--hover-arrow-bottom": useBelow ? "auto" : "-23px",
    } as CSSProperties);
  }, [request]);

  if (!request || !active) return null;
  const media = group?.media.filter((m) => m.canonicalUrl?.startsWith("https://")) ?? [];
  const destinations = (group?.destinations ?? []).map((d) => ({ ...d, url: destinationUrl(d, settings?.ambossAccess, request.term) })).filter((d) => d.url);
  const pin = () => { openAmbossPanel({ pgId: request.pgId, term: request.term }); dismiss.current(); };
  return createPortal(<div ref={popup} className="amboss-hover" role="dialog" aria-label={`${request.term}: AMBOSS preview`} style={position}>
    <img className="amboss-hover-pointer" src={pointerIcon} alt="" aria-hidden="true" />
    <div className="amboss-hover-scroll">
    <section className="amboss-hover-content">
    <header><strong>{group?.title ?? request.term}</strong>
      {group && [...new Set([...group.synonyms, group.translation].filter(Boolean))].map((value) => <p className="amboss-hover-subtitle" key={value}>{value}</p>)}
    </header>
    {!group && !error && <p role="status">Loading reference…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="small" onClick={() => setRetry((n) => n + 1)}>Retry reference</button></div>}
    {group && <>
      <AmbossImages key={group.eid} media={media} title={group.title} preview onViewAll={pin} onViewerChange={onImageOpen} />
      {group.abstract ? <div className="amboss-hover-definition" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(group.abstract) }} onClick={(e) => {
        const link = (e.target as Element).closest("a");
        if (link) { e.preventDefault(); if (link.protocol === "https:") window.open(link.href, "_blank", "noopener,noreferrer"); }
      }} /> : <p className="muted">{group.paywalled ? "An active AMBOSS membership is needed for this explanation." : "See the linked article for this term."}</p>}
    </>}
    </section>
    {!!destinations.length && <div className="amboss-hover-links">{destinations.map((d, i) => <a key={i} href={d.url!} target="saq-amboss-article" rel="noopener noreferrer"><img className="amboss-hover-icon" src={articleIcon} alt="" aria-hidden="true"/><span>{d.label || group?.title}</span><img className="amboss-hover-icon amboss-hover-link-arrow" src={arrowIcon} alt="" aria-hidden="true"/></a>)}</div>}
    <footer className="row spread"><AmbossLogo /><a href="https://support.amboss.com/hc/en-us/requests/new" target="_blank" rel="noopener noreferrer">Feedback</a></footer>
    </div>
  </div>, document.body);
}
