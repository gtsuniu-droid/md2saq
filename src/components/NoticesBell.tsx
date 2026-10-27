import { useEffect, useRef, useState } from "react";
import { formatDate } from "../lib/questions";
import { deleteNotice, markNoticesSeen, noticesSeenAt, postNotice, subscribeNotices, type Notice } from "../lib/notices";

/** The bell in the bar: announcements from the site, with a badge for ones not yet opened. */
export default function NoticesBell({ canPost, uid }: { canPost: boolean; uid: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(noticesSeenAt);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [composing, setComposing] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop: (() => void) | undefined; let live = true;
    void subscribeNotices((rows) => { if (live) setNotices(rows); }).then((fn) => { if (live) stop = fn; else fn(); });
    return () => { live = false; stop?.(); };
  }, [uid]);
  useEffect(() => {
    if (!open) return;
    const latest = Math.max(0, ...notices.map((n) => n.at));
    if (latest > seenAt) { markNoticesSeen(latest); setSeenAt(latest); }
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, notices, seenAt]);

  const unread = notices.filter((n) => n.at > seenAt).length;
  const post = async () => {
    setBusy(true); setNote("");
    try { await postNotice(title, body); setTitle(""); setBody(""); setComposing(false); setNote("Posted."); }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not post."); }
    finally { setBusy(false); }
  };

  return (
    <div className="notices" ref={root}>
      <button className="notices-bell" aria-label={unread ? `Notices, ${unread} new` : "Notices"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.5l-1.6 2.7a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5L18 12.5V9a6 6 0 0 0-6-6Zm-2.5 15a2.5 2.5 0 0 0 5 0Z" fill="currentColor" /></svg>
        {unread > 0 && <span className="notices-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notices-panel" role="dialog" aria-label="Notices">
          <div className="row spread notices-head"><strong>Notices</strong>{canPost && !composing && <button className="small" onClick={() => setComposing(true)}>Post a notice</button>}</div>
          {composing && (
            <form className="notices-compose" onSubmit={(e) => { e.preventDefault(); void post(); }}>
              <input aria-label="Title" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              <textarea aria-label="Notice" placeholder="What do students need to know?" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="row comment-actions"><button type="button" className="small link" disabled={busy} onClick={() => { setComposing(false); setNote(""); }}>Cancel</button><button type="submit" className="primary small" disabled={busy || !title.trim()}>{busy ? "Posting…" : "Post"}</button></div>
            </form>
          )}
          {note && <p className="muted notices-note" role="status">{note}</p>}
          {!notices.length ? <p className="muted notices-empty">Nothing posted yet.</p> : (
            <ul className="notices-list">
              {notices.map((n) => (
                <li key={n.id} className={n.at > seenAt ? "new" : undefined}>
                  <div className="row spread"><strong>{n.title}</strong><small className="muted">{formatDate(n.at)}</small></div>
                  {n.body && <p className="pre">{n.body}</p>}
                  <div className="row spread"><small className="muted">{n.by}</small>{canPost && <button className="small link" onClick={() => void deleteNotice(n.id).catch((e: unknown) => setNote(e instanceof Error ? e.message : "Could not delete."))}>Delete</button>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
