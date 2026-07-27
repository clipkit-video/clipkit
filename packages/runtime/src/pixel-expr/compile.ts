// Pixel-Expr compiler (Tier B — see SHADER-EXTENSION-PLAN.md).
//
// Pixel-Expr is `Expr` (animation/expr.ts) lifted from scalar/CPU to
// vec4/GPU: the SAME grammar and function vocabulary, EXTENDED with
// vectors, swizzles, and the per-pixel inputs `uv`/`t`/`resolution`/
// `aspect`. A program is a single expression that evaluates to a color;
// we type-check it and codegen to GLSL ES 3.0 AND WGSL from one AST so
// both backends render identically (determinism is enforced by the
// closed grammar + fixed stdlib, not by trusting the author).
//
// This is the LANGUAGE only — parse → type → emit. The backend draw path
// (compile + run the emitted shader) and the `pixel_shader` effect wire
// it into the runtime separately.

export type PxType = 'float' | 'vec2' | 'vec3' | 'vec4';
const SIZE: Record<PxType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const BY_SIZE: PxType[] = ['float', 'float', 'vec2', 'vec3', 'vec4'];

type Target = 'glsl' | 'wgsl';

// Set per-compile: whether `backdrop()` is allowed (the effect declared
// reads_backdrop). JS is single-threaded, so a module flag is safe here.
let allowBackdrop = false;
// Set per-compile: did the program reference `coverage`? If so, the runtime
// softens (blurs) the element mask so edges ramp instead of cutting.
let usedCoverage = false;
// Set per-compile: declared param name → packed index (0..15). Params are
// dynamic float knobs, packed into u_params (4 vec4s) so the uniform layout
// stays fixed across shaders.
let paramIndex: Record<string, number> = {};
// Per-target `fold` state: hoisted loop statements (a fold compiles to a real
// for-loop, not an inline expression), a unique-name counter, the acc/i scope
// inside a fold body, and a flag rejecting nested folds (a flat statement
// buffer can't place an inner loop inside an outer one).
let emitStmts: string[] = [];
let foldCounter = 0;
let foldScope: Record<string, { code: string; type: PxType }> = {};
let foldActive = false;
// Set per-compile: declared texture name → slot (0..3). Image inputs the
// program samples via `texture(name, uv)`; slots map to fixed sampler bindings.
let textureIndex: Record<string, number> = {};

// ── inputs / constants ──────────────────────────────────────────────────────
// Per-pixel inputs in scope, with their codegen per target. Uniform names
// (uTime, uResolution) and the v_uv varying are the contract the backend
// draw path must satisfy.
const INPUTS: Record<string, { type: PxType; glsl: string; wgsl: string }> = {
  uv: { type: 'vec2', glsl: 'v_uv', wgsl: 'in.uv' },
  t: { type: 'float', glsl: 'uTime', wgsl: 'u.time' },
  resolution: { type: 'vec2', glsl: 'uResolution', wgsl: 'u.resolution' },
  aspect: { type: 'float', glsl: '(uResolution.x / uResolution.y)', wgsl: '(u.resolution.x / u.resolution.y)' },
  // The element's own coverage (alpha) at this pixel. The runtime SOFTENS it
  // (binds a blurred mask) when a program uses it, so backdrop effects can ramp
  // displacement to zero at the element edge — no hard seam. ~1 deep inside,
  // 0 outside, smooth across the rim.
  coverage: { type: 'float', glsl: 'texture(u_src, v_uv).a', wgsl: 'textureSample(srcTex, samp, in.uv).a' },
};
const CONSTS: Record<string, number> = { PI: Math.PI, TAU: Math.PI * 2, E: Math.E };

// ── AST ─────────────────────────────────────────────────────────────────────
type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'swiz'; a: Node; comps: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'fold'; count: number; init: Node; body: Node }
  | { k: 'tex'; slot: number; uv: Node };

// ── tokenizer (Expr's lexer + the `.` member operator) ──────────────────────
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
    if ('+-*/%^()<>!?:,.=;'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    return null;
  }
  return out;
}

// ── Pratt parser (Expr's, + postfix `.swizzle`) ─────────────────────────────
const BP: Record<string, number> = {
  '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5,
  '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 9,
};
const SWIZ = /^[xyzwrgba]{1,4}$/;

class ParseError extends Error {}

// Substitute `var` nodes by name. Used to inline `def` calls and to build
// central-difference normals — every arg/body is a pure AST, so substitution
// is semantics-preserving.
function subst(node: Node, m: Record<string, Node>): Node {
  switch (node.k) {
    case 'num': return node;
    case 'var': return m[node.name] ?? node;
    case 'swiz': return { k: 'swiz', a: subst(node.a, m), comps: node.comps };
    case 'un': return { k: 'un', op: node.op, a: subst(node.a, m) };
    case 'bin': return { k: 'bin', op: node.op, a: subst(node.a, m), b: subst(node.b, m) };
    case 'tern': return { k: 'tern', c: subst(node.c, m), a: subst(node.a, m), b: subst(node.b, m) };
    case 'call': return { k: 'call', name: node.name, args: node.args.map((a) => subst(a, m)) };
    case 'fold': return { k: 'fold', count: node.count, init: subst(node.init, m), body: subst(node.body, m) };
    case 'tex': return { k: 'tex', slot: node.slot, uv: subst(node.uv, m) };
  }
}

