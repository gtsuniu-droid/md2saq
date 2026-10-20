import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BankClient, setCode } from "./client.js";
import type { Question, SetPack, SubPart } from "./types.js";
import { cleanTitle, describeQuestion, entryTitle, examStyleWarnings, fail, findPart, findQuestion, metadataWarnings, ok, plainText, presentationName, questionStyleWarnings, searchableText, setLabel } from "./util.js";
import { PRESENTATIONS, resolvePresentation } from "./presentations.js";


const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const setRef = z.string().describe("Which set: its short code (as on its share link and in listSets, e.g. \"Q3bzKx9a\"), a label like \"Dyspnoea set 3\" or \"abdominal pain 1\", or its bank id.");
const questionRef = {
  questionNumber: z.number().int().min(1).optional().describe("1-based question number within the set, as getSet shows it."),
  questionId: z.string().optional().describe("The question's id, as getSet shows it. Use this or questionNumber."),
};

/** The next revision of a pack with one question replaced. Keeps every other field as it was. */
function withQuestion(pack: SetPack, index: number, question: Question): SetPack {
  const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
  ordered[index] = question;
  return { ...pack, set: { ...pack.set, updatedAt: Date.now() }, questions: ordered.map((q, i) => ({ ...q, order: i })) };
}

/** Guided workflows, offered as prompts where the client supports them. */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt("overhaul-set", {
    title: "Overhaul a set for clinical reasoning",
    description: "Rewrite a set's questions to MD2–MD4 level: reasoning, differential formation and categorisation rather than recall. Questions only; answers come later.",
    argsSchema: { set: z.string().describe("Set code or label, e.g. \"dyspnoea 3\"") },
  }, ({ set }) => ({ messages: [{ role: "user", content: { type: "text", text: [
    `Read ${set} with getSet (includeModelAnswers false).`,
    "Rewrite its questions so each demands clinical reasoning at MD2–MD4 level: forming and ranking a differential, justifying with discriminating features, categorising causes (e.g. by mechanism or system), choosing and interpreting investigations, and prioritising management. Replace recall-style lists of short subquestions with fewer, richer questions; keep or extend the case stem so later stages add information. Give each question or part the marks it deserves (total similar to before unless told otherwise). House style: each question one to three short sentences, under 45 words, opening with a command word (State, List, Outline, Explain, Justify, Compare, Interpret, Prioritise…), counts in capitals such as THREE, marks equal to the items asked for, no conversational phrasing. Ask for a number of items only where the case genuinely supports that many; never pad to a round number. Shapes to adapt: differentials with supporting findings for each; investigations and what you would look for; contrasting two conditions with paired features; management principles; findings that make the situation more urgent.",
    "Show me the new questions as a numbered list with marks and stop. I will approve or edit them. Only then call rewriteSet with the full list and confirmReplace true, leaving model answers out, and tell me the code so I can ask for answers next.",
  ].join("\n\n") } }] }));

  server.registerPrompt("draft-set", {
    title: "Draft a new set in chat, then upload it",
    description: "Draft a new case and its questions in the chat, stop for the user to approve or edit, then upload with addSet (questions only). Answers come later with write-answers.",
    argsSchema: { topic: z.string().describe("Presentation and angle, e.g. \"high blood pressure in pregnancy\""), questions: z.string().optional().describe("How many questions, default 2") },
  }, ({ topic, questions }) => ({ messages: [{ role: "user", content: { type: "text", text: [
    `Draft a new SAQ set on ${topic}${questions ? ` with ${questions} questions` : ""} at MD2–MD4 clinical-reasoning level. Write it in the chat first, in the text format the bank accepts, so it uploads cleanly:`,
    "Suggested time: 20 minutes\n\nStage 1\n<stem: two to four sentences; patient, age, complaint, key vitals, and what has not yet been clarified>\n\n1. <question> (n marks)\n\n2. <question> (n marks)\n\n3. <one or two sentences of new information>. <question> (n marks)",
    "Each question one to three short sentences, opening with a command word, counts in capitals only where the case genuinely supports that many items, marks reflecting what is asked, parts (a)/(b) for two distinct tasks. Shapes to adapt, not copy: differentials with supporting history and examination findings for each; investigations and what you would look for; contrasting two conditions with paired features; stating a syndrome and localising the pathology; management principles; findings that make the situation more urgent. No conversational phrasing. No model answers yet.",
    "Then stop and wait. I will approve or edit the draft. Only after that, upload it once with addSet: a short descriptive title (under ten words, no numbering prefix), the presentation it belongs under, and tags naming the conditions it covers. Give me the set's code. Answers come later with the write-answers step.",
  ].join("\n\n") } }] }));

  server.registerPrompt("tidy-metadata", {
    title: "Tidy set titles and tags",
    description: "Find sets with generic titles or missing tags and give each a short descriptive title and the conditions it covers, after the user approves.",
    argsSchema: { presentation: z.string().optional().describe("Limit to one presentation, or leave empty for all") },
  }, ({ presentation }) => ({ messages: [{ role: "user", content: { type: "text", text: [
    `Run auditSets${presentation ? ` for ${presentation}` : ""} and take the sets whose weakMetadata is not empty. For each, read it with getSet (includeModelAnswers false) and propose a title under ten words that says what the case is (no "Case 1" or "Set 2" prefixes; numbering is automatic) and 2 to 6 tags naming the conditions the questions actually cover, in proper clinical names.`,
    "Show me the proposals as a table (code, current title, proposed title, proposed tags) and stop. When I approve, apply them with one updateSet call per set.",
  ].join("\n\n") } }] }));

  server.registerPrompt("write-answers", {
    title: "Write model answers for a set",
    description: "Write thorough model answers for every question of a set, with acceptable alternatives and answers not to accept, then save them in one call.",
    argsSchema: { set: z.string().describe("Set code or label") },
  }, ({ set }) => ({ messages: [{ role: "user", content: { type: "text", text: [
    `Read ${set} with getSet.`,
    "For every question and part without a model answer, write a marking guide: one point per line with its marks in square brackets, the reasonable differentials or options a strong candidate would give, the discriminating justification expected, acceptable alternatives, and a short list of answers NOT to accept with why. Use current Australian sources where you can check them (eTG, RACGP, LITFL, local guidelines) and name the source at the end of each answer.",
    "Show me the answers first. When I agree, save them all with a single setAnswers call.",
  ].join("\n\n") } }] }));
}

