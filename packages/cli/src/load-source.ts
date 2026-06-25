// Load a Clipkit Source from a file. Supports .json and .ts/.tsx/.mts/.cts.
//
// For TypeScript files, we use jiti — a small runtime TS loader that
// understands ESM + CJS + TS and is fast enough for one-off CLI runs.
// The file MUST export the Source as either a default export or a named
// export called `source`, `video`, or `default`.

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JSON_EXTS = new Set(['.json']);
const JS_EXTS = new Set(['.js', '.mjs', '.cjs']);

const CANDIDATE_NAMED_EXPORTS = ['source', 'video', 'project', 'composition'] as const;

export async function loadSource(filePath: string): Promise<{
  path: string;
  source: unknown;
}> {
  const abs = resolvePath(process.cwd(), filePath);
  const ext = extname(abs).toLowerCase();

  if (JSON_EXTS.has(ext)) {
    const raw = await readFile(abs, 'utf8');
    return { path: abs, source: JSON.parse(raw) };
  }

  if (TS_EXTS.has(ext) || JS_EXTS.has(ext)) {
    const mod = await loadModule(abs);
    const source = pickSource(mod);
    if (source === undefined) {
      throw new Error(
        `${filePath}: no Clipkit Source found. Export it as ` +
          `\`default\` or one of: ${CANDIDATE_NAMED_EXPORTS.join(', ')}.`,
      );
    }
    return { path: abs, source };
  }

  throw new Error(
    `${filePath}: unsupported extension "${ext}". Expected one of: .json, .ts, .tsx, .mts, .cts, .js, .mjs, .cjs.`,
  );
}

async function loadModule(abs: string): Promise<Record<string, unknown>> {
  const ext = extname(abs).toLowerCase();
  if (TS_EXTS.has(ext)) {
    // Use jiti for TS — handles .ts in a Node process without a build step.
    const jiti = createJiti(pathToFileURL(abs).href, {
      interopDefault: true,
      cache: false,
    });
    const mod = (await jiti.import(abs, {})) as Record<string, unknown>;
    return mod;
  }
  // Plain JS — native dynamic import.
  return (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
}

function pickSource(mod: Record<string, unknown>): unknown {
  // Prefer a named export from our candidate list.
  for (const name of CANDIDATE_NAMED_EXPORTS) {
    if (mod[name] !== undefined) return mod[name];
  }
  // Fall back to `default`. With interopDefault: true this is unwrapped
  // if the file used `export default`.
  if (mod.default !== undefined) return mod.default;
  // Single named export — accept it.
  const keys = Object.keys(mod).filter((k) => k !== 'default');
  if (keys.length === 1) return mod[keys[0]!];
  return undefined;
}
