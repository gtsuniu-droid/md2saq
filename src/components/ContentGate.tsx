import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { db } from "../data/db";
import { ensureQuestionContent, ensureSetContent, syncFromBank } from "../lib/bank";
import { loadLibrary, readCatalogue } from "../lib/library";

/** Keep legacy detail/edit/mark routes from mistaking catalogue metadata for content. */
export default function ContentGate({ kind, children }: { kind: "set" | "question" | "attempt" | "session"; children: ReactNode }) {
  const params = useParams();
  const id = params.attemptId ?? params.id ?? "";
  const key = `${kind}:${id}`;
  const [result, setResult] = useState({ key: "", error: "", ready: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!await readCatalogue()) await syncFromBank().catch(() => undefined);
      if (kind === "set") await ensureSetContent(id);
      else {
        const questionIds = kind === "question" ? [id] : kind === "attempt"
          ? [(await db.attempts.get(id))?.questionId].filter((q): q is string => !!q)
          : (await db.attempts.where("sessionId").equals(id).toArray()).map(a => a.questionId);
        const library = await loadLibrary();
        const setIds = new Set(library.questions.filter(q => questionIds.includes(q.id)).map(q => q.setId));
        await ensureQuestionContent(library.questions.filter(q => setIds.has(q.setId)).map(q => q.id));
      }
      if (active) setResult({ key, error: "", ready: true });
    })().catch(error => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Could not load this set.", ready: false }); });
    return () => { active = false; };
  }, [key, retry, id, kind]);
  if (result.key === key && result.ready) return children;
  return <div role="status"><p>{result.key === key && result.error ? result.error : "Loading set…"}</p>{result.key === key && result.error && <button onClick={() => setRetry(n => n + 1)}>Retry</button>}</div>;
}
