import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { getSettings } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { isAdmin } from "../lib/admin";
import { setProgressAccount } from "../lib/progressAccount";
import { cloudConfigured, signInWithGoogle } from "../lib/firebase";
import { communityBody, communityError, communityTarget, COMMUNITY_BODY_LIMIT, type CommunityChannel, type CommunityKind, type CommunityPage, type CommunityPost, type CommunityTarget } from "../lib/community";
import { deleteCommunityPost, fetchCommunity, postCommunity, resolveCommunityPost } from "../lib/communityCloud";

export const communityApi = { resolve: communityTarget, fetch: fetchCommunity, post: postCommunity, remove: deleteCommunityPost, resolvePost: resolveCommunityPost };
type Props = { question: Question; set?: QuestionSet; disabled?: boolean; api?: typeof communityApi };

export default function QuestionCommunity({ question, set, disabled, api = communityApi }: Props) {
  const [open, setOpen] = useState<CommunityChannel | null>(null);
  const settings = useLiveQuery(getSettings, []);
  return <span className="community-buttons">
    <button className="small link" disabled={disabled} title={disabled ? "Available after submitting the exam" : "Suggest an answer or report a problem"} onClick={() => setOpen("suggestions")}>Suggestions</button>
    <button className="small link" disabled={disabled} title={disabled ? "Available after submitting the exam" : "Discuss this question"} onClick={() => setOpen("discussion")}>Discussion</button>
    {open && settings && <CommunityPanel key={`${question.id}:${settings.cloudUser?.uid ?? "guest"}`} question={question} set={set} initialChannel={open} ownerId={settings.cloudUser?.uid ?? ""} admin={isAdmin(settings)} api={api} onClose={() => setOpen(null)} />}
  </span>;
}