function parse(toks: Tok[]): Node {
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];
  function fail(msg: string): never { throw new ParseError(msg); }
  // `let NAME = EXPR;` bindings are inlined at parse time — the source gets the
  // local, the generated shader inlines the bound AST (all subexpressions are
  // pure, so this is semantics-preserving; the GPU compiler CSEs the repeats).
  const lets: Record<string, Node> = {};
  const foldBound = new Set<string>(); // locally-bound names: fold's acc/i + def params
  const defs: Record<string, { params: string[]; body: Node }> = {};

  function primary(): Node {
    const tk = peek(); if (!tk) fail('unexpected end of expression');
    if (tk.t === 'num') { eat(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '!')) { eat(); return { k: 'un', op: tk.v, a: unary() }; }
    if (tk.t === 'op' && tk.v === '(') { eat(); const e = expr(0); if (eat()?.v !== ')') fail('missing ")"'); return e; }
    if (tk.t === 'id') {
      eat();
      if (tk.v === 'fold' && peek()?.t === 'op' && peek()?.v === '(') {
        // fold(N, init, body): a bounded loop. N is a constant; `acc` (starts
        // at init) and `i` (0..N-1) are bound in body; result is the final acc.
        eat();
        const nTok = eat();
        if (!nTok || nTok.t !== 'num' || !Number.isInteger(nTok.v) || nTok.v < 1 || nTok.v > 256) fail('fold(N, init, body) — N must be an integer 1..256');
        if (eat()?.v !== ',') fail('fold expects fold(N, init, body)');
        const init = expr(0);
        if (eat()?.v !== ',') fail('fold expects fold(N, init, body)');
        const hadAcc = foldBound.has('acc'), hadI = foldBound.has('i');
        foldBound.add('acc'); foldBound.add('i');
        const body = expr(0);
        if (!hadAcc) foldBound.delete('acc');
        if (!hadI) foldBound.delete('i');
        if (eat()?.v !== ')') fail('missing ")" after fold(...)');
        return { k: 'fold', count: nTok.v, init, body };
      }
      if (tk.v === 'texture' && peek()?.t === 'op' && peek()?.v === '(') {
        // texture(name, uv): sample a declared image input at uv → vec4. The
        // name is a declared texture (slot), not a value expression.
        eat();
        const nameTok = eat();
        if (!nameTok || nameTok.t !== 'id' || !(nameTok.v in textureIndex)) fail('texture(name, uv) — name must be a declared texture');
        if (eat()?.v !== ',') fail('texture expects texture(name, uv)');
        const uv = expr(0);
        if (eat()?.v !== ')') fail('missing ")" after texture(...)');
        return { k: 'tex', slot: textureIndex[nameTok.v]!, uv };
      }
      if (tk.v === 'normal' && peek()?.t === 'op' && peek()?.v === '(') {
        // normal(fn, p): central-difference normal of a 1-param def `fn` at p.
        eat();
        const fnTok = eat();
        if (!fnTok || fnTok.t !== 'id' || !(fnTok.v in defs) || defs[fnTok.v]!.params.length !== 1) fail('normal(fn, p) — fn must be a def with one parameter');
        if (eat()?.v !== ',') fail('normal expects normal(fn, p)');
        const pt = expr(0);
        if (eat()?.v !== ')') fail('missing ")" after normal(...)');
        const def = defs[fnTok.v]!;
        const pn = def.params[0]!;
        const E = 0.0015;
        const off = (dx: number, dy: number, dz: number): Node => ({ k: 'call', name: 'vec3', args: [{ k: 'num', v: dx }, { k: 'num', v: dy }, { k: 'num', v: dz }] });
        const at = (s: '+' | '-', o: Node): Node => subst(def.body, { [pn]: { k: 'bin', op: s, a: pt, b: o } });
        const comp = (o: Node): Node => ({ k: 'bin', op: '-', a: at('+', o), b: at('-', o) });
        const grad: Node = { k: 'call', name: 'vec3', args: [comp(off(E, 0, 0)), comp(off(0, E, 0)), comp(off(0, 0, E))] };
        return { k: 'call', name: 'normalize', args: [grad] };
      }
      if (tk.v in defs && peek()?.t === 'op' && peek()?.v === '(') {
        // def call — inline the body with params substituted by the args.
        eat(); const dargs: Node[] = [];
        if (!(peek()?.t === 'op' && peek()?.v === ')')) {
          for (;;) { dargs.push(expr(0)); const s = peek(); if (s?.v === ',') { eat(); continue; } break; }
        }
        if (eat()?.v !== ')') fail(`missing ")" after ${tk.v}(...)`);
        const def = defs[tk.v]!;
        if (dargs.length !== def.params.length) fail(`${tk.v}() takes ${def.params.length} arg(s)`);
        const m: Record<string, Node> = {};
        def.params.forEach((p, i) => { m[p] = dargs[i]!; });
        return subst(def.body, m);
      }
      if (peek()?.t === 'op' && peek()?.v === '(') {
        eat(); const args: Node[] = [];
        if (!(peek()?.t === 'op' && peek()?.v === ')')) {
          for (;;) { args.push(expr(0)); const s = peek(); if (s?.v === ',') { eat(); continue; } break; }
        }
        if (eat()?.v !== ')') fail(`missing ")" after ${tk.v}(...)`);
        return { k: 'call', name: tk.v, args };
      }
      if (tk.v in lets) return lets[tk.v]!;
      if (tk.v in CONSTS || tk.v in INPUTS || tk.v in paramIndex || foldBound.has(tk.v)) return { k: 'var', name: tk.v };
      fail(`unknown name "${tk.v}"`);
    }
    fail(`unexpected "${tk.v}"`);
  }

  // postfix `.swizzle` binds tighter than any binary op
  function postfix(): Node {
    let node = primary();
    while (peek()?.t === 'op' && peek()?.v === '.') {
      eat();
      const id = eat();
      if (!id || id.t !== 'id' || !SWIZ.test(id.v)) fail('expected a swizzle (.x .rgb …) after "."');
      node = { k: 'swiz', a: node, comps: id.v };
    }
    return node;
  }
  function unary(): Node { return postfix(); }

  function expr(min: number): Node {
    let left = unary();
    for (;;) {
      const tk = peek();
      if (tk?.t === 'op' && tk.v === '?') {
        if (min > 1) break; eat();
        const a = expr(0); if (eat()?.v !== ':') fail('missing ":" in ternary');
        left = { k: 'tern', c: left, a, b: expr(1) }; continue;
      }
      if (tk?.t !== 'op' || !(tk.v in BP) || BP[tk.v]! < min) break;
      eat(); const rbp = tk.v === '^' ? BP[tk.v]! : BP[tk.v]! + 1;
      left = { k: 'bin', op: tk.v, a: left, b: expr(rbp) };
    }
    return left;
  }

  // Leading declarations: `def NAME(params) = EXPR;` and `let NAME = EXPR;`.
  const RESERVED = new Set(['let', 'def', 'fold', 'normal', 'texture', 'acc', 'i']);
  while (peek()?.t === 'id' && ((peek() as Tok).v === 'let' || (peek() as Tok).v === 'def')) {
    const kw = (eat() as Tok).v;
    const nameTok = eat();
    if (!nameTok || nameTok.t !== 'id') fail(`expected a name after "${kw}"`);
    const name = nameTok.v;
    if (RESERVED.has(name) || name in CONSTS || name in INPUTS || name in FNS || name in lets || name in defs) fail(`cannot bind reserved name "${name}"`);
    if (kw === 'def') {
      if (eat()?.v !== '(') fail(`expected "(" in "def ${name}(...)"`);
      const params: string[] = [];
      if (!(peek()?.t === 'op' && peek()?.v === ')')) {
        for (;;) {
          const pt = eat();
          if (!pt || pt.t !== 'id') fail('def parameter must be a name');
          if (RESERVED.has(pt.v) || pt.v in CONSTS || pt.v in INPUTS || pt.v in FNS) fail(`def parameter cannot shadow "${pt.v}"`);
          params.push(pt.v);
          const s = peek(); if (s?.v === ',') { eat(); continue; } break;
        }
      }
      if (eat()?.v !== ')') fail(`missing ")" in "def ${name}(...)"`);
      if (eat()?.v !== '=') fail(`expected "=" in "def ${name}"`);
      params.forEach((p) => foldBound.add(p));
      const body = expr(0);
      params.forEach((p) => foldBound.delete(p));
      if (eat()?.v !== ';') fail(`expected ";" after "def ${name}"`);
      defs[name] = { params, body };
    } else {
      if (eat()?.v !== '=') fail(`expected "=" in "let ${name}"`);
      lets[name] = expr(0);
      if (eat()?.v !== ';') fail(`expected ";" after "let ${name}"`);
    }
  }
  const root = expr(0);
  if (p !== toks.length) fail(`unexpected "${peek()?.v}"`);
  return root;
}

