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

  // ── Depth-recursive checks (groups included) ──────────────────────────
  const registered = new Set<string>();
  const fonts = (source as unknown as { fonts?: { family?: unknown }[] }).fonts;
  if (Array.isArray(fonts)) {
    for (const f of fonts) if (typeof f?.family === 'string') registered.add(f.family.trim().toLowerCase());
  }
  walkElements(elements, warnings, registered);

  return warnings;
}

// Generic families + fonts safely present on the render image / typical hosts.
const SAFE_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'arial', 'helvetica', 'helvetica neue', 'georgia', 'times', 'times new roman',
  'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'impact',
  'menlo', 'monaco', 'sf mono', 'sf pro', 'sf pro display', 'sf pro text',
  'avenir', 'avenir next', 'futura', 'gill sans', 'palatino', 'baskerville',
  'american typewriter', 'didot', 'optima', 'copperplate',
]);

function fontStackResolves(family: string, registered: Set<string>): boolean {
  return family
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .some((t) => t.length > 0 && (registered.has(t) || SAFE_FONTS.has(t)));
}

function walkElements(
  elements: unknown[],
  warnings: LintWarning[],
  registered: Set<string>,
): void {
  for (const el of elements) {
    const e = el as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : `(${String(e.type ?? 'element')})`;

    // Text animation presets don't run on the masked/stroked single-quad path.
    if (
      e.type === 'text' &&
      Array.isArray(e.animations) && e.animations.length > 0 &&
      (e.mask !== undefined ||
        e.stroke_gradient !== undefined ||
        (typeof e.stroke_width === 'number' && e.stroke_width > 0))
    ) {
      warnings.push({
        where: id,
        message:
          'Text `animations` presets do not run when the element also has `mask`, `stroke_width`, or ' +
          '`stroke_gradient` (those render as a single static quad). Drop the mask/stroke, or animate ' +
          'with keyframes/`keyframe_animations` instead.',
      });
    }

    // rotation and z_rotation share one slot — authoring both is ambiguous.
    if (e.rotation !== undefined && e.z_rotation !== undefined) {
      warnings.push({
        where: id,
        message:
          'Both `rotation` and `z_rotation` are set — they are the same in-plane slot and one silently ' +
          'wins. Author exactly one.',
      });
    }

    // Unregistered, non-system fonts fall back silently at render time.
    const families: string[] = [];
    if (typeof e.font_family === 'string') families.push(e.font_family);
    if (Array.isArray(e.spans)) {
      for (const sp of e.spans) {
        const f = (sp as { font_family?: unknown })?.font_family;
        if (typeof f === 'string') families.push(f);
      }
    }
    for (const family of families) {
      if (!fontStackResolves(family, registered)) {
        warnings.push({
          where: id,
          message:
            `Font "${family}" is not registered in \`fonts[]\` and has no system-safe fallback in its ` +
            'stack — the renderer will silently substitute the browser default. Register the font face ' +
            'or add a generic fallback (e.g. ", sans-serif").',
        });
        break;
      }
    }

    if (Array.isArray(e.elements)) walkElements(e.elements, warnings, registered);
    const mask = e.mask as { elements?: unknown[] } | undefined;
    if (mask && Array.isArray(mask.elements)) walkElements(mask.elements, warnings, registered);
  }
}
