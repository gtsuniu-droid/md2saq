import type { Config } from "@netlify/functions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { hosted, openNamedStore } from "../lib/store";
import { hashToken, type ConnectionRecord } from "./mcp-token";
import { BankClient, type BankReader } from "../../mcp/src/client";
import type { BankEntry, SetPack } from "../../mcp/src/types";
import { SERVER_INSTRUCTIONS } from "../../mcp/src/instructions";
import { registerTools } from "../../mcp/src/tools";

/**
 * The hosted MCP endpoint, one per connection link: /api/mcp/<token>. The same
 * tools as the local saq-mcp server, run here so claude.ai, Claude Desktop and
 * Claude Code can reach the bank without anything installed. Admins and the
 * owner get the editing tools, using the site's own passcode; everyone else
 * gets the reading tools. Stateless: each request builds a server and answers
 * with plain JSON, which suits a serverless function.
 */
const refuse = (status: number, message: string) =>
  // 403 without WWW-Authenticate: a 401 would make clients start an OAuth flow we do not offer.
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const token = decodeURIComponent(url.pathname.replace(/\/+$/, "").split("/").pop() ?? "");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return refuse(403, "This connection link is not valid.");
  const record = (await openNamedStore("mcp-tokens").get(`tokens/${hashToken(token)}`, { type: "json" })) as ConnectionRecord | null;
  if (!record) return refuse(403, "This connection link has been removed. Create a new one in Settings.");

  if (req.method === "GET") return refuse(405, "This endpoint speaks MCP over POST.");
  if (req.method === "DELETE") return new Response(null, { status: 200 });
  if (req.method !== "POST") return refuse(405, "Method not allowed.");

  const canEdit = record.role === "owner" || record.role === "admin";
  const passcode = process.env.BANK_PASSCODE ?? (hosted() ? "" : "dev");
  // Read straight from the bank's storage; writes still go through /api/bank so numbering and delivery stay in one place.
  const store = openNamedStore("bank");
  const reader: BankReader = {
    index: async () => ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [],
    pack: async (id) => (await store.get(`sets/${id}`, { type: "json" })) as SetPack | null,
  };
  const bank = new BankClient({ siteUrl: url.origin, passcode: canEdit ? passcode : "", readOnly: !canEdit || !passcode }, reader);
  const server = new McpServer({ name: "saq-practice", version: "0.1.0" }, { instructions: `${SERVER_INSTRUCTIONS} Connected as ${record.name || record.email} (${canEdit ? "can edit the bank" : "read only"}).` });
  registerTools(server, bank, !canEdit || !passcode);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close();
  }
};

export const config: Config = { path: "/api/mcp/*" };
