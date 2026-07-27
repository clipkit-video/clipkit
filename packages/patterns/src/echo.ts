// Text-echo / motion-trail patterns — the After Effects "Echo" family rebuilt in
// ClipKit. Each is just N copies of a word/digit offset in TIME (an Expr phase
// lag `t - lag·i`), POSITION, COLOR, or SCALE — no plugins. Every pattern returns
// ONE `group` so a single glow / clip / fade wraps the whole set; children are
// authored back-to-front for `assignLayers`. Built for a dark canvas.
//
// Live demos: the "Echo Tour" playground example. See also the AE recipe these
// mirror (Radio Waves + Reflection + Echo + Glow, etc.).

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

const e = (expr: string): { expr: string } => ({ expr });
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const WHITE = '#FFFFFF';

/** HSL → #rrggbb, so a trail can have any number of smooth rainbow copies. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hx = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

interface EchoBase {
  id: string;
  text: string;
  theme?: ThemeName;
  canvasWidth: number;
  canvasHeight: number;
  /** Centre point (default canvas centre). */
  cx?: number;
  cy?: number;
  fontSize?: number;
  time: number;
  duration: number;
  layer: number;
}

function group(p: EchoBase, children: UnlayeredElement[], effects?: Element extends { effects?: infer E } ? E : never): Element {
  return {
    id: p.id, type: 'group', layer: p.layer, time: p.time, duration: p.duration,
    elements: assignLayers(children),
    ...(effects ? { effects } : {}),
  } as Element;
}

// ─── Radio-wave echo ──────────────────────────────────────────────────────────
export interface RadioEchoProps extends EchoBase {
  color: ColorName;
  /** Echo count (default 12). */
  count?: number;
  /** Pulse speed in Hz (default 0.28). */
  speed?: number;
  /** Per-echo time lag — smaller = tighter trail in z/scale (default 0.02). */
  lag?: number;
  /** Smallest / largest scale of a wave (default 0.2 / 3.6). */
  minScale?: number;
  maxScale?: number;
  strokeWidth?: number;
}

/** Radio-wave echo — the AE "Echo comp" (Radio Waves [Image Contours] +
 *  Reflection + Echo + Glow). The number's OUTLINE radiates outward from the
 *  centre as concentric neon waves, bounces back off the frame edges, and the
 *  echoes trail closely behind, growing with it. Hollow = a black fill (invisible
 *  under `screen`) + a `stroke`; one `glow` on the group. Best with a single glyph. */
export function radioEcho(p: RadioEchoProps): Element {
  const W = p.canvasWidth, H = p.canvasHeight;
  const fonts = getFonts(p.theme ?? 'cinematic');
  const color = getPalette(p.theme ?? 'cinematic', p.color).accent;
  const count = p.count ?? 12, fs = p.fontSize ?? 340, sp = p.speed ?? 0.28, lag = p.lag ?? 0.02;
  const lo = p.minScale ?? 0.2, hi = p.maxScale ?? 3.6, sw = p.strokeWidth ?? 4;
  const span = (hi - lo).toFixed(2);
  const cx = p.cx ?? W / 2, cy = p.cy ?? H / 2;
  const children: UnlayeredElement[] = [];
  for (let i = count - 1; i >= 0; i--) { // back-to-front → leader (i=0) ends up on top
    const wave = `smoothstep(0, 1, 1 - abs(2*fract(t*${sp} - ${(i * lag).toFixed(3)}) - 1))`;
    children.push({
      id: `${p.id}-${i}`, type: 'text', text: p.text, x: cx, y: cy, x_anchor: '50%', y_anchor: '50%',
      font_family: fonts.sans, font_size: fs, font_weight: '800', letter_spacing: -6,
      fill_color: '#000000', blend_mode: 'screen',
      effects: [{ type: 'stroke', width: sw, color }],
      scale: e(`${lo} + ${span} * ${wave}`),
      opacity: e(`${(1 - (i / count) * 0.6).toFixed(3)} * (0.55 + 0.45*(1 - ${wave}))`),
    });
  }
  return group(p, children, [{ type: 'glow', radius: 16, intensity: 1.1, color }]);
}