// ── stdlib (Expr's vocabulary + vector essentials) ──────────────────────────
// kind drives both type-checking and codegen. Most funcs share a name across
// targets; `g`/`w` override per target where they differ.
type Fn =
  | { kind: 'cw1' }                                  // componentwise unary: T → T
  | { kind: 'cw2' }                                  // broadcasting binary: T,T → T
  | { kind: 'cw3' }                                  // broadcasting ternary: T,T,T → T
  | { kind: 'fold'; ret: PxType }                    // a,b → ret (length, dot, distance…)
  | { kind: 'ctor'; ret: PxType }                    // vecN/rgb constructor
  | { kind: 'fixed'; args: PxType[]; ret: PxType };  // exact signature
const FNS: Record<string, Fn & { g?: string; w?: string }> = {
  sin: { kind: 'cw1' }, cos: { kind: 'cw1' }, tan: { kind: 'cw1' },
  asin: { kind: 'cw1' }, acos: { kind: 'cw1' }, atan: { kind: 'cw1' },
  sinh: { kind: 'cw1' }, cosh: { kind: 'cw1' }, tanh: { kind: 'cw1' },
  abs: { kind: 'cw1' }, sign: { kind: 'cw1' }, sqrt: { kind: 'cw1' },
  exp: { kind: 'cw1' }, log: { kind: 'cw1' }, log2: { kind: 'cw1' },
  floor: { kind: 'cw1' }, ceil: { kind: 'cw1' }, round: { kind: 'cw1' },
  trunc: { kind: 'cw1' }, fract: { kind: 'cw1' }, radians: { kind: 'cw1' }, degrees: { kind: 'cw1' },
  pow: { kind: 'cw2' }, mod: { kind: 'cw2' }, min: { kind: 'cw2' }, max: { kind: 'cw2' }, step: { kind: 'cw2' },
  atan2: { kind: 'cw2', g: 'atan', w: 'atan2' },
  clamp: { kind: 'cw3' }, mix: { kind: 'cw3' }, lerp: { kind: 'cw3', g: 'mix', w: 'mix' }, smoothstep: { kind: 'cw3' },
  length: { kind: 'fold', ret: 'float' }, distance: { kind: 'fold', ret: 'float' }, dot: { kind: 'fold', ret: 'float' },
  normalize: { kind: 'cw1' }, cross: { kind: 'fixed', args: ['vec3', 'vec3'], ret: 'vec3' }, reflect: { kind: 'cw2' },
  vec2: { kind: 'ctor', ret: 'vec2' }, vec3: { kind: 'ctor', ret: 'vec3' }, vec4: { kind: 'ctor', ret: 'vec4' },
  rgb: { kind: 'ctor', ret: 'vec3' }, rgba: { kind: 'ctor', ret: 'vec4' },
  hash: { kind: 'fixed', args: ['vec2'], ret: 'float', g: 'px_hash21', w: 'px_hash21' },
  noise: { kind: 'fixed', args: ['vec2'], ret: 'float', g: 'px_noise2', w: 'px_noise2' },
  backdrop: { kind: 'fixed', args: ['vec2'], ret: 'vec4', g: 'px_backdrop', w: 'px_backdrop' },
  // SDF stdlib (for raymarching with `fold`): signed distance to a sphere/box,
  // plus union ops. p is a vec3 in object space.
  sdSphere: { kind: 'fixed', args: ['vec3', 'float'], ret: 'float', g: 'px_sdSphere', w: 'px_sdSphere' },
  sdBox: { kind: 'fixed', args: ['vec3', 'vec3'], ret: 'float', g: 'px_sdBox', w: 'px_sdBox' },
  opUnion: { kind: 'cw2', g: 'min', w: 'min' },
  opSmoothUnion: { kind: 'fixed', args: ['float', 'float', 'float'], ret: 'float', g: 'px_opSmoothUnion', w: 'px_opSmoothUnion' },
  sdTorus: { kind: 'fixed', args: ['vec3', 'vec2'], ret: 'float', g: 'px_sdTorus', w: 'px_sdTorus' },
  sdRoundBox: { kind: 'fixed', args: ['vec3', 'vec3', 'float'], ret: 'float', g: 'px_sdRoundBox', w: 'px_sdRoundBox' },
  sdPlane: { kind: 'fixed', args: ['vec3', 'vec3', 'float'], ret: 'float', g: 'px_sdPlane', w: 'px_sdPlane' },
  sdCapsule: { kind: 'fixed', args: ['vec3', 'vec3', 'vec3', 'float'], ret: 'float', g: 'px_sdCapsule', w: 'px_sdCapsule' },
  opSubtract: { kind: 'fixed', args: ['float', 'float'], ret: 'float', g: 'px_opSubtract', w: 'px_opSubtract' },
  opIntersect: { kind: 'cw2', g: 'max', w: 'max' },
  opOnion: { kind: 'fixed', args: ['float', 'float'], ret: 'float', g: 'px_opOnion', w: 'px_opOnion' },
  // Extrude a 2D SDF (its value `d`, plus p.z and half-height) into a 3D solid.
  opExtrude: { kind: 'fixed', args: ['float', 'float', 'float'], ret: 'float', g: 'px_opExtrude', w: 'px_opExtrude' },
  // Domain rotations (transform p before an SDF).
  rotX: { kind: 'fixed', args: ['vec3', 'float'], ret: 'vec3', g: 'px_rotX', w: 'px_rotX' },
  rotY: { kind: 'fixed', args: ['vec3', 'float'], ret: 'vec3', g: 'px_rotY', w: 'px_rotY' },
  rotZ: { kind: 'fixed', args: ['vec3', 'float'], ret: 'vec3', g: 'px_rotZ', w: 'px_rotZ' },
  // refract(incident, normal, eta) — a GLSL/WGSL builtin (glass material).
  refract: { kind: 'fixed', args: ['vec3', 'vec3', 'float'], ret: 'vec3' },
  // median of three — MSDF text decode: alpha = smoothstep(.5±w, median(s.rgb)).
  median: { kind: 'fixed', args: ['float', 'float', 'float'], ret: 'float', g: 'px_median', w: 'px_median' },
  // Reusable procedural building blocks — NOT tied to any one effect. All
  // deterministic: built on the same PCG hash/noise as `noise`, so bit-stable
  // across GPUs (no derivatives, no sin-hash). fbm(p) → float ~[0,1] (5-octave
  // value fBm — clouds/smoke/grain/marble/plasma). voronoi(p) → vec3 = (F1
  // nearest feature distance, F2 second nearest, cellHash 0..1 for per-cell
  // color); F2−F1 draws crisp cell borders. hsv2rgb(vec3 h,s,v) → rgb.
  fbm: { kind: 'fixed', args: ['vec2'], ret: 'float', g: 'px_fbm', w: 'px_fbm' },
  voronoi: { kind: 'fixed', args: ['vec2'], ret: 'vec3', g: 'px_voronoi', w: 'px_voronoi' },
  hsv2rgb: { kind: 'fixed', args: ['vec3'], ret: 'vec3', g: 'px_hsv2rgb', w: 'px_hsv2rgb' },
};

