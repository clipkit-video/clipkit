// `clipkit preview <file>` — open a Source in the Clipkit web editor.
//
// Validates the Source, POSTs it to /api/projects, and opens the returned
// /editor?id=… link in your browser (it's a real, shareable link — copy it,
// send it, embed it). Keyless: with no API key the link is anonymous and
// expires in 7 days; with one (clipkit login / CLIPKIT_API_KEY) it's owned by
// your team and permanent on paid plans. This is the CLI twin of the MCP
// `share_video` tool — a live, editable preview with zero local setup (no
// Chrome, no render, no credits — the editor renders it in the browser).

import { Command } from 'commander';
import { validate } from '@clipkit/protocol';
import { loadSource } from '../load-source.js';
import { resolveApiKey, resolveApiUrl } from '../config.js';
import { openUrl, printValidationErrors } from '../util.js';

export function previewCommand(program: Command): void {
  program
    .command('preview <file>')
    .description('Open a Source in the web editor (creates a shareable link)')
    .option('--no-open', "just print the link, don't open a browser")
    .option('--api-key <key>', 'API key (defaults to login / CLIPKIT_API_KEY)')
    .option('--api-url <url>', 'override the API host')
    .action(
      async (
        file: string,
        opts: { open: boolean; apiKey?: string; apiUrl?: string },
      ) => {
        const { path, source } = await loadSource(file);
        const result = validate(source);
        if (!result.valid) {
          printValidationErrors(path, result.errors);
          process.exit(1);
        }

        const apiUrl = await resolveApiUrl(opts.apiUrl);
        const apiKey = await resolveApiKey(opts.apiKey);
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;

        let res: Response;
        try {
          res = await fetch(`${apiUrl}/api/projects`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ source: result.data }),
          });
        } catch (e) {
          process.stderr.write(
            `✗ Could not reach ${apiUrl}: ${e instanceof Error ? e.message : String(e)}\n`,
          );
          process.exit(1);
        }

        if (res.status === 429) {
          process.stderr.write(
            '✗ Rate limited — wait a minute and try again (logging in raises the limit).\n',
          );
          process.exit(1);
        }
        if (res.status === 413) {
          process.stderr.write('✗ Source too large (2 MB max).\n');
          process.exit(1);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          process.stderr.write(`✗ Preview failed (${res.status}). ${body.slice(0, 300)}\n`);
          process.exit(1);
        }

        const data = (await res.json()) as { url?: string; id?: string };
        if (!data.url) {
          process.stderr.write('✗ Share API returned no URL.\n');
          process.exit(1);
        }

        const scope = apiKey ? 'team-owned' : 'anonymous, expires in 7 days';
        process.stdout.write(`✓ Preview ready (${scope}):\n\n${data.url}\n`);
        if (opts.open) openUrl(data.url);
      },
    );
}
