// Sound-design kit — the layer that reads as "synced" in a pro promo. Built with
// the real sound-design recipe (not just filtered noise): each SFX LAYERS a
// swept noise band + a pitched sweep, shapes it with a bell envelope, and adds a
// short reverb TAIL for air + stereo movement. Procedural, license-clean,
// deterministic, infinitely tunable. (The same functions can be swapped for CC0
// WAVs later — designSfxBus just needs audio.)
//
// whoosh → into a cut (anticipation), impact → on it (payoff), riser → builds in,
// pop → a scale/snap. Each returns stereo PCM (encodeWav-able).

const SR = 44100;

export interface Sfx {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

/** Static pan -1..1, or [from, to] to sweep across the stereo field (a slide). */
export type Pan = number | [number, number];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── a small Schroeder reverb for "air" (4 combs + 2 allpass) ──────────────────
function comb(x: Float32Array, D: number, g: number): Float32Array {
  const y = new Float32Array(x.length), z = new Float32Array(D); let p = 0;
  for (let i = 0; i < x.length; i++) { const yn = x[i]! + g * z[p]!; z[p] = yn; y[i] = yn; p = (p + 1) % D; }
  return y;
}
function allpass(x: Float32Array, D: number, g: number): Float32Array {
  const y = new Float32Array(x.length), z = new Float32Array(D); let p = 0;
  for (let i = 0; i < x.length; i++) { const bo = z[p]!; y[i] = -g * x[i]! + bo; z[p] = x[i]! + g * bo; p = (p + 1) % D; }
  return y;
}
function reverbMono(x: Float32Array): Float32Array {
  const wet = new Float32Array(x.length);
  for (const d of [1116, 1188, 1277, 1356]) { const c = comb(x, d, 0.78); for (let i = 0; i < x.length; i++) wet[i] += c[i]! * 0.25; }
  return allpass(allpass(wet, 556, 0.5), 441, 0.5);
}

/** Place a mono dry signal in stereo with a pan (or pan-sweep) and a reverb tail. */
function spatialize(dry: Float32Array, pan: Pan, reverbMix: number, tailSec: number): Sfx {
  const tail = Math.floor(tailSec * SR), n = dry.length, N = n + tail;
  const src = new Float32Array(N); src.set(dry);
  const wet = reverbMix > 0 ? reverbMono(src) : null;
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.min(1, i / n);
    const p = Array.isArray(pan) ? pan[0] + (pan[1] - pan[0]) * k : pan;
    const lg = Math.cos((p + 1) * Math.PI / 4), rg = Math.sin((p + 1) * Math.PI / 4);
    const wv = wet ? wet[i]! * reverbMix : 0;
    L[i] = src[i]! * lg + wv; R[i] = src[i]! * rg + wv;
  }
  return { left: L, right: R, sampleRate: SR };
}

export interface WhooshOptions { duration?: number; gain?: number; seed?: number; pan?: Pan; reverb?: number; tune?: number; }
/** A swish into a cut: a noise BAND sweeping upward (movement) layered with a
 *  pitched "vwoom" tuned to `tune` Hz, bell-shaped, with air. Place to END on the
 *  cut. `reverb: 0` for a dry voice (glue with one shared reverb on the bus). */
export function whoosh(o: WhooshOptions = {}): Sfx {
  const dur = o.duration ?? 0.5, gain = o.gain ?? 0.3, rand = rng(o.seed ?? 1), tune = o.tune ?? 220;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  let hpState = 0, lpState = 0, lpState2 = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const fc = 300 + 2600 * k * k;                 // band centre sweeps up (capped lower = less fizz)
    const aH = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    const aL = 1 - Math.exp((-2 * Math.PI * (fc * 2.2)) / SR);
    const x = rand() * 2 - 1;
    hpState += aH * (x - hpState);                 // highpass = x − lp
    const hp = x - hpState;
    lpState += aL * (hp - lpState);                // two-pole lowpass (12 dB/oct) →
    lpState2 += aL * (lpState - lpState2);         // steeper roll-off = smooth, not grainy
    const f = tune * (0.5 + 1.5 * k * k); ph += (2 * Math.PI * f) / SR; // "vwoom", tuned
    const tone = Math.sin(ph) * 0.22;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, k / 0.96)), 1.4); // bell
    dry[i] = (lpState2 * 1.1 + tone) * env * gain;
  }
  return spatialize(dry, o.pan ?? 0, o.reverb ?? 0.28, 0.32);
}

