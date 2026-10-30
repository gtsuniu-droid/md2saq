import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { AnswerComment } from "../data/types";
import { getSettings, newId } from "../data/db";
import { useLiveQuery } from "dexie-react-hooks";
import { GENERAL_ANCHOR, commentSegments, deleteAnswerComment, isGeneralComment, validCommentAnchor, writeAnswerComment, type AnswerAnchor } from "../lib/answerComments";
import { requestSync } from "../lib/sync";
import { renderAnswer } from "../lib/answerRender";

interface Props {
  attemptId: string;
  partLabel: string;
  doc: unknown;
  text?: string;
  comments: AnswerComment[];
  /** Show comments in a margin beside the answer, like a word processor. */
  margin?: boolean;
}

const CARD_GAP = 8;

/** Comments belong to the submitted answer, independently of whether it has been marked. */
export default function CommentedAnswer({ attemptId, partLabel, doc, text = "", comments, margin = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const me = useLiveQuery(async () => (await getSettings()).cloudUser, []);
  const when = (ts: number) => { if (!ts) return ""; const d = new Date(ts); const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); return d.toDateString() === new Date().toDateString() ? `${time} Today` : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`; };
  const author = (ts = 0) => <span className="comment-author">{me?.photo ? <img src={me.photo} alt="" referrerPolicy="no-referrer" /> : <span className="comment-avatar me">{(me?.name ?? me?.email ?? "You").charAt(0).toUpperCase()}</span>}<span><span>{me?.name ?? me?.email ?? "You"}</span>{ts ? <span className="comment-when">{when(ts)}</span> : null}</span></span>;
  // Comments sent back as suggested marks, from whoever the student asked to mark the set.
  const marker = (ts = 0) => <span className="comment-author"><span className="comment-avatar">✓</span><span><span>Marker</span>{ts ? <span className="comment-when">{when(ts)}</span> : null}</span></span>;
  const shell = useRef<HTMLDivElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  // Where the selection ends, within the answer box: the comment button sits there.
  const [selectionAt, setSelectionAt] = useState<{ top: number; left: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [selection, setSelection] = useState<AnswerAnchor | null>(null);
  const [selectionTop, setSelectionTop] = useState(0);
  const [draft, setDraft] = useState<AnswerComment | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const [showList, setShowList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [tops, setTops] = useState<Record<string, number>>({});
  const [marginHeight, setMarginHeight] = useState(0);
  const [resized, setResized] = useState(0);
  const mine = comments.filter((c) => c.partLabel === partLabel);
  const current = mine.find((c) => c.id === active);
  const rendered = useMemo(() => {
    const container = renderAnswer(doc, text);
    const plain = container.textContent ?? "";
    const valid = comments.filter((c) => c.partLabel === partLabel && validCommentAnchor(plain, c));
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    let offset = 0;
    for (const node of nodes) {
      const value = node.data;
      const fragment = document.createDocumentFragment();
      for (const segment of commentSegments(value, valid, offset)) {
        if (!segment.ids.length) { fragment.append(document.createTextNode(segment.text)); continue; }
        const highlight = document.createElement("mark");
        highlight.className = "answer-comment-highlight";
        highlight.dataset.commentIds = JSON.stringify(segment.ids);
        if (segment.ids.some((id) => id === activeRef.current)) highlight.classList.add("active");
        highlight.setAttribute("role", "button"); highlight.tabIndex = 0;
        highlight.setAttribute("aria-label", `Comment on: ${segment.text}`);
        highlight.textContent = segment.text;
        fragment.append(highlight);
      }
      offset += value.length;
      node.replaceWith(fragment);
    }
    return { html: container.innerHTML, plain };
  }, [doc, text, comments, partLabel, active]);
  useEffect(() => {
    const el = input.current;
    if (!draft || !el) return;
    el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`;
    el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  }, [draft?.id]);
  useEffect(() => { setSelection(null); setDraft(null); setActive(null); setShowList(false); setStatus(""); }, [attemptId, partLabel]);

  // Margin layout: each card sits level with its highlight, pushed down only to avoid the one above.
  const ordered = useMemo(() => [...mine].sort((a, b) => a.start - b.start), [mine]);
  const cardOrder = useMemo(() => {
    const items: { id: string; anchorTop: number }[] = ordered.map((c) => ({ id: c.id, anchorTop: isGeneralComment(c) ? 0 : tops[c.id] ?? 0 }));
    if (draft && !mine.some((c) => c.id === draft.id)) items.push({ id: draft.id, anchorTop: isGeneralComment(draft) ? 0 : selectionTop });
    return items.sort((a, b) => a.anchorTop - b.anchorTop);
  }, [ordered, tops, draft, mine, selectionTop]);
  const [laid, setLaid] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    if (!margin || !root.current || !shell.current) return;
    const base = shell.current.getBoundingClientRect().top;
    const next: Record<string, number> = {};
    root.current.querySelectorAll<HTMLElement>("[data-comment-ids]").forEach((el) => {
      const ids = JSON.parse(el.dataset.commentIds ?? "[]") as string[];
      const top = el.getBoundingClientRect().top - base;
      for (const id of ids) if (next[id] === undefined || top < next[id]) next[id] = top;
    });
    setTops((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
  }, [margin, rendered.html, mine.length, resized]);
  useEffect(() => {
    if (!margin) return;
    let frame = 0;
    const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setResized((n) => n + 1)); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", onResize); };
  }, [margin]);
  useLayoutEffect(() => {
    if (!margin) return;
    let cursor = 0;
    const next: Record<string, number> = {};
    for (const item of cardOrder) {
      const top = Math.max(item.anchorTop, cursor);
      next[item.id] = top;
      const height = cardRefs.current.get(item.id)?.offsetHeight ?? 0;
      cursor = top + height + CARD_GAP;
    }
    setLaid((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    setMarginHeight(cursor);
  }, [margin, cardOrder, active, draft?.text, status]);
  useEffect(() => {
    if (!margin) return;
    const cards = cardRefs.current;
    const el = draft ? cards.get(draft.id) : null;
    if (el) gsap.fromTo(el, { opacity: 0, x: 12 }, { opacity: 1, x: 0, duration: 0.25, ease: "power2.out" });
  }, [margin, draft?.id]);

  const captureSelection = () => {
    if (draft || !root.current || (!text && !doc)) return;
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) { setSelection(null); return; }
    const range = selected.getRangeAt(0);
    if (!root.current.contains(range.startContainer) || !root.current.contains(range.endContainer)) { setSelection(null); return; }
    const prefix = range.cloneRange(); prefix.selectNodeContents(root.current); prefix.setEnd(range.startContainer, range.startOffset);
    let start = prefix.toString().length;
    let end = start + range.toString().length;
    while (start < end && /\s/.test(rendered.plain[start])) start++;
    while (end > start && /\s/.test(rendered.plain[end - 1])) end--;
    const anchor = { start, end, quote: rendered.plain.slice(start, end) };
    const ok = validCommentAnchor(rendered.plain, anchor) && !isGeneralComment(anchor);
    setSelection((prev) => !ok ? null : prev && prev.start === start && prev.end === end ? prev : anchor);
    if (ok && shell.current) setSelectionTop(range.getBoundingClientRect().top - shell.current.getBoundingClientRect().top);
    if (ok && textBox.current) {
      const rects = range.getClientRects(); const r = rects[rects.length - 1] ?? range.getBoundingClientRect(); const box = textBox.current.getBoundingClientRect();
      setSelectionAt({ top: r.top - box.top + r.height / 2, left: Math.min(r.right - box.left, box.width - 48) });
    }
  };
  const captureRef = useRef(captureSelection);
  captureRef.current = captureSelection;
  useEffect(() => {
    let frame = 0;
    const onChange = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => captureRef.current()); };
    document.addEventListener("selectionchange", onChange);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("selectionchange", onChange); };
  }, []);
  const openHighlight = (target: EventTarget) => {
    if (draft || window.getSelection()?.toString().trim()) return;
    const highlight = target instanceof Element ? target.closest<HTMLElement>("[data-comment-ids]") : null;
    if (highlight && root.current?.contains(highlight)) {
      const ids = JSON.parse(highlight.dataset.commentIds ?? "[]") as string[];
      setActive(ids[0] ?? null); setShowList(!margin && ids.length > 1); setStatus("");
    }
  };
  /** A comment on the selected passage when there is one, otherwise on the answer as a whole. */
  const startDraft = () => {
    setDraft({ id: newId(), partLabel, ...(selection ?? GENERAL_ANCHOR), text: "", createdAt: 0, updatedAt: 0 });
    setActive(null); setStatus("");
    window.getSelection()?.removeAllRanges();
  };
  const save = async () => {
    if (!draft || busy || !draft.text.trim()) return;
    setBusy(true); setStatus("");
    try {
      if (!draft.updatedAt && !validCommentAnchor(rendered.plain, draft)) throw new Error("The selected passage changed. Select it again before commenting.");
      await writeAnswerComment(attemptId, draft, draft.updatedAt || undefined);
      requestSync(); setActive(draft.id); setDraft(null); setSelection(null); setStatus(margin ? "" : "Comment saved");
    } catch (e) { setStatus(e instanceof Error ? e.message : "Could not save comment."); }
    finally { setBusy(false); }
  };
  const remove = async (target = current) => {
    if (!target || busy) return;
    setBusy(true);
    try { await deleteAnswerComment(attemptId, target.id, target.updatedAt); requestSync(); setActive(null); setStatus(margin ? "" : "Comment removed"); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Could not remove comment."); }
    finally { setBusy(false); }
  };

  const answer = <div ref={root} className="answer-html" onPointerUp={captureSelection} onKeyUp={captureSelection} onClick={(e) => openHighlight(e.target)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { const target = e.target as HTMLElement; if (target.hasAttribute("data-comment-ids")) { e.preventDefault(); openHighlight(target); } } }} dangerouslySetInnerHTML={{ __html: rendered.html }} />;

  const draftCard = (positioned: boolean) => draft && (
    <div key={draft.id} ref={(el) => { if (el) cardRefs.current.set(draft.id, el); else cardRefs.current.delete(draft.id); }} className="answer-comment-card draft" role="region" aria-label="Write a comment" style={positioned ? { top: laid[draft.id] ?? selectionTop } : undefined}>
      {positioned ? author() : draft.quote ? <blockquote>{draft.quote}</blockquote> : <p className="muted comment-scope">On the whole answer</p>}
      <textarea ref={input} rows={1} aria-label="Comment" placeholder="Comment" value={draft.text} onChange={(e) => { setDraft({ ...draft, text: e.target.value }); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); } if (e.key === "Escape" && !busy) setDraft(null); }} />
      <div className="row comment-actions"><button className="small link" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button className="primary small" disabled={busy || !draft.text.trim()} onClick={() => void save()}>{busy ? "Saving…" : draft.updatedAt ? "Save" : "Comment"}</button></div>
    </div>
  );

  if (!margin) {
    return <div className="commented-answer">
      {answer}
      <div className="answer-comment-tools">
        {!draft && <button className="small" onMouseDown={(e) => e.preventDefault()} onClick={startDraft}>{selection ? "Comment on selection" : "Add comment"}</button>}
        {mine.length > 0 && <button className="small link" aria-expanded={showList} onClick={() => setShowList(!showList)}>Comments ({mine.length})</button>}
      </div>
      {showList && <div className="answer-comment-list">{mine.map((c) => <button className="small" key={c.id} onClick={() => { setActive(c.id); setDraft(null); }}><span>{c.quote ? `“${c.quote}”` : "Whole answer"}</span><span>{c.text}</span></button>)}</div>}
      {draft ? draftCard(false) : current && <div className="answer-comment-card" role="region" aria-label="Answer comment">
        {current.quote ? <blockquote>{current.quote}</blockquote> : <p className="muted comment-scope">On the whole answer</p>}<p className="pre">{current.text}</p>
        {!validCommentAnchor(rendered.plain, current) && <p className="muted">The original passage has changed.</p>}
        <div className="row"><button className="small" disabled={busy} onClick={() => { setDraft({ ...current }); setStatus(""); }}>Edit comment</button><button className="small link" disabled={busy} onClick={() => void remove()}>Remove comment</button><button className="small link" onClick={() => setActive(null)}>Close</button></div>
      </div>}
      {status && <p className="muted" role="status">{status}</p>}
    </div>;
  }

  const commentIcon = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.5 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M10 7v5M7.5 9.5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  // Long enough to be cut to two lines when closed.
  const long = (c: AnswerComment) => c.text.length > 110 || c.text.includes("\n");
  return <div ref={shell} className="commented-answer with-margin">
    <div ref={textBox} className="commented-answer-text">
      {answer}
      {!draft && selection && selectionAt && <button type="button" className="comment-fab" style={{ top: selectionAt.top, left: selectionAt.left }} aria-label="Comment on the selected text" title="Comment on the selected text" onMouseDown={(e) => e.preventDefault()} onClick={startDraft}>{commentIcon}</button>}
      {!draft && !selection && <button className="small comment-add" title="Comment on the whole answer, or select some text first to comment on a passage" onMouseDown={(e) => e.preventDefault()} onClick={startDraft}>Add comment</button>}
    </div>
    <aside className="comment-margin" aria-label="Comments" style={{ minHeight: marginHeight }}>
      {ordered.map((c) => {
        const open = c.id === active && !draft;
        const editing = draft?.id === c.id;
        if (editing) return draftCard(true);
        return <div key={c.id} ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }} className={"answer-comment-card" + (open ? " open" : "") + (!isGeneralComment(c) && tops[c.id] === undefined ? " orphan" : "") + (isGeneralComment(c) ? " general" : "")} style={{ top: laid[c.id] ?? tops[c.id] ?? 0 }} role="region" aria-label="Answer comment">
          <button type="button" className="comment-card-body" onClick={() => { setActive(open ? null : c.id); setDraft(null); setStatus(""); }} aria-expanded={open}>
            {c.by === "marker" ? marker(c.createdAt) : author(c.createdAt)}
            <p className="pre">{c.text}</p>
            {long(c) && <span className="comment-more">{open ? "Show less" : "Show more"}</span>}
          </button>
          {open && <div className="row comment-actions">
            {!validCommentAnchor(rendered.plain, c) && <span className="muted comment-note">“{c.quote}” has changed.</span>}
            <button className="small link" disabled={busy} onClick={() => { setDraft({ ...c }); setStatus(""); }}>Edit</button>
            <button className="small link" disabled={busy} onClick={() => void remove(c)}>Delete</button>
          </div>}
        </div>;
      })}
      {draft && !mine.some((c) => c.id === draft.id) && draftCard(true)}
      {status && <p className="muted comment-status" role="status" style={{ top: marginHeight }}>{status}</p>}
    </aside>
  </div>;
}
