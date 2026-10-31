import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok } from "../../mcp/src/util";
import { checkSuggested, MARKING_RULES, setText } from "../../src/lib/setForMarking";
import { findSet, mySets, suggest } from "./answers";

/**
 * The connected student's own answers: read a set they have opened for marking, and leave
 * suggested marks and comments on it. Hosted only, since it needs to know whose answers they
 * are; the marking page fills the suggestions in for the student to check and save.
 */
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const setRef = z.string().optional().describe("The set's id (the marking page's prompt gives it), or part of its name or number; \"exam\" for the student's most recent whole exam paper (every set of it, numbered right through); leave out for the set most recently opened for marking.");

export function registerAnswerTools(server: McpServer, uid: string): void {
  server.registerTool("getMyAnswers", {
    title: "Get my answers",
    description: "The connected student's own answers to a set they have submitted, with the case, each question and part with its marks, and the model answers and marking notes. Sets appear here once the student opens their marking page, and a submitted exam appears whole as well, so \"mark the exam I just did\" means set \"exam\". Use it when asked to mark their answers, as its howToMark sets out (strictly, as an expert, evidence-based consultant examining finals, with clinical reasoning rather than a blind reading of the guide), then send the marks with markMyAnswers.",
    inputSchema: { set: setRef },
    annotations: READ,
  }, async ({ set }) => {
    try {
      const sets = await mySets(uid);
      const s = findSet(sets, set);
      if (!s) return fail(new Error(sets.length ? `No recent set matches "${set}".` : "No sets yet."), { hint: "Sets appear once the student opens a set's marking page on the site.", recent: sets.map((x) => ({ id: x.key, name: x.name })) });
      return ok({
        success: true, id: s.key, set: s.name, ...(s.exam ? { exam: true } : {}), submitted: new Date(s.at).toISOString(),
        parts: s.questions.flatMap((q) => q.parts.map((p) => ({ part: p.id, marks: p.marks }))),
        ...(s.suggested ? { alreadySuggested: `Marks were suggested ${new Date(s.suggested.at).toISOString()}; sending again replaces them.` } : {}),
        otherRecentSets: sets.filter((x) => x !== s).map((x) => ({ id: x.key, name: x.name, ...(x.exam ? { exam: true } : {}) })),
        howToMark: [...MARKING_RULES, `Point at specific passages by quoting them word for word from the answer, with a short comment on each. Then call markMyAnswers with set "${s.key}".`].join(" "),
        text: setText(s),
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool("markMyAnswers", {
    title: "Mark my answers",
    description: "Send suggested marks for one of the connected student's sets (see getMyAnswers): per part, a score, feedback, comments on quoted passages of their answer, and where it fell short a rewrite of their answer that would earn full marks. The marking page fills them in for the student to check and save. Sending again replaces earlier suggestions for the set.",
    inputSchema: {
      set: setRef,
      marks: z.array(z.object({
        part: z.string().describe('The part as getMyAnswers names it, e.g. "1(a)", or "2" for a question without parts.'),
        score: z.number().min(0).describe("Marked strictly, as an expert, evidence-based consultant would: points the model answer credits, or their clinical equivalent such a consultant would accept on current evidence, stated specifically; nothing for vague points, for items beyond the number asked, or for points wrong for this patient."),
        feedback: z.string().max(2000).describe("Which points earned marks and which were missed, ending with one high-yield clinical pearl as a plain closing sentence, with no label."),
        comments: z.array(z.object({
          quote: z.string().min(1).max(500).describe("A passage copied word for word from the student's answer to this part."),
          comment: z.string().min(1).max(1000),
        })).max(10).optional(),
        rewrite: z.string().max(10_000).optional().describe("When the part fell short of full marks: the student's answer rewritten to earn them, in their own words and layout, changing the least needed (replace or add the missing specific points, drop what earned nothing). Leave out at full marks."),
      })).min(1),
      summary: z.string().max(3000).optional().describe("An overall note for the set: strengths and what to work on."),
    },
    annotations: WRITE,
  }, async ({ set, marks, summary }) => {
    try {
      const s = findSet(await mySets(uid), set);
      if (!s) return fail(new Error(set ? `No recent set matches "${set}".` : "No sets yet."), { hint: "Call getMyAnswers first." });
      const { marks: checked, problems } = checkSuggested(s, marks, summary);
      if (!checked.parts.length) return fail(new Error("None of the marks could be used."), { problems });
      await suggest(uid, s.key, checked);
      const all = s.questions.flatMap((q) => q.parts);
      const marked = new Set(checked.parts.map((m) => `${m.attemptId}:${m.label}`));
      const missing = s.questions.flatMap((q) => q.parts.filter((p) => !marked.has(`${q.attemptId}:${p.label}`)).map((p) => p.id));
      return ok({
        success: true, id: s.key, set: s.name, partsMarked: checked.parts.length,
        total: `${checked.parts.reduce((t, p) => t + p.score, 0)} / ${all.reduce((t, p) => t + p.marks, 0)}`,
        ...(missing.length ? { notMarked: missing } : {}), ...(problems.length ? { problems } : {}),
        next: "Tell the student the marks are waiting on the set's marking page, to check and save.",
      });
    } catch (e) { return fail(e); }
  });
}
