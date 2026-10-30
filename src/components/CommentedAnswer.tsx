import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import gsap from "gsap";
import type { AnswerComment } from "../data/types";
import { getSettings, newId } from "../data/db";
import { useLiveQuery } from "dexie-react-hooks";
import { GENERAL_ANCHOR, commentSegments, deleteAnswerComment, isGeneralComment, repliesTo, validCommentAnchor, withParagraphBreaks, writeAnswerComment, type AnswerAnchor } from "../lib/answerComments";
import { requestSync } from "../lib/sync";
import { renderAnswer } from "../lib/answerRender";
import { diffWithOrigin } from "../lib/wordDiff";

interface Props {
  attemptId: string;
  partLabel: string;
  doc: unknown;
  text?: string;
  comments: AnswerComment[];
  /** Show comments in a margin beside the answer, like a word processor. */
  margin?: boolean;
  /** Further quiet actions shown beside "Add comment" in the margin layout. */
  actions?: ReactNode;
  /** The answer as revised after reading the model answer: shown in place of the original with the changes marked, comments still on the words they were on. */
  revision?: string;
  /** With a revision: mark what changed (default), or read the revised text clean. */
  showChanges?: boolean;
  /** An editor shown in place of the answer (revising it), which draws the comment highlights itself and says when its layout changed. */
  editor?: (ctx: { active: string | null; onLayout: () => void }) => ReactNode;
}

const CARD_GAP = 8;

