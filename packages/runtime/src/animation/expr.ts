// Tier-A expression evaluator (CKP/1.0 — see EXPRESSIONS-PLAN.md / PROTOCOL.md).
//
// A numeric property may be `{ expr: "<formula>" }` — a PURE function of the
// element's local time `t` and its own index/params (`i`, `n`, `dur`, `value`).
// No element references, no runtime inputs: it is deterministic across renderers,
// bakeable to keyframes, and GPU-shaped.
//
// This is a real sandbox — a tokenizer + Pratt parser + tree-walk evaluator,
// NOT eval()/Function(). It accepts ONLY the closed grammar below; an unknown
// identifier, member access, assignment, statement, or string is a parse error,
// and the caller falls back to the property's base value. There are no host
// objects in scope and no loops, so evaluation is bounded and non-recursive.

import { EXPR_VOCABULARY } from '@clipkit/protocol';
import { noise1d, hash01 } from './noise1d.js';

export interface ExprScope {
  /** element-local time, seconds */ t: number;
  /** element duration, seconds */ dur: number;
  /** index within a generated set */ i: number;
  /** sibling count */ n: number;
  /** the property's base/static value */ value: number;
}

// ── AST ──────────────────────────────────────────────────────────────────────
type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

const CONSTS = { PI: Math.PI, TAU: Math.PI * 2, E: Math.E } satisfies Record<string, number>;
// The variable set is the protocol vocabulary verbatim (single source of truth).
const VARS = new Set<string>(EXPR_VOCABULARY.vars);

// Native functions: (args, scope) → number. Pure; `wiggle` reads scope.t.
const FNS = {
  sin: (a) => Math.sin(a[0]!), cos: (a) => Math.cos(a[0]!), tan: (a) => Math.tan(a[0]!),
  asin: (a) => Math.asin(a[0]!), acos: (a) => Math.acos(a[0]!), atan: (a) => Math.atan(a[0]!),
  atan2: (a) => Math.atan2(a[0]!, a[1]!), sinh: (a) => Math.sinh(a[0]!), cosh: (a) => Math.cosh(a[0]!), tanh: (a) => Math.tanh(a[0]!),
  abs: (a) => Math.abs(a[0]!), sign: (a) => Math.sign(a[0]!), sqrt: (a) => Math.sqrt(a[0]!), cbrt: (a) => Math.cbrt(a[0]!),
  pow: (a) => Math.pow(a[0]!, a[1]!), exp: (a) => Math.exp(a[0]!), log: (a) => Math.log(a[0]!), log2: (a) => Math.log2(a[0]!),
  floor: (a) => Math.floor(a[0]!), ceil: (a) => Math.ceil(a[0]!), round: (a) => Math.round(a[0]!), trunc: (a) => Math.trunc(a[0]!),
  fract: (a) => a[0]! - Math.floor(a[0]!), hypot: (a) => Math.hypot(...a),
  min: (a) => Math.min(...a), max: (a) => Math.max(...a), mod: (a) => ((a[0]! % a[1]!) + a[1]!) % a[1]!,
  clamp: (a) => Math.min(Math.max(a[0]!, a[1]!), a[2]!),
  lerp: (a) => a[0]! + (a[1]! - a[0]!) * a[2]!,
  mix: (a) => a[0]! + (a[1]! - a[0]!) * a[2]!,
  step: (a) => (a[1]! < a[0]! ? 0 : 1),
  smoothstep: (a) => { const u = Math.min(Math.max((a[2]! - a[0]!) / (a[1]! - a[0]!), 0), 1); return u * u * (3 - 2 * u); },
  // map x∈[x0,x1] → [y0,y1], clamped (linear) / cubic in-out (ease)
  linear: (a) => { const u = clamp01((a[0]! - a[1]!) / (a[2]! - a[1]!)); return a[3]! + (a[4]! - a[3]!) * u; },
  ease: (a) => { const u = clamp01((a[0]! - a[1]!) / (a[2]! - a[1]!)); const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; return a[3]! + (a[4]! - a[3]!) * e; },
  noise: (a) => 2 * noise1d(a[0]!, a[1] ?? 0) - 1,
  wiggle: (a, s) => (a[1] ?? 0) * (2 * noise1d(s.t * (a[0] ?? 0), a[2] ?? 0) - 1),
  random: (a) => hash01(a[0] ?? 0),
} satisfies Record<string, (a: number[], s: ExprScope) => number>;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

// ── drift lock (compile-time) ──────────────────────────────────────────────────
// The evaluator MUST implement exactly the protocol's published vocabulary — no
// missing or extra functions, constants, or variables — so the schema
// `.describe()`, the docs, and these tables can never disagree about what a
// Tier-A expression may contain. Each `_Missing*`/`_Extra*` is `never` only when
// its two sets match; any mismatch makes the union non-`never` and fails the
// assignment below at build time.
type _MissingFns = Exclude<(typeof EXPR_VOCABULARY.functions)[number], keyof typeof FNS>;
type _ExtraFns = Exclude<keyof typeof FNS, (typeof EXPR_VOCABULARY.functions)[number]>;
type _MissingConsts = Exclude<(typeof EXPR_VOCABULARY.consts)[number], keyof typeof CONSTS>;
type _MissingVars = Exclude<(typeof EXPR_VOCABULARY.vars)[number], keyof ExprScope>;
type _ExtraVars = Exclude<keyof ExprScope, (typeof EXPR_VOCABULARY.vars)[number]>;
const _exprVocabularyLock: [
  _MissingFns | _ExtraFns | _MissingConsts | _MissingVars | _ExtraVars,
] extends [never]
  ? true
  : ['EXPR_VOCABULARY drift — runtime FNS/CONSTS/scope must match the protocol vocabulary'] = true;
