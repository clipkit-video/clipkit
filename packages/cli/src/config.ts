// Persistent CLI config — the API key (and optional API host) used by the
// cloud commands (`render --cloud`, and team-owned `share`). Stored at
// $XDG_CONFIG_HOME/clipkit/config.json (falls back to ~/.config/clipkit),
// chmod 0600 so the key isn't world-readable.
//
// Resolution order for both key and host: explicit flag → environment
// variable → config file → built-in default. The env vars (CLIPKIT_API_KEY /
// CLIPKIT_API_URL) are the same ones the MCP server reads, so a machine wired
// up for one is wired up for both.

import { readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_API_URL = 'https://clipkit.dev';

export interface Config {
  apiKey?: string;
  /** Non-default API host, persisted only when the user overrides it. */
  apiUrl?: string;
}

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'clipkit');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export async function readConfig(): Promise<Config> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Config) : {};
  } catch {
    // Missing or unreadable file → empty config (the common first-run case).
    return {};
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  const path = configPath();
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  // Best-effort lock-down; filesystems that ignore mode bits (Windows) just won't.
  await chmod(path, 0o600).catch(() => {});
}

export async function clearConfig(): Promise<void> {
  await rm(configPath(), { force: true });
}

// ── Resolution: flag → env → config file → default ──────────────────────────

export async function resolveApiKey(flag?: string): Promise<string | undefined> {
  if (flag?.trim()) return flag.trim();
  const env = process.env.CLIPKIT_API_KEY?.trim();
  if (env) return env;
  return (await readConfig()).apiKey;
}

export async function resolveApiUrl(flag?: string): Promise<string> {
  const pick =
    flag?.trim() ||
    process.env.CLIPKIT_API_URL?.trim() ||
    (await readConfig()).apiUrl ||
    DEFAULT_API_URL;
  return pick.replace(/\/+$/, '');
}