/** Comments belong to the submitted answer, independently of whether it has been marked. */
export default function CommentedAnswer({ attemptId, partLabel, doc, text = "", comments, margin = false, actions, revision, showChanges = true, editor }: Props) {
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
  const all = comments.filter((c) => c.partLabel === partLabel);
  // Cards are the comments themselves; replies hang under them.
  const mine = all.filter((c) => !c.replyTo);
  const current = mine.find((c) => c.id === active);
  const [reply, setReply] = useState("");
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const sendReply = async (to: string) => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true); setStatus("");
    try { await writeAnswerComment(attemptId, { id: newId(), partLabel, ...GENERAL_ANCHOR, text, createdAt: 0, updatedAt: 0, replyTo: to }); requestSync(); setReply(""); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Could not save the reply."); }
    finally { setBusy(false); }
  };
  // Replies show under their comment whether or not it is open; the box to add one only when it is.
  const thread = (c: AnswerComment, open: boolean) => {
    const replies = repliesTo(all, c.id);
    if (!replies.length && !open) return null;
    return <div className="comment-thread">
      {replies.map((r) => <div key={r.id} className="comment-reply" onClick={() => { if (!open) { setActive(c.id); setDraft(null); setStatus(""); } }}>
        {r.by === "marker" ? marker(r.createdAt) : author(r.createdAt)}
        <p className="pre">{r.text}</p>
        {open && <button type="button" className="small link comment-reply-delete" disabled={busy} onClick={(e) => { e.stopPropagation(); void remove(r); }} aria-label="Delete reply">Delete</button>}
      </div>)}
      {open && <textarea ref={replyInput} className="comment-reply-box" rows={1} aria-label="Reply" placeholder="Reply" value={reply} disabled={busy}
        onChange={(e) => { setReply(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(c.id); } if (e.key === "Escape") setReply(""); }} />}
    </div>;
  };
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
    // Paragraph texts, so the revision (one line break between paragraphs) can be compared with the original on equal terms.
    const paragraphs = [...container.querySelectorAll("p")].map((p) => p.textContent ?? "");
    return { html: container.innerHTML, plain, paragraphs: paragraphs.join("") === plain ? paragraphs : [plain] };
  }, [doc, text, comments, partLabel, active]);
  useEffect(() => {
    const el = input.current;
    if (!draft || !el) return;
    el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`;
    el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  }, [draft?.id]);
  useEffect(() => { setSelection(null); setDraft(null); setActive(null); setShowList(false); setStatus(""); setReply(""); }, [attemptId, partLabel]);
  useEffect(() => { setReply(""); }, [active]);
  // The editor takes the answer's place: a passage selected before has no button to keep.
  useEffect(() => { if (editor) { setSelection(null); setSelectionAt(null); } }, [!!editor]);

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
  }, [margin, rendered.html, mine.length, resized, revision, showChanges, !!editor]);
  useEffect(() => {
    if (!margin) return;
    let frame = 0;
    const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setResized((n) => n + 1)); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", onResize); };
  }, [margin]);
  // Each card sits level with its line unless the one above is in the way. The open card is
  // given its line if the cards above can move up far enough to let it; they never overlap,
  // and nothing moves further than it has to.
  useLayoutEffect(() => {
    if (!margin) return;
    const height = (id: string) => cardRefs.current.get(id)?.offsetHeight ?? 0;
    const next: Record<string, number> = {};
    // With nothing open: each card level with its line unless the one above is in the way.
    const closed: Record<string, number> = {};
    let flow = 0;
    for (const item of cardOrder) { closed[item.id] = Math.max(item.anchorTop, flow); flow = closed[item.id] + height(item.id) + CARD_GAP; }
    const openId = draft?.id ?? active;
    const at = cardOrder.findIndex((item) => item.id === openId);
    let start = 0;
    if (at >= 0) {
      // The least room the cards above need, stacked tight from the top.
      const needed = cardOrder.slice(0, at).reduce((n, item) => n + height(item.id) + CARD_GAP, 0);
      const openTop = Math.max(cardOrder[at].anchorTop, needed);
      next[cardOrder[at].id] = openTop;
      // The cards above stay put unless the open card needs their room; then they move up, only as far as needed.
      let above = openTop;
      for (let k = at - 1; k >= 0; k--) { const id = cardOrder[k].id; next[id] = Math.max(0, Math.min(closed[id], above - height(id) - CARD_GAP)); above = next[id]; }
      start = at + 1;
    }
    let cursor = start ? next[cardOrder[start - 1].id] + height(cardOrder[start - 1].id) + CARD_GAP : 0;
    for (const item of cardOrder.slice(start)) {
      const top = Math.max(item.anchorTop, cursor);
      next[item.id] = top;
      cursor = top + height(item.id) + CARD_GAP;
    }
    setLaid((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    setMarginHeight(Math.max(cursor, ...Object.values(next).map((top, i) => top + height(Object.keys(next)[i]))));
  }, [margin, cardOrder, active, draft?.id, draft?.text, status, reply, all.length]);
  // Cards glide to their places rather than jumping; a card's first position is set outright.
  const placed = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (!margin) return;
    const openId = draft?.id ?? active;
    const at = cardOrder.findIndex((item) => item.id === openId);
    cardOrder.forEach((item, k) => {
      const el = cardRefs.current.get(item.id); const top = laid[item.id];
      if (!el || top === undefined) return;
      const zIndex = k === at ? 2 : 1;
      if (!placed.current.has(item.id) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { gsap.set(el, { top, zIndex }); placed.current.add(item.id); }
      else gsap.to(el, { top, zIndex, duration: 0.28, ease: "power2.out", overwrite: "auto" });
    });
    for (const id of [...placed.current]) if (!(id in laid)) placed.current.delete(id);
  }, [margin, laid, cardOrder, active, draft?.id]);
  useEffect(() => {
    if (!margin) return;
    const cards = cardRefs.current;
    const el = draft ? cards.get(draft.id) : null;
    if (el) gsap.fromTo(el, { opacity: 0, x: 12 }, { opacity: 1, x: 0, duration: 0.25, ease: "power2.out" });
  }, [margin, draft?.id]);

  const captureSelection = () => {
    if (draft || revision !== undefined || editor || !root.current || (!text && !doc)) return;
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

  // The revision read in place of the original: kept and removed words carry the comments made on them.
  const revised = useMemo(() => {
    if (revision === undefined) return null;
    const unbroken = text || doc ? rendered.plain : "";
    const blocks = text || doc ? rendered.paragraphs : [];
    const original = blocks.join("\n");
    const valid = comments.filter((c) => c.partLabel === partLabel && validCommentAnchor(unbroken, c)).map((c) => isGeneralComment(c) ? c : { ...c, start: withParagraphBreaks(blocks, c.start, "start"), end: withParagraphBreaks(blocks, c.end, "end") });
    const segments = (value: string, offset: number) => commentSegments(value, valid, offset).map((seg, i) => seg.ids.length
      ? <mark key={i} className={"answer-comment-highlight" + (seg.ids.some((id) => id === active) ? " active" : "")} data-comment-ids={JSON.stringify(seg.ids)} role="button" tabIndex={0} aria-label={`Comment on: ${seg.text}`}>{seg.text}</mark>
      : <span key={i}>{seg.text}</span>);
    // Paragraphs, as the original reads: a line break in the text closes one. Kept and removed
    // words keep their comments; a removed stretch that spans paragraphs is struck in each.
    const paragraphs: ReactNode[][] = [[]];
    const add = (node: ReactNode) => paragraphs[paragraphs.length - 1].push(node);
    const parts = showChanges ? diffWithOrigin(original, revision) : [{ kind: "same" as const, text: revision }];
    parts.forEach((part, i) => {
      const lines = part.text.split("\n");
      lines.forEach((line, j) => {
        if (j) paragraphs.push([]);
        if (!line) return;
        // Where this piece sits in the original, when it came from there.
        const at = part.at === undefined || !showChanges ? undefined : part.at + lines.slice(0, j).reduce((n, l) => n + l.length + 1, 0);
        const inner = at === undefined ? line : segments(line, at);
        add(part.kind === "ins" ? <ins key={`${i}:${j}`} className="tc-ins">{line}</ins>
          : part.kind === "del" ? <del key={`${i}:${j}`} className="tc-del">{inner}</del>
          : <span key={`${i}:${j}`}>{inner}</span>);
      });
    });
    return <div className="answer-diff">{paragraphs.map((nodes, i) => <p key={i} className="pre">{nodes}</p>)}</div>;
  }, [revision, showChanges, rendered.plain, rendered.paragraphs, text, doc, comments, partLabel, active]);
  const onAnswerKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { const target = e.target as HTMLElement; if (target.hasAttribute("data-comment-ids")) { e.preventDefault(); openHighlight(target); } } };
  const answer = editor
    ? <div ref={root} className="answer-html answer-editing" onClick={(e) => openHighlight(e.target)} onKeyDown={onAnswerKey}>{editor({ active, onLayout: () => setResized((n) => n + 1) })}</div>
    : revised
    ? <div ref={root} className="answer-html" onClick={(e) => openHighlight(e.target)} onKeyDown={onAnswerKey}>{revised}</div>
    : <div ref={root} className="answer-html" onPointerUp={captureSelection} onKeyUp={captureSelection} onClick={(e) => openHighlight(e.target)} onKeyDown={onAnswerKey} dangerouslySetInnerHTML={{ __html: rendered.html }} />;

  const draftCard = (positioned: boolean) => draft && (
    <div key={draft.id} ref={(el) => { if (el) cardRefs.current.set(draft.id, el); else cardRefs.current.delete(draft.id); }} className="answer-comment-card draft" role="region" aria-label="Write a comment" >
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
        {repliesTo(all, current.id).map((r) => <p key={r.id} className="pre comment-reply-plain"><span className="muted">{r.by === "marker" ? "Marker" : "You"}: </span>{r.text}</p>)}
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
      {!draft && !selection && !editor && <span className="comment-add-row"><button className="small comment-add" title="Comment on the whole answer, or select some text first to comment on a passage" onMouseDown={(e) => e.preventDefault()} onClick={startDraft}>Add comment</button>{actions}</span>}
    </div>
    <aside className="comment-margin" aria-label="Comments" style={{ minHeight: marginHeight }}>
      {ordered.map((c) => {
        const open = c.id === active && !draft;
        const editing = draft?.id === c.id;
        if (editing) return draftCard(true);
        return <div key={c.id} ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }} className={"answer-comment-card" + (open ? " open" : "") + (!isGeneralComment(c) && tops[c.id] === undefined ? " orphan" : "") + (isGeneralComment(c) ? " general" : "")} role="region" aria-label="Answer comment">
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
          {thread(c, open)}
        </div>;
      })}
      {draft && !mine.some((c) => c.id === draft.id) && draftCard(true)}
      {status && <p className="muted comment-status" role="status" style={{ top: marginHeight }}>{status}</p>}
    </aside>
  </div>;
}
