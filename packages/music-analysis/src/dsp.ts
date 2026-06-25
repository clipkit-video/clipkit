// The analysis pipeline: PCM samples → tempo, phase, onsets, sections.
// Deterministic, dependency-free, built on the FFT in fft.ts.
//
//   STFT → spectral flux ─┬─ peak-pick → onsets (the actual hits, w/ band)
//                         └─ autocorrelation → tempo + phase → beat grid
//   frame RMS → novelty  ──→ section boundaries (structure)
//
// Tuned for music, verified against click tracks of known tempo. Section
// detection here is ENERGY-based (a build/drop reads as an energy jump); a
// timbral self-similarity pass is the future refinement.

import { magnitudeSpectrum } from './fft.js';
import type { Band, Marker, Onset, Section } from './beat-map.js';

const FRAME = 2048;
const HOP = 512;

interface Frames {
  flux: Float64Array;      // spectral flux onset envelope, per frame (0..1)
  bandFlux: Float64Array[]; // [low, mid, high] flux per frame
  rms: Float64Array;       // per-frame RMS energy
  dt: number;              // seconds per frame (HOP / sr)
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** STFT-derived per-frame features: spectral flux (overall + 3 bands) and RMS. */
function analyzeFrames(samples: Float32Array, sr: number): Frames {
  const win = hann(FRAME);
  const nFrames = Math.max(1, Math.floor((samples.length - FRAME) / HOP) + 1);
  const flux = new Float64Array(nFrames);
  const low = new Float64Array(nFrames);
  const mid = new Float64Array(nFrames);
  const high = new Float64Array(nFrames);
  const rms = new Float64Array(nFrames);

  const half = FRAME >> 1;
  // band edges in bins (bin width = sr / FRAME)
  const binHz = sr / FRAME;
  const loEdge = Math.round(200 / binHz);
  const hiEdge = Math.round(5000 / binHz);

  let prev = new Float64Array(half);
  const frame = new Float64Array(FRAME);
  for (let f = 0; f < nFrames; f++) {
    const start = f * HOP;
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = samples[start + i] ?? 0;
      energy += s * s;
      frame[i] = s * win[i]!;
    }
    rms[f] = Math.sqrt(energy / FRAME);
    const mag = magnitudeSpectrum(frame);
    let fl = 0, fLo = 0, fMid = 0, fHi = 0;
    for (let b = 1; b < half; b++) {
      const m = Math.log1p(mag[b]!); // log-compress for musical dynamics
      const d = m - prev[b]!;
      if (d > 0) {
        fl += d;
        if (b < loEdge) fLo += d;
        else if (b < hiEdge) fMid += d;
        else fHi += d;
      }
      prev[b] = m;
    }
    flux[f] = fl;
    low[f] = fLo; mid[f] = fMid; high[f] = fHi;
  }
  // normalize flux to [0,1]
  let mx = 0;
  for (let f = 0; f < nFrames; f++) if (flux[f]! > mx) mx = flux[f]!;
  if (mx > 0) for (let f = 0; f < nFrames; f++) flux[f]! /= mx;

  return { flux, bandFlux: [low, mid, high], rms, dt: HOP / sr };
}

/** Peak-pick onsets from the flux envelope: local maxima above an adaptive
 *  threshold, with a minimum inter-onset gap. */
function pickOnsets(fr: Frames): Onset[] {
  const { flux, bandFlux, dt } = fr;
  const n = flux.length;
  const w = Math.max(2, Math.round(0.05 / dt)); // local window ~50ms
  const meanW = Math.max(4, Math.round(0.1 / dt));
  const minGap = 0.07; // seconds
  const out: Onset[] = [];
  let lastT = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const v = flux[i]!;
    if (v < 0.06) continue;
    // local max?
    let isMax = true;
    for (let k = -w; k <= w; k++) if (flux[i + k] !== undefined && flux[i + k]! > v) { isMax = false; break; }
    if (!isMax) continue;
    // adaptive threshold: above the local mean by a margin
    let sum = 0, cnt = 0;
    for (let k = -meanW; k <= meanW; k++) { const x = flux[i + k]; if (x !== undefined) { sum += x; cnt++; } }
    if (v < (sum / cnt) * 1.4 + 0.03) continue;
    const t = i * dt;
    if (t - lastT < minGap) continue;
    lastT = t;
    // dominant band at this frame
    const lo = bandFlux[0]![i]!, md = bandFlux[1]![i]!, hi = bandFlux[2]![i]!;
    const band: Band = lo >= md && lo >= hi ? 'low' : hi >= md ? 'high' : 'mid';
    out.push({ time: t, strength: Math.min(1, v), band });
  }
  return out;
}

/** Autocorrelation tempo over 60–180 BPM, picking the strongest lag. */
function detectTempo(flux: Float64Array, dt: number): number {
  const n = flux.length;
  // de-mean
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i]!;
  mean /= n;
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = flux[i]! - mean;

  const lagMin = Math.max(1, Math.round((60 / 200) / dt));
  const lagMax = Math.round((60 / 60) / dt);
  const acf = new Float64Array(lagMax + 1);
  let bestLag = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i]! * env[i + lag]!;
    acf[lag] = s;
    // Perceptual tempo prior: a log-normal centred on 120 BPM nudges the octave
    // ambiguity toward the tactus humans tap.
    const bpm = 60 / (lag * dt);
    const score = s * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.8) ** 2);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // Octave-doubling: a four-on-the-floor track correlates strongly at the
  // half-bar (e.g. 60) because the backbeat repeats there — but if the
  // double-tempo pulse (the kick, 120) is well-supported, that's the real beat.
  for (;;) {
    const half = Math.round(bestLag / 2);
    const bpmD = 60 / (half * dt);
    if (half < lagMin || bpmD > 185 || acf[half]! < 0.5 * acf[bestLag]!) break;
    bestLag = half;
  }
  return Math.round((60 / (bestLag * dt)) * 10) / 10;
}