function CommunityPanel({ question, set, initialChannel, ownerId, admin, api, onClose }: Props & { initialChannel: CommunityChannel; ownerId: string; admin: boolean; api: typeof communityApi; onClose: () => void }) {
  const [channel, setChannel] = useState(initialChannel);
  const [target, setTarget] = useState<CommunityTarget>();
  const [page, setPage] = useState<CommunityPage>({ posts: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState({ suggestions: "", discussion: "" });
  const [kind, setKind] = useState<CommunityKind>("problem");
  const [replyTo, setReplyTo] = useState<CommunityPost>();
  const pending = useRef<{ id: string; body: string; kind: CommunityKind } | undefined>(undefined);
  const panel = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const body = drafts[channel];
  const close = () => {
    if (busy) return;
    if ((drafts.suggestions.trim() || drafts.discussion.trim()) && !confirm("Discard your unsent post?")) return;
    onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  useEffect(() => {
    const request = ++generation.current;
    setPage({ posts: [] }); setError(""); setMessage(""); setTarget(undefined);
    if (!ownerId || !set?.bankId) return;
    setLoading(true);
    void api.resolve(set, question).then(async resolved => {
      if (generation.current !== request) return;
      setTarget(resolved);
      const result = await api.fetch(resolved, channel);
      if (generation.current === request) setPage(result);
    }).catch(e => { if (generation.current === request) setError(communityError(e)); })
      .finally(() => { if (generation.current === request) setLoading(false); });
    return () => { generation.current++; };
  }, [channel, ownerId, question.id, set?.bankId, api]);

  async function refresh(more = false) {
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const resolved = target ?? await api.resolve(set, question);
      if (request !== generation.current) return;
      setTarget(resolved);
      const result = await api.fetch(resolved, channel, more ? page.cursor : undefined);
      if (request === generation.current) setPage(previous => ({ ...result, posts: more ? [...previous.posts, ...result.posts.filter(p => !previous.posts.some(old => old.id === p.id))] : result.posts }));
    } catch (e) { if (request === generation.current) setError(communityError(e)); }
    finally { if (request === generation.current) setLoading(false); }
  }
  async function send() {
    if (!target || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const text = communityBody(body);
      const content = replyTo && channel === "discussion" ? `Reply to ${replyTo.authorName}:\n“${replyTo.body.slice(0, 240)}${replyTo.body.length > 240 ? "…" : ""}”\n\n${text}` : text;
      communityBody(content);
      const postKind = channel === "discussion" ? "comment" : kind;
      if (!pending.current || pending.current.body !== content || pending.current.kind !== postKind) pending.current = { id: crypto.randomUUID(), body: content, kind: postKind };
      await api.post(target, channel, { ...pending.current, expectedOwner: ownerId });
      pending.current = undefined;
      setDrafts(previous => ({ ...previous, [channel]: "" })); setReplyTo(undefined);
      setMessage(channel === "discussion" ? "Comment posted." : "Suggestion posted.");
      await refresh();
    } catch (e) { setError(communityError(e)); }
    finally { setBusy(false); }
  }
  async function remove(post: CommunityPost) {
    if (!target || busy || !confirm("Delete this post from the discussion?")) return;
    setBusy(true); setError("");
    try { await api.remove(target, channel, post.id); setPage(p => ({ ...p, posts: p.posts.filter(item => item.id !== post.id) })); }
    catch (e) { setError(communityError(e)); }
    finally { setBusy(false); }
  }
  async function resolve(post: CommunityPost) {
    if (!target || busy) return;
    setBusy(true); setError("");
    try { await api.resolvePost(target, post.id, !post.resolved); setPage(p => ({ ...p, posts: p.posts.map(item => item.id === post.id ? { ...item, resolved: !item.resolved } : item) })); }
    catch (e) { setError(communityError(e)); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="community-overlay">
    <div className="community-backdrop" onClick={close} />
    <aside className="community-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Question ${question.order + 1} community`} onKeyDown={e => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "Tab") {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') ?? []);
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="community-header"><div><strong>Question {question.order + 1}</strong><small>{set?.name}</small></div><button className="small link" onClick={close} disabled={busy} aria-label="Close discussion">×</button></header>
      <div className="community-tabs" role="group" aria-label="Conversation type">
        <button aria-pressed={channel === "suggestions"} disabled={busy} onClick={() => setChannel("suggestions")}>Suggestions</button>
        <button aria-pressed={channel === "discussion"} disabled={busy} onClick={() => setChannel("discussion")}>Discussion</button>
      </div>
      <div className="community-content">
        {!set?.bankId ? <p>Suggestions and discussion are available after this set is published.</p> : !ownerId ? <div><p>Sign in to read and post with other users.</p><button className="primary" disabled={busy || !cloudConfigured()} onClick={async () => {
          setBusy(true); setError("");
          try { await setProgressAccount(await signInWithGoogle()); } catch (e) { setError(communityError(e)); } finally { setBusy(false); }
        }}>Sign in</button></div> : <>
          <form className="community-compose" onSubmit={e => { e.preventDefault(); void send(); }}>
            {channel === "suggestions" && <label>Suggestion type<select aria-label="Suggestion type" value={kind} disabled={busy} onChange={e => setKind(e.target.value as CommunityKind)}><option value="problem">Report a problem</option><option value="answer">Suggest an answer</option></select></label>}
            {replyTo && channel === "discussion" && <div className="community-reply">Replying to {replyTo.authorName}<button type="button" className="small link" disabled={busy} onClick={() => setReplyTo(undefined)} aria-label="Cancel reply">×</button></div>}
            <label htmlFor="community-message">{channel === "suggestions" ? "Your suggestion" : "Your comment"}</label>
            <textarea id="community-message" value={body} maxLength={replyTo && channel === "discussion" ? COMMUNITY_BODY_LIMIT - 400 : COMMUNITY_BODY_LIMIT} disabled={busy} onChange={e => setDrafts(previous => ({ ...previous, [channel]: e.target.value }))} placeholder={channel === "suggestions" ? "What should be corrected or added? Include the subquestion if relevant." : "Share your reasoning or ask a question…"} />
            <div className="row spread"><small>Visible to other signed-in users</small><button className="primary" disabled={busy || !target || !body.trim()}>{busy ? "Saving…" : channel === "suggestions" ? "Post suggestion" : "Post comment"}</button></div>
          </form>
          {message && <p role="status">{message}</p>}
          <div className="row spread community-list-heading"><strong>{channel === "suggestions" ? "Suggestions" : "Discussion"}</strong><button className="small link" disabled={loading || busy} onClick={() => void refresh()}>Refresh</button></div>
          {loading && <p role="status">Loading…</p>}
          {!loading && !error && !page.posts.length && <p className="muted">{channel === "suggestions" ? "No suggestions yet." : "Start the discussion."}</p>}
          {page.posts.map(post => <article className="community-post" key={post.id}>
            <div className="row spread"><strong>{post.authorName}</strong><time dateTime={new Date(post.createdAt).toISOString()}>{new Date(post.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></div>
            {channel === "suggestions" && <small className="community-post-kind">{post.kind === "answer" ? "Suggested answer" : "Problem reported"}{post.resolved ? ", resolved" : ""}</small>}
            <p className="pre">{post.body}</p>
            <div className="row community-post-actions">
              {channel === "discussion" && <button className="small link" disabled={busy} onClick={() => { setReplyTo(post); document.getElementById("community-message")?.focus(); }}>Reply</button>}
              {admin && channel === "suggestions" && <button className="small link" disabled={busy} onClick={() => void resolve(post)}>{post.resolved ? "Reopen" : "Mark resolved"}</button>}
              {(post.authorId === ownerId || admin) && <button className="small link danger" disabled={busy} onClick={() => void remove(post)}>Delete</button>}
            </div>
          </article>)}
          {page.cursor != null && <button disabled={loading || busy} onClick={() => void refresh(true)}>Load older posts</button>}
        </>}
        {error && <p role="alert" className="community-error">{error}</p>}
      </div>
    </aside>
  </div>, document.body);
}
