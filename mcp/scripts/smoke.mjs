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

const sets = await call("listSets", { limit: 5 });
console.log(`listSets: ${sets.count} of ${sets.total}; first: ${sets.sets[0]?.label} (${sets.sets[0]?.questionCount} questions)`);
const bankId = sets.sets[0].bankId;

const set = await call("getSet", { bankId });
console.log(`getSet: ${set.label}, ${set.questionCount} questions; q1 marks ${set.questions[0].marks}, parts ${set.questions[0].parts.length}`);

const found = await call("findQuestions", { query: set.questions[0].text.split(/\s+/).slice(0, 3).join(" "), limit: 3 });
console.log(`findQuestions: ${found.count} set(s) matched, searched ${found.searched}`);

const original = set.questions[0].text;
const edited = await call("updateQuestion", { bankId, questionNumber: 1, text: `${original} [smoke]` });
console.log(`updateQuestion: changed ${edited.changed.join(",")}; now ends with "${edited.question.text.slice(-12)}"`);
const again = await call("getSet", { bankId });
if (!again.questions[0].text.endsWith("[smoke]")) throw new Error("edit did not persist");
const restored = await call("updateQuestion", { bankId, questionNumber: 1, text: original });
if (restored.question.text !== original) throw new Error("restore failed");
console.log("restored original text");

const denied = await client.callTool({ name: "deleteSet", arguments: { bankId, confirmDeletion: false } });
console.log(`deleteSet without confirmation: ${denied.isError ? "refused (good)" : "RAN (bad)"}`);

await client.close();
console.log("smoke OK");