export interface ImpactOptions { duration?: number; gain?: number; seed?: number; pan?: Pan; reverb?: number; tune?: number; }
/** A thud on the cut: sub sine drop (tuned low, around `tune`) + a filtered noise
 *  body + a click transient, with a tail. Subtle by default. */
export function impact(o: ImpactOptions = {}): Sfx {
  const dur = o.duration ?? 0.3, gain = o.gain ?? 0.4, rand = rng(o.seed ?? 2), tune = o.tune ?? 220;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  let ph = 0, prev = 0, lp = 0, lp2 = 0;
  const aBody = 1 - Math.exp((-2 * Math.PI * 900) / SR); // LOWPASS the body (round thump, not bright hiss)
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = tune * 0.26 + tune * 0.32 * Math.exp(-t / 0.025); ph += (2 * Math.PI * f) / SR;
    const sub = Math.sin(ph) * Math.exp(-t / 0.12);
    const x = rand() * 2 - 1; lp += aBody * (x - lp); lp2 += aBody * (lp - lp2); // 2-pole lowpassed noise
    const body = lp2 * Math.exp(-t / 0.05) * 0.7;
    const clk = i < 0.004 * SR ? (x - prev) * 0.4 : 0; prev = x; // brief click only
    dry[i] = (sub + body + clk) * gain;
  }
  return spatialize(dry, o.pan ?? 0, o.reverb ?? 0.22, 0.36);
}

export interface RiserOptions { duration?: number; gain?: number; seed?: number; pan?: Pan; reverb?: number; tune?: number; }
/** An uplifter into a big moment: a noise band + rising tone (tuned), swelling. */
export function riser(o: RiserOptions = {}): Sfx {
  const dur = o.duration ?? 1.2, gain = o.gain ?? 0.3, rand = rng(o.seed ?? 3), tune = o.tune ?? 220;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  let hpState = 0, lpState = 0, lpState2 = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const fc = 350 + 2800 * k;
    const aH = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    const aL = 1 - Math.exp((-2 * Math.PI * (fc * 2.2)) / SR);
    const x = rand() * 2 - 1; hpState += aH * (x - hpState); const hp = x - hpState;
    lpState += aL * (hp - lpState); lpState2 += aL * (lpState - lpState2); // 2-pole, smoother
    const f = tune * (0.7 + 1.3 * k * k); ph += (2 * Math.PI * f) / SR;
    const tone = Math.sin(ph) * 0.28;
    const env = k * k * gain;
    dry[i] = (lpState2 * 1.05 + tone) * env;
  }
  return spatialize(dry, o.pan ?? 0, o.reverb ?? 0.3, 0.4);
}

export interface PopOptions { duration?: number; gain?: number; seed?: number; pan?: Pan; reverb?: number; tune?: number; }
/** A bright snap for a scale-in/bounce: a quick pitched blip (tuned high, around
 *  2× `tune`) + a click + air. */
export function pop(o: PopOptions = {}): Sfx {
  const dur = o.duration ?? 0.1, gain = o.gain ?? 0.3, rand = rng(o.seed ?? 4), tune = o.tune ?? 220;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  let ph = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = tune * 2 + tune * 4 * Math.exp(-t / 0.015); ph += (2 * Math.PI * f) / SR;
    const tone = Math.sin(ph) * Math.exp(-t / 0.03);
    const x = rand() * 2 - 1; const clk = i < 0.006 * SR ? (x - prev) * 0.6 : 0; prev = x;
    dry[i] = (tone * 0.7 + clk) * gain;
  }
  return spatialize(dry, o.pan ?? 0, o.reverb ?? 0.18, 0.2);
}

/**
 * "Glue" a stereo SFX bus into one cohesive layer: a single SHARED reverb (so
 * every SFX sits in the same space) + light saturation. Run this once on the
 * summed bus AFTER placing dry SFX — the cohesion fix. In place.
 */