// Injected helper source (used only when referenced). Determinism: a PCG2D
// hash over float bits — bit-stable across GPUs (no `sin*43758` divergence).
const HELP_GLSL: Record<string, string> = {
  px_hash21: `uvec2 px_pcg2d(uvec2 v){v=v*1664525u+1013904223u;v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>16u;v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>16u;return v;}
float px_hash21(vec2 p){uvec2 h=px_pcg2d(floatBitsToUint(p));return float(h.x)/4294967295.0;}`,
  px_noise2: `float px_noise2(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);
float a=px_hash21(i),b=px_hash21(i+vec2(1.0,0.0)),c=px_hash21(i+vec2(0.0,1.0)),d=px_hash21(i+vec2(1.0,1.0));
return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}`,
  px_backdrop: `vec4 px_backdrop(vec2 p){ return texture(u_backdrop, vec2(p.x, mix(p.y, 1.0 - p.y, u_backdropFlipY))); }`,
  px_sdSphere: `float px_sdSphere(vec3 p, float r){ return length(p) - r; }`,
  px_sdBox: `float px_sdBox(vec3 p, vec3 b){ vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }`,
  px_opSmoothUnion: `float px_opSmoothUnion(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }`,
  px_sdTorus: `float px_sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }`,
  px_sdRoundBox: `float px_sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }`,
  px_sdPlane: `float px_sdPlane(vec3 p, vec3 n, float h){ return dot(p, normalize(n)) + h; }`,
  px_sdCapsule: `float px_sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a; vec3 ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }`,
  px_opSubtract: `float px_opSubtract(float a, float b){ return max(a, -b); }`,
  px_opOnion: `float px_opOnion(float d, float t){ return abs(d) - t; }`,
  px_opExtrude: `float px_opExtrude(float d, float pz, float h){ vec2 w = vec2(d, abs(pz) - h); return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)); }`,
  px_rotX: `vec3 px_rotX(vec3 p, float a){ float c = cos(a); float s = sin(a); return vec3(p.x, c*p.y - s*p.z, s*p.y + c*p.z); }`,
  px_rotY: `vec3 px_rotY(vec3 p, float a){ float c = cos(a); float s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }`,
  px_rotZ: `vec3 px_rotZ(vec3 p, float a){ float c = cos(a); float s = sin(a); return vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z); }`,
  px_median: `float px_median(float a, float b, float c){ return max(min(a, b), min(max(a, b), c)); }`,
  px_fbm: `float px_fbm(vec2 p){ float s = 0.0; float a = 0.5; vec2 q = p; for (int k = 0; k < 5; k++){ s += a * px_noise2(q); q *= 2.0; a *= 0.5; } return s / 0.96875; }`,
  px_voronoi: `vec3 px_voronoi(vec2 p){ vec2 n = floor(p); vec2 f = fract(p); float f1 = 8.0; float f2 = 8.0; float cell = 0.0;
for (int j = -1; j <= 1; j++){ for (int i = -1; i <= 1; i++){ vec2 g = vec2(float(i), float(j)); vec2 o = vec2(px_hash21(n+g), px_hash21(n+g+vec2(31.0,17.0))); vec2 r = g + o - f; float d = dot(r, r);
if (d < f1){ f2 = f1; f1 = d; cell = px_hash21(n+g); } else if (d < f2){ f2 = d; } } }
return vec3(sqrt(f1), sqrt(f2), cell); }`,
  px_hsv2rgb: `vec3 px_hsv2rgb(vec3 c){ vec3 r = clamp(abs(mod(c.x*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return c.z * mix(vec3(1.0), r, vec3(c.y)); }`,
};
const HELP_WGSL: Record<string, string> = {
  px_hash21: `fn px_pcg2d(iv:vec2<u32>)->vec2<u32>{var v=iv*1664525u+1013904223u;v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>vec2<u32>(16u);v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>vec2<u32>(16u);return v;}
fn px_hash21(p:vec2<f32>)->f32{let h=px_pcg2d(bitcast<vec2<u32>>(p));return f32(h.x)/4294967295.0;}`,
  px_noise2: `fn px_noise2(p:vec2<f32>)->f32{let i=floor(p);let f=fract(p);let u=f*f*(3.0-2.0*f);
let a=px_hash21(i);let b=px_hash21(i+vec2<f32>(1.0,0.0));let c=px_hash21(i+vec2<f32>(0.0,1.0));let d=px_hash21(i+vec2<f32>(1.0,1.0));
return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}`,
  px_backdrop: `fn px_backdrop(p:vec2<f32>)->vec4<f32>{return textureSample(backdropTex, samp, vec2<f32>(p.x, select(p.y, 1.0 - p.y, u.backdropFlipY > 0.5)));}`,
  px_sdSphere: `fn px_sdSphere(p:vec3<f32>, r:f32)->f32{ return length(p) - r; }`,
  px_sdBox: `fn px_sdBox(p:vec3<f32>, b:vec3<f32>)->f32{ let d = abs(p) - b; return length(max(d, vec3<f32>(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0); }`,
  px_opSmoothUnion: `fn px_opSmoothUnion(a:f32, b:f32, k:f32)->f32{ let h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }`,
  px_sdTorus: `fn px_sdTorus(p:vec3<f32>, t:vec2<f32>)->f32{ let q = vec2<f32>(length(p.xz) - t.x, p.y); return length(q) - t.y; }`,
  px_sdRoundBox: `fn px_sdRoundBox(p:vec3<f32>, b:vec3<f32>, r:f32)->f32{ let q = abs(p) - b + r; return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }`,
  px_sdPlane: `fn px_sdPlane(p:vec3<f32>, n:vec3<f32>, h:f32)->f32{ return dot(p, normalize(n)) + h; }`,
  px_sdCapsule: `fn px_sdCapsule(p:vec3<f32>, a:vec3<f32>, b:vec3<f32>, r:f32)->f32{ let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }`,
  px_opSubtract: `fn px_opSubtract(a:f32, b:f32)->f32{ return max(a, -b); }`,
  px_opOnion: `fn px_opOnion(d:f32, t:f32)->f32{ return abs(d) - t; }`,
  px_opExtrude: `fn px_opExtrude(d:f32, pz:f32, h:f32)->f32{ let w = vec2<f32>(d, abs(pz) - h); return min(max(w.x, w.y), 0.0) + length(max(w, vec2<f32>(0.0))); }`,
  px_rotX: `fn px_rotX(p:vec3<f32>, a:f32)->vec3<f32>{ let c = cos(a); let s = sin(a); return vec3<f32>(p.x, c*p.y - s*p.z, s*p.y + c*p.z); }`,
  px_rotY: `fn px_rotY(p:vec3<f32>, a:f32)->vec3<f32>{ let c = cos(a); let s = sin(a); return vec3<f32>(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }`,
  px_rotZ: `fn px_rotZ(p:vec3<f32>, a:f32)->vec3<f32>{ let c = cos(a); let s = sin(a); return vec3<f32>(c*p.x - s*p.y, s*p.x + c*p.y, p.z); }`,
  px_median: `fn px_median(a:f32, b:f32, c:f32)->f32{ return max(min(a, b), min(max(a, b), c)); }`,
  px_fbm: `fn px_fbm(p:vec2<f32>)->f32{ var s = 0.0; var a = 0.5; var q = p; for (var k = 0; k < 5; k = k + 1){ s = s + a * px_noise2(q); q = q * 2.0; a = a * 0.5; } return s / 0.96875; }`,
  px_voronoi: `fn px_voronoi(p:vec2<f32>)->vec3<f32>{ let n = floor(p); let f = fract(p); var f1 = 8.0; var f2 = 8.0; var cell = 0.0;
for (var j = -1; j <= 1; j = j + 1){ for (var i = -1; i <= 1; i = i + 1){ let g = vec2<f32>(f32(i), f32(j)); let o = vec2<f32>(px_hash21(n+g), px_hash21(n+g+vec2<f32>(31.0,17.0))); let r = g + o - f; let d = dot(r, r);
if (d < f1){ f2 = f1; f1 = d; cell = px_hash21(n+g); } else if (d < f2){ f2 = d; } } }
return vec3<f32>(sqrt(f1), sqrt(f2), cell); }`,
  px_hsv2rgb: `fn px_hsv2rgb(c:vec3<f32>)->vec3<f32>{ let h = c.x*6.0 + vec3<f32>(0.0,4.0,2.0); let m = h - 6.0*floor(h/6.0); let r = clamp(abs(m - 3.0) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)); return c.z * mix(vec3<f32>(1.0), r, vec3<f32>(c.y)); }`,
};
// Transitive helper deps (addHelper pulls one level, so list the full closure).
const HELP_DEPS: Record<string, string[]> = {
  px_noise2: ['px_hash21'],
  px_fbm: ['px_noise2', 'px_hash21'],
  px_voronoi: ['px_hash21'],
};

