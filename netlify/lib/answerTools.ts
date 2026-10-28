import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok } from "../../mcp/src/util";
import { checkSuggested, setText } from "../../src/lib/setForMarking";
import { findSet, mySets, suggest } from "./answers";

/**
 * The connected student's own answers: read a set they have opened for marking, and leave
 * suggested marks and comments on it. Hosted only, since it needs to know whose answers they
 * are; the marking page fills the suggestions in for the student to check and save.
 */
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const setRef = z.string().optional().describe("Part of the set's name or number; leave out for the set most recently opened for marking.");

export function registerAnswerTools(server: McpServer, uid: string): void {
  server.registerTool("getMyAnswers", {
    title: "Get my answers",
    description: "The connected student's own answers to a set they have submitted, with the case, each question and part with its marks, and the model answers and marking notes. Sets appear here once the student opens their marking page. Use it when asked to mark their answers, then send the marks with markMyAnswers.",
    inputSchema: { set: setRef },
    annotations: READ,
  }, async ({ set }) => {
    try {
      const sets = await mySets(uid);
      const s = findSet(sets, set);
      if (!s) return fail(new Error(sets.length ? `No recent set matches "${set}".` : "No sets yet."), { hint: "Sets appear once the student opens a set's marking page on the site.", recent: sets.map((x) => x.name) });
      return ok({
        success: true, set: s.name, submitted: new Date(s.at).toISOString(),
        parts: s.questions.flatMap((q) => q.parts.map((p) => ({ part: p.id, marks: p.marks }))),
        ...(s.suggested ? { alreadySuggested: `Marks were suggested ${new Date(s.suggested.at).toISOString()}; sending again replaces them.` } : {}),
        otherRecentSets: sets.filter((x) => x !== s).map((x) => x.name),
        howToMark: "Mark every part against its model answer and the marking notes: a score out of its marks and one or two lines of feedback. Point at specific passages by quoting them word for word from the answer, with a short comment on each. Then call markMyAnswers.",
        text: setText(s),
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool("markMyAnswers", {
    title: "Mark my answers",
    description: "Send suggested marks for one of the connected student's sets (see getMyAnswers): per part, a score, feedback, and comments on quoted passages of their answer. The marking page fills them in for the student to check and save. Sending again replaces earlier suggestions for the set.",
    inputSchema: {
      set: setRef,
      marks: z.array(z.object({
        part: z.string().describe('The part as getMyAnswers names it, e.g. "1(a)", or "2" for a question without parts.'),
        score: z.number().min(0),
        feedback: z.string().max(2000).describe("One or two lines: what earned marks and what was missing."),
        comments: z.array(z.object({
          quote: z.string().min(1).max(500).describe("A passage copied word for word from the student's answer to this part."),
          comment: z.string().min(1).max(1000),
        })).max(10).optional(),
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
        success: true, set: s.name, partsMarked: checked.parts.length,
        total: `${checked.parts.reduce((t, p) => t + p.score, 0)} / ${all.reduce((t, p) => t + p.marks, 0)}`,
        ...(missing.length ? { notMarked: missing } : {}), ...(problems.length ? { problems } : {}),
        next: "Tell the student the marks are waiting on the set's marking page, to check and save.",
      });
    } catch (e) { return fail(e); }
  });
}
