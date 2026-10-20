// Exercises the hosted endpoint (/api/mcp/<token>) the way claude.ai does: Streamable HTTP.
// SAQ_MCP_URL must be a full connection link.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.SAQ_MCP_URL;
if (!url) throw new Error("Set SAQ_MCP_URL to a connection link.");
const client = new Client({ name: "smoke-http", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const info = client.getServerVersion();
console.log(`server: ${info?.name} ${info?.version}`);
console.log(`instructions: ${(client.getInstructions() ?? "").slice(-80)}`);
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));
const r = await client.callTool({ name: "listSets", arguments: { limit: 2 } });
const data = r.structuredContent ?? JSON.parse(r.content[0].text);
console.log(`listSets over HTTP: ${data.count} of ${data.total}; first ${data.sets[0]?.label} [${data.sets[0]?.code}]`);
const got = await client.callTool({ name: "getSet", arguments: { set: data.sets[0].code, includeModelAnswers: false } });
const set = got.structuredContent ?? JSON.parse(got.content[0].text);
console.log(`getSet over HTTP: ${set.label}, ${set.questionCount} questions`);
await client.close();
console.log("http smoke OK");