// ── type-check + codegen (one bottom-up pass per target) ────────────────────
function tyName(t: PxType, target: Target): string {
  if (target === 'glsl') return t;
  return t === 'float' ? 'f32' : `${t}<f32>`;
}
function numLit(v: number, target: Target): string {
  // GLSL ints aren't floats and WGSL bare ints are AbstractInt — always emit a float literal.
  let s = Number.isFinite(v) ? String(v) : '0';
  if (!/[.eE]/.test(s)) s += '.0';
  return target === 'wgsl' ? s : s;
}
function splat(code: string, from: PxType, to: PxType, target: Target): string {
  if (from === to) return code;
  // scalar → vector (only widening we do implicitly, for broadcasting)
  return `${tyName(to, target)}(${code})`;
}

interface Emit { code: string; type: PxType; helpers: Set<string> }

function emit(node: Node, target: Target): Emit {
  const merge = (...es: Emit[]): Set<string> => {
    const s = new Set<string>();
    for (const e of es) for (const h of e.helpers) s.add(h);
    return s;
  };
  switch (node.k) {
    case 'num': return { code: numLit(node.v, target), type: 'float', helpers: new Set() };
    case 'var': {
      if (node.name in foldScope) { const s = foldScope[node.name]!; return { code: s.code, type: s.type, helpers: new Set() }; }
      if (node.name in CONSTS) return { code: numLit(CONSTS[node.name]!, target), type: 'float', helpers: new Set() };
      if (node.name in paramIndex) {
        const i = paramIndex[node.name]!, v = i >> 2, c = i & 3;
        return { code: target === 'glsl' ? `u_params[${v}][${c}]` : `u.params[${v}][${c}]`, type: 'float', helpers: new Set() };
      }
      if (node.name === 'coverage') usedCoverage = true;
      const inp = INPUTS[node.name]!;
      return { code: inp[target], type: inp.type, helpers: new Set() };
    }
    case 'swiz': {
      const a = emit(node.a, target);
      if (a.type === 'float') throw new ParseError(`cannot swizzle a float with ".${node.comps}"`);
      const max = SIZE[a.type];
      // Normalize rgba→xyzw for BOTH targets (GLSL accepts xyzw; WGSL only
      // xyzw) so mixed sets like ".xg" can't diverge between backends.
      const xyzw = node.comps.replace(/[rgba]/g, (c) => 'xyzw'['rgba'.indexOf(c)]!);
      for (const ch of xyzw) if ('xyzw'.indexOf(ch) >= max) throw new ParseError(`".${node.comps}" reads past ${a.type}`);
      return { code: `(${a.code}).${xyzw}`, type: BY_SIZE[node.comps.length]!, helpers: a.helpers };
    }
    case 'un': {
      const a = emit(node.a, target);
      if (node.op === '-') return { code: `(-${a.code})`, type: a.type, helpers: a.helpers };
      if (a.type !== 'float') throw new ParseError('"!" needs a float');
      const code = target === 'glsl' ? `float(${a.code} == 0.0)` : `f32(${a.code} == 0.0)`;
      return { code, type: 'float', helpers: a.helpers };
    }
    case 'tern': {
      const c = emit(node.c, target), a = emit(node.a, target), b = emit(node.b, target);
      if (c.type !== 'float') throw new ParseError('ternary condition must be a float');
      if (a.type !== b.type) throw new ParseError(`ternary branches differ (${a.type} vs ${b.type})`);
      const cond = `(${c.code} != 0.0)`;
      const code = target === 'glsl' ? `(${cond} ? ${a.code} : ${b.code})` : `select(${b.code}, ${a.code}, ${cond})`;
      return { code, type: a.type, helpers: merge(c, a, b) };
    }
    case 'bin': return emitBin(node, target, emit);
    case 'call': return emitCall(node, target, emit);
    case 'fold': {
      if (foldActive) throw new ParseError('fold cannot be nested (v1)');
      const id = foldCounter++;
      const acc = `pe_acc${id}`, iv = `pe_i${id}`;
      const init = emit(node.init, target);
      foldActive = true;
      foldScope['acc'] = { code: acc, type: init.type };
      foldScope['i'] = { code: target === 'glsl' ? `float(${iv})` : `f32(${iv})`, type: 'float' };
      const body = emit(node.body, target);
      delete foldScope['acc'];
      delete foldScope['i'];
      foldActive = false;
      if (body.type !== init.type) throw new ParseError(`fold body type (${body.type}) must match init (${init.type})`);
      const ty = tyName(init.type, target);
      if (target === 'glsl') {
        emitStmts.push(`${ty} ${acc} = ${init.code};`);
        emitStmts.push(`for (int ${iv} = 0; ${iv} < ${node.count}; ${iv}++) { ${acc} = ${body.code}; }`);
      } else {
        emitStmts.push(`var ${acc} = ${init.code};`);
        emitStmts.push(`for (var ${iv} = 0; ${iv} < ${node.count}; ${iv} = ${iv} + 1) { ${acc} = ${body.code}; }`);
      }
      return { code: acc, type: init.type, helpers: new Set<string>([...init.helpers, ...body.helpers]) };
    }
    case 'tex': {
      const uv = emit(node.uv, target);
      if (uv.type !== 'vec2') throw new ParseError('texture(name, uv) — uv must be a vec2');
      const code = target === 'glsl'
        ? `texture(u_tex${node.slot}, ${uv.code})`
        : `textureSample(tex${node.slot}, samp, ${uv.code})`;
      return { code, type: 'vec4', helpers: uv.helpers };
    }
  }
}

