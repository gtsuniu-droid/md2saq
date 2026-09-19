import { generateHTML } from "@tiptap/react";
import { useMemo } from "react";
import { EDITOR_EXTENSIONS } from "./Editor";
import { highlightHtml } from "../lib/marking";

/** Read-only render of a Tiptap document, with optional hit-term highlighting. */
export default function AnswerHtml({ doc, hits = [] }: { doc: unknown; hits?: string[] }) {
  const html = useMemo(() => {
    if (!doc || typeof doc !== "object") return "";
    try {
      return highlightHtml(generateHTML(doc as Parameters<typeof generateHTML>[0], EDITOR_EXTENSIONS), hits);
    } catch {
      return "";
    }
  }, [doc, hits]);
  if (!html) return <p className="muted">No answer written.</p>;
  return <div className="answer-html" dangerouslySetInnerHTML={{ __html: html }} />;
}