void _exprVocabularyLock;

// String-keyed views for eval-time lookup — the parser has already validated
// every name against the closed vocabulary, so these accesses are total.
const FN_TABLE = FNS as Record<string, (a: number[], s: ExprScope) => number>;
const CONST_TABLE = CONSTS as Record<string, number>;

// ── tokenizer ────────────────────────────────────────────────────────────────
type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };
function lex(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) return null; out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%^()<>!?:,'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    return null; // illegal character
  }
  return out;
}

// ── Pratt parser ─────────────────────────────────────────────────────────────
// binding powers for binary operators (higher = tighter)
const BP: Record<string, number> = {
  '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5,
  '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 9,
};
function parse(toks: Tok[]): Node | null {
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];
  function primary(): Node | null {
    const tk = peek(); if (!tk) return null;
    if (tk.t === 'num') { eat(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '!')) { eat(); const a = unary(); return a && { k: 'un', op: tk.v, a }; }
    if (tk.t === 'op' && tk.v === '(') { eat(); const e = expr(0); if (!e || (eat() as Tok)?.v !== ')') return null; return e; }
    if (tk.t === 'id') {
      eat();
      if (peek()?.t === 'op' && peek()?.v === '(') { // function call
        eat(); const args: Node[] = [];
        if (!(peek()?.t === 'op' && peek()?.v === ')')) {
          for (;;) { const a = expr(0); if (!a) return null; args.push(a); const s = peek(); if (s?.v === ',') { eat(); continue; } break; }
        }
        if ((eat() as Tok)?.v !== ')') return null;
        if (!(tk.v in FNS)) return null; // unknown function → reject
        return { k: 'call', name: tk.v, args };
      }
      if (tk.v in CONSTS || VARS.has(tk.v)) return { k: 'var', name: tk.v };
      return null; // unknown identifier → reject
    }
    return null;
  }
  function unary(): Node | null { return primary(); }
  function expr(min: number): Node | null {
    let left = unary(); if (!left) return null;
    for (;;) {
      const tk = peek();
      if (tk?.t === 'op' && tk.v === '?') { // ternary (lowest, right-assoc)
        if (min > 1) break; eat();
        const a = expr(0); if (!a || (eat() as Tok)?.v !== ':') return null;
        const b = expr(1); if (!b) return null; left = { k: 'tern', c: left, a, b }; continue;
      }
      if (tk?.t !== 'op' || !(tk.v in BP) || BP[tk.v]! < min) break;
      eat(); const rbp = tk.v === '^' ? BP[tk.v]! : BP[tk.v]! + 1; // ^ right-assoc
      const right = expr(rbp); if (!right) return null;
      left = { k: 'bin', op: tk.v, a: left, b: right };
    }
    return left;
  }
  const root = expr(0);
  return root && p === toks.length ? root : null;
}

// ── evaluate ─────────────────────────────────────────────────────────────────
function evalNode(node: Node, s: ExprScope): number {
  switch (node.k) {
    case 'num': return node.v;
    case 'var': return node.name in CONST_TABLE ? CONST_TABLE[node.name]! : (s as unknown as Record<string, number>)[node.name]!;
    case 'un': return node.op === '-' ? -evalNode(node.a, s) : evalNode(node.a, s) === 0 ? 1 : 0;
    case 'tern': return evalNode(node.c, s) !== 0 ? evalNode(node.a, s) : evalNode(node.b, s);
    case 'call': return FN_TABLE[node.name]!(node.args.map((a) => evalNode(a, s)), s);
    case 'bin': {
      const a = evalNode(node.a, s);
      if (node.op === '&&') return a !== 0 && evalNode(node.b, s) !== 0 ? 1 : 0;
      if (node.op === '||') return a !== 0 || evalNode(node.b, s) !== 0 ? 1 : 0;
      const b = evalNode(node.b, s);
      switch (node.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': return a / b; case '%': return a % b; case '^': return Math.pow(a, b);
        case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
      }
      return NaN;
    }
  }
}

// compile-once cache; null = parse error (poisoned so we don't retry)
const CACHE = new Map<string, Node | null>();
export function compileExpr(src: string): Node | null {
  if (CACHE.has(src)) return CACHE.get(src)!;
  const toks = lex(src);
  const ast = toks ? parse(toks) : null;
  CACHE.set(src, ast);
  return ast;
}

/** True when a property value is an expression object `{ expr: string }`. */
export function isExpr(v: unknown): v is { expr: string } {
  return typeof v === 'object' && v !== null && typeof (v as { expr?: unknown }).expr === 'string';
}

/** Evaluate `{expr}` in the given scope; returns NaN-guarded `scope.value` on
 *  parse error or non-finite result. */
export function evalExpr(value: { expr: string }, scope: ExprScope): number {
  const ast = compileExpr(value.expr);
  if (!ast) return scope.value;
  const r = evalNode(ast, scope);
  return Number.isFinite(r) ? r : scope.value;
}