function emitBin(node: Extract<Node, { k: 'bin' }>, target: Target, rec: typeof emit): Emit {
  const a = rec(node.a, target), b = rec(node.b, target);
  const op = node.op;
  const hs = new Set([...a.helpers, ...b.helpers]);
  // logical / comparison → float 0/1, scalars only
  if (['&&', '||', '<', '>', '<=', '>=', '==', '!='].includes(op)) {
    if (a.type !== 'float' || b.type !== 'float') throw new ParseError(`"${op}" needs floats`);
    const wrap = (s: string) => target === 'glsl' ? `float(${s})` : `f32(${s})`;
    if (op === '&&') return { code: wrap(`(${a.code} != 0.0) && (${b.code} != 0.0)`), type: 'float', helpers: hs };
    if (op === '||') return { code: wrap(`(${a.code} != 0.0) || (${b.code} != 0.0)`), type: 'float', helpers: hs };
    return { code: wrap(`${a.code} ${op === '==' ? '==' : op === '!=' ? '!=' : op} ${b.code}`), type: 'float', helpers: hs };
  }
  // arithmetic — broadcast scalar↔vector by splatting (avoids WGSL's stricter rules)
  let rt: PxType;
  if (a.type === b.type) rt = a.type;
  else if (a.type === 'float') rt = b.type;
  else if (b.type === 'float') rt = a.type;
  else throw new ParseError(`cannot combine ${a.type} ${op} ${b.type}`);
  const ac = splat(a.code, a.type, rt, target), bc = splat(b.code, b.type, rt, target);
  if (op === '^') return { code: `pow(${ac}, ${bc})`, type: rt, helpers: hs };
  if (op === '%') {
    // floored mod, identical on both targets (WGSL `%` is truncated rem)
    const code = target === 'glsl' ? `mod(${ac}, ${bc})` : `(${ac} - ${bc} * floor(${ac} / ${bc}))`;
    return { code, type: rt, helpers: hs };
  }
  return { code: `(${ac} ${op} ${bc})`, type: rt, helpers: hs };
}

