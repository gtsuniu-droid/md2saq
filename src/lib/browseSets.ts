import { presentationName } from "../data/presentations";
import { primaryPresentation } from "./primaryPresentation";
import { setLabel, type SetSummary } from "./sets";

export function browseSetTitle(summary: SetSummary): string {
  const presentation = primaryPresentation(summary.set, summary.questions);
  return presentation ? `${presentationName(presentation)} — ${setLabel(summary.set)}` : setLabel(summary.set);
}

/** Search prompts and metadata without revealing or matching hidden model answers. */
export function browseSets(summaries: SetSummary[], search: string, presentation: string, tag?: string | null, collection?: string | null): SetSummary[] {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return summaries.filter((summary) => {
    const { set, questions } = summary;
    if (presentation && (primaryPresentation(set, questions) ?? "unassigned") !== presentation) return false;
    if (tag && !(set.tags ?? []).includes(tag)) return false;
    if (collection && set.collection !== collection) return false;
    const text = [browseSetTitle(summary), set.name, set.source, set.collection, ...(set.tags ?? []),
      ...questions.flatMap((q) => [...(q.stems ?? []), q.text, ...q.parts.map((p) => p.text)])].join("\n").toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  }).sort((a, b) => browseSetTitle(a).localeCompare(browseSetTitle(b), undefined, { numeric: true }) || a.set.createdAt - b.set.createdAt || a.set.id.localeCompare(b.set.id));
}
