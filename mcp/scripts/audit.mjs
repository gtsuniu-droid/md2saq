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
r = await raw("listPresentations", {});
expect("listPresentations carries names and synonyms", r.data.presentations.some((p) => p.id === "high-blood-pressure" && p.name === "High blood pressure" && (p.alsoKnownAs ?? []).length));
await client.close();