function emitCall(node: Extract<Node, { k: 'call' }>, target: Target, rec: typeof emit): Emit {
  const fn = FNS[node.name];
  if (!fn) throw new ParseError(`unknown function "${node.name}"`);
  if (node.name === 'backdrop' && !allowBackdrop) throw new ParseError('backdrop() requires reads_backdrop: true on the pixel_shader effect');
  const args = node.args.map((a) => rec(a, target));
  const hs = new Set<string>();
  for (const a of args) for (const h of a.helpers) hs.add(h);
  const name = (target === 'glsl' ? fn.g : fn.w) ?? node.name;
  const addHelper = (h?: string) => { if (h) { hs.add(h); for (const d of HELP_DEPS[h] ?? []) hs.add(d); } };
  if ('g' in fn && fn.g?.startsWith('px_')) addHelper(fn.g);

  switch (fn.kind) {
    case 'cw1': {
      if (args.length !== 1) throw new ParseError(`${node.name}() takes 1 arg`);
      return { code: `${name}(${args[0]!.code})`, type: args[0]!.type, helpers: hs };
    }
    case 'cw2': {
      if (args.length !== 2) throw new ParseError(`${node.name}() takes 2 args`);
      const rt = resultType(node.name, args[0]!.type, args[1]!.type);
      const a = splat(args[0]!.code, args[0]!.type, rt, target), b = splat(args[1]!.code, args[1]!.type, rt, target);
      return { code: `${name}(${a}, ${b})`, type: rt, helpers: hs };
    }
    case 'cw3': {
      if (args.length !== 3) throw new ParseError(`${node.name}() takes 3 args`);
      // smoothstep(e0,e1,x): edges may be scalar, x drives the type; others broadcast.
      const rt = [args[0]!, args[1]!, args[2]!].map((a) => a.type).find((t) => t !== 'float') ?? 'float';
      const cs = args.map((a) => splat(a.code, a.type, rt, target));
      return { code: `${name}(${cs.join(', ')})`, type: rt, helpers: hs };
    }
    case 'fold': {
      const arity = node.name === 'length' ? 1 : 2; // length(v); dot(a,b)/distance(a,b)
      if (args.length !== arity) throw new ParseError(`${node.name}() takes ${arity} arg(s)`);
      if (arity === 2 && args[0]!.type !== args[1]!.type) throw new ParseError(`${node.name}() args must match`);
      if (args[0]!.type === 'float') throw new ParseError(`${node.name}() needs a vector`);
      return { code: `${name}(${args.map((a) => a.code).join(', ')})`, type: fn.ret, helpers: hs };
    }
    case 'fixed': {
      if (args.length !== fn.args.length) throw new ParseError(`${node.name}() takes ${fn.args.length} arg(s)`);
      fn.args.forEach((want, idx) => { if (args[idx]!.type !== want) throw new ParseError(`${node.name}() arg ${idx + 1} must be ${want}`); });
      return { code: `${name}(${args.map((a) => a.code).join(', ')})`, type: fn.ret, helpers: hs };
    }
    case 'ctor': return emitCtor(node.name, fn.ret, args, target, hs);
  }
}

function resultType(name: string, a: PxType, b: PxType): PxType {
  if (a === b) return a;
  if (a === 'float') return b;
  if (b === 'float') return a;
  throw new ParseError(`${name}() arguments differ (${a} vs ${b})`);
}

function emitCtor(name: string, ret: PxType, args: Emit[], target: Target, hs: Set<string>): Emit {
  const want = SIZE[ret];
  const have = args.reduce((s, a) => s + SIZE[a.type], 0);
  // GLSL/WGSL rule: a single scalar splats; otherwise components must sum exactly.
  if (!(args.length === 1 && args[0]!.type === 'float') && have !== want) {
    throw new ParseError(`${name}() needs ${want} components, got ${have}`);
  }
  return { code: `${tyName(ret, target)}(${args.map((a) => a.code).join(', ')})`, type: ret, helpers: hs };
}

// ── public API ──────────────────────────────────────────────────────────────
export interface PixelExprOk {
  ok: true;
  type: PxType;
  /** The program referenced `coverage` — the runtime should bind a softened mask. */
  usesCoverage: boolean;
  glsl: { expr: string; stmts: string; preamble: string };
  wgsl: { expr: string; stmts: string; preamble: string };
}
export interface PixelExprErr { ok: false; error: string }
export type PixelExprResult = PixelExprOk | PixelExprErr;

