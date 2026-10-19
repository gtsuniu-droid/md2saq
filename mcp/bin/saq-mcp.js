#!/usr/bin/env node
// Launcher for the SAQ Practice MCP server. Runs over STDIO, the transport
// Claude Desktop, Claude Code, Cursor and similar clients use for local servers.
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`Node.js ${process.versions.node} is too old: saq-mcp needs Node 20 or newer.`);
  process.exit(1);
}
import("../dist/index.js");
