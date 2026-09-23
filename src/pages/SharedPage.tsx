import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { SetPack } from "../lib/exportImport";
import { loadSharedPack, loadShortSharedSet, sharedPath } from "../lib/publicLinks";
import { partLabel, stemsOf } from "../lib/questions";
import { hasModelAnswer } from "../lib/modelAnswer";
import ModelAnswerContent from "../components/ModelAnswerContent";

/** Public bank content only. Opening a link never changes a private session or local draft. */
export default function SharedPage() {
  const { bankId: routeBankId = "", questionId, code } = useParams();
  const requestKey = code ?? routeBankId;
  const [result, setResult] = useState<{ key: string; bankId: string; pack?: SetPack; error?: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    void (code ? loadShortSharedSet(code) : loadSharedPack(routeBankId).then(pack => ({ bankId: routeBankId, pack }))).then(({ bankId, pack }) => {
      if (active) setResult({ key: requestKey, bankId, pack });
    }).catch(error => {
      if (active) setResult({ key: requestKey, bankId: routeBankId, error: /not found|404/i.test(String(error))
        ? "This shared set is no longer available."
        : "Could not load this shared set. Check your connection and try again." });
    });
    return () => { active = false; };
  }, [routeBankId, code, retry]);
  if (!result || result.key !== requestKey) return <p role="status">Loading shared set…</p>;
  if (!result.pack) return <div><h1>Shared set</h1><p role="alert">{result.error}</p><button onClick={() => setRetry(n => n + 1)}>Try again</button> <Link to="/">Home</Link></div>;
  const pack = result.pack;
  const bankId = result.bankId;
  const questions = [...pack.questions].sort((a, b) => a.order - b.order);
  const visible = questionId ? questions.filter(q => q.id === questionId) : questions;
  return <div className="shared-page">
    <div className="row spread"><Link to="/">Home</Link>{questionId && <Link to={sharedPath(bankId)}>View whole set</Link>}</div>
    <h1>{pack.set.name || "Shared set"}</h1>
    {pack.set.instructions && <p className="pre">{pack.set.instructions}</p>}
    {!visible.length && <p role="alert">{questionId ? "This question is no longer in the published set. You can still view the whole set." : "This set has no questions yet."}</p>}
    {visible.map(q => <section className="card shared-question" key={q.id}>
      <h2>Question {questions.indexOf(q) + 1}</h2>
      {stemsOf(q).map((stem, i) => <p className="pre stem-block" key={i}>{stem}</p>)}
      {(q.images ?? []).map(image => <figure className="qimg" key={image.id}><img src={image.dataUrl} alt={image.caption ?? "Question image"} />{image.caption && <figcaption>{image.caption}</figcaption>}</figure>)}
      <p className="pre">{q.text}</p>
      {q.parts.map(part => <div className="part-head" key={part.label}><span className="label">{partLabel(part.label)}</span><span className="text pre">{part.text}</span>{part.marks !== undefined && <span className="marks">({part.marks})</span>}</div>)}
      {!q.parts.length && q.marks !== undefined && <p className="muted">{q.marks} marks</p>}
      {(hasModelAnswer(q) || q.parts.some(hasModelAnswer)) && <details><summary>Model answer</summary>{q.parts.filter(hasModelAnswer).map(part => <div key={part.label}><strong>{partLabel(part.label)}</strong><ModelAnswerContent answer={part} /></div>)}{hasModelAnswer(q) && <ModelAnswerContent answer={q} />}</details>}
    </section>)}
  </div>;
}