function preamble(helpers: Set<string>, src: Record<string, string>): string {
  // emit in dependency order (deps already pulled into the set)
  const order = ['px_hash21', 'px_noise2', 'px_fbm', 'px_voronoi', 'px_hsv2rgb', 'px_backdrop', 'px_sdSphere', 'px_sdBox', 'px_opSmoothUnion', 'px_sdTorus', 'px_sdRoundBox', 'px_sdPlane', 'px_sdCapsule', 'px_opSubtract', 'px_opOnion', 'px_opExtrude', 'px_rotX', 'px_rotY', 'px_rotZ', 'px_median'].filter((h) => helpers.has(h));
  return order.map((h) => src[h]!).join('\n');
}

/** Compile a Pixel-Expr program to GLSL ES 3.0 + WGSL fragment expressions.
 *  The returned `expr` references `v_uv`/`uTime`/`uResolution` (GLSL) and
 *  `in.uv`/`u.time`/`u.resolution` (WGSL); the backend wraps it in main()
 *  and promotes the output `type` to vec4 (float→gray, vec3→rgb α=1). */
export function compilePixelExpr(source: string, opts?: { backdrop?: boolean; params?: string[]; textures?: string[] }): PixelExprResult {
  allowBackdrop = opts?.backdrop === true;
  usedCoverage = false;
  paramIndex = {};
  textureIndex = {};
  const pnames = opts?.params ?? [];
  if (pnames.length > 16) return { ok: false, error: 'a pixel_shader may declare at most 16 params' };
  pnames.forEach((name, i) => { paramIndex[name] = i; });
  const tnames = opts?.textures ?? [];
  if (tnames.length > 4) return { ok: false, error: 'a pixel_shader may declare at most 4 textures' };
  tnames.forEach((name, i) => { textureIndex[name] = i; });
  try {
    const toks = lex(source);
    if (!toks) return { ok: false, error: 'illegal character in expression' };
    if (toks.length === 0) return { ok: false, error: 'empty expression' };
    const ast = parse(toks);
    emitStmts = []; foldCounter = 0; foldScope = {}; foldActive = false;
    const g = emit(ast, 'glsl');
    const gStmts = emitStmts.join('\n  ');
    emitStmts = []; foldCounter = 0; foldScope = {}; foldActive = false;
    const w = emit(ast, 'wgsl');
    const wStmts = emitStmts.join('\n  ');
    if (g.type !== w.type) return { ok: false, error: 'internal: target type mismatch' };
    return {
      ok: true,
      type: g.type,
      usesCoverage: usedCoverage,
      glsl: { expr: g.code, stmts: gStmts, preamble: preamble(g.helpers, HELP_GLSL) },
      wgsl: { expr: w.code, stmts: wStmts, preamble: preamble(w.helpers, HELP_WGSL) },
    };
  } catch (e) {
    return { ok: false, error: e instanceof ParseError ? e.message : `parse error: ${String(e)}` };
  }
}

// ── shader assembly ──────────────────────────────────────────────────────────
// Wrap a compiled program into a full fragment shader. This is the canonical
// `pixel_shader` contract both backends implement: the program output is
// promoted to vec4 (float→gray, vec3→rgb α=1), clamped, premultiplied, and
// masked to the element's own alpha (u_src) so it fills the element footprint.
function promote(expr: string, type: PxType, target: Target): string {
  const v4 = target === 'glsl' ? 'vec4' : 'vec4<f32>';
  const v3 = target === 'glsl' ? 'vec3' : 'vec3<f32>';
  if (type === 'vec4') return expr;
  if (type === 'vec3') return `${v4}((${expr}), 1.0)`;
  return `${v4}(${v3}((${expr})), 1.0)`; // float → grayscale
}

/** Full GLSL ES 3.0 fragment source. Pairs with the runtime's TEXTURED_VS
 *  (provides `v_uv`); uniforms: `u_src` (layer, for the alpha mask),
 *  `uTime`, `uResolution`. */
export function buildGlslFragment(r: PixelExprOk): string {
  const c = promote(r.glsl.expr, r.type, 'glsl');
  return `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform sampler2D u_backdrop;
uniform float u_backdropFlipY;
uniform float uTime;
uniform vec2 uResolution;
uniform vec4 u_params[4];
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
${r.glsl.preamble}
void main() {
  float _m = texture(u_src, v_uv).a;
  ${r.glsl.stmts}
  vec4 _c = clamp(${c}, 0.0, 1.0);
  fragColor = vec4(_c.rgb * _c.a, _c.a) * _m;
}`;
}

/** Full WGSL source (vertex + fragment). Bind group: uniform `u`
 *  (transform+resolution+time), sampler, srcTex. */
export function buildWgslFragment(r: PixelExprOk): string {
  const c = promote(r.wgsl.expr, r.type, 'wgsl');
  return `struct PixelUniforms {
  transform: mat4x4<f32>,
  resolution: vec2<f32>,
  time: f32,
  backdropFlipY: f32,
  params: array<vec4<f32>, 4>,
}
@group(0) @binding(0) var<uniform> u: PixelUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcTex: texture_2d<f32>;
@group(0) @binding(3) var backdropTex: texture_2d<f32>;
@group(0) @binding(4) var tex0: texture_2d<f32>;
@group(0) @binding(5) var tex1: texture_2d<f32>;
@group(0) @binding(6) var tex2: texture_2d<f32>;
@group(0) @binding(7) var tex3: texture_2d<f32>;
${r.wgsl.preamble}
struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}
@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}
@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let _m = textureSample(srcTex, samp, in.uv).a;
  ${r.wgsl.stmts}
  let _c = clamp(${c}, vec4<f32>(0.0), vec4<f32>(1.0));
  return vec4<f32>(_c.rgb * _c.a, _c.a) * _m;
}`;
}