export function registerTools(server: McpServer, bank: BankClient, readOnly: boolean): void {
  registerPrompts(server);
  server.registerTool("listSets", {
    title: "List sets",
    description: "Every set in the shared bank, newest change first, with its code and label (presentation and number), title, collection, tags and question count. Filter by presentation, words, tag, collection or date. Refer to a set by its code or label in every other tool.",
    inputSchema: {
      presentation: z.string().optional().describe("Keep one presentation, by id (\"chest-pain\") or name (\"Chest pain\")."),
      query: z.string().optional().describe("Words that must all appear in the label, title, collection, tags or presentation name (case-insensitive)."),
      tag: z.string().optional().describe("Keep sets carrying this tag, e.g. a condition name."),
      collection: z.string().optional().describe("Keep sets in this collection."),
      updatedSince: z.string().optional().describe("ISO date; keep sets changed on or after it."),
      limit: z.number().int().min(1).max(500).default(100).describe("Most sets to return."),
    },
    annotations: READ,
  }, async ({ presentation, query, tag, collection, updatedSince, limit }) => {
    try {
      const entries = await bank.listEntries(true);
      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const pres = presentation ? resolvePresentation(presentation)?.id ?? presentation.trim().toLowerCase().replace(/\s+/g, "-") : undefined;
      const since = updatedSince ? Date.parse(updatedSince) : NaN;
      const rows = entries
        .filter((e) => !pres || e.presentations.includes(pres) || e.group === pres)
        .filter((e) => !tag || (e.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()))
        .filter((e) => !collection || (e.collection ?? "").toLowerCase() === collection.toLowerCase())
        .filter((e) => Number.isNaN(since) || (e.updatedAt ?? e.uploadedAt) >= since)
        .filter((e) => { const hay = `${setLabel(e)} ${e.name} ${e.source ?? ""} ${e.collection ?? ""} ${(e.tags ?? []).join(" ")} ${e.presentations.map(presentationName).join(" ")}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
        .slice(0, limit)
        .map((e) => ({ code: setCode(e.id), label: setLabel(e), title: entryTitle(e), collection: e.collection, tags: e.tags ?? [], presentations: e.presentations, questionCount: e.questionCount, updatedAt: new Date(e.updatedAt ?? e.uploadedAt).toISOString(), bankId: e.id }));
      return ok({ success: true, count: rows.length, total: entries.length, sets: rows, hint: rows.length ? "Refer to a set by its code or label in every other tool. getSet reads one in full; findQuestions searches inside them." : "No sets match. Try fewer words, or listPresentations for the presentation ids." });
    } catch (e) { return fail(e); }
  });

  server.registerTool("listPresentations", {
    title: "List presentations",
    description: "The presentation ids the bank files sets under (the core presenting complaints), with the number of sets each has.",
    inputSchema: {},
    annotations: READ,
  }, async () => {
    try {
      const entries = await bank.listEntries();
      const counts = new Map<string, number>();
      for (const e of entries) counts.set(e.group ?? e.presentations[0] ?? "unassigned", (counts.get(e.group ?? e.presentations[0] ?? "unassigned") ?? 0) + 1);
      const known = PRESENTATIONS.map((p) => ({ id: p.id, name: p.name, parent: p.parent ?? undefined, alsoKnownAs: p.synonyms.slice(0, 4), sets: counts.get(p.id) ?? 0 }));
      const extra = [...counts.keys()].filter((id) => !PRESENTATIONS.some((p) => p.id === id)).map((id) => ({ id, name: presentationName(id), sets: counts.get(id) ?? 0 }));
      return ok({ success: true, presentations: [...known, ...extra], hint: "Give a presentation to other tools by id, name or a synonym; the first id you give addSet is the one the set is filed under." });
    } catch (e) { return fail(e); }
  });

  server.registerTool("getSet", {
    title: "Get a set",
    description: "A whole set: its details (title, presentation, tags, instructions, marking notes, debrief, suggested minutes) and every question with its number, id, case stems, text, marks, parts and model answers. Read this before editing so you change the right question.",
    inputSchema: { set: setRef, includeModelAnswers: z.boolean().default(true).describe("Set false to leave the model answers out, for a shorter result.") },
    annotations: READ,
  }, async ({ set: ref, includeModelAnswers }) => {
    try {
      const entry = await bank.resolve(ref);
      const bankId = entry.id;
      const pack = await bank.getPack(bankId);
      const questions = [...pack.questions].sort((a, b) => a.order - b.order).map(describeQuestion);
      if (!includeModelAnswers) for (const q of questions) { delete (q as { modelAnswer?: string }).modelAnswer; for (const p of q.parts) delete (p as { modelAnswer?: string }).modelAnswer; }
      const { set } = pack;
      return ok({
        success: true, code: setCode(bankId), bankId, label: setLabel(entry),
        set: { title: entryTitle({ name: set.name, source: set.source, number: set.number }), collection: set.collection, tags: set.tags ?? [], primaryPresentation: set.primaryPresentation ?? entry.group, instructions: set.instructions, markingNotes: set.markingNotes, debrief: set.debrief, suggestedMinutes: set.suggestedMinutes },
        questionCount: questions.length, questions,
        hint: "updateQuestion, updatePart, updateStem and updateSet change parts of this; each saves and publishes at once.",
      });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("findQuestions", {
    title: "Find questions",
    description: "Search the text of every set (stems, questions, parts and model answers) for words or a phrase. Returns the matching sets and the question numbers that matched, with a short snippet each. Use it to find where a topic is covered or to locate a question to edit.",
    inputSchema: {
      query: z.string().min(2).describe("Words or a phrase to look for, case-insensitive. All words must appear in the same set."),
      presentation: z.string().optional().describe("Limit to one presentation id."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: READ,
  }, async ({ query, presentation, limit }) => {
    try {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const all = await bank.allPacks();
      const matches: Record<string, unknown>[] = [];
      const pres = presentation ? resolvePresentation(presentation)?.id ?? presentation : undefined;
      for (const { entry, pack } of all) {
        if (pres && !(entry.presentations.includes(pres) || entry.group === pres)) continue;
        const text = searchableText(pack);
        if (!words.every((w) => text.includes(w))) continue;
        const hits = [...pack.questions].sort((a, b) => a.order - b.order).flatMap((q, i) => {
          const body = [...(q.stems ?? []), q.text, q.modelAnswer ?? "", ...q.parts.flatMap((p) => [p.text, p.modelAnswer ?? ""])].join("\n");
          const lower = body.toLowerCase();
          const at = words.map((w) => lower.indexOf(w)).filter((n) => n >= 0);
          if (!at.length) return [];
          const start = Math.max(0, Math.min(...at) - 80);
          return [{ questionNumber: i + 1, questionId: q.id, snippet: body.slice(start, start + 220).replace(/\s+/g, " ").trim() }];
        });
        matches.push({ code: setCode(entry.id), label: setLabel(entry), title: entryTitle(entry), questions: hits, bankId: entry.id });
        if (matches.length >= limit) break;
      }
      return ok({ success: true, query, count: matches.length, searched: all.length, matches, hint: matches.length ? "getSet reads a matching set in full." : "Nothing matched. Try fewer or different words." });
    } catch (e) { return fail(e, { query }); }
  });

  server.registerTool("auditSets", {
    title: "Audit sets",
    description: "Find sets whose questions need work: questions with many short subquestions (recall-style parts), parts or questions with no model answer, questions without a case stem. Returns each flagged set with its code, label and the question numbers flagged, so the next step can target them. Use this before an overhaul.",
    inputSchema: {
      presentation: z.string().optional().describe("Limit to one presentation, by id or name."),
      minParts: z.number().int().min(1).default(3).describe("Flag a question when it has at least this many parts…"),
      maxPartWords: z.number().int().min(1).default(14).describe("…and its parts average no more than this many words."),
      limit: z.number().int().min(1).max(200).default(40),
    },
    annotations: READ,
  }, async ({ presentation, minParts, maxPartWords, limit }) => {
    try {
      const pres = presentation ? resolvePresentation(presentation)?.id ?? presentation.trim().toLowerCase().replace(/\s+/g, "-") : undefined;
      const all = await bank.allPacks();
      const rows = all.flatMap(({ entry, pack }) => {
        if (pres && !(entry.presentations.includes(pres) || entry.group === pres)) return [];
        const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
        const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
        const manyShortParts: number[] = []; const missingAnswers: number[] = []; const noStem: number[] = [];
        ordered.forEach((q, i) => {
          if (q.parts.length >= minParts && q.parts.reduce((sum, p) => sum + words(p.text), 0) / q.parts.length <= maxPartWords) manyShortParts.push(i + 1);
          const answered = q.parts.length ? q.parts.every((p) => (p.modelAnswer ?? "").trim() || p.modelAnswerDoc) || !!((q.modelAnswer ?? "").trim() || q.modelAnswerDoc) : !!((q.modelAnswer ?? "").trim() || q.modelAnswerDoc);
          if (!answered) missingAnswers.push(i + 1);
          if (!(q.stems?.length)) noStem.push(i + 1);
        });
        const weakMetadata = metadataWarnings({ name: pack.set.name, source: pack.set.source, tags: pack.set.tags });
        if (!manyShortParts.length && !missingAnswers.length && !weakMetadata.length) return [];
        return [{ code: setCode(entry.id), label: setLabel(entry), title: entryTitle(entry), tags: entry.tags ?? [], questions: ordered.length, partsPerQuestion: Number((ordered.reduce((sum, q) => sum + q.parts.length, 0) / Math.max(1, ordered.length)).toFixed(1)), manyShortParts, missingAnswers, noStem, weakMetadata, bankId: entry.id }];
      }).sort((a, b) => b.manyShortParts.length - a.manyShortParts.length || b.missingAnswers.length - a.missingAnswers.length || b.weakMetadata.length - a.weakMetadata.length).slice(0, limit);
      return ok({ success: true, count: rows.length, searched: all.length, criteria: { minParts, maxPartWords }, sets: rows, hint: rows.length ? "getSet reads a flagged set; rewriteSet replaces its questions in one call; setAnswers fills in model answers; updateSet fixes a title or tags." : "Nothing flagged with these thresholds. Lower minParts or raise maxPartWords to widen the net." });
    } catch (e) { return fail(e); }
  });

  if (readOnly) return;

  const partInput = z.object({ label: z.string().describe("e.g. \"a\""), text: z.string().min(1), marks: z.number().min(0).optional(), modelAnswer: z.string().optional() });
  const questionInput = z.object({
    text: z.string().min(1).describe("The question, or the lead-in when parts are given."),
    marks: z.number().min(0).optional().describe("Marks for a question without parts."),
    modelAnswer: z.string().optional().describe("Model answer for a question without parts, one point per line."),
    parts: z.array(partInput).optional(),
    stems: z.array(z.string()).optional().describe("Case stems this question shows, stage by stage. Omit to reuse the set's existing stems."),
  });

  server.registerTool("rewriteSet", {
    title: "Rewrite a set's questions",
    description: "Replace every question in a set in one call: the full new list of questions, each with optional parts, marks and model answers. Existing model answers are dropped unless keepAnswers is true (then a question keeps its old answers when the new one gives none). Case stems are kept unless new ones are given. Question ids are reused by position so students' earlier attempts stay attached where numbers match. Use after getSet, and only with confirmReplace true after the user has agreed to the overhaul.",
    inputSchema: {
      set: setRef,
      questions: z.array(questionInput).min(1).describe("The complete new question list, in order."),
      stems: z.array(z.string()).optional().describe("New opening case stem(s) for the whole set, stage by stage. Omit to keep the current stems."),
      title: z.string().optional().describe("A new case title, when the case itself changed."),
      tags: z.array(z.string()).optional().describe("New tags: the conditions the rewritten case covers."),
      keepAnswers: z.boolean().default(false).describe("Keep an existing question's model answers when the replacement at the same number gives none."),
      confirmReplace: z.boolean().describe("Must be true; the user has agreed to replace the set's questions."),
    },
    annotations: DESTRUCTIVE,
  }, async ({ set: ref, questions, stems, title, tags, keepAnswers, confirmReplace }) => {
    try {
      if (!confirmReplace) return fail(new Error("Not confirmed."), { set: ref, hint: "Show the user the new questions, then call again with confirmReplace true." });
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
      const baseStems = stems ?? ordered[0]?.stems;
      const baseStemDocs = stems ? undefined : ordered[0]?.stemDocs;
      const now = Date.now();
      const next: Question[] = questions.map((q, i) => {
        const old = ordered[i];
        const parts: SubPart[] = (q.parts ?? []).map((p) => {
          const oldPart = keepAnswers ? old?.parts.find((x) => x.label.toLowerCase() === p.label.toLowerCase()) : undefined;
          return { label: p.label.trim(), text: plainText(p.text), marks: p.marks, modelAnswer: p.modelAnswer ? plainText(p.modelAnswer) : oldPart?.modelAnswer, modelAnswerDoc: p.modelAnswer ? undefined : oldPart?.modelAnswerDoc };
        });
        return {
          ...(old ?? {}), id: old?.id ?? crypto.randomUUID(), setId: pack.set.id, order: i, createdAt: old?.createdAt ?? now,
          stems: q.stems ?? baseStems, stemDocs: q.stems ? undefined : baseStemDocs,
          text: plainText(q.text), textDoc: undefined, marks: q.marks, parts,
          modelAnswer: q.modelAnswer ? plainText(q.modelAnswer) : keepAnswers && !q.parts?.length ? old?.modelAnswer : undefined,
          modelAnswerDoc: q.modelAnswer ? undefined : keepAnswers && !q.parts?.length ? old?.modelAnswerDoc : undefined,
          images: old?.images, presentations: old?.presentations ?? ordered[0]?.presentations ?? (pack.set.primaryPresentation ? [pack.set.primaryPresentation] : []), tags: old?.tags ?? [],
        } as Question;
      });
      const meta = { ...pack.set, updatedAt: now, ...(title ? { source: cleanTitle(title), name: cleanTitle(title) } : {}), ...(tags ? { tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))] } : {}) };
      const entry = await bank.updatePack(bankId, { ...pack, set: meta, questions: next });
      const withoutAnswers = next.filter((q) => q.parts.length ? q.parts.some((p) => !p.modelAnswer && !p.modelAnswerDoc) : !q.modelAnswer && !q.modelAnswerDoc).map((q) => q.order + 1);
      const style = next.flatMap((q, i) => questionStyleWarnings(q, i + 1));
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), questionCount: next.length, replaced: ordered.length, questionsWithoutAnswers: withoutAnswers, questions: next.map(describeQuestion), styleWarnings: style.length ? style : undefined, message: "Saved and published.", hint: withoutAnswers.length ? "setAnswers fills in the model answers for the listed questions in one call." : undefined });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("setAnswers", {
    title: "Set model answers",
    description: "Write model answers for many questions or parts of a set in one call. Each entry names a question number and, for a question with parts, the part label. A model answer is a marking guide: one point per line, marks in square brackets where the set uses them, acceptable alternatives and answers not to accept made explicit. Entries that name a missing question or part are reported, the rest are saved.",
    inputSchema: {
      set: setRef,
      answers: z.array(z.object({ questionNumber: z.number().int().min(1), part: z.string().optional().describe("Part label, e.g. \"a\", for a question with parts."), modelAnswer: z.string().min(1), marks: z.number().min(0).optional().describe("Also set the marks for this question or part.") })).min(1),
    },
    annotations: WRITE,
  }, async ({ set: ref, answers }) => {
    try {
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const ordered = [...pack.questions].sort((a, b) => a.order - b.order).map((q) => ({ ...q, parts: q.parts.map((p) => ({ ...p })) }));
      const applied: string[] = []; const missing: string[] = [];
      for (const a of answers) {
        const q = ordered[a.questionNumber - 1];
        if (!q) { missing.push(`Q${a.questionNumber}`); continue; }
        if (a.part) {
          const p = q.parts.find((x) => x.label.toLowerCase() === a.part!.toLowerCase());
          if (!p) { missing.push(`Q${a.questionNumber}(${a.part})`); continue; }
          p.modelAnswer = plainText(a.modelAnswer); delete p.modelAnswerDoc; if (a.marks !== undefined) p.marks = a.marks;
          applied.push(`Q${a.questionNumber}(${p.label})`);
        } else {
          q.modelAnswer = plainText(a.modelAnswer); delete q.modelAnswerDoc; if (a.marks !== undefined) q.marks = a.marks;
          applied.push(`Q${a.questionNumber}`);
        }
      }
      if (!applied.length) return fail(new Error(`None of the entries matched: ${missing.join(", ")}.`), { set: ref, hint: "getSet shows the question numbers and part labels." });
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, updatedAt: Date.now() }, questions: ordered.map((q, i) => ({ ...q, order: i })) });
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), applied, missing, message: `Saved ${applied.length} answer${applied.length === 1 ? "" : "s"} and published.${missing.length ? ` Not found: ${missing.join(", ")}.` : ""}` });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("updateQuestion", {
    title: "Update a question",
    description: "Change a question's text, marks or whole-question model answer. Only the fields given change. The set is saved and published at once. If the question has parts (a), (b)…, their text and model answers are edited with updatePart instead. Replacing text that has rich formatting or pictures (hasRichText / hasRichModelAnswer in getSet) drops that formatting.",
    inputSchema: {
      set: setRef, ...questionRef,
      text: z.string().optional().describe("New question text, plain text. Line breaks are kept."),
      marks: z.number().min(0).nullable().optional().describe("New marks for the question; null clears it."),
      modelAnswer: z.string().nullable().optional().describe("New model answer, plain text, one marking point per line; null clears it."),
    },
    annotations: WRITE,
  }, async ({ set: ref, questionNumber, questionId, text, marks, modelAnswer }) => {
    try {
      if (text === undefined && marks === undefined && modelAnswer === undefined) return fail(new Error("Nothing to change: give text, marks or modelAnswer."), { set: ref });
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const { question, index } = findQuestion(pack, { number: questionNumber, questionId });
      const next: Question = { ...question };
      const dropped: string[] = [];
      if (text !== undefined) { next.text = plainText(text); if (question.textDoc) { delete next.textDoc; dropped.push("question formatting"); } }
      if (marks !== undefined) next.marks = marks ?? undefined;
      if (modelAnswer !== undefined) { next.modelAnswer = modelAnswer === null ? undefined : plainText(modelAnswer); if (question.modelAnswerDoc) { delete next.modelAnswerDoc; dropped.push("model answer formatting"); } }
      const entry = await bank.updatePack(bankId, withQuestion(pack, index, next));
      const style = text !== undefined ? questionStyleWarnings(next, index + 1) : [];
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), question: describeQuestion(next, index), changed: [text !== undefined && "text", marks !== undefined && "marks", modelAnswer !== undefined && "modelAnswer"].filter(Boolean), warning: dropped.length ? `Replaced ${dropped.join(" and ")}; pictures or formatting in it are gone.` : undefined, styleWarnings: style.length ? style : undefined, message: "Saved and published. Students receive it when they next open the site." });
    } catch (e) { return fail(e, { set: ref, questionNumber, questionId }); }
  });

  server.registerTool("updatePart", {
    title: "Update a part",
    description: "Change one part of a question, (a), (b)…: its text, marks or model answer. Only the fields given change. Saved and published at once. Replacing text that has rich formatting drops it.",
    inputSchema: {
      set: setRef, ...questionRef,
      part: z.string().describe("The part's label, e.g. \"a\"."),
      text: z.string().optional().describe("New part text, plain."),
      marks: z.number().min(0).nullable().optional().describe("New marks for the part; null clears it."),
      modelAnswer: z.string().nullable().optional().describe("New model answer for the part, one marking point per line; null clears it."),
    },
    annotations: WRITE,
  }, async ({ set: ref, questionNumber, questionId, part, text, marks, modelAnswer }) => {
    try {
      if (text === undefined && marks === undefined && modelAnswer === undefined) return fail(new Error("Nothing to change: give text, marks or modelAnswer."), { set: ref });
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const { question, index } = findQuestion(pack, { number: questionNumber, questionId });
      const current = findPart(question, part);
      const nextPart: SubPart = { ...current };
      const dropped: string[] = [];
      if (text !== undefined) { nextPart.text = plainText(text); if (current.textDoc) { delete nextPart.textDoc; dropped.push("part formatting"); } }
      if (marks !== undefined) nextPart.marks = marks ?? undefined;
      if (modelAnswer !== undefined) { nextPart.modelAnswer = modelAnswer === null ? undefined : plainText(modelAnswer); if (current.modelAnswerDoc) { delete nextPart.modelAnswerDoc; dropped.push("model answer formatting"); } }
      const next: Question = { ...question, parts: question.parts.map((p) => (p === current ? nextPart : p)) };
      const entry = await bank.updatePack(bankId, withQuestion(pack, index, next));
      const style = text !== undefined ? examStyleWarnings(`Question ${index + 1}(${current.label})`, nextPart.text) : [];
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), question: describeQuestion(next, index), part: current.label, warning: dropped.length ? `Replaced ${dropped.join(" and ")}; pictures or formatting in it are gone.` : undefined, styleWarnings: style.length ? style : undefined, message: "Saved and published." });
    } catch (e) { return fail(e, { set: ref, questionNumber, questionId, part }); }
  });

  server.registerTool("updateStem", {
    title: "Update a case stem",
    description: "Rewrite a case stem. Stems are shared: every question in the set that shows the same stem text is updated together, so the case reads the same from every question. Stage 1 is the opening presentation; later stages add information before later questions. Replacing a stem with pictures drops them.",
    inputSchema: {
      set: setRef,
      stage: z.number().int().min(1).default(1).describe("Which stem: 1 for the opening stem, 2 for the next stage, and so on."),
      text: z.string().min(1).describe("The new stem text, plain."),
      questionNumber: z.number().int().min(1).optional().describe("A question that shows the stem, when the set has more than one case; defaults to the first question that has this stage."),
    },
    annotations: WRITE,
  }, async ({ set: ref, stage, text, questionNumber }) => {
    try {
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
      const anchor = questionNumber ? findQuestion(pack, { number: questionNumber }).question : ordered.find((q) => (q.stems?.length ?? 0) >= stage);
      if (!anchor || (anchor.stems?.length ?? 0) < stage) return fail(new Error(`No stage ${stage} stem to replace. getSet shows each question's stems.`), { set: ref, stage });
      const old = anchor.stems![stage - 1];
      let touched = 0; let dropped = false;
      const questions = ordered.map((q, i) => {
        if ((q.stems?.length ?? 0) < stage || q.stems![stage - 1] !== old) return { ...q, order: i };
        touched++;
        const stems = [...q.stems!]; stems[stage - 1] = plainText(text);
        const stemDocs = q.stemDocs ? [...q.stemDocs] : undefined;
        if (stemDocs && stemDocs[stage - 1]) { stemDocs[stage - 1] = null; dropped = true; }
        return { ...q, order: i, stems, stemDocs };
      });
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, updatedAt: Date.now() }, questions });
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), stage, questionsUpdated: touched, warning: dropped ? "The stem had pictures or formatting; they are gone." : undefined, message: "Saved and published." });
    } catch (e) { return fail(e, { set: ref, stage }); }
  });

  server.registerTool("updateSet", {
    title: "Update set details",
    description: "Change a set's title, collection, tags, presentation, candidate instructions, marking notes, debrief or suggested minutes. Only the fields given change. Moving a set to another presentation gives it the next number there.",
    inputSchema: {
      set: setRef,
      title: z.string().nullable().optional().describe("The case title shown as detail, e.g. \"Case 02: Dizziness after a respiratory illness\"."),
      collection: z.string().nullable().optional(),
      tags: z.array(z.string()).optional().describe("Replaces the whole tag list, usually the conditions the case covers."),
      primaryPresentation: z.string().optional().describe("Presentation id; listPresentations gives them."),
      instructions: z.string().nullable().optional().describe("Shown at the top of the paper."),
      markingNotes: z.string().nullable().optional().describe("Shown while marking."),
      debrief: z.string().nullable().optional().describe("Shown after marking."),
      suggestedMinutes: z.number().min(0).nullable().optional(),
    },
    annotations: WRITE,
  }, async ({ set: ref, title, collection, tags, primaryPresentation, instructions, markingNotes, debrief, suggestedMinutes }) => {
    try {
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const set = { ...pack.set, updatedAt: Date.now() };
      const changed: string[] = [];
      const apply = <K extends keyof typeof set>(key: K, value: unknown, given: boolean) => { if (!given) return; (set as Record<string, unknown>)[key as string] = value === null ? undefined : value; changed.push(String(key)); };
      apply("source", title === null ? null : title !== undefined ? cleanTitle(title) : undefined, title !== undefined);
      if (title) set.name = cleanTitle(title);
      apply("collection", collection, collection !== undefined);
      apply("tags", tags ? [...new Set(tags.map((t) => t.trim()).filter(Boolean))] : undefined, tags !== undefined);
      if (primaryPresentation !== undefined && !resolvePresentation(primaryPresentation)) return fail(new Error(`Unknown presentation "${primaryPresentation}".`), { set: ref, hint: "listPresentations gives the ids and names." });
      apply("primaryPresentation", primaryPresentation !== undefined ? resolvePresentation(primaryPresentation)!.id : undefined, primaryPresentation !== undefined);
      apply("instructions", instructions, instructions !== undefined);
      apply("markingNotes", markingNotes, markingNotes !== undefined);
      apply("debrief", debrief, debrief !== undefined);
      apply("suggestedMinutes", suggestedMinutes, suggestedMinutes !== undefined);
      if (!changed.length) return fail(new Error("Nothing to change: give at least one field."), { set: ref });
      const entry = await bank.updatePack(bankId, { ...pack, set });
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), changed, message: "Saved and published." });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("addQuestion", {
    title: "Add a question",
    description: "Append a question to the end of a set, optionally with parts. It shows the same case stems as the question before it. Saved and published at once.",
    inputSchema: {
      set: setRef,
      text: z.string().min(1).describe("The question, or the shared lead-in when parts are given."),
      marks: z.number().min(0).optional().describe("Marks, when the question has no parts."),
      modelAnswer: z.string().optional().describe("Model answer, one marking point per line, when the question has no parts."),
      parts: z.array(z.object({ label: z.string().describe("e.g. \"a\""), text: z.string(), marks: z.number().min(0).optional(), modelAnswer: z.string().optional() })).optional(),
      presentations: z.array(z.string()).optional().describe("Presentation ids; defaults to the set's."),
    },
    annotations: WRITE,
  }, async ({ set: ref, text, marks, modelAnswer, parts, presentations }) => {
    try {
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
      const previous = ordered[ordered.length - 1];
      const question: Question = {
        id: crypto.randomUUID(), setId: pack.set.id, order: ordered.length, createdAt: Date.now(),
        stems: previous?.stems, stemDocs: previous?.stemDocs,
        text: plainText(text), marks, modelAnswer: modelAnswer ? plainText(modelAnswer) : undefined,
        parts: (parts ?? []).map((p) => ({ label: p.label.trim(), text: plainText(p.text), marks: p.marks, modelAnswer: p.modelAnswer ? plainText(p.modelAnswer) : undefined })),
        presentations: presentations ?? previous?.presentations ?? (pack.set.primaryPresentation ? [pack.set.primaryPresentation] : []), tags: [],
      };
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, updatedAt: Date.now() }, questions: [...ordered, question] });
      const style = questionStyleWarnings(question, ordered.length + 1);
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), question: describeQuestion(question, ordered.length), styleWarnings: style.length ? style : undefined, message: "Saved and published." });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("removeQuestion", {
    title: "Remove a question",
    description: "Permanently remove one question from a set. The remaining questions renumber. Students lose their attempts on it when their library updates. Runs only with confirmDeletion true.",
    inputSchema: { set: setRef, ...questionRef, confirmDeletion: z.boolean().describe("Must be true; the user has confirmed.") },
    annotations: DESTRUCTIVE,
  }, async ({ set: ref, questionNumber, questionId, confirmDeletion }) => {
    try {
      if (!confirmDeletion) return fail(new Error("Not confirmed."), { set: ref, hint: "Ask the user, then call again with confirmDeletion true." });
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const { question, index } = findQuestion(pack, { number: questionNumber, questionId });
      const questions = [...pack.questions].sort((a, b) => a.order - b.order).filter((q) => q.id !== question.id).map((q, i) => ({ ...q, order: i }));
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, updatedAt: Date.now() }, questions });
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), removed: { number: index + 1, questionId: question.id, text: question.text.slice(0, 120) }, remaining: questions.length, message: "Removed and published." });
    } catch (e) { return fail(e, { set: ref, questionNumber, questionId }); }
  });

  server.registerTool("addSet", {
    title: "Add a set from text",
    description: "Create a new set by pasting a whole paper as text, the same format the site's Create page accepts: numbered questions (1., Q1, Question 1:), parts as (a), (b), marks as (4 marks), and a model answer after a line starting \"Answer:\" with one marking point per line. A \"Stage 1\" / \"Stage 2\" layout gives staged stems. The set is published at once and gets the next number in its presentation.",
    inputSchema: {
      title: z.string().min(3).describe("A short descriptive case title students see, under ten words, no \"Case 1:\" prefix (numbering is automatic), e.g. \"Newly found hypertension in a 48-year-old\"."),
      text: z.string().min(20).describe("The whole paper as text."),
      presentations: z.array(z.string()).min(1).describe("Where it is filed: presentation id, name or synonym; the first is the primary one."),
      tags: z.array(z.string()).optional().describe("The conditions the case covers, 2 to 6 proper names, e.g. [\"Pre-eclampsia\", \"Hypertensive emergency\"]. Used for browsing and search."),
      collection: z.string().optional().describe("Optional source bank or series the set belongs to."),
      key: z.string().optional().describe("Optional idempotency key so re-sending the same paper does not create a duplicate."),
    },
    annotations: WRITE,
  }, async ({ title, text, presentations, tags, collection, key }) => {
    try {
      const name = cleanTitle(title);
      const ids = presentations?.map((p) => resolvePresentation(p)?.id ?? p);
      const unknown = (ids ?? []).filter((id) => !PRESENTATIONS.some((p) => p.id === id));
      if (unknown.length) return fail(new Error(`Unknown presentation: ${unknown.join(", ")}.`), { name, hint: "listPresentations gives the ids and names; a synonym such as \"hypertension\" also works." });
      let entry = await bank.createFromText({ name, text, source: name, presentations: ids, key });
      const wanted = ids?.[0];
      if (!entry.duplicate) {
        // Keyword detection can file a paper elsewhere and the text upload carries no tags; set both now.
        const pack = await bank.getPack(entry.id, true);
        entry = await bank.updatePack(entry.id, { ...pack, set: { ...pack.set, name, source: name, primaryPresentation: wanted, tags: tags?.length ? [...new Set(tags.map((t) => t.trim()).filter(Boolean))] : pack.set.tags, collection: collection ?? pack.set.collection, updatedAt: Date.now() } });
      }
      const created = await bank.getPack(entry.id);
      const style = [...created.questions].sort((a, b) => a.order - b.order).flatMap((q, i) => questionStyleWarnings(q, i + 1));
      return ok({ success: true, code: setCode(entry.id), bankId: entry.id, label: setLabel(entry), title: name, tags: entry.tags ?? [], questionCount: entry.questionCount, duplicate: entry.duplicate ?? false, styleWarnings: style.length ? style : undefined, message: entry.duplicate ? "That key was sent before; the existing set is returned." : "Created and published.", hint: "getSet shows how the text was split into questions; fix any mis-split with updateQuestion or updatePart." });
    } catch (e) { return fail(e, { title }); }
  });

  server.registerTool("deleteSet", {
    title: "Delete a set",
    description: "Permanently delete a set from the shared bank for everyone. Students lose their attempts on it when their library updates; later sets in the presentation renumber. Runs only with confirmDeletion true.",
    inputSchema: { set: setRef, confirmDeletion: z.boolean().describe("Must be true; the user has confirmed.") },
    annotations: DESTRUCTIVE,
  }, async ({ set: ref, confirmDeletion }) => {
    try {
      if (!confirmDeletion) return fail(new Error("Not confirmed."), { set: ref, hint: "Ask the user, then call again with confirmDeletion true." });
      const entry = await bank.resolve(ref);
      const bankId = entry.id;
      await bank.deleteSet(bankId);
      return ok({ success: true, code: setCode(bankId), bankId, deleted: setLabel(entry), questionCount: entry.questionCount, message: "Deleted from the shared bank." });
    } catch (e) { return fail(e, { set: ref }); }
  });
}
