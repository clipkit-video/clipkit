#!/usr/bin/env node
// CLI entry for @clipkit/mcp-server.
//
// Starts an MCP server over stdio. The agent process (Claude Desktop,
// Cursor, etc.) spawns this binary, communicates via JSON-RPC on
// stdin/stdout, and we never write to stdout ourselves — diagnostic
// output goes to stderr.
//
// This is the stdio bin. Importing the package (`@clipkit/mcp-server`) resolves
// to the library entry (lib.ts) — the building blocks for hosting the server
// behind an HTTP route — WITHOUT this stdio bootstrap.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryProjectStore } from './project-store.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { SERVER_INFO, SERVER_CAPABILITIES, SERVER_INSTRUCTIONS } from './server-config.js';

async function main(): Promise<void> {
  const server = new McpServer(SERVER_INFO, {
    capabilities: SERVER_CAPABILITIES,
    instructions: SERVER_INSTRUCTIONS,
  });

  // Local stdio: one in-memory project per process. project_id is optional and
  // defaults to this single "current" project. (A hosted, sessionless server
  // injects a Supabase-backed store and requires explicit project_ids instead.)
  const store = new InMemoryProjectStore();
  registerTools(server, store);
  registerResources(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write('[clipkit-mcp] ready (tools + resources)\n');
}

main().catch((err) => {
  process.stderr.write(
    `[clipkit-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