/** Best phase (time of beat 0) for a known tempo: the grid offset that lands on
 *  the most onset-envelope energy. */
function detectPhase(flux: Float64Array, bpm: number, dt: number): number {
  const periodF = 60 / bpm / dt; // frames per beat (float)
  const steps = Math.max(1, Math.round(periodF));
  let bestOff = 0;
  let bestScore = -Infinity;
  for (let o = 0; o < steps; o++) {
    let s = 0;
    for (let k = 0; o + k * periodF < flux.length; k++) s += flux[Math.round(o + k * periodF)]!;
    if (s > bestScore) { bestScore = s; bestOff = o; }
  }
  return Math.round(bestOff * dt * 1000) / 1000;
}

/** Energy-novelty section boundaries: sustained RMS changes split the track. */
function detectSections(rms: Float64Array, dt: number, duration: number): Section[] {
  const n = rms.length;
  // smooth RMS over ~0.4s
  const sw = Math.max(1, Math.round(0.4 / dt));
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -sw; k <= sw; k++) { const x = rms[i + k]; if (x !== undefined) { s += x; c++; } }
    sm[i] = s / c;
  }
  // novelty = |future mean − past mean| over a ~1.5s half-window
  const hw = Math.max(2, Math.round(1.5 / dt));
  const nov = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let pa = 0, pc = 0, fa = 0, fc = 0;
    for (let k = 1; k <= hw; k++) {
      if (sm[i - k] !== undefined) { pa += sm[i - k]!; pc++; }
      if (sm[i + k] !== undefined) { fa += sm[i + k]!; fc++; }
    }
    nov[i] = pc && fc ? Math.abs(fa / fc - pa / pc) : 0;
  }
  // peak-pick boundaries: local maxima, min section length, relative threshold
  let mx = 0;
  for (let i = 0; i < n; i++) if (nov[i]! > mx) mx = nov[i]!;
  const minLenF = Math.round(4 / dt); // ≥ 4s sections
  const boundaries: number[] = [0];
  if (mx > 0) {
    let last = -minLenF;
    for (let i = hw; i < n - hw; i++) {
      const v = nov[i]!;
      if (v < mx * 0.35) continue;
      let isMax = true;
      for (let k = -hw; k <= hw; k++) if (nov[i + k] !== undefined && nov[i + k]! > v) { isMax = false; break; }
      if (isMax && i - last >= minLenF) { boundaries.push(i); last = i; }
    }
  }
  // build sections, energy normalized to the loudest section
  const segs: { start: number; end: number; energy: number }[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const s = boundaries[b]!;
    const e = b + 1 < boundaries.length ? boundaries[b + 1]! : n;
    let sum = 0;
    for (let i = s; i < e; i++) sum += sm[i]!;
    segs.push({ start: s * dt, end: (b + 1 < boundaries.length ? e * dt : duration), energy: sum / Math.max(1, e - s) });
  }
  let emax = 0;
  for (const g of segs) if (g.energy > emax) emax = g.energy;
  return segs.map((g) => {
    const energy = emax > 0 ? Math.round((g.energy / emax) * 1000) / 1000 : 0;
    const label = energy < 0.34 ? 'low' : energy < 0.7 ? 'mid' : 'high';
    return { start: Math.round(g.start * 1000) / 1000, end: Math.round(g.end * 1000) / 1000, label, energy };
  });
}

export interface PcmAnalysis {
  bpm: number;
  phase: number;
  beats: Marker[];
  downbeats: Marker[];
  onsets: Onset[];
  sections: Section[];
}

/** Full analysis of mono PCM. Beats/downbeats are the regular grid implied by
 *  the detected tempo+phase; onsets are the actual detected transients. */
export function analyzePcm(samples: Float32Array, sr: number, beatsPerBar = 4): PcmAnalysis {
  const duration = samples.length / sr;
  const fr = analyzeFrames(samples, sr);
  const onsets = pickOnsets(fr);
  // Tempo/phase run on an ENERGY-flux envelope (half-wave-rectified RMS diff),
  // not the spectral flux: spectral flux over-weights broadband hits (claps,
  // snares) which biases toward the half-bar, while the energy envelope tracks
  // the kick pulse — the tactus. (Spectral flux still drives onset timing.)
  const tempoEnv = new Float64Array(fr.rms.length);
  for (let i = 1; i < fr.rms.length; i++) {
    const d = fr.rms[i]! - fr.rms[i - 1]!;
    tempoEnv[i] = d > 0 ? d : 0;
  }
  const bpm = detectTempo(tempoEnv, fr.dt);
  const phase = detectPhase(tempoEnv, bpm, fr.dt);

  const interval = 60 / bpm;
  const beats: Marker[] = [];
  const downbeats: Marker[] = [];
  for (let k = 0; ; k++) {
    const t = phase + k * interval;
    if (t > duration) break;
    if (t < 0) continue;
    const isDown = k % beatsPerBar === 0;
    const m: Marker = { time: Math.round(t * 1000) / 1000, strength: isDown ? 1 : 0.7 };
    beats.push(m);
    if (isDown) downbeats.push(m);
  }
  const sections = detectSections(fr.rms, fr.dt, duration);
  return { bpm, phase, beats, downbeats, onsets, sections };
}
