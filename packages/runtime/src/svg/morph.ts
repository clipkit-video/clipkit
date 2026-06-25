// Path morphing (§5.6.2) — interpolate two SVG d-strings.
//
// STRICT compatibility, no path normalization: both strings must have
// the identical command-letter sequence with equal argument counts and
// contain no arc commands (A/a — their boolean flags don't lerp).
// Compatible pairs lerp every numeric argument; incompatible pairs
// snap (the caller holds the source until the destination keyframe).

const TOKEN = /([MLHVCSQTZmlhvcsqtz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

interface ParsedD {
  /** Command letters in order. */
  skeleton: string;
  /** All numeric arguments in order. */
  numbers: number[];
  /** Token layout: for rebuilding — 'C' for command, index into numbers otherwise. */
  layout: Array<string | number>;
}

const parseCache = new Map<string, ParsedD | null>();

function parseD(d: string): ParsedD | null {
  const hit = parseCache.get(d);
  if (hit !== undefined) return hit;
  if (parseCache.size > 256) parseCache.clear();
  if (/[Aa]/.test(d)) {
    parseCache.set(d, null);
    return null;
  }
  const skeleton: string[] = [];
  const numbers: number[] = [];
  const layout: Array<string | number> = [];
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(d)) !== null) {
    if (m[1]) {
      skeleton.push(m[1]);
      layout.push(m[1]);
    } else {
      layout.push(numbers.length);
      numbers.push(parseFloat(m[2]!));
    }
  }
  const parsed: ParsedD = { skeleton: skeleton.join(''), numbers, layout };
  parseCache.set(d, parsed);
  return parsed;
}

/**
 * Interpolate from `a` to `b` at eased progress u ∈ [0, 1]. Returns
 * null when the pair is incompatible (caller snaps instead).
 */
export function morphD(a: string, b: string, u: number): string | null {
  const pa = parseD(a);
  const pb = parseD(b);
  if (!pa || !pb) return null;
  if (pa.skeleton !== pb.skeleton || pa.numbers.length !== pb.numbers.length) return null;
  const out: string[] = [];
  for (const tok of pa.layout) {
    if (typeof tok === 'string') {
      out.push(tok);
    } else {
      const v = pa.numbers[tok]! + (pb.numbers[tok]! - pa.numbers[tok]!) * u;
      out.push(String(Math.round(v * 1000) / 1000));
    }
  }
  return out.join(' ');
}
