// Error paths and name resolution over STDIO against the dev bank. Nothing is left changed.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "audit", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js", "--stdio"], env: { ...process.env, SAQ_SITE_URL: process.env.SAQ_SITE_URL ?? "http://localhost:5173", SAQ_PASSCODE: process.env.SAQ_PASSCODE ?? "dev" } }));
const raw = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content[0].text) }; };
const expect = (label, cond, detail = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);

let r = await raw("listSets", { presentation: "hypertension" });
expect("listSets by synonym 'hypertension' finds the two HBP sets", r.data.count === 2, `count=${r.data.count}`);
r = await raw("getSet", { set: "hypertension 1" });
expect("getSet by synonym label 'hypertension 1'", !r.isError && /High blood pressure — Set 01/.test(r.data.label), r.data.label ?? r.data.error);
r = await raw("getSet", { set: "HBP 2" });
expect("getSet by abbreviation 'HBP 2'", !r.isError && /Set 02/.test(r.data.label ?? ""), r.data.label ?? r.data.error);
r = await raw("getSet", { set: "high blood pressure" });
expect("ambiguous label is refused with candidates", r.isError && /matches 2 sets/.test(r.data.error), r.data.error);
r = await raw("getSet", { set: "nonsense set 9" });
expect("unknown label gives a helpful error", r.isError && /No set matches/.test(r.data.error), r.data.error);
r = await raw("addSet", { title: "Case 7: a test title", text: "1. State the diagnosis. (2 marks)\nAnswer:\n- test", presentations: ["made-up-thing"] });
expect("addSet rejects an unknown presentation before creating anything", r.isError && /Unknown presentation/.test(r.data.error), r.data.error);
{ const res = await client.callTool({ name: "addSet", arguments: { name: "old field", text: "1. State the diagnosis. (2 marks)" } }).catch((e) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
  const text = res.content?.[0]?.text ?? ""; expect("addSet without a title is refused", !!res.isError && /title/.test(text), text.slice(0, 80)); }
r = await raw("addSet", { title: "Case 7: Collapse at the gym", text: "Stage 1\nA 19-year-old collapses while running on a treadmill. He is now alert.\n\n1. State the diagnosis of greatest concern. (2 marks)", presentations: ["syncope"], tags: ["Hypertrophic cardiomyopathy", "Vasovagal syncope"] });
expect("addSet strips the 'Case 7:' prefix and keeps tags", !r.isError && r.data.title === "Collapse at the gym" && r.data.tags.length === 2, r.isError ? r.data.error : `${r.data.title} / ${r.data.tags}`);
if (!r.isError) { const del = await raw("deleteSet", { set: r.data.code, confirmDeletion: true }); expect("test set deleted again", !del.isError); }
r = await raw("updateSet", { set: "hypertension 2", tags: ["Pre-eclampsia", "Hypertensive emergency"], primaryPresentation: "High blood pressure" });
expect("updateSet accepts a presentation by name", !r.isError && r.data.changed.includes("primaryPresentation"), r.data.error ?? r.data.changed?.join(","));
r = await raw("setAnswers", { set: "hypertension 1", answers: [{ questionNumber: 9, modelAnswer: "x" }] });
expect("setAnswers with nothing matching fails clearly", r.isError && /None of the entries matched/.test(r.data.error), r.data.error);
r = await raw("removeQuestion", { set: "hypertension 1", questionNumber: 1, confirmDeletion: false });
expect("removeQuestion needs confirmation", r.isError && /Not confirmed/.test(r.data.error));
r = await raw("rewriteSet", { set: "hypertension 1", questions: [{ text: "State x." }], confirmReplace: false });
expect("rewriteSet needs confirmation", r.isError && /Not confirmed/.test(r.data.error));
r = await raw("updatePart", { set: "hypertension 1", questionNumber: 1, part: "a", text: "State y." });
expect("updatePart on a question without parts explains the parts", r.isError && /has no part/.test(r.data.error), r.data.error);
r = await raw("updateQuestion", { set: "hypertension 1", questionNumber: 1, text: "Could you tell me what you think the diagnosis is and why, and also what you would do next, and which tests you would order, and how you would explain this to the patient and their family?" });
expect("style warnings on a chatty, long question", !r.isError && (r.data.styleWarnings ?? []).length >= 2, (r.data.styleWarnings ?? []).join(" | "));
await raw("updateQuestion", { set: "hypertension 1", questionNumber: 1, text: "State how you would confirm hypertension in this man. Name THREE findings on history or examination that would make this a hypertensive emergency." });
// --- v2 tools: preview, stats, tags, bulk edits, reorder, duplicate, history, restore, undelete.
r = await raw("previewSet", { title: "Case 3: Preview only", text: "Stage 1\nA 60-year-old woman has had a headache for 3 days.\n\n1. State the diagnosis of greatest concern. (2 marks)\n\n2. List THREE features on history that would support it. (3 marks)", presentations: ["headache"], tags: ["Giant cell arteritis"] });
expect("previewSet parses without saving", !r.isError && r.data.questionCount === 2 && r.data.totalMarks === 5 && /Nothing was saved/.test(r.data.message), r.isError ? r.data.error : `${r.data.questionCount} q, ${r.data.totalMarks} marks`);
const before = (await raw("listSets", {})).data.total;
r = await raw("bankStats", {});
expect("bankStats totals match listSets", !r.isError && r.data.totals.sets === before, r.isError ? r.data.error : `${r.data.totals.sets} sets, ${r.data.totals.questions} questions`);
r = await raw("listTags", {});
expect("listTags lists tags with counts", !r.isError && Array.isArray(r.data.tags) && r.data.tags.some((t) => t.tag === "Pre-eclampsia"), r.isError ? r.data.error : r.data.tags.map((t) => `${t.tag}:${t.sets}`).join(", "));
r = await raw("findQuestions", { query: "", withoutAnswers: true, presentation: "high blood pressure" });
expect("findQuestions filters by withoutAnswers with no words", !r.isError && r.data.count >= 1, r.isError ? r.data.error : `${r.data.count} sets`);
{ const res = await client.callTool({ name: "getSet", arguments: { set: "hypertension 1", format: "markdown" } }); expect("getSet markdown starts with a heading and a code", /^# High blood pressure — Set 01/.test(res.content[0].text) && /Code `/.test(res.content[0].text), res.content[0].text.split("\n")[0]); }
r = await raw("duplicateSet", { set: "hypertension 1", title: "Case 9: Duplicate for audit", includeAnswers: false });
expect("duplicateSet creates a copy with a clean title", !r.isError && r.data.title === "Duplicate for audit" && r.data.questionCount >= 1, r.isError ? r.data.error : `${r.data.code} ${r.data.questionCount} q`);
const copy = r.data.code;
if (!r.isError) {
  r = await raw("applyEdits", { set: copy, edits: [{ questionNumber: 1, text: "State the single most likely diagnosis.", marks: 2 }, { questionNumber: 7, text: "x" }] });
  expect("applyEdits refuses when one edit names a missing question", r.isError && /No question 7/.test(r.data.error), r.data.error);
  r = await raw("applyEdits", { set: copy, edits: [{ questionNumber: 1, text: "State the single most likely diagnosis.", marks: 2 }] });
  expect("applyEdits saves several changes in one publish", !r.isError && r.data.applied.length === 1, r.isError ? r.data.error : r.data.applied.join(","));
  r = await raw("setHistory", { set: copy });
  expect("setHistory shows the version before applyEdits", !r.isError && r.data.count === 1 && r.data.versions[0].replacedBy === "update", r.isError ? r.data.error : `${r.data.count} versions`);
  const at = r.data.versions?.[0]?.at;
  r = await raw("restoreSet", { set: copy, at, confirmReplace: true });
  expect("restoreSet brings the earlier version back", !r.isError, r.data.error);
  r = await raw("getSet", { set: copy });
  expect("restored text matches the original", !r.isError && !/single most likely/.test(r.data.questions[0].text), r.data.questions?.[0]?.text?.slice(0, 60));
  const n = r.data.questionCount;
  if (n >= 2) { r = await raw("reorderQuestions", { set: copy, order: [2, 1, ...Array.from({ length: n - 2 }, (_, i) => i + 3)] }); expect("reorderQuestions swaps the first two", !r.isError && r.data.order[0].was === 2, r.data.error); }
  r = await raw("reorderQuestions", { set: copy, order: [1, 1] });
  expect("reorderQuestions rejects a bad permutation", r.isError && /exactly once/.test(r.data.error), r.data.error);
  r = await raw("deleteSet", { set: copy, confirmDeletion: true });
  expect("deleteSet says it can be restored", !r.isError && /restoreDeletedSet/.test(r.data.hint ?? ""), r.data.error);
  r = await raw("listDeletedSets", {});
  expect("listDeletedSets shows the deleted copy", !r.isError && r.data.deleted.some((d) => d.code === copy), r.isError ? r.data.error : `${r.data.count} deleted`);
  const bankId = r.data.deleted?.find((d) => d.code === copy)?.bankId;
  r = await raw("restoreDeletedSet", { bankId, confirmRestore: true });
  expect("restoreDeletedSet brings it back under the same code", !r.isError && r.data.code === copy, r.data.error ?? r.data.code);
  r = await raw("deleteSet", { set: copy, confirmDeletion: true });
  expect("copy deleted again", !r.isError);
}
// --- review and flags
r = await raw("reviewQuestions", { presentation: "high blood pressure" });
expect("reviewQuestions reads every question and reports issues", !r.isError && r.data.questionsSeen >= 2 && Array.isArray(r.data.sets), r.isError ? r.data.error : `${r.data.questionsSeen} seen, ${r.data.questionsFlagged} flagged`);
r = await raw("flagQuestions", { items: [{ set: "hypertension 1", questionNumber: 1, reason: "Audit flag: wording" }, { set: "hypertension 2", questionNumber: 1, reason: "Audit flag: marks" }], by: "audit" });
expect("flagQuestions flags across two sets", !r.isError && r.data.setsChanged === 2, r.data.error);
r = await raw("listFlags", {});
expect("listFlags finds both flags with reasons", !r.isError && r.data.flags.filter((f) => /Audit flag/.test(f.reason)).length === 2, r.isError ? r.data.error : `${r.data.count}`);
r = await raw("reviewQuestions", { set: "hypertension 1" });
expect("reviewQuestions shows a question's existing flag", !r.isError && (r.data.sets[0]?.questions ?? []).some((q) => q.alreadyFlagged) || (!r.isError && r.data.questionsFlagged === 0), r.data.error);
r = await raw("updateQuestion", { set: "hypertension 1", questionNumber: 1, marks: 3 });
r = await raw("listFlags", {});
expect("editing a flagged question clears its flag", !r.isError && !r.data.flags.some((f) => /wording/.test(f.reason)), r.data.flags?.map((f) => f.reason).join("|"));
r = await raw("clearFlags", { set: "hypertension 2" });
expect("clearFlags removes the rest", !r.isError && r.data.cleared === 1, r.data.error ?? `cleared ${r.data.cleared}`);
r = await raw("renameTag", { from: "Pre-eclampsia", to: "Pre-eclampsia", confirm: false });
expect("renameTag reports affected sets before confirming", r.isError && r.data.affectedSets >= 1, r.data.error ?? "");
{ const res = await client.listResources(); expect("resources: saq://sets is listed", res.resources.some((x) => x.uri === "saq://sets"), res.resources.map((x) => x.uri).join(","));
  const tpl = await client.listResourceTemplates(); expect("resources: saq://set/{code} template is listed", tpl.resourceTemplates.some((x) => x.uriTemplate === "saq://set/{code}"));
  const code = (await raw("listSets", { presentation: "hypertension", limit: 1 })).data.sets[0].code;
  const read = await client.readResource({ uri: `saq://set/${code}` }); expect("resources: a set reads as markdown", /^# High blood pressure/.test(read.contents[0].text), read.contents[0].text.split("\n")[0]); }
r = await raw("listPresentations", {});
expect("listPresentations carries names and synonyms", r.data.presentations.some((p) => p.id === "high-blood-pressure" && p.name === "High blood pressure" && (p.alsoKnownAs ?? []).length));
await client.close();
