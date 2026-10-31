import type { PeerMark, StudyComment } from "../lib/studyTypes";
import type { RoomPerson } from "../lib/studyRoom";

/** Pieces shared by Mark together and the set marking page: who marked an answer, and what they said. */

export function Face({ name, photo, small, shared }: { name: string; photo?: string; small?: boolean; shared?: boolean }) {
  return <span className={`lb-avatar plain mt-face${small ? " small" : ""}${shared ? " shared" : ""}`} aria-hidden="true">{photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : name.charAt(0).toUpperCase()}</span>;
}

/** A chip per person who marked: their picture and the mark, for one part when `part` is given; a mark given to the whole answer shows once, on the first part. */
export function MarkChips({ marks, people, part, firstPart = true }: { marks: PeerMark[]; people: RoomPerson[]; part?: string; firstPart?: boolean }) {
  const who = (uid: string) => people.find((p) => p.uid === uid);
  const scoreOf = (m: PeerMark) => {
    if (part === undefined) return m.score;
    const own = m.parts?.find((p) => p.label === part)?.score;
    if (own !== undefined) return own;
    // A mark given to the whole answer, or to parts labelled differently, shows once with its total.
    return firstPart && !(m.parts?.some((p) => p.label === part) ?? false) && (!m.parts || !m.parts.some((p) => p.label)) ? m.score : undefined;
  };
  return <>{marks.map((m) => { const s = scoreOf(m); return s === undefined ? null : <span key={m.by} className="mt-chip" title={`${who(m.by)?.name ?? "Someone"} gave ${s}`}><Face name={who(m.by)?.name ?? "?"} photo={who(m.by)?.photo} small /><strong>{s}</strong></span>; })}</>;
}

/** Friends' comments on an answer, oldest first. */
export function FriendComments({ comments, me, onDelete }: { comments: StudyComment[]; me?: string; onDelete?: (id: string) => void }) {
  return <>{comments.map((c) => (
    <div key={c.id} className="mt-comment">
      <Face name={c.name} photo={c.photo} small />
      <p className="pre"><strong>{c.name}</strong> {c.text}{onDelete && c.uid === me && <button type="button" className="link" onClick={() => onDelete(c.id)} aria-label="Delete your comment">Delete</button>}</p>
    </div>
  ))}</>;
}