// ─── Classic motion trail ─────────────────────────────────────────────────────
export interface EchoTrailProps extends EchoBase {
  color: ColorName;
  /** Number of copies incl. leader (default 7). */
  count?: number;
  /** Trail lag per copy, seconds (default 0.06). */
  lag?: number;
}

/** Classic Echo motion trail — a word follows a looping path with phase-lagged
 *  copies trailing behind it, fading out; the leader stays readable on top. */
export function echoTrail(p: EchoTrailProps): Element {
  const W = p.canvasWidth, H = p.canvasHeight;
  const fonts = getFonts(p.theme ?? 'cinematic');
  const color = getPalette(p.theme ?? 'cinematic', p.color).accent;
  const count = p.count ?? 7, lag = p.lag ?? 0.06, fs = p.fontSize ?? 140;
  const cx = p.cx ?? W / 2, cy = p.cy ?? H / 2;
  const ax = (W * 0.36).toFixed(0), ay = (H * 0.14).toFixed(0);
  const children: UnlayeredElement[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const L = (lag * i).toFixed(3);
    children.push({
      id: `${p.id}-${i}`, type: 'text', x_anchor: '50%', y_anchor: '50%', text: p.text,
      x: e(`${cx} + ${ax}*sin((t - ${L})*1.1)`),
      y: e(`${cy} + ${ay}*sin((t - ${L})*2.2)`),
      font_family: fonts.sans, font_size: fs, font_weight: '800', letter_spacing: -2,
      fill_color: i === 0 ? WHITE : color,
      opacity: i === 0 ? 1 : 0.5 * (1 - i / count),
    });
  }
  return group(p, children);
}

// ─── RGB split / chromatic aberration ────────────────────────────────────────
export interface RgbSplitProps extends EchoBase {
  /** Split amplitude in px (default 16). */
  amp?: number;
}

/** RGB split / chromatic aberration — pure red/green/blue copies on `screen`
 *  (they recombine to white) with R and B oscillating apart, so the glyph edges
 *  fringe and ghost. The colours ARE the effect, so this one isn't themed. */
export function rgbSplit(p: RgbSplitProps): Element {
  const W = p.canvasWidth, H = p.canvasHeight;
  const fonts = getFonts(p.theme ?? 'cinematic');
  const fs = p.fontSize ?? 190, amp = p.amp ?? 16;
  const cx = p.cx ?? W / 2, cy = p.cy ?? H / 2;
  const mk = (suffix: string, col: string, sign: string): UnlayeredElement => ({
    id: `${p.id}-${suffix}`, type: 'text', text: p.text, x_anchor: '50%', y_anchor: '50%',
    x: e(`${cx} + (${sign})*${amp}*sin(t*1.4)`),
    y: e(`${cy} + (${sign})*${(amp * 0.35).toFixed(2)}*cos(t*1.4)`),
    font_family: fonts.sans, font_size: fs, font_weight: '800', letter_spacing: -4,
    fill_color: col, blend_mode: 'screen',
  });
  return group(p, [mk('r', '#FF0000', '-1'), mk('g', '#00FF00', '0'), mk('b', '#0000FF', '1')]);
}

// ─── Rainbow echo ─────────────────────────────────────────────────────────────
export interface RainbowEchoProps extends EchoBase {
  /** Echo count (default 13). */
  count?: number;
  /** Trail lag per copy, seconds (default 0.06). */
  lag?: number;
}

/** Rainbow echo — a solid WHITE leader with many rainbow echoes trailing behind
 *  it on `screen`. The word eases UP and DOWN (sine), so the trail pools at the
 *  turns and stretches through the fast middle. Intrinsically multi-colour. */
