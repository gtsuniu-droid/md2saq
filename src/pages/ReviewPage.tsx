import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { db, getSettings } from "../data/db";
import { historyEntries } from "../lib/history";
import { reviewTopics, savedReviewNotes } from "../lib/review";
import { nextReview, rateReview, reviewIntervalLabel, reviewQueue, type ReviewQueueItem } from "../lib/reviewSchedule";
import type { ReviewRating } from "../data/types";
import { requestSync } from "../lib/sync";
import { answerParts, stemsOf } from "../lib/questions";
import { hasModelAnswer } from "../lib/modelAnswer";
import ModelAnswerContent from "../components/ModelAnswerContent";

export default function ReviewPage() {
  const [tab, setTab] = useState<"topics" | "notes">("topics");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const data = useLiveQuery(async () => {
    const [attempts, marks, questions, sets, settings] = await Promise.all([db.attempts.toArray(), db.marks.toArray(), db.questions.toArray(), db.sets.toArray(), getSettings()]);
    const entries = historyEntries(attempts, marks, questions, sets, settings.cloudUser?.uid ?? "");
    return { entries, topics: reviewTopics(entries, questions), signedIn: !!settings.cloudUser };
  }, []);
  if (!data) return <p>Loading review…</p>;
  const query = search.trim().toLowerCase();
  const queue = reviewQueue(data.topics.flatMap((topic) => topic.entries.map(({ entry, reasons }) => ({ entry, reasons, topic: topic.name }))), data.entries.flatMap((e) => e.mark ? [e.mark] : []), now);
  const matches = (item: ReviewQueueItem) => `${item.topic} ${item.entry.label} ${item.entry.text} ${savedReviewNotes(item.entry)}`.toLowerCase().includes(query);
  const due = queue.ready.filter(matches).slice(0, 10);
  const later = queue.later.filter(matches);
  const notes = data.entries.filter((entry) => savedReviewNotes(entry).trim() && `${entry.label} ${entry.text} ${savedReviewNotes(entry)}`.toLowerCase().includes(query));
  return <div className="review-page">
    <h1>Review</h1>
    <div className="row spread review-controls">
      <div className="seg" role="group" aria-label="Review view">
        <button className={tab === "topics" ? "on" : ""} aria-pressed={tab === "topics"} onClick={() => setTab("topics")}>Due now</button>
        <button className={tab === "notes" ? "on" : ""} aria-pressed={tab === "notes"} onClick={() => setTab("notes")}>Saved notes</button>
      </div>
      <input type="search" aria-label="Search review" placeholder="Search topics or notes" value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
    {!data.signedIn && <p className="muted"><Link to="/settings">Sign in</Link> to sync your review notes.</p>}
    {tab === "topics" ? <>
      <div className="row spread review-queue-summary"><strong>{queue.ready.length} due now</strong><span className="muted">Up to 10 new questions a day</span></div>
      {!due.length && <p className="muted">{query ? "No due reviews match your search." : queue.later.length ? "You’re caught up for now." : queue.waiting ? "Today’s new reviews are finished." : "Nothing due. Flag an answer while marking to add it here."}</p>}
      {due.map((item) => <ScheduledReviewCard key={item.entry.mark!.id} item={item} now={now} onRated={() => setNow(Date.now())} />)}
      {queue.ready.length > 10 && <p className="muted">Showing 10 at a time. The next reviews appear as you finish.</p>}
      {(later.length > 0 || queue.waiting > 0) && <details className="review-upcoming">
        <summary>Upcoming ({later.length + queue.waiting})</summary>
        {later.map(({ entry, topic }) => <div className="row spread review-upcoming-row" key={entry.mark!.id}><Link to={`/history/${entry.attempt.id}`}>{topic}, {entry.label}</Link><time>{new Date(entry.mark!.reviewSchedule!.dueAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div>)}
        {queue.waiting > 0 && <p className="muted">{queue.waiting} new questions waiting for future days.</p>}
      </details>}

    </> : <>
      {!notes.length && <p className="muted">{query ? "No matching notes." : "Notes you save while marking will appear here."}</p>}
      {notes.map((entry) => <article className="card review-topic" key={entry.attempt.id}>
        <div className="row spread"><strong><Link to={`/history/${entry.attempt.id}`}>{entry.label}</Link></strong><time className="muted">{new Date(entry.attempt.submittedAt!).toLocaleDateString()}</time></div>
        <p className="muted">{entry.text}</p>
        <p className="pre review-note-text">{savedReviewNotes(entry)}</p>
        <Link to={`/mark/${entry.attempt.id}`}>Edit notes</Link>
      </article>)}
    </>}
  </div>;
}


function ScheduledReviewCard({ item, now, onRated }: { item: ReviewQueueItem; now: number; onRated: () => void }) {
  const { entry, reasons, topic } = item;
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const question = entry.question;
  const mark = entry.mark!;
  const notes = savedReviewNotes(entry);
  const rate = async (rating: ReviewRating) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await rateReview(mark.id, rating, mark._m); requestSync(); onRated(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save this review. Try again."); }
    finally { setBusy(false); }
  };
  return <article className="card review-topic">
    <div className="row spread"><h2>{topic}</h2><Link to={`/history/${entry.attempt.id}`}>{entry.label}</Link></div>
    {question && stemsOf(question).length > 0 && <details className="review-case"><summary>Case</summary>{stemsOf(question).map((stem, i) => <p className="pre" key={i}>{stem}</p>)}</details>}
    <p className="pre">{entry.text}</p>
    {(question?.images ?? []).map((image) => <figure className="qimg" key={image.id}><img src={image.dataUrl} alt={image.caption ?? ""} />{image.caption && <figcaption>{image.caption}</figcaption>}</figure>)}
    {question?.parts.map((part) => <p className="pre" key={part.label}><strong>{part.label}) </strong>{part.text}</p>)}
    <div className="review-reasons">{reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
    {!revealed ? <button className="primary review-reveal" onClick={() => setRevealed(true)}>Show answer and notes</button> : <div className="review-revealed">
      {question && hasModelAnswer(question) && <ModelAnswerContent answer={question} />}
      {question && question.parts.length > 0 && answerParts(question).filter(hasModelAnswer).map((part) => <div key={part.label}><strong>{part.label})</strong><ModelAnswerContent answer={part} /></div>)}
      {notes && <div className="review-note-text"><strong>My notes</strong><p className="pre">{notes}</p></div>}
      {!notes && (!question || !hasModelAnswer(question) && !question.parts.some(hasModelAnswer)) && <p className="muted">No saved guide or notes. Open the set to check your answer before rating.</p>}
      <div className="review-rating" role="group" aria-label="How well did you remember?">{(["again", "hard", "good", "easy"] as ReviewRating[]).map((rating) => <button key={rating} disabled={busy} onClick={() => void rate(rating)}><strong>{rating[0].toUpperCase() + rating.slice(1)}</strong><small>{reviewIntervalLabel(nextReview(mark.reviewSchedule, rating, now), now)}</small></button>)}</div>
      <Link to={`/mark/${entry.attempt.id}`}>Edit notes or marking</Link>
      {error && <p role="alert">{error}</p>}
    </div>}
  </article>;
}
