// `clipkit mcp` — run the Clipkit MCP server over stdio, so any agent (Claude
// Desktop, Cursor, Cline, …) gets the full Clipkit toolset from one command:
//
//   { "command": "npx", "args": ["-y", "@clipkit/cli", "mcp"] }
//
// The server speaks JSON-RPC on stdin/stdout, so this command must keep stdout
// clean — we import the package's `/stdio` entry, whose module self-starts: it
// connects a StdioServerTransport and takes over the stream. (The bare
// `@clipkit/mcp-server` entry is the library build and does NOT self-start.)
// Diagnostics (incl. the server's "ready" line) go to stderr.

import { Command } from 'commander';

export function mcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the Clipkit MCP server over stdio (wire up an AI agent)')
    .action(async () => {
      try {
        await import('@clipkit/mcp-server/stdio');
      } catch (e) {
        process.stderr.write(
          `✗ Could not start the MCP server: ${e instanceof Error ? e.message : String(e)}\n` +
            '  Install it alongside the CLI:  npm i -g @clipkit/mcp-server\n',
        );
        process.exit(1);
      }
    });
}
