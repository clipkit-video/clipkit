// A plain-language read-back of a Source so a human or an agent can sanity-check
// what was authored WITHOUT rendering: dimensions, fps, duration, a per-track
// timeline, an element breakdown, plus the protocol-aware warnings from lint.ts.
// The fast inner loop of an author→verify→fix cycle.

import type { Source } from '@clipkit/protocol';
import { lintSource } from './lint.js';

export function describe(s: Source): string {
  const c = s as unknown as {
    width?: number;
    height?: number;
    frame_rate?: number;
    duration?: number;
    output_format?: string;
    background_color?: string;
    elements?: Array<Record<string, unknown>>;
  };
  const out: string[] = [];

  out.push(
    `${c.width ?? '?'}×${c.height ?? '?'} · ${c.frame_rate ?? '?'}fps · ${c.duration ?? '?'}s · ${c.output_format ?? 'mp4'}` +
      (c.background_color ? ` · bg ${c.background_color}` : ''),
  );

  const els = c.elements ?? [];
  const byType = new Map<string, number>();
  for (const e of els) {
    const t = String(e.type ?? 'unknown');
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  out.push(
    `${els.length} element${els.length === 1 ? '' : 's'}` +
      (byType.size ? `  (${[...byType].map(([t, n]) => `${n} ${t}`).join(', ')})` : ''),
  );

  // Timeline grouped by layer, each layer ordered by start time.
  const layers = new Map<number, Array<Record<string, unknown>>>();
  for (const e of els) {
    const ly = typeof e.layer === 'number' ? e.layer : 0;
    if (!layers.has(ly)) layers.set(ly, []);
    layers.get(ly)!.push(e);
  }
  if (layers.size) {
    out.push('');
    out.push('Timeline (by layer, 1 = top/front):');
    for (const ly of [...layers.keys()].sort((a, b) => a - b)) {
      out.push(`  layer ${ly}`);
      const items = layers
        .get(ly)!
        .slice()
        .sort((a, b) => num(a.time) - num(b.time));
      for (const e of items) {
        const t = num(e.time);
        const d = typeof e.duration === 'number' ? e.duration : undefined;
        const span = d !== undefined ? `${t.toFixed(2)}–${(t + d).toFixed(2)}s` : `${t.toFixed(2)}s →`;
        const label = e.id ? `${String(e.type)} #${String(e.id)}` : String(e.type);
        out.push(`    ${span.padEnd(16)} ${label}${textPreview(e)}`);
      }
    }
  }

  const warnings = lintSource(s);
  out.push('');
  if (warnings.length === 0) {
    out.push('✓ No warnings.');
  } else {
    out.push(`⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
    for (const w of warnings) out.push(`  - ${w.where}: ${w.message}`);
  }

  return out.join('\n') + '\n';
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function textPreview(e: Record<string, unknown>): string {
  if (e.type === 'text' && typeof e.text === 'string' && e.text.length) {
    const t = e.text.length > 32 ? `${e.text.slice(0, 32)}…` : e.text;
    return `  "${t}"`;
  }
  return '';
}