export function glueBus(L: Float32Array, R: Float32Array, opts: { space?: number; drive?: number } = {}): void {
  const space = opts.space ?? 0.25, drive = opts.drive ?? 0.15;
  if (space > 0) {
    const wl = reverbMono(L), wr = reverbMono(R);
    for (let i = 0; i < L.length; i++) { L[i] += wl[i]! * space; R[i] += wr[i]! * space; }
  }
  const d = 1 + drive * 2;
  for (let i = 0; i < L.length; i++) { L[i] = Math.tanh(L[i]! * d); R[i] = Math.tanh(R[i]! * d); }
}

export interface SubDropOptions { duration?: number; gain?: number; }
/** A low whump after an impact — sine dropping in pitch. */
export function subDrop(o: SubDropOptions = {}): Sfx {
  const dur = o.duration ?? 0.6, gain = o.gain ?? 0.4;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 70 * Math.exp(-t / 0.25) + 28; ph += (2 * Math.PI * f) / SR;
    dry[i] = Math.sin(ph) * Math.exp(-t / 0.3) * gain;
  }
  return spatialize(dry, 0, 0.15, 0.3);
}

// ── more of the catalog (see SFX-LIBRARY.md) ─────────────────────────────────

export interface TickOptions { gain?: number; seed?: number; pan?: Pan; reverb?: number; tune?: number; }
/** A tiny UI tick/tap — a short high blip + click. For small reveals/counters. */
export function tick(o: TickOptions = {}): Sfx {
  const gain = o.gain ?? 0.25, rand = rng(o.seed ?? 5), tune = o.tune ?? 220;
  const n = Math.floor(0.05 * SR), dry = new Float32Array(n);
  let ph = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * tune * 4) / SR;
    const tone = Math.sin(ph) * Math.exp(-t / 0.01);
    const x = rand() * 2 - 1; const clk = i < 0.003 * SR ? (x - prev) * 0.6 : 0; prev = x;
    dry[i] = (tone * 0.5 + clk) * gain;
  }
  return spatialize(dry, o.pan ?? 0, o.reverb ?? 0.1, 0.12);
}

export interface BraamOptions { duration?: number; gain?: number; seed?: number; reverb?: number; tune?: number; }
/** Cinematic dread hit — a detuned low brass/saw cluster (root+fifth+octave) +
 *  sub + noise rasp, slow swell, heavy saturation, long tail. Power & weight. */
export function braam(o: BraamOptions = {}): Sfx {
  const dur = o.duration ?? 1.6, gain = o.gain ?? 0.5, rand = rng(o.seed ?? 6), tune = o.tune ?? 110;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  const freqs = [tune * 0.5, tune, tune * 1.498, tune * 2];
  const det = [0, 0.4, -0.3, 0.6];
  const phs = freqs.map(() => 0);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    let v = 0;
    for (let j = 0; j < freqs.length; j++) {
      phs[j]! += (2 * Math.PI * (freqs[j]! + det[j]!)) / SR;
      v += Math.sin(phs[j]!) + 0.4 * Math.sin(2 * phs[j]!) + 0.2 * Math.sin(3 * phs[j]!); // brassy harmonics
    }
    v /= freqs.length;
    // rasp: LOWPASSED noise (a soft growl), not bright hiss
    const x = rand() * 2 - 1; lp += 0.06 * (x - lp); lp2 += 0.06 * (lp - lp2); const rasp = lp2 * 0.5;
    const env = Math.min(1, k / 0.25) * Math.min(1, (1 - k) / 0.3);
    dry[i] = Math.tanh((v * 0.5 + rasp) * env * 1.7) * gain; // moderate drive (less harsh)
  }
  return spatialize(dry, 0, o.reverb ?? 0.4, 0.6);
}

