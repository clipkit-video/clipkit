// Suggest the closest valid key for a mistyped one. Targets the dominant LLM
// mistake — camelCase vs the protocol's snake_case — via a NORMALIZED match
// (case- and underscore-insensitive), plus 1-char typos via edit distance.
// Conservative: returns nothing unless a candidate is clearly close, so it never
// invents a misleading "did you mean".

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_-]/g, '');
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

export function suggest(bad: string, candidates: readonly string[]): string | undefined {
  if (bad.length < 3) return undefined;
  const nb = normalize(bad);
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c === bad) continue;
    const score = normalize(c) === nb ? 0 : editDistance(nb, normalize(c));
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (bestScore === 0) return best; // normalized-exact: camelCase ↔ snake_case
  if (bestScore === 1 && nb.length >= 4) return best; // a single-char typo
  return undefined;
}

/** ` (did you mean X?)` if a close valid key exists, else ''. */
export function hint(bad: string, candidates: readonly string[]): string {
  const s = suggest(bad, candidates);
  return s ? ` (did you mean ${s}?)` : '';
}
