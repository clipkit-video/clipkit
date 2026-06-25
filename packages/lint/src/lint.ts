// Protocol-aware "soft" checks — things that pass schema validation but will
// surprise you at render time. Shared by the CLI (`explain`, `validate --explain`)
// and the MCP server (`validate_project`, `describe_project`).

import type { Source } from '@clipkit/protocol';

export interface LintWarning {
  /** Element id, or '(source)' for composition-level issues. */
  where: string;
  message: string;
}

// The runtime text/caption renderer uses a fixed ASCII coverage-font atlas;
// any non-ASCII glyph (emoji, accents, smart quotes, CJK) is silently dropped.
const NON_ASCII = /[^\x00-\x7F]/;

function firstNonAscii(s: string): string | null {
  const m = NON_ASCII.exec(s);
  return m ? m[0] : null;
}

export function lintSource(source: Source): LintWarning[] {
  const warnings: LintWarning[] = [];
  const comp = source as unknown as { duration?: number; elements?: unknown[] };
  const compDuration = typeof comp.duration === 'number' ? comp.duration : undefined;

  if (compDuration === undefined) {
    warnings.push({
      where: '(source)',
      message:
        "No top-level `duration` — the runtime can't tell how long the composition is. Set `duration` (seconds).",
    });
  }

  const elements = Array.isArray(comp.elements) ? comp.elements : [];
  for (const el of elements) {
    const e = el as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : `(${String(e.type ?? 'element')})`;
    const time = typeof e.time === 'number' ? e.time : 0;
    const dur = typeof e.duration === 'number' ? e.duration : undefined;

    // Runs past the composition's end → it'll be cut off.
    if (compDuration !== undefined && dur !== undefined && time + dur > compDuration + 1e-6) {
      warnings.push({
        where: id,
        message: `Ends at ${(time + dur).toFixed(2)}s, past the composition's ${compDuration}s — it'll be cut off.`,
      });
    }

    // Non-ASCII in text-bearing fields (dropped by the ASCII atlas).
    if (e.type === 'text') {
      const texts: string[] = [];
      if (typeof e.text === 'string') texts.push(e.text);
      if (Array.isArray(e.spans)) {
        for (const sp of e.spans) {
          const t = (sp as { text?: unknown })?.text;
          if (typeof t === 'string') texts.push(t);
        }
      }
      for (const t of texts) {
        const ch = firstNonAscii(t);
        if (ch) {
          warnings.push({
            where: id,
            message: `Text has a non-ASCII character ("${ch}") — the runtime's ASCII font atlas drops these (emoji, accents, smart quotes, CJK). Use plain ASCII.`,
          });
          break;
        }
      }
    }
    if (e.type === 'caption' && Array.isArray(e.words)) {
      for (const w of e.words) {
        const t = (w as { text?: unknown })?.text;
        if (typeof t === 'string') {
          const ch = firstNonAscii(t);
          if (ch) {
            warnings.push({
              where: id,
              message: `Caption word has a non-ASCII character ("${ch}") — dropped by the runtime's ASCII atlas.`,
            });
            break;
          }
        }
      }
    }
  }

  return warnings;
}
