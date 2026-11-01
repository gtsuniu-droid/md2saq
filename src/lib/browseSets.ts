import { presentationName } from "../data/presentations";
import { primaryPresentation } from "./primaryPresentation";
import { setHeadline, type SetSummary } from "./sets";

export function browseSetTitle(summary: SetSummary): string {
  const presentation = primaryPresentation(summary.set, summary.questions);
  return presentation ? `${presentationName(presentation)} ${setHeadline(summary.set)}` : setHeadline(summary.set);
}

/** Done or not done, where done means a submitted sitting since progress was last reset. */
export type DoneFilter = "" | "done" | "new";
export type BrowseSort = "title" | "sat";

/** Search prompts and metadata without revealing or matching hidden model answers. */
export function browseSets(summaries: SetSummary[], search: string, presentation: string, tag?: string | null, collection?: string | null, done: DoneFilter = "", sort: BrowseSort = "title"): SetSummary[] {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const byTitle = (a: SetSummary, b: SetSummary) => browseSetTitle(a).localeCompare(browseSetTitle(b), undefined, { numeric: true }) || a.set.createdAt - b.set.createdAt || a.set.id.localeCompare(b.set.id);
  return summaries.filter((summary) => {
    const { set, questions } = summary;
    if (done && summary.done !== (done === "done")) return false;
    if (presentation && (primaryPresentation(set, questions) ?? "unassigned") !== presentation) return false;
    if (tag && !(set.tags ?? []).includes(tag)) return false;
    if (collection && set.collection !== collection) return false;
    const text = [browseSetTitle(summary), set.name, set.source, set.collection, ...(set.tags ?? []),
      ...questions.flatMap((q) => [...(q.stems ?? []), q.text, ...q.parts.map((p) => p.text)])].join("\n").toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  }).sort(sort === "sat" ? (a, b) => (b.lastSat?.submittedAt ?? 0) - (a.lastSat?.submittedAt ?? 0) || byTitle(a, b) : byTitle);
}

/** "3 Nov" this year, "Nov 2025" before it. */
export function shortSatDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  return d.getFullYear() === new Date(now).getFullYear()
    ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
