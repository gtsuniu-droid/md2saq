#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BankClient } from "./client.js";
import { loadConfig } from "./config.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerTools } from "./tools.js";

const VERSION = "0.1.0";

async function main() {
  const config = loadConfig();
  const bank = new BankClient(config);
  const server = new McpServer({ name: "saq-mcp", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, bank, config.readOnly);
  // stdout carries the protocol; everything human goes to stderr.
  await server.connect(new StdioServerTransport());
  const mode = config.readOnly ? "read-only" : config.passcode ? "read and write" : "read-only (no SAQ_PASSCODE)";
  console.error(`saq-mcp ${VERSION} connected to ${config.siteUrl} (${mode})`);
}

main().catch((error) => {
  console.error(`saq-mcp failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