export function rainbowEcho(p: RainbowEchoProps): Element {
  const W = p.canvasWidth, H = p.canvasHeight;
  const fonts = getFonts(p.theme ?? 'cinematic');
  const count = p.count ?? 13, lag = p.lag ?? 0.06, fs = p.fontSize ?? 150;
  const cx = p.cx ?? W / 2, cy = p.cy ?? H / 2, amp = (H * 0.31).toFixed(0);
  const children: UnlayeredElement[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const leader = i === 0;
    const hue = ((i - 1) / Math.max(1, count - 2)) * 290;
    children.push({
      id: `${p.id}-${i}`, type: 'text', text: p.text, x: cx, x_anchor: '50%', y_anchor: '50%',
      y: e(`${cy} + ${amp}*sin((t - ${(lag * i).toFixed(3)})*1.3)`),
      font_family: fonts.sans, font_size: fs, font_weight: '800', letter_spacing: -2,
      fill_color: leader ? WHITE : hslToHex(hue, 0.95, 0.58),
      blend_mode: leader ? undefined : 'screen',
      opacity: leader ? 1 : Math.max(0.3, 1 - (i / count) * 0.7),
    });
  }
  return group(p, children);
}

// ─── Disperse burst ───────────────────────────────────────────────────────────
export interface DisperseStackProps extends EchoBase {
  color: ColorName;
  /** Vertical gap between stacked copies, px (default 132). */
  gap?: number;
}

/** Disperse burst — copies start stacked dead-centre (hidden behind the leader),
 *  then burst outward simultaneously into a ladder (ease-out). No fade. */
export function disperseStack(p: DisperseStackProps): Element {
  const W = p.canvasWidth, H = p.canvasHeight;
  const fonts = getFonts(p.theme ?? 'cinematic');
  const color = getPalette(p.theme ?? 'cinematic', p.color).text;
  const fs = p.fontSize ?? 150, gap = p.gap ?? 132;
  const cx = p.cx ?? W / 2, cy = p.cy ?? H / 2;
  const children: UnlayeredElement[] = [];
  for (let k = 2; k >= -2; k--) { // outer copies first (back), leader (k=0) last (front)
    const stackY = cy + k * gap;
    const op = k === 0 ? 1 : Math.abs(k) === 1 ? 0.6 : 0.35;
    const base = {
      id: `${p.id}-${k}`, type: 'text' as const, text: p.text, x: cx, y: k === 0 ? cy : stackY,
      x_anchor: '50%' as const, y_anchor: '50%' as const,
      font_family: fonts.sans, font_size: fs, font_weight: '800', letter_spacing: -3,
      fill_color: k === 0 ? WHITE : color, opacity: op,
    };
    children.push(k === 0 ? base : { ...base, keyframe_animations: [{ property: 'y', keyframes: [{ time: 0, value: cy }, { time: 0.45, value: cy }, { time: 1.35, value: stackY, easing: EXPO_OUT }] }] });
  }
  return group(p, children);
}

// ─── Wiggly jitter ────────────────────────────────────────────────────────────
export interface WiggleJitterProps extends EchoBase {
  color: ColorName;
  /** Copy count (default 6). */
  count?: number;
  /** Jitter amplitude px / frequency Hz (default 26 / 3). */
  amp?: number;
  freq?: number;
}

/** Wiggly jitter — copies scattered by a per-copy `wiggle` seed, so the echoes
 *  shudder around the word instead of trailing smoothly. */
export function wiggleJitter(p: WiggleJitterProps): Element {
  const W = p.canvasWidth, H = p.canvasHeight;
  const fonts = getFonts(p.theme ?? 'cinematic');
  const color = getPalette(p.theme ?? 'cinematic', p.color).accent;
  const count = p.count ?? 6, fs = p.fontSize ?? 160, amp = p.amp ?? 26, fr = p.freq ?? 3;
  const cx = p.cx ?? W / 2, cy = p.cy ?? H / 2;
  const children: UnlayeredElement[] = [];
  for (let i = count - 1; i >= 0; i--) {
    children.push({
      id: `${p.id}-${i}`, type: 'text', text: p.text, x_anchor: '50%', y_anchor: '50%',
      x: e(`${cx} + wiggle(${fr}, ${amp}, ${i + 1})`),
      y: e(`${cy} + wiggle(${fr}, ${amp}, ${i + 21})`),
      font_family: fonts.sans, font_size: fs, font_weight: '800', letter_spacing: -2,
      fill_color: i === 0 ? WHITE : color, opacity: i === 0 ? 1 : 0.5,
    });
  }
  return group(p, children);
}
