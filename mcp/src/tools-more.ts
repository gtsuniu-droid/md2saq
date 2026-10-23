import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BankClient, setCode } from "./client.js";
import type { Question, SetPack, SubPart } from "./types.js";
import { cleanTitle, describeQuestion, entryTitle, examStyleWarnings, fail, findPart, findQuestion, hasModelAnswers, metadataWarnings, ok, packToMarkdown, plainText, presentationName, questionQualityIssues, questionStyleWarnings, setLabel } from "./util.js";
import type { ReviewFlag } from "./types.js";
import { PRESENTATIONS, resolvePresentation } from "./presentations.js";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
const setRef = z.string().describe("Which set: its short code, a label like \"Dyspnoea set 3\", or its bank id.");

const ordered = (pack: SetPack): Question[] => [...pack.questions].sort((a, b) => a.order - b.order);
const resolvePres = (p: string) => resolvePresentation(p)?.id ?? p.trim().toLowerCase().replace(/\s+/g, "-");

/** Reading tools for everyone: the shape of the bank, its tags, and sets as documents. */
export function registerMoreReadTools(server: McpServer, bank: BankClient): void {
  server.registerPrompt("review-bank", {
    title: "Review the bank for bad questions",
    description: "Go through every set (or one presentation), list the questions that break the house style or marking rules, and flag the ones the user wants fixed later.",
    argsSchema: { presentation: z.string().optional().describe("Limit to one presentation, or leave empty for the whole bank") },
  }, ({ presentation }) => ({ messages: [{ role: "user", content: { type: "text", text: [
    `Run reviewQuestions${presentation ? ` for ${presentation}` : " over the whole bank"}, severity "fix" first. Then show me a table: set code and label, question number, the problem, and what you would change (one line). Group by set, worst first, and stop.`,
    "When I say which to fix now, fix them with applyEdits or updateQuestion (which clears their flags). When I say which to leave for later, flagQuestions them with the reason so they show on the site for admins. Do not change anything I have not named.",
  ].join("\n\n") } }] }));

  server.registerTool("reviewQuestions", {
    title: "Review questions",
    description: "Read every question in the bank (or one presentation or set) against the house style and marking rules and list the ones that need work: no command word, chatty or over-long wording, no marks, a count of items that does not match the marks or is not in capitals, no model answer, a thin answer for its marks, no stem, a lone part, 'etc.'. Severity 'fix' is a clear fault; 'check' is worth a look. Returns the flagged questions grouped by set, worst first, each with its number and id so it can be fixed with applyEdits or flagged with flagQuestions.",
    inputSchema: {
      presentation: z.string().optional().describe("Limit to one presentation, by id or name."),
      set: z.string().optional().describe("Limit to one set, by code or label."),
      severity: z.enum(["fix", "check", "all"]).default("all").describe("'fix' for clear faults only."),
      limit: z.number().int().min(1).max(300).default(60).describe("Most sets to return."),
    },
    annotations: READ,
  }, async ({ presentation, set: ref, severity, limit }) => {
    try {
      const pres = presentation ? resolvePres(presentation) : undefined;
      const only = ref ? (await bank.resolve(ref)).id : undefined;
      const all = await bank.allPacks();
      let questionsSeen = 0; let flaggedQuestions = 0;
      const sets = all.flatMap(({ entry, pack }) => {
        if (only && entry.id !== only) return [];
        if (pres && !(entry.presentations.includes(pres) || entry.group === pres)) return [];
        const flags = new Map((pack.set.reviewFlags ?? []).map((f) => [f.questionId, f.reason]));
        const rows = ordered(pack).flatMap((q, i) => {
          questionsSeen++;
          const issues = questionQualityIssues(q, i + 1).filter((x) => severity === "all" || x.severity === severity);
          if (!issues.length) return [];
          flaggedQuestions++;
          return [{ questionNumber: i + 1, questionId: q.id, text: q.text.slice(0, 140), issues, alreadyFlagged: flags.get(q.id) }];
        });
        if (!rows.length) return [];
        const fixes = rows.reduce((n, r) => n + r.issues.filter((x) => x.severity === "fix").length, 0);
        return [{ code: setCode(entry.id), label: setLabel(entry), title: entryTitle(entry), bankId: entry.id, questionsFlagged: rows.length, faults: fixes, questions: rows }];
      }).sort((a, b) => b.faults - a.faults || b.questionsFlagged - a.questionsFlagged);
      return ok({ success: true, setsSearched: only ? 1 : all.filter(({ entry }) => !pres || entry.presentations.includes(pres) || entry.group === pres).length, questionsSeen, questionsFlagged: flaggedQuestions, setsWithIssues: sets.length, sets: sets.slice(0, limit), hint: sets.length ? "Fix a question with applyEdits or updateQuestion (its flag clears), or keep it for later with flagQuestions." : "Nothing to raise at this severity." });
    } catch (e) { return fail(e); }
  });

  server.registerTool("listFlags", {
    title: "List flagged questions",
    description: "Every question currently flagged for review across the bank, with its set, number, reason and when it was flagged. Admins see the same list on each set's page.",
    inputSchema: { presentation: z.string().optional() },
    annotations: READ,
  }, async ({ presentation }) => {
    try {
      const pres = presentation ? resolvePres(presentation) : undefined;
      const all = await bank.allPacks();
      const rows = all.flatMap(({ entry, pack }) => {
        if (pres && !(entry.presentations.includes(pres) || entry.group === pres)) return [];
        const qs = ordered(pack);
        return (pack.set.reviewFlags ?? []).map((f) => { const i = qs.findIndex((q) => q.id === f.questionId); return { code: setCode(entry.id), label: setLabel(entry), questionNumber: i >= 0 ? i + 1 : null, questionId: f.questionId, text: i >= 0 ? qs[i].text.slice(0, 120) : "(question removed)", reason: f.reason, flaggedAt: new Date(f.flaggedAt).toISOString(), by: f.by }; });
      });
      return ok({ success: true, count: rows.length, flags: rows, hint: rows.length ? "applyEdits or updateQuestion on a flagged question clears its flag; clearFlags removes flags without changing the question." : "Nothing is flagged. reviewQuestions finds candidates." });
    } catch (e) { return fail(e); }
  });
  server.registerTool("bankStats", {
    title: "Bank statistics",
    description: "The shape of the whole bank: per presentation, how many sets and questions there are, how many questions have model answers, and how many sets have weak titles or tags; plus totals and the latest change. Use it to see where coverage is thin or answers are missing before planning work.",
    inputSchema: {},
    annotations: READ,
  }, async () => {
    try {
      const all = await bank.allPacks();
      const rows = new Map<string, { presentation: string; sets: number; questions: number; questionsWithAnswers: number; setsWithoutAnyAnswers: number; weakMetadata: number }>();
      let latest = 0;
      for (const { entry, pack } of all) {
        const id = entry.group ?? entry.presentations[0] ?? "unassigned";
        const row = rows.get(id) ?? { presentation: presentationName(id), sets: 0, questions: 0, questionsWithAnswers: 0, setsWithoutAnyAnswers: 0, weakMetadata: 0 };
        const qs = pack.questions;
        row.sets++; row.questions += qs.length; row.questionsWithAnswers += qs.filter(hasModelAnswers).length;
        if (qs.length && !qs.some(hasModelAnswers)) row.setsWithoutAnyAnswers++;
        if (metadataWarnings({ name: pack.set.name, source: pack.set.source, tags: pack.set.tags }).length) row.weakMetadata++;
        rows.set(id, row);
        latest = Math.max(latest, entry.updatedAt ?? entry.uploadedAt);
      }
      const byPresentation = [...rows.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => b.sets - a.sets);
      const totals = byPresentation.reduce((t, r) => ({ sets: t.sets + r.sets, questions: t.questions + r.questions, questionsWithAnswers: t.questionsWithAnswers + r.questionsWithAnswers, setsWithoutAnyAnswers: t.setsWithoutAnyAnswers + r.setsWithoutAnyAnswers, weakMetadata: t.weakMetadata + r.weakMetadata }), { sets: 0, questions: 0, questionsWithAnswers: 0, setsWithoutAnyAnswers: 0, weakMetadata: 0 });
      const empty = PRESENTATIONS.filter((p) => !rows.has(p.id)).map((p) => p.name);
      return ok({ success: true, totals, presentationsWithSets: byPresentation.length, presentationsWithoutSets: empty, byPresentation, latestChange: latest ? new Date(latest).toISOString() : null, hint: "auditSets lists the specific sets behind these numbers; listSets with a presentation shows what exists there." });
    } catch (e) { return fail(e); }
  });

  server.registerTool("listTags", {
    title: "List tags",
    description: "Every tag in use (the conditions sets are tagged with), how many sets carry each, and the codes of up to five of them. Spot near-duplicates such as \"PE\" and \"Pulmonary embolism\" here, then merge them with renameTag.",
    inputSchema: { query: z.string().optional().describe("Only tags containing this text.") },
    annotations: READ,
  }, async ({ query }) => {
    try {
      const entries = await bank.listEntries(true);
      const tags = new Map<string, { tag: string; sets: number; codes: string[] }>();
      for (const e of entries) for (const raw of e.tags ?? []) {
        const tag = raw.trim(); if (!tag) continue;
        const key = tag.toLowerCase();
        const row = tags.get(key) ?? { tag, sets: 0, codes: [] };
        row.sets++; if (row.codes.length < 5) row.codes.push(setCode(e.id));
        tags.set(key, row);
      }
      const q = query?.trim().toLowerCase();
      const rows = [...tags.values()].filter((t) => !q || t.tag.toLowerCase().includes(q)).sort((a, b) => b.sets - a.sets || a.tag.localeCompare(b.tag));
      return ok({ success: true, count: rows.length, untagged: entries.filter((e) => !(e.tags ?? []).length).length, tags: rows });
    } catch (e) { return fail(e); }
  });

  server.registerResource("sets", "saq://sets", { title: "All sets", description: "Every set in the bank with its code, label, title and tags.", mimeType: "text/markdown" }, async (uri) => {
    const entries = await bank.listEntries();
    const text = ["# SAQ Practice bank", "", ...entries.map((e) => `- \`${setCode(e.id)}\` ${setLabel(e)}${entryTitle(e) ? `: ${entryTitle(e)}` : ""}${e.tags?.length ? ` (${e.tags.join(", ")})` : ""} · ${e.questionCount} questions`)].join("\n");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
  });
  server.registerResource("set", new ResourceTemplate("saq://set/{code}", { list: undefined }), { title: "A set as a document", description: "One set, by code or label, as Markdown with its model answers.", mimeType: "text/markdown" }, async (uri, { code }) => {
    const ref = decodeURIComponent(String(code));
    const entry = await bank.resolve(ref);
    const pack = await bank.getPack(entry.id);
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: packToMarkdown({ code: setCode(entry.id), label: setLabel(entry) }, pack, true) }] };
  });
}

