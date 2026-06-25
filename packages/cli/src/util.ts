// Small shared helpers for the CLI commands.

import { spawn } from 'node:child_process';

/** Structural shape of a @clipkit/protocol validation error. */
export interface ValidationIssue {
  path: ReadonlyArray<string | number>;
  message: string;
}

/** Print a validation failure to stderr in the standard CLI format. */
export function printValidationErrors(
  path: string,
  errors: ReadonlyArray<ValidationIssue>,
): void {
  process.stderr.write(
    `✗ ${path} failed validation (${errors.length} error${errors.length === 1 ? '' : 's'}):\n`,
  );
  for (const err of errors) {
    const at = err.path.length > 0 ? err.path.join('.') : '(root)';
    process.stderr.write(`  - ${at}: ${err.message}\n`);
  }
}

/**
 * Open a URL in the user's default browser. Best-effort and non-blocking;
 * never throws (a headless box just won't have a browser, and the caller has
 * already printed the URL as a fallback).
 */
export function openUrl(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* no browser available */
  }
}

/** Human-readable byte size. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