export interface DownlifterOptions { duration?: number; gain?: number; seed?: number; pan?: Pan; reverb?: number; tune?: number; }
/** A downer — noise band + tone pitching DOWN, falling away. Scene exit / release. */
export function downlifter(o: DownlifterOptions = {}): Sfx {
  const dur = o.duration ?? 1.0, gain = o.gain ?? 0.3, rand = rng(o.seed ?? 7), tune = o.tune ?? 220;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  let hpState = 0, lpState = 0, lpState2 = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const fc = 3000 - 2500 * k;
    const aH = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    const aL = 1 - Math.exp((-2 * Math.PI * (fc * 2.2)) / SR);
    const x = rand() * 2 - 1; hpState += aH * (x - hpState); const hp = x - hpState;
    lpState += aL * (hp - lpState); lpState2 += aL * (lpState - lpState2);
    const f = tune * (2 - 1.3 * k); ph += (2 * Math.PI * Math.max(40, f)) / SR;
    const tone = Math.sin(ph) * 0.28;
    const env = Math.min(1, k / 0.03) * Math.pow(1 - k, 0.9) * gain;
    dry[i] = (lpState2 * 1.05 + tone) * env;
  }
  return spatialize(dry, o.pan ?? 0, o.reverb ?? 0.3, 0.4);
}

export interface SweepOptions { duration?: number; gain?: number; seed?: number; reverb?: number; }
/** A wide resonant filter sweep — noise through a state-variable bandpass whose
 *  cutoff sweeps up, panned across the field. A clean transition wash. */
export function sweep(o: SweepOptions = {}): Sfx {
  const dur = o.duration ?? 0.6, gain = o.gain ?? 0.3, rand = rng(o.seed ?? 8);
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  let low = 0, band = 0;
  const q = 0.6; // lower = more resonant
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const fc = 200 + 7000 * k * k;
    const f = 2 * Math.sin((Math.PI * fc) / SR);
    const x = rand() * 2 - 1;
    const high = x - low - q * band; band += f * high; low += f * band;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, k / 0.95)), 1.3) * gain;
    dry[i] = band * env;
  }
  return spatialize(dry, [-0.7, 0.7], o.reverb ?? 0.25, 0.3);
}

export interface GlitchOptions { duration?: number; gain?: number; seed?: number; pan?: Pan; tune?: number; }
/** A digital glitch/stutter — bitcrushed + sample-held tone+noise, gated into
 *  retriggered slices. Dry-ish, modern/tech. */
export function glitch(o: GlitchOptions = {}): Sfx {
  const dur = o.duration ?? 0.25, gain = o.gain ?? 0.3, rand = rng(o.seed ?? 9), tune = o.tune ?? 220;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  const hold = 90;            // sample-hold (downsample) → digital aliasing
  const levels = 6;           // bitcrush quantization
  const slice = Math.floor(0.03 * SR); // stutter slice length
  let held = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const posInSlice = i % slice;
    if (i % hold === 0) {
      ph += (2 * Math.PI * tune * 2 * hold) / SR;
      const tone = Math.sin(ph) * 0.5;
      const noise = (rand() * 2 - 1) * 0.5;
      held = Math.round((tone + noise) * levels) / levels;
    }
    // gate: each slice fades fast → stutter feel
    const gate = posInSlice < slice * 0.6 ? 1 : 0;
    dry[i] = held * gate * gain;
  }
  return spatialize(dry, o.pan ?? 0, 0.08, 0.12);
}

export interface ShimmerOptions { duration?: number; gain?: number; reverb?: number; tune?: number; }
/** A bright sparkle for reveals — stacked high partials (octaves + fifths) with
 *  tremolo and a long bright tail. The "premium" sheen. */
export function shimmer(o: ShimmerOptions = {}): Sfx {
  const dur = o.duration ?? 1.0, gain = o.gain ?? 0.22, tune = o.tune ?? 220;
  const n = Math.floor(dur * SR), dry = new Float32Array(n);
  const parts = [tune * 2, tune * 3, tune * 4, tune * 6, tune * 8];
  const phs = parts.map(() => 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR, k = i / n;
    let v = 0;
    for (let j = 0; j < parts.length; j++) { phs[j]! += (2 * Math.PI * parts[j]!) / SR; v += Math.sin(phs[j]!) / (j + 1); }
    const trem = 0.7 + 0.3 * Math.sin(2 * Math.PI * 7 * t);
    const env = Math.min(1, k / 0.1) * Math.pow(1 - k, 0.6) * gain * trem;
    dry[i] = v * env;
  }
  return spatialize(dry, 0, o.reverb ?? 0.45, 0.7);
}