/** Editing tools for admins: drafts, bulk edits, structure, tags, and undo. */
export function registerMoreWriteTools(server: McpServer, bank: BankClient): void {
  server.registerTool("flagQuestions", {
    title: "Flag questions for review",
    description: "Mark questions as needing review, with a reason each, so they are kept for later: the flags live on the set, show to admins on the site, and listFlags finds them in any chat. Items may span several sets; each set is saved once. Flagging a question again replaces its reason.",
    inputSchema: { items: z.array(z.object({ set: setRef, questionNumber: z.number().int().min(1).optional(), questionId: z.string().optional(), reason: z.string().min(3) })).min(1), by: z.string().optional().describe("Who is flagging, e.g. the user's name.") },
    annotations: WRITE,
  }, async ({ items, by }) => {
    try {
      const bySet = new Map<string, typeof items>();
      for (const item of items) { const id = (await bank.resolve(item.set, true)).id; bySet.set(id, [...(bySet.get(id) ?? []), item]); }
      const flagged: { code: string; label: string; questions: number[] }[] = [];
      for (const [bankId, list] of bySet) {
        const pack = await bank.getPack(bankId, true);
        const flags: ReviewFlag[] = [...(pack.set.reviewFlags ?? [])];
        const numbers: number[] = [];
        for (const item of list) {
          const { question, index } = findQuestion(pack, { number: item.questionNumber, questionId: item.questionId });
          const flag: ReviewFlag = { questionId: question.id, reason: item.reason.trim(), flaggedAt: Date.now(), by: by?.trim() || "AI connector" };
          const at = flags.findIndex((f) => f.questionId === question.id);
          if (at >= 0) flags[at] = flag; else flags.push(flag);
          numbers.push(index + 1);
        }
        const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, reviewFlags: flags, updatedAt: Date.now() } });
        flagged.push({ code: setCode(bankId), label: setLabel(entry), questions: numbers });
      }
      return ok({ success: true, setsChanged: flagged.length, flagged, message: `Flagged ${items.length} question${items.length === 1 ? "" : "s"}. Admins see them on the set page; listFlags lists them.` });
    } catch (e) { return fail(e); }
  });

  server.registerTool("clearFlags", {
    title: "Clear review flags",
    description: "Remove review flags from a set without changing its questions: all of them, or only the question numbers given. (Editing a question with applyEdits or updateQuestion clears its flag automatically.)",
    inputSchema: { set: setRef, questionNumbers: z.array(z.number().int().min(1)).optional() },
    annotations: WRITE,
  }, async ({ set: ref, questionNumbers }) => {
    try {
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const qs = ordered(pack);
      const drop = new Set((questionNumbers ?? []).map((n) => qs[n - 1]?.id).filter(Boolean));
      const before = pack.set.reviewFlags ?? [];
      const kept = questionNumbers ? before.filter((f) => !drop.has(f.questionId)) : [];
      if (kept.length === before.length) return ok({ success: true, code: setCode(bankId), cleared: 0, message: "Nothing to clear." });
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, reviewFlags: kept.length ? kept : undefined, updatedAt: Date.now() } });
      return ok({ success: true, code: setCode(bankId), label: setLabel(entry), cleared: before.length - kept.length, remaining: kept.length, message: "Cleared and published." });
    } catch (e) { return fail(e, { set: ref }); }
  });
  server.registerTool("previewSet", {
    title: "Preview a set from text",
    description: "Parse a paper exactly as addSet would, without saving: shows how the text splits into stems, questions, parts, marks and answers, plus style and title/tag warnings. Use it to check a draft before uploading, or to find why a paper mis-splits.",
    inputSchema: {
      title: z.string().min(3), text: z.string().min(20),
      presentations: z.array(z.string()).min(1).describe("Presentation id, name or synonym; the first is primary."),
      tags: z.array(z.string()).optional(),
    },
    annotations: READ,
  }, async ({ title, text, presentations, tags }) => {
    try {
      const name = cleanTitle(title);
      const ids = presentations.map(resolvePres);
      const unknown = ids.filter((id) => !PRESENTATIONS.some((p) => p.id === id));
      if (unknown.length) return fail(new Error(`Unknown presentation: ${unknown.join(", ")}.`), { hint: "listPresentations gives the ids and names." });
      const pack = await bank.preview({ name, text, source: name, presentations: ids });
      const qs = ordered(pack);
      const style = qs.flatMap((q, i) => questionStyleWarnings(q, i + 1));
      const meta = metadataWarnings({ name, source: name, tags });
      return ok({ success: true, title: name, presentation: ids[0], tags: tags ?? [], questionCount: qs.length, totalMarks: qs.reduce((t, q) => t + (q.parts.length ? q.parts.reduce((s, p) => s + (p.marks ?? 0), 0) : q.marks ?? 0), 0), questions: qs.map(describeQuestion), styleWarnings: style.length ? style : undefined, metadataWarnings: meta.length ? meta : undefined, message: "Nothing was saved. addSet with the same text publishes it." });
    } catch (e) { return fail(e, { title }); }
  });

  server.registerTool("applyEdits", {
    title: "Apply several edits to a set",
    description: "Change many questions and parts of one set in a single save: each edit names a question (number or id) and optionally a part label, and gives new text, marks or model answer. Also sets a new stage-1 stem for the set when stems is given. Everything is checked first; if any edit names a missing question or part, nothing is saved. One publish, one version in history.",
    inputSchema: {
      set: setRef,
      edits: z.array(z.object({
        questionNumber: z.number().int().min(1).optional(), questionId: z.string().optional(),
        part: z.string().optional().describe("Part label, e.g. \"a\", to edit a part rather than the question."),
        text: z.string().optional(), marks: z.number().min(0).nullable().optional(), modelAnswer: z.string().nullable().optional(),
      })).min(1),
      stems: z.array(z.string()).optional().describe("Replace the set's case stems (every question), stage by stage."),
    },
    annotations: WRITE,
  }, async ({ set: ref, edits, stems }) => {
    try {
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const questions = ordered(pack).map((q) => ({ ...q, parts: q.parts.map((p) => ({ ...p })) }));
      const applied: string[] = []; const warnings: string[] = [];
      for (const e of edits) {
        const { index } = findQuestion({ ...pack, questions }, { number: e.questionNumber, questionId: e.questionId });
        const q = questions[index];
        if (e.text === undefined && e.marks === undefined && e.modelAnswer === undefined) throw new Error(`Edit for question ${index + 1} changes nothing.`);
        const target: SubPart | Question = e.part ? findPart(q, e.part) : q;
        if (e.text !== undefined) { target.text = plainText(e.text); if (target.textDoc) { delete target.textDoc; warnings.push(`Question ${index + 1}${e.part ? `(${e.part})` : ""}: formatting dropped.`); } }
        if (e.marks !== undefined) target.marks = e.marks ?? undefined;
        if (e.modelAnswer !== undefined) { target.modelAnswer = e.modelAnswer === null ? undefined : plainText(e.modelAnswer); if (target.modelAnswerDoc) { delete target.modelAnswerDoc; warnings.push(`Question ${index + 1}${e.part ? `(${e.part})` : ""}: answer formatting dropped.`); } }
        applied.push(`Q${index + 1}${e.part ? `(${e.part})` : ""}`);
        if (e.text !== undefined) warnings.push(...(e.part ? examStyleWarnings(`Question ${index + 1}(${e.part})`, target.text) : questionStyleWarnings(q, index + 1)));
      }
      if (stems) for (const q of questions) { q.stems = stems.map(plainText); delete q.stemDocs; }
      const edited = new Set(applied.map((a) => questions[Number(/\d+/.exec(a)![0]) - 1].id));
      const reviewFlags = (pack.set.reviewFlags ?? []).filter((f) => !edited.has(f.questionId));
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, updatedAt: Date.now(), reviewFlags: reviewFlags.length ? reviewFlags : undefined }, questions: questions.map((q, i) => ({ ...q, order: i })) });
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), applied, stemsReplaced: !!stems, warnings: warnings.length ? warnings : undefined, message: `Saved ${applied.length} edit${applied.length === 1 ? "" : "s"} and published.`, hint: "setHistory shows the version before this change; restoreSet brings it back." });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("reorderQuestions", {
    title: "Reorder questions",
    description: "Put a set's questions in a new order. Give the current question numbers in the order wanted, e.g. [2, 1, 3, 4]; every question must appear once. Attempts stay attached to their questions.",
    inputSchema: { set: setRef, order: z.array(z.number().int().min(1)).min(2) },
    annotations: WRITE,
  }, async ({ set: ref, order }) => {
    try {
      const bankId = (await bank.resolve(ref, true)).id;
      const pack = await bank.getPack(bankId, true);
      const qs = ordered(pack);
      const sorted = [...order].sort((a, b) => a - b);
      if (sorted.length !== qs.length || sorted.some((n, i) => n !== i + 1)) return fail(new Error(`order must list each of the ${qs.length} question numbers exactly once.`), { set: ref, given: order });
      const questions = order.map((n, i) => ({ ...qs[n - 1], order: i }));
      const entry = await bank.updatePack(bankId, { ...pack, set: { ...pack.set, updatedAt: Date.now() }, questions });
      return ok({ success: true, code: setCode(bankId), bankId, label: setLabel(entry), order: questions.map((q, i) => ({ number: i + 1, was: order[i], text: q.text.slice(0, 80) })), message: "Reordered and published." });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("duplicateSet", {
    title: "Duplicate a set",
    description: "Copy a set as a new set with its own code: same stems, questions, parts and (optionally) model answers, under a new title and, if wanted, another presentation. Use it to make a variant case or to start a rewrite without touching the original.",
    inputSchema: {
      set: setRef, title: z.string().min(3).describe("Title for the copy, under ten words."),
      presentations: z.array(z.string()).optional().describe("Where the copy is filed; defaults to the original's."),
      tags: z.array(z.string()).optional().describe("Tags for the copy; defaults to the original's."),
      includeAnswers: z.boolean().default(true),
    },
    annotations: WRITE,
  }, async ({ set: ref, title, presentations, tags, includeAnswers }) => {
    try {
      const source = await bank.resolve(ref, true);
      const pack = await bank.getPack(source.id, true);
      const ids = presentations?.map(resolvePres);
      const unknown = (ids ?? []).filter((id) => !PRESENTATIONS.some((p) => p.id === id));
      if (unknown.length) return fail(new Error(`Unknown presentation: ${unknown.join(", ")}.`), { set: ref });
      const name = cleanTitle(title); const now = Date.now(); const setId = crypto.randomUUID();
      const strip = (q: Question): Question => includeAnswers ? q : { ...q, modelAnswer: undefined, modelAnswerDoc: undefined, parts: q.parts.map((p) => ({ ...p, modelAnswer: undefined, modelAnswerDoc: undefined })) };
      const copy: SetPack = {
        ...pack,
        set: { ...pack.set, id: setId, number: undefined, name, source: name, createdAt: now, updatedAt: now, tags: tags ? [...new Set(tags.map((t) => t.trim()).filter(Boolean))] : pack.set.tags, primaryPresentation: ids?.[0] ?? pack.set.primaryPresentation },
        questions: ordered(pack).map((q, i) => ({ ...strip(q), id: crypto.randomUUID(), setId, order: i, createdAt: now, presentations: ids ?? q.presentations })),
      };
      const entry = await bank.createPack(copy);
      return ok({ success: true, code: setCode(entry.id), bankId: entry.id, label: setLabel(entry), title: name, copiedFrom: { code: setCode(source.id), label: setLabel(source) }, questionCount: entry.questionCount, includeAnswers, message: "Created and published." });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("renameTag", {
    title: "Rename or merge a tag",
    description: "Change a tag on every set that carries it, e.g. \"PE\" to \"Pulmonary embolism\". If the new name is already a tag on a set, the two merge. An empty new name removes the tag everywhere. Each changed set is saved and published (one history version each). Runs only with confirm true, after showing the user how many sets are affected (listTags).",
    inputSchema: { from: z.string().min(1), to: z.string().describe("The new tag, or empty to remove the tag."), confirm: z.boolean() },
    annotations: DESTRUCTIVE,
  }, async ({ from, to, confirm }) => {
    try {
      const target = to.trim();
      const affected = (await bank.listEntries(true)).filter((e) => (e.tags ?? []).some((t) => t.trim().toLowerCase() === from.trim().toLowerCase()));
      if (!confirm) return fail(new Error("Not confirmed."), { from, to: target, affectedSets: affected.length, codes: affected.slice(0, 20).map((e) => setCode(e.id)), hint: "Tell the user how many sets change, then call again with confirm true." });
      const changed: string[] = [];
      for (const e of affected) {
        const pack = await bank.getPack(e.id, true);
        const tags = (pack.set.tags ?? []).map((t) => (t.trim().toLowerCase() === from.trim().toLowerCase() ? target : t.trim())).filter(Boolean);
        await bank.updatePack(e.id, { ...pack, set: { ...pack.set, tags: [...new Set(tags)], updatedAt: Date.now() } });
        changed.push(setCode(e.id));
      }
      return ok({ success: true, from, to: target || null, setsChanged: changed.length, codes: changed, message: changed.length ? `${target ? "Renamed" : "Removed"} on ${changed.length} set${changed.length === 1 ? "" : "s"} and published.` : "No set carries that tag." });
    } catch (e) { return fail(e, { from, to }); }
  });

  server.registerTool("setHistory", {
    title: "Set history",
    description: "Earlier versions of a set, newest first: when each was replaced and why (update, restore or delete), with its title and question count then. Up to twenty are kept. restoreSet brings one back.",
    inputSchema: { set: setRef, showVersion: z.number().optional().describe("The 'at' of one version to read in full, as questions.") },
    annotations: READ,
  }, async ({ set: ref, showVersion }) => {
    try {
      const entry = await bank.resolve(ref);
      const versions = await bank.history(entry.id);
      const rows = versions.map((v) => ({ at: v.at, when: new Date(v.at).toISOString(), replacedBy: v.reason, title: v.name, questionCount: v.questionCount }));
      if (showVersion !== undefined) {
        const snap = await bank.historyPack(entry.id, showVersion);
        return ok({ success: true, code: setCode(entry.id), label: setLabel(entry), version: { at: snap.at, when: new Date(snap.at).toISOString(), questions: ordered(snap.pack).map(describeQuestion) }, versions: rows });
      }
      return ok({ success: true, code: setCode(entry.id), label: setLabel(entry), count: rows.length, versions: rows, hint: rows.length ? "setHistory with showVersion reads one; restoreSet with its 'at' makes it current again." : "No earlier versions yet: history starts with the first change made after this feature was added." });
    } catch (e) { return fail(e, { set: ref }); }
  });

  server.registerTool("restoreSet", {
    title: "Restore an earlier version",
    description: "Make an earlier version of a set current again (undo). The version being replaced is kept in history too, so a restore can itself be undone. Runs only with confirmReplace true.",
    inputSchema: { set: setRef, at: z.number().describe("The version's 'at' from setHistory."), confirmReplace: z.boolean() },
    annotations: DESTRUCTIVE,
  }, async ({ set: ref, at, confirmReplace }) => {
    try {
      if (!confirmReplace) return fail(new Error("Not confirmed."), { set: ref, hint: "Show the user the version (setHistory showVersion), then call again with confirmReplace true." });
      const entry = await bank.resolve(ref, true);
      const restored = await bank.restore(entry.id, at);
      return ok({ success: true, code: setCode(restored.id), bankId: restored.id, label: setLabel(restored), questionCount: restored.questionCount, restoredFrom: new Date(at).toISOString(), message: "Restored and published." });
    } catch (e) { return fail(e, { set: ref, at }); }
  });

  server.registerTool("listDeletedSets", {
    title: "List deleted sets",
    description: "Sets deleted from the bank that can still be brought back (the last fifty), with when they went. restoreDeletedSet puts one back under its old code.",
    inputSchema: {},
    annotations: READ,
  }, async () => {
    try {
      const rows = (await bank.deletedSets()).map((d) => ({ code: setCode(d.id), bankId: d.id, title: cleanTitle(d.name) || d.name, presentation: d.group ? presentationName(d.group) : undefined, wasNumber: d.number, questionCount: d.questionCount, deletedAt: new Date(d.deletedAt).toISOString() }));
      return ok({ success: true, count: rows.length, deleted: rows, hint: rows.length ? "restoreDeletedSet with the bankId brings one back." : "Nothing deleted recently." });
    } catch (e) { return fail(e); }
  });

  server.registerTool("restoreDeletedSet", {
    title: "Restore a deleted set",
    description: "Bring a deleted set back into the bank under its old id and code, at the end of its presentation. Runs only with confirmRestore true.",
    inputSchema: { bankId: z.string().describe("From listDeletedSets."), confirmRestore: z.boolean() },
    annotations: WRITE,
  }, async ({ bankId, confirmRestore }) => {
    try {
      if (!confirmRestore) return fail(new Error("Not confirmed."), { bankId, hint: "Confirm with the user, then call again with confirmRestore true." });
      const gone = (await bank.deletedSets()).find((d) => d.id === bankId);
      if (!gone) return fail(new Error("That set is not in the deleted list."), { bankId, hint: "listDeletedSets shows what can be restored." });
      const versions = await bank.history(bankId);
      const last = versions.find((v) => v.reason === "delete") ?? versions[0];
      if (!last) return fail(new Error("No stored version of that set to restore."), { bankId });
      const entry = await bank.restore(bankId, last.at);
      return ok({ success: true, code: setCode(entry.id), bankId: entry.id, label: setLabel(entry), questionCount: entry.questionCount, message: "Restored and published. Students see it again when their library refreshes." });
    } catch (e) { return fail(e, { bankId }); }
  });
}
