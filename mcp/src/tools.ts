import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BankClient } from "./client.js";
import type { Question, SetPack, SubPart } from "./types.js";
import { describeQuestion, fail, findPart, findQuestion, ok, plainText, presentationName, searchableText, setLabel } from "./util.js";

const PRESENTATIONS = [
  "abdominal-pain", "abnormal-speech", "altered-bowel-habit", "altered-sleep", "altered-urinary-volume", "cognitive-impairment", "chest-pain", "confusion",
  "constipation", "cough", "diarrhoea", "dizziness", "dysphagia", "dyspnoea", "falls", "fertility-visit", "fever", "haematemesis", "haematuria", "haemoptysis",
  "headache", "hearing-loss", "high-blood-pressure", "jaundice", "joint-pain", "joint-swelling", "lack-of-energy",
];

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const setRef = z.string().describe("The set's bank id, as listSets and findQuestions return it.");
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

export function registerTools(server: McpServer, bank: BankClient, readOnly: boolean): void {
  server.registerTool("listSets", {
    title: "List sets",
    description: "Every set in the shared bank, newest change first: bank id, label (presentation and number), title, collection, tags and question count. Filter by presentation id or by words in the title, tags or collection. The bank id is what every other tool takes.",
    inputSchema: {
      presentation: z.string().optional().describe("Presentation id to keep, e.g. \"chest-pain\". listPresentations gives the ids."),
      query: z.string().optional().describe("Words that must appear in the label, title, collection or tags (case-insensitive)."),
      limit: z.number().int().min(1).max(500).default(100).describe("Most sets to return."),
    },
    annotations: READ,
  }, async ({ presentation, query, limit }) => {
    try {
      const entries = await bank.listEntries(true);
      const q = query?.trim().toLowerCase();
      const rows = entries
        .filter((e) => !presentation || e.presentations.includes(presentation) || e.group === presentation)
        .filter((e) => !q || `${setLabel(e)} ${e.name} ${e.source ?? ""} ${e.collection ?? ""} ${(e.tags ?? []).join(" ")}`.toLowerCase().includes(q))
        .slice(0, limit)
        .map((e) => ({ bankId: e.id, label: setLabel(e), title: e.source ?? e.name, collection: e.collection, tags: e.tags ?? [], presentations: e.presentations, questionCount: e.questionCount, updatedAt: new Date(e.updatedAt ?? e.uploadedAt).toISOString() }));
      return ok({ success: true, count: rows.length, total: entries.length, sets: rows, hint: rows.length ? "getSet reads one of these in full; findQuestions searches inside them." : "No sets match. Try fewer words, or listPresentations for the presentation ids." });
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
      const ids = [...new Set([...PRESENTATIONS, ...counts.keys()])].sort();
      return ok({ success: true, presentations: ids.map((id) => ({ id, name: presentationName(id), sets: counts.get(id) ?? 0 })) });
    } catch (e) { return fail(e); }
  });

  server.registerTool("getSet", {
    title: "Get a set",
    description: "A whole set: its details (title, presentation, tags, instructions, marking notes, debrief, suggested minutes) and every question with its number, id, case stems, text, marks, parts and model answers. Read this before editing so you change the right question.",
    inputSchema: { bankId: setRef, includeModelAnswers: z.boolean().default(true).describe("Set false to leave the model answers out, for a shorter result.") },
    annotations: READ,
  }, async ({ bankId, includeModelAnswers }) => {
    try {
      const [entry, pack] = [await bank.entry(bankId), await bank.getPack(bankId)];
      const questions = [...pack.questions].sort((a, b) => a.order - b.order).map(describeQuestion);
      if (!includeModelAnswers) for (const q of questions) { delete (q as { modelAnswer?: string }).modelAnswer; for (const p of q.parts) delete (p as { modelAnswer?: string }).modelAnswer; }
      const { set } = pack;
      return ok({
        success: true, bankId, label: setLabel(entry),
        set: { title: set.source, name: set.name, collection: set.collection, tags: set.tags ?? [], primaryPresentation: set.primaryPresentation ?? entry.group, instructions: set.instructions, markingNotes: set.markingNotes, debrief: set.debrief, suggestedMinutes: set.suggestedMinutes },
        questionCount: questions.length, questions,
        hint: "updateQuestion, updatePart, updateStem and updateSet change parts of this; each saves and publishes at once.",
      });
    } catch (e) { return fail(e, { bankId }); }
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
      for (const { entry, pack } of all) {
        if (presentation && !(entry.presentations.includes(presentation) || entry.group === presentation)) continue;
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
        matches.push({ bankId: entry.id, label: setLabel(entry), title: entry.source ?? entry.name, questions: hits });
        if (matches.length >= limit) break;
      }
      return ok({ success: true, query, count: matches.length, searched: all.length, matches, hint: matches.length ? "getSet reads a matching set in full." : "Nothing matched. Try fewer or different words." });
    } catch (e) { return fail(e, { query }); }
  });

  if (readOnly) return;

  server.registerTool("updateQuestion", {
    title: "Update a question",
    description: "Change a question's text, marks or whole-question model answer. Only the fields given change. The set is saved and published at once. If the question has parts (a), (b)…, their text and model answers are edited with updatePart instead. Replacing text that has rich formatting or pictures (hasRichText / hasRichModelAnswer in getSet) drops that formatting.",
    inputSchema: {
      bankId: setRef, ...questionRef,
      text: z.string().optional().describe("New question text, plain text. Line breaks are kept."),
      marks: z.number().min(0).nullable().optional().describe("New marks for the question; null clears it."),
      modelAnswer: z.string().nullable().optional().describe("New model answer, plain text, one marking point per line; null clears it."),
    },
    annotations: WRITE,
  }, async ({ bankId, questionNumber, questionId, text, marks, modelAnswer }) => {
    try {
      if (text === undefined && marks === undefined && modelAnswer === undefined) return fail(new Error("Nothing to change: give text, marks or modelAnswer."), { bankId });
      const pack = await bank.getPack(bankId);
      const { question, index } = findQuestion(pack, { number: questionNumber, questionId });
      const next: Question = { ...question };
      const dropped: string[] = [];
      if (text !== undefined) { next.text = plainText(text); if (question.textDoc) { delete next.textDoc; dropped.push("question formatting"); } }
      if (marks !== undefined) next.marks = marks ?? undefined;
      if (modelAnswer !== undefined) { next.modelAnswer = modelAnswer === null ? undefined : plainText(modelAnswer); if (question.modelAnswerDoc) { delete next.modelAnswerDoc; dropped.push("model answer formatting"); } }
      const entry = await bank.updatePack(bankId, withQuestion(pack, index, next));
      return ok({ success: true, bankId, label: setLabel(entry), question: describeQuestion(next, index), changed: [text !== undefined && "text", marks !== undefined && "marks", modelAnswer !== undefined && "modelAnswer"].filter(Boolean), warning: dropped.length ? `Replaced ${dropped.join(" and ")}; pictures or formatting in it are gone.` : undefined, message: "Saved and published. Students receive it when they next open the site." });
    } catch (e) { return fail(e, { bankId, questionNumber, questionId }); }
  });

  server.registerTool("updatePart", {
    title: "Update a part",
    description: "Change one part of a question, (a), (b)…: its text, marks or model answer. Only the fields given change. Saved and published at once. Replacing text that has rich formatting drops it.",
    inputSchema: {
      bankId: setRef, ...questionRef,
      part: z.string().describe("The part's label, e.g. \"a\"."),
      text: z.string().optional().describe("New part text, plain."),
      marks: z.number().min(0).nullable().optional().describe("New marks for the part; null clears it."),
      modelAnswer: z.string().nullable().optional().describe("New model answer for the part, one marking point per line; null clears it."),
    },
    annotations: WRITE,
  }, async ({ bankId, questionNumber, questionId, part, text, marks, modelAnswer }) => {
    try {
      if (text === undefined && marks === undefined && modelAnswer === undefined) return fail(new Error("Nothing to change: give text, marks or modelAnswer."), { bankId });
      const pack = await bank.getPack(bankId);
      const { question, index } = findQuestion(pack, { number: questionNumber, questionId });
      const current = findPart(question, part);
      const nextPart: SubPart = { ...current };
      const dropped: string[] = [];
      if (text !== undefined) { nextPart.text = plainText(text); if (current.textDoc) { delete nextPart.textDoc; dropped.push("part formatting"); } }
      if (marks !== undefined) nextPart.marks = marks ?? undefined;
      if (modelAnswer !== undefined) { nextPart.modelAnswer = modelAnswer === null ? undefined : plainText(modelAnswer); if (current.modelAnswerDoc) { delete nextPart.modelAnswerDoc; dropped.push("model answer formatting"); } }
      const next: Question = { ...question, parts: question.parts.map((p) => (p === current ? nextPart : p)) };
      const entry = await bank.updatePack(bankId, withQuestion(pack, index, next));
      return ok({ success: true, bankId, label: setLabel(entry), question: describeQuestion(next, index), part: current.label, warning: dropped.length ? `Replaced ${dropped.join(" and ")}; pictures or formatting in it are gone.` : undefined, message: "Saved and published." });
    } catch (e) { return fail(e, { bankId, questionNumber, questionId, part }); }
  });

  server.registerTool("updateStem", {
    title: "Update a case stem",
    description: "Rewrite a case stem. Stems are shared: every question in the set that shows the same stem text is updated together, so the case reads the same from every question. Stage 1 is the opening presentation; later stages add information before later questions. Replacing a stem with pictures drops them.",
    inputSchema: {
      bankId: setRef,
      stage: z.number().int().min(1).default(1).describe("Which stem: 1 for the opening stem, 2 for the next stage, and so on."),
      text: z.string().min(1).describe("The new stem text, plain."),
      questionNumber: z.number().int().min(1).optional().describe("A question that shows the stem, when the set has more than one case; defaults to the first question that has this stage."),
    },
    annotations: WRITE,
  }, async ({ bankId, stage, text, questionNumber }) => {
    try {
      const pack = await bank.getPack(bankId);
      const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
      const anchor = questionNumber ? findQuestion(pack, { number: questionNumber }).question : ordered.find((q) => (q.stems?.length ?? 0) >= stage);
      if (!anchor || (anchor.stems?.length ?? 0) < stage) return fail(new Error(`No stage ${stage} stem to replace. getSet shows each question's stems.`), { bankId, stage });
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
      return ok({ success: true, bankId, label: setLabel(entry), stage, questionsUpdated: touched, warning: dropped ? "The stem had pictures or formatting; they are gone." : undefined, message: "Saved and published." });
    } catch (e) { return fail(e, { bankId, stage }); }
  });

  server.registerTool("updateSet", {
    title: "Update set details",
    description: "Change a set's title, collection, tags, presentation, candidate instructions, marking notes, debrief or suggested minutes. Only the fields given change. Moving a set to another presentation gives it the next number there.",
    inputSchema: {
      bankId: setRef,
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
  }, async ({ bankId, title, collection, tags, primaryPresentation, instructions, markingNotes, debrief, suggestedMinutes }) => {
    try {
      const pack = await bank.getPack(bankId);
      const set = { ...pack.set, updatedAt: Date.now() };
      const changed: string[] = [];
      const apply = <K extends keyof typeof set>(key: K, value: unknown, given: boolean) => { if (!given) return; (set as Record<string, unknown>)[key as string] = value === null ? undefined : value; changed.push(String(key)); };
      apply("source", title, title !== undefined);
      apply("collection", collection, collection !== undefined);
      apply("tags", tags?.map((t) => t.trim()).filter(Boolean), tags !== undefined);
      apply("primaryPresentation", primaryPresentation, primaryPresentation !== undefined);
      apply("instructions", instructions, instructions !== undefined);
      apply("markingNotes", markingNotes, markingNotes !== undefined);
      apply("debrief", debrief, debrief !== undefined);
      apply("suggestedMinutes", suggestedMinutes, suggestedMinutes !== undefined);
      if (!changed.length) return fail(new Error("Nothing to change: give at least one field."), { bankId });
      const entry = await bank.updatePack(bankId, { ...pack, set });
      return ok({ success: true, bankId, label: setLabel(entry), changed, message: "Saved and published." });
    } catch (e) { return fail(e, { bankId }); }
  });

  server.registerTool("addQuestion", {
    title: "Add a question",
    description: "Append a question to the end of a set, optionally with parts. It shows the same case stems as the question before it. Saved and published at once.",
    inputSchema: {
      bankId: setRef,
      text: z.string().min(1).describe("The question, or the shared lead-in when parts are given."),
      marks: z.number().min(0).optional().describe("Marks, when the question has no parts."),
      modelAnswer: z.string().optional().describe("Model answer, one marking point per line, when the question has no parts."),
      parts: z.array(z.object({ label: z.string().describe("e.g. \"a\""), text: z.string(), marks: z.number().min(0).optional(), modelAnswer: z.string().optional() })).optional(),
      presentations: z.array(z.string()).optional().describe("Presentation ids; defaults to the set's."),
    },
    annotations: WRITE,
  }, async ({ bankId, text, marks, modelAnswer, parts, presentations }) => {
    try {
      const pack = await bank.getPack(bankId);
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
      return ok({ success: true, bankId, label: setLabel(entry), question: describeQuestion(question, ordered.length), message: "Saved and published." });
    } catch (e) { return fail(e, { bankId }); }
  });

  server.registerTool("removeQuestion", {
    title: "Remove a question",
    description: "Permanently remove one question from a set. The remaining questions renumber. Students lose their attempts on it when their library updates. Runs only with confirmDeletion true.",
    inputSchema: { bankId: setRef, ...questionRef, confirmDeletion: z.boolean().describe("Must be true; the user has confirmed.") },
    annotations: DESTRUCTIVE,
  }, async ({ bankId, questionNumber, questionId, confirmDeletion }) => {
    try {
      if (!confirmDeletion) return fail(new Error("Not confirmed."), { bankId, hint: "Ask the user, then call again with confirmDeletion true." });
      const pack = await bank.getPack(bankId);
      const { question, index } = findQuestion(pack, { number: questionNumber, questionId });
      const questions = [...pack.questions].sort((a, b) => a.order - b.order).filter((q) => q.id !== question.id).map((q, i) => ({ ...q, order: i }));
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, updatedAt: Date.now() }, questions });
      return ok({ success: true, bankId, label: setLabel(entry), removed: { number: index + 1, questionId: question.id, text: question.text.slice(0, 120) }, remaining: questions.length, message: "Removed and published." });
    } catch (e) { return fail(e, { bankId, questionNumber, questionId }); }
  });

  server.registerTool("addSet", {
    title: "Add a set from text",
    description: "Create a new set by pasting a whole paper as text, the same format the site's Create page accepts: numbered questions (1., Q1, Question 1:), parts as (a), (b), marks as (4 marks), and a model answer after a line starting \"Answer:\" with one marking point per line. A \"Stage 1\" / \"Stage 2\" layout gives staged stems. The set is published at once and gets the next number in its presentation.",
    inputSchema: {
      name: z.string().min(1).describe("Working name, e.g. \"Chest pain batch 3\"."),
      text: z.string().min(20).describe("The whole paper as text."),
      title: z.string().optional().describe("Case title kept as detail, e.g. \"Case 05: Sudden chest pain at rest\"."),
      presentations: z.array(z.string()).optional().describe("Presentation ids to file it under; the first is the primary one."),
      key: z.string().optional().describe("Optional idempotency key so re-sending the same paper does not create a duplicate."),
    },
    annotations: WRITE,
  }, async ({ name, text, title, presentations, key }) => {
    try {
      const entry = await bank.createFromText({ name, text, source: title, presentations, key });
      return ok({ success: true, bankId: entry.id, label: setLabel(entry), questionCount: entry.questionCount, duplicate: entry.duplicate ?? false, message: entry.duplicate ? "That key was sent before; the existing set is returned." : "Created and published.", hint: "getSet shows how the text was split into questions; fix any mis-split with updateQuestion or updatePart." });
    } catch (e) { return fail(e, { name }); }
  });

  server.registerTool("deleteSet", {
    title: "Delete a set",
    description: "Permanently delete a set from the shared bank for everyone. Students lose their attempts on it when their library updates; later sets in the presentation renumber. Runs only with confirmDeletion true.",
    inputSchema: { bankId: setRef, confirmDeletion: z.boolean().describe("Must be true; the user has confirmed.") },
    annotations: DESTRUCTIVE,
  }, async ({ bankId, confirmDeletion }) => {
    try {
      if (!confirmDeletion) return fail(new Error("Not confirmed."), { bankId, hint: "Ask the user, then call again with confirmDeletion true." });
      const entry = await bank.entry(bankId);
      await bank.deleteSet(bankId);
      return ok({ success: true, bankId, deleted: setLabel(entry), questionCount: entry.questionCount, message: "Deleted from the shared bank." });
    } catch (e) { return fail(e, { bankId }); }
  });
}
