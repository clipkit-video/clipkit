// `clipkit login` stores an API key for the cloud commands; `clipkit logout`
// removes it. Auth reuses the dashboard `ck_live_…` / `ck_test_…` keys the API
// already accepts (see verify-key.ts) — there's no separate CLI token system.
//
// Flow: open <host>/keys in a browser, paste the key, store it (chmod 0600)
// after a cheap liveness check. The check needs no dedicated endpoint: an
// authed GET of a non-existent render returns 401 for a bad/unknown key and
// 404 for a good one, so 401 ⇒ reject, anything else ⇒ accept.

import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  readConfig,
  writeConfig,
  clearConfig,
  configPath,
  resolveApiUrl,
} from '../config.js';
import { openUrl } from '../util.js';

const KEY_RE = /^ck_(?:live|test)_[A-Za-z0-9_-]+$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// 'ok' | 'bad' | 'unknown' — 'unknown' means we couldn't reach the host, so we
// store the key anyway rather than block login on a flaky network.
async function checkKey(apiUrl: string, key: string): Promise<'ok' | 'bad' | 'unknown'> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/renders/${ZERO_UUID}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    return res.status === 401 ? 'bad' : 'ok';
  } catch {
    return 'unknown';
  }
}

export function loginCommand(program: Command): void {
  program
    .command('login')
    .description('Store an API key for cloud commands (render --cloud, team previews)')
    .option('--api-key <key>', 'set the key non-interactively (CI-friendly)')
    .option('--api-url <url>', 'override the API host (e.g. http://localhost:3000)')
    .action(async (opts: { apiKey?: string; apiUrl?: string }) => {
      const apiUrl = await resolveApiUrl(opts.apiUrl);
      let key = opts.apiKey?.trim();

      if (!key) {
        const keysUrl = `${apiUrl}/keys`;
        process.stdout.write(
          `Create an API key here (opening your browser):\n  ${keysUrl}\n\n`,
        );
        openUrl(keysUrl);
        const rl = createInterface({ input: stdin, output: stdout });
        try {
          key = (await rl.question('Paste your key (ck_live_… or ck_test_…): ')).trim();
        } finally {
          rl.close();
        }
      }

      if (!key || !KEY_RE.test(key)) {
        process.stderr.write(
          '✗ That doesn’t look like a Clipkit API key (expected ck_live_… or ck_test_…).\n',
        );
        process.exit(1);
      }

      const status = await checkKey(apiUrl, key);
      if (status === 'bad') {
        process.stderr.write(
          '✗ That key was rejected by the API. Check you copied it whole and it isn’t revoked.\n',
        );
        process.exit(1);
      }

      const next = await readConfig();
      next.apiKey = key;
      // Persist a non-default host so the file stays portable across machines.
      if (opts.apiUrl) next.apiUrl = apiUrl;
      await writeConfig(next);

      const masked = `${key.slice(0, 11)}…${key.slice(-4)}`;
      process.stdout.write(
        `✓ Logged in${status === 'unknown' ? ' (couldn’t reach the API to verify — key stored anyway)' : ''}.\n` +
          `  key:  ${masked}\n` +
          `  host: ${apiUrl}\n` +
          `  file: ${configPath()}\n\n` +
          `Try it: clipkit render <file> --cloud\n`,
      );
    });

  program
    .command('logout')
    .description('Remove the stored API key')
    .action(async () => {
      const cfg = await readConfig();
      if (!cfg.apiKey) {
        process.stdout.write('Already logged out.\n');
        return;
      }
      delete cfg.apiKey;
      if (Object.keys(cfg).length === 0) await clearConfig();
      else await writeConfig(cfg);
      process.stdout.write('✓ Logged out — removed the stored key.\n');
    });
}
