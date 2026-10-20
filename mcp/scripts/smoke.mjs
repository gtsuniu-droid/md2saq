// Drives the built server over STDIO the way an MCP client does, against a site
// given by SAQ_SITE_URL (default: the local dev server, whose passcode is "dev").
// Edits one question and puts it back, so the bank ends as it started.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const site = process.env.SAQ_SITE_URL ?? "http://localhost:5173";
const passcode = process.env.SAQ_PASSCODE ?? "dev";
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js", "--stdio"], env: { ...process.env, SAQ_SITE_URL: site, SAQ_PASSCODE: passcode } }));

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const data = result.structuredContent ?? JSON.parse(result.content[0].text);
  if (result.isError) throw new Error(`${name}: ${data.error}${data.hint ? ` (${data.hint})` : ""}`);
  return data;
};

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));
const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
console.log("prompts:", prompts.join(", "));

const sets = await call("listSets", { limit: 5 });
console.log(`listSets: ${sets.count} of ${sets.total}; first: ${sets.sets[0]?.label} (${sets.sets[0]?.questionCount} questions)`);
const code = sets.sets[0].code;
const label = sets.sets[0].label;

const set = await call("getSet", { set: code });
const byLabel = await call("getSet", { set: label.replace("—", "").replace(/\s+/g, " ") });
if (byLabel.bankId !== set.bankId) throw new Error("label did not resolve to the same set");
console.log(`getSet by code ${code} and by label "${label}" agree`);
console.log(`getSet: ${set.label}, ${set.questionCount} questions; q1 marks ${set.questions[0].marks}, parts ${set.questions[0].parts.length}`);

const found = await call("findQuestions", { query: set.questions[0].text.split(/\s+/).slice(0, 3).join(" "), limit: 3 });
console.log(`findQuestions: ${found.count} set(s) matched, searched ${found.searched}`);

const original = set.questions[0].text;
const edited = await call("updateQuestion", { set: code, questionNumber: 1, text: `${original} [smoke]` });
console.log(`updateQuestion: changed ${edited.changed.join(",")}; now ends with "${edited.question.text.slice(-12)}"`);
const again = await call("getSet", { set: code });
if (!again.questions[0].text.endsWith("[smoke]")) throw new Error("edit did not persist");
const restored = await call("updateQuestion", { set: code, questionNumber: 1, text: original });
if (restored.question.text !== original) throw new Error("restore failed");
console.log("restored original text");

const audit = await call("auditSets", { minParts: 2, maxPartWords: 30, limit: 5 });
console.log(`auditSets: ${audit.count} flagged of ${audit.searched}; first: ${audit.sets[0]?.label} manyShortParts=${JSON.stringify(audit.sets[0]?.manyShortParts)} missingAnswers=${JSON.stringify(audit.sets[0]?.missingAnswers)}`);

// Overhaul round trip: replace the questions, write answers, then put the original back.
const full = await call("getSet", { set: code });
const backup = full.questions.map((q) => ({ text: q.text, marks: q.marks, modelAnswer: q.modelAnswer, stems: q.stems, parts: q.parts.map((p) => ({ label: p.label, text: p.text, marks: p.marks, modelAnswer: p.modelAnswer })) }));
const rewritten = await call("rewriteSet", { set: code, confirmReplace: true, questions: [
  { text: "Rank THREE differentials and justify each with one discriminating feature.", marks: 6 },
  { text: "Investigations.", parts: [{ label: "a", text: "Name the single most useful first investigation and what result would change your plan.", marks: 2 }, { label: "b", text: "Categorise the causes of this presentation by mechanism.", marks: 3 }] },
] });
console.log(`rewriteSet: ${rewritten.questionCount} questions (replaced ${rewritten.replaced}); without answers: ${JSON.stringify(rewritten.questionsWithoutAnswers)}`);
const answered = await call("setAnswers", { set: code, answers: [
  { questionNumber: 1, modelAnswer: "- [2 marks] Appendicitis: migratory RIF pain\n- [2 marks] Mesenteric adenitis: preceding viral illness\n- [2 marks] Not accepted: constipation without supporting features" },
  { questionNumber: 2, part: "a", modelAnswer: "- [1 mark] Urinalysis\n- [1 mark] Haematuria would raise ureteric colic" },
  { questionNumber: 2, part: "zz", modelAnswer: "should be reported missing" },
] });
console.log(`setAnswers: applied ${answered.applied.join(", ")}; missing ${answered.missing.join(", ")}`);
const check = await call("getSet", { set: code });
if (!check.questions[1].parts[0].modelAnswer?.includes("Urinalysis")) throw new Error("setAnswers did not persist");
const restoredSet = await call("rewriteSet", { set: code, confirmReplace: true, questions: backup });
if (restoredSet.questionCount !== backup.length) throw new Error("restore changed the question count");
const verify = await call("getSet", { set: code });
if (verify.questions[0].text !== full.questions[0].text || (verify.questions[0].modelAnswer ?? "") !== (full.questions[0].modelAnswer ?? "")) throw new Error("restore did not reproduce question 1");
console.log(`rewriteSet restore: ${verify.questionCount} questions back as before`);

const denied = await client.callTool({ name: "deleteSet", arguments: { set: code, confirmDeletion: false } });
console.log(`deleteSet without confirmation: ${denied.isError ? "refused (good)" : "RAN (bad)"}`);

await client.close();
console.log("smoke OK");
