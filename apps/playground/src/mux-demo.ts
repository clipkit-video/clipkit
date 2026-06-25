// Mux Remotion demo — recreation of github.com/davekiss/mux-remotion-demo
//
// 1920×1080, 30fps, 39.3s (1180 frames). A 7-scene year-in-review data
// video styled after the Mux Data dashboard. Every scene shares a Layout
// (Mux logo + scene title + date range) and a coloured body background.
//
// Built almost entirely from clipkit's native primitives: shapes (color
// cards, measure bars), text with `text_template`/vars for spring-driven
// count-up reveals, SVG element for the Mux logo + device icons + US
// states + browser logos, and audio for the soundtrack.

import type { Source } from '@clipkit/protocol';
import US_STATES_PATHS from './us-states-data.json';

// ────────────────────────────────────────────────────────────────────────────
// Color palette — Mux's brand colors lifted from their tailwind.config.js.
// ────────────────────────────────────────────────────────────────────────────

const MUX = {
  black: '#252525',
  gray: '#8e8e8e',
  red: '#DF2868',
  pink: '#ffecf6',
  pinkDarker: '#fb2491',
  pinkDarkest: '#d91377',
  green: '#eaf9e4',
  greenDarker: '#1FC3A8',
  greenDarkest: '#17A089',
  blue: '#e5f4ff',
  blueDarker: '#1CA0FD',
  blueDarkest: '#0B85DB',
  lavender: '#f5e4ff',
  purple: '#9620D8',
  yellow: '#FFF8E0',
  yellowDarker: '#FED32F',
  yellowDarkest: '#E99001',
  white: '#ffffff',
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Scene timing — matches Timeline.tsx frame counts (30fps).
// ────────────────────────────────────────────────────────────────────────────

const F = 1 / 30; // seconds per frame
const T = {
  intro: { start: 0, dur: 130 * F },                // 0 → 4.33s
  overall: { start: 130 * F, dur: 180 * F },        // 4.33 → 10.33
  devices: { start: 310 * F, dur: 180 * F },        // 10.33 → 16.33
  titles: { start: 490 * F, dur: 180 * F },         // 16.33 → 22.33
  states: { start: 670 * F, dur: 180 * F },         // 22.33 → 28.33
  browsers: { start: 850 * F, dur: 180 * F },       // 28.33 → 34.33
  outro: { start: 1030 * F, dur: 146 * F },         // 34.33 → 39.20
};
const TOTAL_DURATION = 1180 * F; // 39.33s

const W = 1920;
const H = 1080;

// ────────────────────────────────────────────────────────────────────────────
// Mux logo — 11 paths/ellipses ported from MuxLogo.tsx. Linear gradient
// runs orange → pink across the logo (matches the overall look; individual
// path gradient angles in the original are approximated by their position).
// ────────────────────────────────────────────────────────────────────────────

const MUX_LOGO_VB: [number, number, number, number] = [0, 0, 215, 70];

// Convert an ellipse (cx, cy, rx, ry) to two-arc path data.
function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

const MUX_LOGO_PATHS = [
  // Top-right diagonal of the X — opacity-0.7 layer.
  {
    d: 'M201.943724,67.069223 C204.891915,70.0191554 209.524787,70.0191554 212.262394,67.069223 C215.210585,64.1192905 215.210585,59.4836824 212.262394,56.7444595 L157.931437,2.38141892 C154.983246,-0.568513514 150.350374,-0.568513514 147.612767,2.38141892 C144.875161,5.33135135 144.664576,9.96695946 147.612767,12.7061824 L201.943724,67.069223 Z',
    opacity: 0.7,
  },
  // Bottom-right diagonal of the X.
  {
    d: 'M157.931437,67.7013514 C154.983246,70.6512838 150.350374,70.6512838 147.612767,67.7013514 C144.875161,64.7514189 144.664576,60.1158108 147.612767,57.3765878 L201.943724,3.0135473 C204.891915,0.0636148649 209.524787,0.0636148649 212.262394,3.0135473 C215,5.96347973 215.210585,10.5990878 212.262394,13.3383108 L157.931437,67.7013514 Z',
  },
  // U right-half — opacity 0.7.
  {
    d: 'M107.601598,54.6373649 C116.867343,54.6373649 124.448406,47.0518243 124.448406,37.7806081 L124.448406,7.85986486 C124.448406,3.64567568 127.607183,0.274324324 131.818885,0.274324324 C136.030587,0.274324324 139.189363,3.64567568 139.189363,7.85986486 L139.189363,37.5698986 C139.189363,55.0587838 125.080162,69.1763176 107.601598,69.1763176 C103.600481,69.1763176 100.23112,65.8049662 100.23112,61.8014865 C100.441705,57.7980068 103.600481,54.6373649 107.601598,54.6373649 Z',
    opacity: 0.7,
  },
  // M right vertical bar — opacity 0.7.
  {
    d: 'M62.3258012,0.906452703 C58.1140991,0.906452703 54.9553226,4.27780405 54.9553226,8.49199324 L54.9553226,62.2229054 C54.9553226,66.4370946 58.1140991,69.8084459 62.3258012,69.8084459 C66.5375032,69.8084459 69.6962797,66.4370946 69.6962797,62.2229054 L69.6962797,8.49199324 C69.6962797,4.27780405 66.5375032,0.906452703 62.3258012,0.906452703 Z',
    opacity: 0.7,
  },
  // U right pin (top).
  { d: ellipseToPath(131.818885, 7.64915541, 7.37047856, 7.37483108) },
  // X bottom-right pin.
  { d: ellipseToPath(207.629521, 62.4336149, 7.37047856, 7.37483108) },
  // M left vertical bar.
  {
    d: 'M7.57367471,0.683445946 C3.36197268,0.683445946 0.203196151,4.06570894 0.203196151,8.29353769 L0.203196151,62.1983542 C0.203196151,66.4261829 3.36197268,69.8084459 7.57367471,69.8084459 C11.7853768,69.8084459 14.9441533,66.4261829 14.9441533,62.1983542 L14.9441533,8.29353769 C14.9441533,4.06570894 11.7853768,0.683445946 7.57367471,0.683445946 Z',
  },
  // M bottom pin.
  { d: ellipseToPath(62.3258012, 62.4336149, 7.37047856, 7.37483108) },
  // M left-up diagonal — opacity 0.7.
  {
    d: 'M29.4745253,40.0984122 C32.4227167,43.0483446 37.055589,43.0483446 39.7931953,40.0984122 C42.5308016,37.1484797 42.7413867,32.5128716 39.7931953,29.7736486 L12.6277172,2.59212838 C9.89011083,-0.357804054 5.25723859,-0.357804054 2.30904717,2.59212838 C-0.639144256,5.54206081 -0.428559155,10.1776689 2.30904717,12.9168919 L29.4745253,40.0984122 Z',
    opacity: 0.7,
  },
  // M right-up diagonal.
  {
    d: 'M40.2143655,40.0984122 C37.2661741,43.0483446 32.6333018,43.0483446 29.8956955,40.0984122 C27.1580892,37.1484797 26.9475041,32.5128716 29.8956955,29.7736486 L57.0611736,2.59212838 C60.0093651,-0.357804054 64.6422373,-0.357804054 67.3798436,2.59212838 C70.3280351,5.54206081 70.3280351,10.1776689 67.3798436,12.9168919 L40.2143655,40.0984122 Z',
  },
  // U left-half.
  {
    d: 'M107.601598,54.6373649 C98.3358536,54.6373649 90.7547899,47.0518243 90.7547899,37.7806081 L90.7547899,7.85986486 C90.7547899,3.64567568 87.5960134,0.274324324 83.3843114,0.274324324 C79.1726093,0.274324324 76.0138328,3.64567568 76.0138328,7.85986486 L76.0138328,37.5698986 C76.0138328,55.0587838 90.1230346,69.1763176 107.601598,69.1763176 C111.602715,69.1763176 114.972077,65.8049662 114.972077,61.8014865 C114.761492,57.7980068 111.602715,54.6373649 107.601598,54.6373649 Z',
  },
];

/**
 * Build a MuxLogo SVG element. Defaults to left-aligned, vertically
 * centered (the natural anchoring for header use). Pass `x_anchor`/
 * `y_anchor` to override (e.g. 0.5 for centered placement in the outro).
 */
// TODO(layer): verify stacking direction — rename-and-kept old track value (default 50) under the new descending sort.
function muxLogoElement(opts: {
  id: string;
  x: number;
  y: number;
  width: number;
  x_anchor?: number;
  y_anchor?: number;
  layer?: number;
  time?: number;
  duration?: number;
}): Source['elements'][number] {
  const aspect = MUX_LOGO_VB[3] / MUX_LOGO_VB[2]; // 70/215
  return {
    id: opts.id,
    type: 'shape',
    layer: opts.layer ?? 50,
    time: opts.time ?? 0,
    duration: opts.duration ?? TOTAL_DURATION,
    x: opts.x,
    y: opts.y,
    x_anchor: opts.x_anchor ?? 0,
    y_anchor: opts.y_anchor ?? 0.5,
    width: opts.width,
    height: opts.width * aspect,
    view_box: MUX_LOGO_VB,
    gradients: [
      {
        id: 'mux-grad',
        type: 'linear',
        x1: 0,
        y1: 35,
        x2: 215,
        y2: 35,
        stops: [
          { offset: 0, color: '#FF4E00' },
          { offset: 1, color: '#FF1791' },
        ],
      },
    ],
    paths: MUX_LOGO_PATHS.map((p) => ({
      d: p.d,
      fill: 'url(#mux-grad)',
      opacity: p.opacity,
    })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layout helper — produces the per-scene header (Mux logo + title + date)
// plus the colored body background. Each scene calls this to get its frame.
// ────────────────────────────────────────────────────────────────────────────

// TODO(layer): verify stacking direction — layerBase scheme rename-and-kept (was trackBase ascending); not inverted.
function sceneHeader(opts: {
  scene: keyof typeof T;
  title?: string;
  dateRange?: string;
  bodyColor: string;
  layerBase: number;
}): Source['elements'] {
  const t = T[opts.scene];
  const out: Source['elements'] = [];

  // Colored body (bottom 80% of frame).
  out.push({
    id: `${opts.scene}-body`,
    type: 'shape',
    layer: opts.layerBase,
    time: t.start,
    duration: t.dur,
    shape: 'rectangle',
    x: W / 2,
    y: 216 + (H - 216) / 2,
    x_anchor: '50%',
    y_anchor: '50%',
    width: W,
    height: H - 216,
    fill_color: opts.bodyColor,
  });

  // Header background (top 20% = 216px of frame, white).
  out.push({
    id: `${opts.scene}-header-bg`,
    type: 'shape',
    layer: opts.layerBase + 1,
    time: t.start,
    duration: t.dur,
    shape: 'rectangle',
    x: W / 2,
    y: 108,
    x_anchor: '50%',
    y_anchor: '50%',
    width: W,
    height: 216,
    fill_color: MUX.white,
  });

  // Mux logo (left of header).
  out.push(
    muxLogoElement({
      id: `${opts.scene}-logo`,
      x: 80,
      y: 108,
      width: 220,
      layer: opts.layerBase + 2,
      time: t.start,
      duration: t.dur,
    }),
  );

  // Scene title — middle of header.
  if (opts.title) {
    out.push({
      id: `${opts.scene}-title`,
      type: 'text',
      layer: opts.layerBase + 3,
      time: t.start,
      duration: t.dur,
      text: opts.title,
      x: 380,
      y: 108,
      x_anchor: 0,
      font_family: 'Helvetica Neue, Helvetica, Arial, sans-serif',
      font_size: 36,
      font_weight: '400',
      fill_color: '#383838',
      animations: [{ type: 'fade-in', duration: 1.0 }],
    });
  }

  // Date range — right of header.
  if (opts.dateRange) {
    out.push({
      id: `${opts.scene}-date`,
      type: 'text',
      layer: opts.layerBase + 4,
      time: t.start,
      duration: t.dur,
      text: opts.dateRange,
      x: W - 80,
      y: 108,
      x_anchor: 1,
      font_family: 'Helvetica Neue, Helvetica, Arial, sans-serif',
      font_size: 28,
      font_weight: '400',
      fill_color: MUX.gray,
      animations: [{ type: 'fade-in', duration: 1.0 }],
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene 1 — Intro
// ────────────────────────────────────────────────────────────────────────────
// Title "Video stats overview" + date subtitle + "Powered by Mux Data" +
// 5-color horizontal bar strip.

function buildIntro(): Source['elements'] {
  const t = T.intro;
  const out: Source['elements'] = [];

  // White background body — no header colored stripe in this scene.
  out.push({
    id: 'intro-bg',
    type: 'shape',
    layer: 1,
    time: t.start,
    duration: t.dur,
    shape: 'rectangle',
    x: 0,
    y: 0,
    width: W,
    height: H,
    fill_color: MUX.white,
  });

  // Top-left Mux logo.
  out.push(
    muxLogoElement({
      id: 'intro-logo',
      x: 160,
      y: 160,
      width: 320,
      layer: 2,
      time: t.start,
      duration: t.dur,
    }),
  );

  // Hairline divider under title block — sits below the date text.
  out.push({
    id: 'intro-divider',
    type: 'shape',
    layer: 3,
    time: t.start,
    duration: t.dur,
    shape: 'rectangle',
    x: W / 2,
    y: 540,
    x_anchor: '50%',
    y_anchor: '50%',
    width: W - 320,
    height: 2,
    fill_color: '#e5e5e5',
  });

  // "Video stats overview" headline — slides up + fades in.
  out.push({
    id: 'intro-title',
    type: 'text',
    layer: 4,
    time: t.start + 5 * F,
    duration: t.dur - 5 * F,
    text: 'Video stats overview',
    x: 160,
    y: 320,
    x_anchor: 0,
    font_family: 'Helvetica Neue, Helvetica, Arial, sans-serif',
    font_size: 100,
    font_weight: '400',
    fill_color: MUX.black,
    animations: [
      { type: 'fade-in', duration: 0.67, easing: 'ease-out-cubic' },
      { type: 'slide-up-in', duration: 0.67, easing: 'ease-out-cubic' },
    ],
  });

  // "Nov. 17 - Dec. 16, 2021" subtitle.
  out.push({
    id: 'intro-date',
    type: 'text',
    layer: 5,
    time: t.start + 30 * F,
    duration: t.dur - 30 * F,
    text: 'Nov. 17 - Dec. 16, 2021',
    x: 160,
    y: 430,
    x_anchor: 0,
    font_family: 'Helvetica Neue, Helvetica, Arial, sans-serif',
    font_size: 80,
    font_weight: '300',
    fill_color: MUX.gray,
    animations: [
      { type: 'fade-in', duration: 0.67, easing: 'ease-out-cubic' },
      { type: 'slide-up-in', duration: 0.67, easing: 'ease-out-cubic' },
    ],
  });

  // "Powered by Mux Data" eyebrow text.
  out.push({
    id: 'intro-powered',
    type: 'text',
    layer: 6,
    time: t.start + 50 * F,
    duration: t.dur - 50 * F,
    text: 'POWERED BY MUX DATA',
    x: 160,
    y: 720,
    x_anchor: 0,
    font_family: 'Helvetica Neue, Helvetica, Arial, sans-serif',
    font_size: 32,
    font_weight: '400',
    letter_spacing: 4,
    fill_color: MUX.gray,
    animations: [{ type: 'fade-in', duration: 0.5 }],
  });

  // 5-color horizontal bar strip — pink / green / blue / lavender / yellow.
  const stripColors = [MUX.pinkDarker, MUX.greenDarker, MUX.blueDarker, MUX.purple, MUX.yellowDarker];
  const stripY = 820;
  const stripH = 24;
  const stripFullW = W - 320;
  const stripStart = 160;
  const segW = stripFullW / stripColors.length;
  // TODO(layer): verify stacking direction — `layer: 7 + i` loop rename-and-kept (was `track: 7 + i` ascending); not inverted.
  for (let i = 0; i < stripColors.length; i++) {
    out.push({
      id: `intro-strip-${i}`,
      type: 'shape',
      layer: 7 + i,
      time: t.start + (60 + i * 4) * F,
      duration: t.dur - (60 + i * 4) * F,
      shape: 'rectangle',
      x: stripStart + segW * (i + 0.5),
      y: stripY + stripH / 2,
      x_anchor: '50%',
      y_anchor: '50%',
      width: segW,
      height: stripH,
      fill_color: stripColors[i]!,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'scale-in', duration: 0.5, easing: 'ease-out-back' },
      ],
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable widgets: trend pill, stat block
// ────────────────────────────────────────────────────────────────────────────

const MONO_FONT = 'Menlo, Monaco, Consolas, monospace';
const SANS_FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';

/**
 * "+22.6% from last month" pill. Border is faked with stacked rectangles
 * (outer filled in the accent color, inner filled in bgColor). Animates
 * up from below with a spring.
 */
// TODO(layer): verify stacking direction — layerBase+0/+1/+2 rename-and-kept (was trackBase ascending); not inverted.
function trendPill(opts: {
  id: string;
  layerBase: number;
  time: number;
  duration: number;
  cx: number;
  cy: number;
  borderColor: string;
  bgColor: string;
  textColor: string;
  delta: number; // signed percentage (+ trending up, - trending down)
  width?: number;
  height?: number;
}): Source['elements'] {
  const w = opts.width ?? 460;
  const h = opts.height ?? 60;
  const sign = opts.delta >= 0 ? '+' : '-';
  const text = `${sign}${Math.abs(opts.delta).toFixed(1)}% FROM LAST MONTH`;

  const slide: Source['elements'][number]['animations'] = [
    { type: 'fade-in', duration: 0.4 },
    { type: 'slide-up-in', duration: 0.6, easing: 'ease-out-cubic' },
  ];

  return [
    // Outer border
    {
      id: `${opts.id}-border`,
      type: 'shape',
      layer: opts.layerBase,
      time: opts.time,
      duration: opts.duration,
      shape: 'rectangle',
      x: opts.cx,
      y: opts.cy,
      x_anchor: '50%',
      y_anchor: '50%',
      width: w,
      height: h,
      fill_color: opts.borderColor,
      border_radius: 12,
      animations: slide,
    },
    // Inner fill (creates the 2-px-equivalent border)
    {
      id: `${opts.id}-inner`,
      type: 'shape',
      layer: opts.layerBase + 1,
      time: opts.time,
      duration: opts.duration,
      shape: 'rectangle',
      x: opts.cx,
      y: opts.cy,
      x_anchor: '50%',
      y_anchor: '50%',
      width: w - 6,
      height: h - 6,
      fill_color: opts.bgColor,
      border_radius: 10,
      animations: slide,
    },
    // Text — nudged down a touch so uppercase glyphs look optically
    // centered (geometric box-center + uppercase = visually too high).
    {
      id: `${opts.id}-text`,
      type: 'text',
      layer: opts.layerBase + 2,
      time: opts.time,
      duration: opts.duration,
      text,
      x: opts.cx,
      y: opts.cy + 4,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: MONO_FONT,
      font_size: 26,
      font_weight: '600',
      letter_spacing: 1.5,
      fill_color: opts.textColor,
      animations: slide,
    },
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Scene 2 — Overall stats
// ────────────────────────────────────────────────────────────────────────────
// Pink body with two stat blocks (Total views, Minutes watched). Big numbers
// spring-count from 0 to their final value over the first second. Trend
// pills on the right show change from previous month.

const STATS_DATA = {
  totalViews: { current: 195654112, previous: 159560036 },
  totalWatchTime: { current: 3478645368, previous: 3226170994 }, // already / 10000
};

function trendPct(current: number, previous: number): number {
  return ((current - previous) / previous) * 100;
}

function buildOverall(): Source['elements'] {
  const t = T.overall;
  const out: Source['elements'] = sceneHeader({
    scene: 'overall',
    title: 'Overall stats',
    dateRange: 'Nov. 17 - Dec. 16 2021',
    bodyColor: MUX.pink,
    layerBase: 100,
  });

  // Body content area: padding 80px inside the body region (y=216..1080).
  const padX = 120;
  const contentX = padX;
  const contentRight = W - padX;
  const contentW = contentRight - contentX;

  // Two stat blocks stacked.
  const blockH = 280;
  const blockGap = 60;
  const firstTop = 380;
  const blockTops = [firstTop, firstTop + blockH + blockGap];

  const labels = ['Total views', 'Minutes watched'];
  const values = [STATS_DATA.totalViews, STATS_DATA.totalWatchTime];

  for (let i = 0; i < 2; i++) {
    const blockTop = blockTops[i]!;
    // TODO(layer): verify stacking direction — layerBase scheme rename-and-kept (was trackBase ascending); not inverted.
    const layerBase = 200 + i * 20;

    // Top border line (2px, pink-darker).
    out.push({
      id: `overall-border-${i}`,
      type: 'shape',
      layer: layerBase,
      time: t.start,
      duration: t.dur,
      shape: 'rectangle',
      x: W / 2,
      y: blockTop,
      x_anchor: '50%',
      y_anchor: '50%',
      width: contentW,
      height: 3,
      fill_color: MUX.pinkDarker,
    });

    // Big spring-counted number — anchored at top so the gap from the
    // divider line above is exactly what we set here.
    out.push({
      id: `overall-value-${i}`,
      type: 'text',
      layer: layerBase + 1,
      time: t.start,
      duration: t.dur,
      text_template: '{{n}}',
      vars: {
        n: [
          { time: 0, value: 0 },
          { time: 1.0, value: values[i]!.current, easing: 'ease-out-cubic' },
        ],
      },
      number_format: 'comma',
      x: contentX + 60,
      y: blockTop + 50,
      x_anchor: 0,
      y_anchor: 0,
      font_family: SANS_FONT,
      font_size: 160,
      font_weight: '300',
      fill_color: MUX.black,
    });

    // Label below the number.
    out.push({
      id: `overall-label-${i}`,
      type: 'text',
      layer: layerBase + 2,
      time: t.start + 10 * F,
      duration: t.dur - 10 * F,
      text: labels[i]!,
      x: contentX + 60,
      y: blockTop + 240,
      x_anchor: 0,
      y_anchor: 0,
      font_family: SANS_FONT,
      font_size: 36,
      font_weight: '400',
      fill_color: MUX.black,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // Trend pill on the right of the block.
    out.push(
      ...trendPill({
        id: `overall-pill-${i}`,
        layerBase: layerBase + 3,
        time: t.start + 15 * F,
        duration: t.dur - 15 * F,
        cx: contentRight - 280,
        cy: blockTop + 50,
        borderColor: MUX.pinkDarkest,
        bgColor: MUX.pink,
        textColor: MUX.pinkDarkest,
        delta: trendPct(values[i]!.current, values[i]!.previous),
      }),
    );
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// SVG primitive helpers (rounded rect → path; line → path)
// ────────────────────────────────────────────────────────────────────────────

function roundRectPath(x: number, y: number, w: number, h: number, rx = 0): string {
  if (rx === 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  return `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${rx} 0 0 1 ${x + w} ${y + rx} V ${y + h - rx} A ${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${rx} 0 0 1 ${x} ${y + h - rx} V ${y + rx} A ${rx} ${rx} 0 0 1 ${x + rx} ${y} Z`;
}

// ────────────────────────────────────────────────────────────────────────────
// Device icons (Mobile / Desktop / Tablet / TV) — Mux Data icon set
// ────────────────────────────────────────────────────────────────────────────

const ICON_STROKE = '#383838';

const ICON_MOBILE = {
  view_box: [0, 0, 32, 52] as [number, number, number, number],
  paths: [
    // Phone outline (rounded rect)
    { d: roundRectPath(2, 2, 27.801, 48, 4), stroke: ICON_STROKE, stroke_width: 3 },
    // Top + bottom speaker / button lines
    { d: 'M 2.467 7.58 H 30', stroke: ICON_STROKE, stroke_width: 2 },
    { d: 'M 2.467 44.48 H 30', stroke: ICON_STROKE, stroke_width: 2 },
  ],
};

const ICON_DESKTOP = {
  view_box: [0, 0, 78, 70] as [number, number, number, number],
  paths: [
    // Monitor outline
    { d: 'M 76 53.958 H 2 V 2 h 74 v 51.958 z', stroke: ICON_STROKE, stroke_width: 3 },
    // Stand + base
    { d: 'M 38.9 54.14 V 67.98', stroke: ICON_STROKE, stroke_width: 3 },
    { d: 'M 57.104 68 H 20.45', stroke: ICON_STROKE, stroke_width: 3, stroke_linecap: 'round' as const },
    // Bottom-of-screen line
    { d: 'M 2 45.637 h 74', stroke: ICON_STROKE, stroke_width: 2 },
  ],
};

const ICON_TABLET = {
  view_box: [0, 0, 52, 68] as [number, number, number, number],
  paths: [
    { d: roundRectPath(2, 2, 48, 64, 4), stroke: ICON_STROKE, stroke_width: 3 },
    { d: roundRectPath(7.106, 7, 37.787, 54, 1), stroke: ICON_STROKE, stroke_width: 2 },
  ],
};

const ICON_TV = {
  view_box: [0, 0, 104, 92] as [number, number, number, number],
  paths: [
    { d: 'M 2 2 H 102 V 78 H 2 Z', stroke: ICON_STROKE, stroke_width: 3 },
    { d: 'M 7 7 H 97 V 73 H 7 Z', stroke: ICON_STROKE, stroke_width: 2 },
    { d: 'M 24 78 L 12 90', stroke: ICON_STROKE, stroke_width: 3, stroke_linecap: 'round' as const },
    { d: 'M 94 90 L 82 78', stroke: ICON_STROKE, stroke_width: 3, stroke_linecap: 'round' as const },
  ],
};

// TODO(layer): verify stacking direction — layer passthrough rename-and-kept (was track); not inverted.
function iconSvg(opts: {
  id: string;
  icon: { view_box: [number, number, number, number]; paths: Array<{ d: string; stroke?: string; stroke_width?: number; stroke_linecap?: 'butt' | 'round' | 'square' }> };
  cx: number;
  cy: number;
  height: number;
  layer: number;
  time: number;
  duration: number;
  animations?: Source['elements'][number]['animations'];
}): Source['elements'][number] {
  const aspect = opts.icon.view_box[2] / opts.icon.view_box[3];
  const width = opts.height * aspect;
  return {
    id: opts.id,
    type: 'shape',
    layer: opts.layer,
    time: opts.time,
    duration: opts.duration,
    x: opts.cx,
    y: opts.cy,
    x_anchor: '50%',
    y_anchor: '50%',
    width,
    height: opts.height,
    view_box: opts.icon.view_box,
    paths: opts.icon.paths,
    animations: opts.animations,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Scene 3 — Views by device
// ────────────────────────────────────────────────────────────────────────────

const DEVICES_DATA = [
  { field: 'phone',   icon: ICON_MOBILE,  current: 130733672, previous: 133478441 },
  { field: 'desktop', icon: ICON_DESKTOP, current: 14470905,  previous: 15079609 },
  { field: 'tv',      icon: ICON_TV,      current: 4232855,   previous: 4010607 },
  { field: 'tablet',  icon: ICON_TABLET,  current: 3755811,   previous: 4466728 },
];

function buildDevices(): Source['elements'] {
  const t = T.devices;
  const out: Source['elements'] = sceneHeader({
    scene: 'devices',
    title: 'Views by device',
    dateRange: 'Nov. 17 - Dec. 16 2021',
    bodyColor: MUX.green,
    layerBase: 300,
  });

  const padX = 120;
  const rowX = padX;
  const rowRight = W - padX;
  const rowW = rowRight - rowX;
  const rowH = 168;
  const firstTop = 320;
  const leading = DEVICES_DATA[0]!.current;

  for (let i = 0; i < DEVICES_DATA.length; i++) {
    const d = DEVICES_DATA[i]!;
    const rowTop = firstTop + i * rowH;
    // TODO(layer): verify stacking direction — layerBase scheme rename-and-kept (was trackBase ascending); not inverted.
    const layerBase = 400 + i * 30;
    const stagger = (10 + 8 * i) * F;

    const slideIn = [
      { type: 'fade-in' as const, duration: 0.33, time: stagger },
      { type: 'slide-up-in' as const, duration: 0.6, easing: 'ease-out-cubic' as const, time: stagger },
    ];

    // White measure bar — grows from 0 to (views/leading)% of rowW.
    const measurePct = (d.current / leading) * 100;
    const measureFullW = (rowW * measurePct) / 100;
    out.push({
      id: `dev-measure-${i}`,
      type: 'shape',
      layer: layerBase,
      time: t.start + stagger + 10 * F,
      duration: t.dur - (stagger + 10 * F),
      shape: 'rectangle',
      x: rowX,
      y: rowTop,
      x_anchor: 0,
      y_anchor: 0,
      width: measureFullW,
      height: rowH,
      fill_color: MUX.white,
      keyframe_animations: [
        {
          property: 'width',
          keyframes: [
            { time: 0, value: 0 },
            // 1.6s with ease-out-quart approximates Remotion's heavily
            // overdamped `spring({ damping: 60 })` — fast start, long
            // slow tail toward the final value.
            { time: 1.6, value: measureFullW, easing: 'ease-out-quart' },
          ],
        },
      ],
    });

    // Top border (green-darker, 2px).
    out.push({
      id: `dev-border-${i}`,
      type: 'shape',
      layer: layerBase + 1,
      time: t.start,
      duration: t.dur,
      shape: 'rectangle',
      x: W / 2,
      y: rowTop,
      x_anchor: '50%',
      y_anchor: '50%',
      width: rowW,
      height: 3,
      fill_color: MUX.greenDarker,
      animations: slideIn,
    });

    // Icon on the far left.
    out.push(
      iconSvg({
        id: `dev-icon-${i}`,
        icon: d.icon,
        cx: rowX + 70,
        cy: rowTop + rowH / 2,
        height: 70,
        layer: layerBase + 2,
        time: t.start,
        duration: t.dur,
        animations: slideIn,
      }),
    );

    // Spring-counted value (after the icon).
    out.push({
      id: `dev-value-${i}`,
      type: 'text',
      layer: layerBase + 3,
      time: t.start + stagger,
      duration: t.dur - stagger,
      text_template: '{{n}}',
      vars: {
        n: [
          { time: 0, value: 0 },
          { time: 1.0, value: d.current, easing: 'ease-out-cubic' },
        ],
      },
      number_format: 'comma',
      x: rowX + 200,
      y: rowTop + rowH / 2,
      x_anchor: 0,
      font_family: SANS_FONT,
      font_size: 80,
      font_weight: '300',
      fill_color: MUX.black,
    });

    // Device label.
    out.push({
      id: `dev-label-${i}`,
      type: 'text',
      layer: layerBase + 4,
      time: t.start + stagger + 5 * F,
      duration: t.dur - (stagger + 5 * F),
      text: d.field === 'tv' ? 'TV' : d.field.charAt(0).toUpperCase() + d.field.slice(1),
      x: rowX + 900,
      y: rowTop + rowH / 2,
      x_anchor: 0,
      font_family: SANS_FONT,
      font_size: 36,
      font_weight: '400',
      fill_color: MUX.black,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // Trend pill on the far right.
    out.push(
      ...trendPill({
        id: `dev-pill-${i}`,
        layerBase: layerBase + 5,
        time: t.start + stagger + 8 * F,
        duration: t.dur - (stagger + 8 * F),
        cx: rowRight - 240,
        cy: rowTop + rowH / 2,
        borderColor: MUX.greenDarkest,
        bgColor: MUX.green,
        textColor: MUX.greenDarkest,
        delta: trendPct(d.current, d.previous),
        width: 440,
        height: 56,
      }),
    );
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene 4 — Top 10 videos by viewership
// ────────────────────────────────────────────────────────────────────────────

const TITLES_DATA = [
  { field: 'Burgandy Alert', views: 2733413 },
  { field: 'Tough Affection', views: 1694421 },
  { field: 'They Fell Hard', views: 782615 },
  { field: 'Gang of Criminals', views: 735770 },
  { field: 'Dad Saint Nick Returns', views: 620065 },
  { field: '911', views: 568323 },
  { field: 'Zombie Navy', views: 557327 },
  { field: 'Throwing', views: 538476 },
  { field: 'Changing of the Guards', views: 519590 },
  { field: 'The Gardner Games', views: 518008 },
];

function buildVideoTitles(): Source['elements'] {
  const t = T.titles;
  const out: Source['elements'] = sceneHeader({
    scene: 'titles',
    title: 'Top 10 videos by viewership',
    dateRange: 'Nov. 17 - Dec. 16 2021',
    bodyColor: MUX.lavender,
    layerBase: 500,
  });

  const padX = 120;
  const colGap = 40;
  const colW = (W - padX * 2 - colGap) / 2;

  const rowH = 130;
  const firstTop = 320;
  const maxViews = TITLES_DATA[0]!.views;

  for (let i = 0; i < TITLES_DATA.length; i++) {
    const v = TITLES_DATA[i]!;
    const colIdx = i < 5 ? 0 : 1;
    const rowIdx = i % 5;
    const rowTop = firstTop + rowIdx * rowH;
    const rowX = padX + colIdx * (colW + colGap);
    const rowRight = rowX + colW;
    // TODO(layer): verify stacking direction — layerBase scheme rename-and-kept (was trackBase ascending); not inverted.
    const layerBase = 600 + i * 10;
    const stagger = (10 + 6 * i) * F;

    // Animated measure bar (white) — fills the row so it touches the
    // next row's top border below.
    const measurePct = (v.views / maxViews) * 100;
    const measureFullW = (colW * measurePct) / 100;
    out.push({
      id: `title-measure-${i}`,
      type: 'shape',
      layer: layerBase,
      time: t.start + stagger,
      duration: t.dur - stagger,
      shape: 'rectangle',
      x: rowX,
      y: rowTop,
      x_anchor: 0,
      y_anchor: 0,
      width: measureFullW,
      height: rowH,
      fill_color: MUX.white,
      keyframe_animations: [
        {
          property: 'width',
          keyframes: [
            { time: 0, value: 0 },
            // 1.6s with ease-out-quart approximates Remotion's heavily
            // overdamped `spring({ damping: 60 })` — fast start, long
            // slow tail toward the final value.
            { time: 1.6, value: measureFullW, easing: 'ease-out-quart' },
          ],
        },
      ],
    });

    // Top border (purple, 2px).
    out.push({
      id: `title-border-${i}`,
      type: 'shape',
      layer: layerBase + 1,
      time: t.start,
      duration: t.dur,
      shape: 'rectangle',
      x: rowX + colW / 2,
      y: rowTop,
      x_anchor: '50%',
      y_anchor: '50%',
      width: colW,
      height: 3,
      fill_color: MUX.purple,
    });

    // Rank label (purple).
    out.push({
      id: `title-rank-${i}`,
      type: 'text',
      layer: layerBase + 2,
      time: t.start + stagger,
      duration: t.dur - stagger,
      text: `${i + 1}.`,
      x: rowX + 30,
      y: rowTop + rowH / 2,
      x_anchor: 0,
      font_family: SANS_FONT,
      font_size: 46,
      font_weight: '400',
      fill_color: MUX.purple,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // Title text.
    out.push({
      id: `title-text-${i}`,
      type: 'text',
      layer: layerBase + 3,
      time: t.start + stagger + 2 * F,
      duration: t.dur - (stagger + 2 * F),
      text: v.field,
      x: rowX + 100,
      y: rowTop + rowH / 2,
      x_anchor: 0,
      font_family: SANS_FONT,
      font_size: 46,
      font_weight: '400',
      fill_color: MUX.black,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // Views count (right-aligned).
    out.push({
      id: `title-views-${i}`,
      type: 'text',
      layer: layerBase + 4,
      time: t.start + stagger + 4 * F,
      duration: t.dur - (stagger + 4 * F),
      text: new Intl.NumberFormat('en-US').format(v.views),
      x: rowRight - 30,
      y: rowTop + rowH / 2,
      x_anchor: 1,
      font_family: SANS_FONT,
      font_size: 46,
      font_weight: '400',
      fill_color: MUX.black,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene 5 — US states heatmap
// ────────────────────────────────────────────────────────────────────────────
//
// Map paths are pre-generated by a one-shot d3-geo + topojson-client script
// (see /tmp/us-map-gen/gen.mjs in dev history) and committed as
// us-states-data.json. Each state's color is interpolated from a fixed
// orange-red to cream gradient based on its rank in the viewership data
// (matches the original `interpolateColors(rank, [1,50], [#FB501D, #FFF3C7])`).

const STATES_RANKING = [
  'California', 'New York', 'Texas', 'Florida', 'Illinois', 'Pennsylvania',
  null, 'Georgia', 'Massachusetts', 'New Jersey', 'Virginia', 'Ohio',
  'Washington', 'North Carolina', 'Michigan', 'Maryland', 'Minnesota',
  'Arizona', 'Colorado', 'Tennessee', 'Connecticut', 'Missouri', 'Wisconsin',
  'Utah', 'Indiana', 'Oregon', 'Iowa', 'South Carolina', 'Alabama', 'Nevada',
  'Oklahoma', 'Kentucky', 'Louisiana', 'Rhode Island', 'Nebraska',
  'District of Columbia', 'Kansas', 'Idaho', 'New Mexico', 'New Hampshire',
  'Arkansas', 'Maine', 'Mississippi', 'Hawaii', 'North Dakota', 'Montana',
  'South Dakota', 'West Virginia', 'Delaware', 'Vermont',
];

const STATES_TOP5 = [
  { field: 'California', value: 948353 },
  { field: 'New York',   value: 689209 },
  { field: 'Texas',      value: 539258 },
  { field: 'Florida',    value: 466148 },
  { field: 'Illinois',   value: 347139 },
];

function lerpHex(t: number, c1: [number, number, number], c2: [number, number, number]): string {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function stateColor(name: string): string {
  const idx = STATES_RANKING.indexOf(name);
  const val = idx >= 0 ? idx + 1 : 50;
  const t = (val - 1) / 49; // 0..1
  return lerpHex(t, [0xFB, 0x50, 0x1D], [0xFF, 0xF3, 0xC7]);
}

function buildStates(): Source['elements'] {
  const t = T.states;
  const out: Source['elements'] = sceneHeader({
    scene: 'states',
    title: 'Heatmap: top 5 states by overall views',
    dateRange: 'Nov. 17 - Dec. 16 2021',
    bodyColor: MUX.yellow,
    layerBase: 700,
  });

  // ── Map (left 2/3 of body) ────────────────────────────────────────────
  const mapW = 1200;
  const mapH = 600;
  const mapX = 80;
  const mapY = 350;

  out.push({
    id: 'states-map',
    type: 'shape',
    layer: 800,
    time: t.start + 5 * F,
    duration: t.dur - 5 * F,
    x: mapX,
    y: mapY,
    x_anchor: 0,
    y_anchor: 0,
    width: mapW,
    height: mapH,
    view_box: [0, 0, 1000, 500],
    paths: US_STATES_PATHS
      .filter((s): s is { name: string; d: string } => typeof s.d === 'string')
      .map((s) => ({
        d: s.d,
        fill: stateColor(s.name),
        stroke: MUX.yellowDarker,
        stroke_width: 1,
      })),
    animations: [{ type: 'fade-in', duration: 0.8 }],
  });

  // ── Top-5 list (right 1/3 of body) ────────────────────────────────────
  const listX = 1340;
  const listW = 500;
  const listRowH = 110;
  const listTop = 360;
  const maxVal = STATES_TOP5[0]!.value;

  for (let i = 0; i < STATES_TOP5.length; i++) {
    const s = STATES_TOP5[i]!;
    const rowTop = listTop + i * listRowH;
    // TODO(layer): verify stacking direction — layerBase scheme rename-and-kept (was trackBase ascending); not inverted.
    const layerBase = 850 + i * 10;
    const stagger = (10 + 6 * i) * F;

    const measurePct = (s.value / maxVal) * 100;
    const measureFullW = (listW * measurePct) / 100;

    // White measure bar — fills the row so it touches the next border.
    out.push({
      id: `states-measure-${i}`,
      type: 'shape',
      layer: layerBase,
      time: t.start + stagger,
      duration: t.dur - stagger,
      shape: 'rectangle',
      x: listX,
      y: rowTop,
      x_anchor: 0,
      y_anchor: 0,
      width: measureFullW,
      height: listRowH,
      fill_color: MUX.white,
      keyframe_animations: [
        {
          property: 'width',
          keyframes: [
            { time: 0, value: 0 },
            // 1.6s with ease-out-quart approximates Remotion's heavily
            // overdamped `spring({ damping: 60 })` — fast start, long
            // slow tail toward the final value.
            { time: 1.6, value: measureFullW, easing: 'ease-out-quart' },
          ],
        },
      ],
    });

    // Top border (yellow-darker).
    out.push({
      id: `states-border-${i}`,
      type: 'shape',
      layer: layerBase + 1,
      time: t.start,
      duration: t.dur,
      shape: 'rectangle',
      x: listX + listW / 2,
      y: rowTop,
      x_anchor: '50%',
      y_anchor: '50%',
      width: listW,
      height: 3,
      fill_color: MUX.yellowDarker,
    });

    // Rank (yellow-darkest).
    out.push({
      id: `states-rank-${i}`,
      type: 'text',
      layer: layerBase + 2,
      time: t.start + stagger,
      duration: t.dur - stagger,
      text: `0${i + 1}.`,
      x: listX + 20,
      y: rowTop + listRowH / 2,
      x_anchor: 0,
      font_family: SANS_FONT,
      font_size: 40,
      font_weight: '400',
      fill_color: MUX.yellowDarkest,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // State name.
    out.push({
      id: `states-name-${i}`,
      type: 'text',
      layer: layerBase + 3,
      time: t.start + stagger + 2 * F,
      duration: t.dur - (stagger + 2 * F),
      text: s.field,
      x: listX + 100,
      y: rowTop + listRowH / 2,
      x_anchor: 0,
      font_family: SANS_FONT,
      font_size: 40,
      font_weight: '400',
      fill_color: MUX.black,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // Value count (right-aligned).
    out.push({
      id: `states-value-${i}`,
      type: 'text',
      layer: layerBase + 4,
      time: t.start + stagger + 4 * F,
      duration: t.dur - (stagger + 4 * F),
      text: new Intl.NumberFormat('en-US').format(s.value),
      x: listX + listW - 20,
      y: rowTop + listRowH / 2,
      x_anchor: 1,
      font_family: SANS_FONT,
      font_size: 40,
      font_weight: '400',
      fill_color: MUX.black,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene 6 — Browsers
// ────────────────────────────────────────────────────────────────────────────
//
// 4 browser cards: animated pie chart (via SVG stroke-dashoffset trick),
// percentage label centered on the pie, view count, trend pill, and
// browser name label. Vertical dividers between adjacent cards.

const BROWSERS_DATA = [
  { field: 'Chrome',  logo: '/chrome.png',  current: 2233793, previous: 2337628 },
  { field: 'Safari',  logo: '/safari.png',  current: 950038,  previous: 1265800 },
  { field: 'Edge',    logo: '/edge.png',    current: 125273,  previous: 34685   },
  { field: 'Firefox', logo: '/firefox.png', current: 87807,   previous: 82536   },
];

function buildBrowsers(): Source['elements'] {
  const t = T.browsers;
  const out: Source['elements'] = sceneHeader({
    scene: 'browsers',
    title: 'Top browsers by views',
    dateRange: 'Nov. 17 - Dec. 16 2021',
    bodyColor: MUX.blue,
    layerBase: 900,
  });

  const totalViews = BROWSERS_DATA.reduce((sum, b) => sum + b.current, 0);
  const padX = 80;
  const cardW = (W - padX * 2) / 4;

  for (let i = 0; i < BROWSERS_DATA.length; i++) {
    const b = BROWSERS_DATA[i]!;
    const pct = (b.current / totalViews) * 100;
    const cardCx = padX + cardW * (i + 0.5);
    // TODO(layer): verify stacking direction — layerBase scheme rename-and-kept (was trackBase ascending); not inverted.
    // NOTE(layer): logo was `trackBase + 8.5` (fractional) -> `layerBase + 7` (free integer slot in this card; pill uses +4/+5/+6, logo-bg +8, name +9).
    const layerBase = 1000 + i * 30;
    const stagger = (10 + 5 * i) * F;

    // Vertical divider between cards (after cards 0, 1, 2).
    if (i < 3) {
      out.push({
        id: `br-divider-${i}`,
        type: 'shape',
        layer: layerBase,
        time: t.start + 5 * F,
        duration: t.dur - 5 * F,
        shape: 'rectangle',
        x: padX + cardW * (i + 1),
        y: 600,
        x_anchor: '50%',
        y_anchor: '50%',
        width: 3,
        height: 580,
        fill_color: MUX.blueDarker,
        animations: [{ type: 'fade-in', duration: 0.5 }],
      });
    }

    // Pie chart (SVG, animated stroke).
    out.push({
      id: `br-pie-${i}`,
      type: 'shape',
      layer: layerBase + 1,
      time: t.start + stagger,
      duration: t.dur - stagger,
      x: cardCx,
      y: 460,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 320,
      height: 320,
      view_box: [0, 0, 20, 20],
      paths: [
        {
          d: 'M 10 5 A 5 5 0 1 0 10 15 A 5 5 0 1 0 10 5 Z',
          stroke: MUX.white,
          stroke_width: 10,
          stroke_progress: [
            { time: 0, value: 0 },
            { time: 0.8, value: pct / 100, easing: 'ease-out-cubic' },
          ],
        },
      ],
    });

    // Percentage label centered on pie (animated count).
    out.push({
      id: `br-pct-${i}`,
      type: 'text',
      layer: layerBase + 2,
      time: t.start + stagger,
      duration: t.dur - stagger,
      text_template: '{{p}}%',
      vars: {
        p: [
          { time: 0, value: 0 },
          { time: 0.8, value: pct, easing: 'ease-out-cubic' },
        ],
      },
      number_format: 'decimal',
      x: cardCx,
      y: 440,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: SANS_FONT,
      font_size: 64,
      font_weight: '400',
      fill_color: MUX.black,
    });

    // View count below percentage.
    out.push({
      id: `br-views-${i}`,
      type: 'text',
      layer: layerBase + 3,
      time: t.start + stagger + 5 * F,
      duration: t.dur - (stagger + 5 * F),
      text_template: '{{n}} views',
      vars: {
        n: [
          { time: 0, value: 0 },
          { time: 0.8, value: b.current, easing: 'ease-out-cubic' },
        ],
      },
      number_format: 'comma',
      x: cardCx,
      y: 510,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: SANS_FONT,
      font_size: 32,
      font_weight: '400',
      fill_color: MUX.black,
    });

    // Trend pill.
    out.push(
      ...trendPill({
        id: `br-pill-${i}`,
        layerBase: layerBase + 4,
        time: t.start + stagger + 10 * F,
        duration: t.dur - (stagger + 10 * F),
        cx: cardCx,
        cy: 700,
        borderColor: MUX.blueDarkest,
        bgColor: MUX.blue,
        textColor: MUX.blueDarkest,
        delta: trendPct(b.current, b.previous),
        width: 380,
        height: 50,
      }),
    );

    // White rounded-square background for the logo.
    out.push({
      id: `br-logo-bg-${i}`,
      type: 'shape',
      layer: layerBase + 8,
      time: t.start + stagger + 15 * F,
      duration: t.dur - (stagger + 15 * F),
      shape: 'rectangle',
      x: cardCx,
      y: 850,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 132,
      height: 132,
      fill_color: MUX.white,
      border_radius: 16,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'scale-in', duration: 0.5, easing: 'ease-out-back' },
      ],
    });

    // Browser logo image on top of the white square.
    out.push({
      id: `br-logo-${i}`,
      type: 'image',
      layer: layerBase + 7,
      time: t.start + stagger + 17 * F,
      duration: t.dur - (stagger + 17 * F),
      source: b.logo,
      x: cardCx,
      y: 850,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 100,
      height: 100,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'scale-in', duration: 0.5, easing: 'ease-out-back' },
      ],
    });

    // Browser name label.
    out.push({
      id: `br-name-${i}`,
      type: 'text',
      layer: layerBase + 9,
      time: t.start + stagger + 18 * F,
      duration: t.dur - (stagger + 18 * F),
      text: b.field,
      x: cardCx,
      y: 980,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: SANS_FONT,
      font_size: 36,
      font_weight: '400',
      fill_color: MUX.black,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene 7 — Outro
// ────────────────────────────────────────────────────────────────────────────
//
// Particle convergence: ~500 orange / pink dots scatter across the frame
// and fly inward to assemble into the Mux logo shape, then the real
// gradient logo crossfades over them and holds before fading out. The
// original uses a pre-rendered webm; ours is generated live by sampling
// points along the logo's SVG paths and feeding them as target_points to
// the particle system.

/**
 * Sample points along the Mux logo paths, distributed proportional to
 * each path's length. Returns canvas-space coordinates for a logo placed
 * centered at (cx, cy) with the given width.
 */
function sampleMuxLogoPoints(cx: number, cy: number, width: number, totalPoints = 500): [number, number][] {
  const height = (width * 70) / 215;
  const left = cx - width / 2;
  const top = cy - height / 2;
  const sx = width / 215;
  const sy = height / 70;

  // First pass: measure each path's length.
  const measured: { path: SVGPathElement; svg: SVGSVGElement; length: number }[] = [];
  let totalLen = 0;
  for (const p of MUX_LOGO_PATHS) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', p.d);
    svg.appendChild(pathEl);
    document.body.appendChild(svg);
    const length = pathEl.getTotalLength();
    measured.push({ path: pathEl, svg, length });
    totalLen += length;
  }

  // Second pass: sample N_i points along each path proportional to length.
  const points: [number, number][] = [];
  for (const m of measured) {
    const share = Math.max(1, Math.round((m.length / totalLen) * totalPoints));
    for (let i = 0; i < share; i++) {
      const t = (i + 0.5) / share;
      const pt = m.path.getPointAtLength(t * m.length);
      points.push([left + pt.x * sx, top + pt.y * sy]);
    }
    document.body.removeChild(m.svg);
  }
  return points;
}

function buildOutro(): Source['elements'] {
  const t = T.outro;
  const out: Source['elements'] = [];

  const LOGO_W = 960;
  const LOGO_CX = W / 2;
  const LOGO_CY = H / 2;
  const targetPoints = sampleMuxLogoPoints(LOGO_CX, LOGO_CY, LOGO_W, 500);

  // White background.
  out.push({
    id: 'outro-bg',
    type: 'shape',
    layer: 1100,
    time: t.start,
    duration: t.dur,
    shape: 'rectangle',
    x: 0,
    y: 0,
    width: W,
    height: H,
    fill_color: MUX.white,
  });

  // Convergence particles — scattered across the canvas, fly into the
  // logo shape, then vanish quickly as the real logo takes over. Lifetime
  // sized so that the convergence completes around the same beat the
  // logo crossfade lands.
  out.push({
    id: 'outro-particles',
    type: 'particles',
    layer: 1101,
    time: t.start,
    // Element duration is the *visible* lifespan — particles get cut off
    // sharply here. The convergence math still runs on `lifetime` (1.6s),
    // which stretches the ease-out-quart curve so the opening looks
    // gentle before the curve accelerates the rest of the way in.
    duration: 1.05,
    x: LOGO_CX,
    y: LOGO_CY,
    x_anchor: '50%',
    y_anchor: '50%',
    burst: true,
    burst_count: targetPoints.length,
    lifetime: 1.6,
    size: 10,
    size_variation: 0.5,
    particle_shape: 'circle',
    color: ['#FF4E00', '#FF7019', '#FF1791', '#FF4080'],
    rotation_speed: 0,
    // Disable the built-in linear fade — we use a short ease-in fade-out
    // animation below for a sharper snap-off.
    fade_at: 1.0,
    target_points: targetPoints,
    convergence_easing: 'ease-out-quart',
    scatter_radius: 1100,
    animations: [
      { type: 'fade-out', duration: 0.15, easing: 'ease-in-cubic', time: 'end' },
    ],
  });

  // Real logo fades in just as the particles arrive, then quick fade-out
  // at the end of the outro.
  out.push(
    muxLogoElement({
      id: 'outro-logo',
      x: LOGO_CX,
      y: LOGO_CY,
      x_anchor: 0.5,
      y_anchor: 0.5,
      width: LOGO_W,
      layer: 1102,
      time: t.start + 0.93,
      duration: t.dur - 0.93,
    }),
  );
  out[out.length - 1] = {
    ...out[out.length - 1]!,
    animations: [
      // 0.15s fade-in runs concurrently with the particle fade-out
      // (0.9–1.05) so neither layer drops to 0 — clean crossfade, no flash.
      { type: 'fade-in', duration: 0.15, easing: 'ease-out-cubic' },
      { type: 'fade-out', duration: 0.3, time: 'end' },
    ],
  } as Source['elements'][number];

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene assembly + export
// ────────────────────────────────────────────────────────────────────────────

export const MUX_DEMO: Source = {
  output_format: 'mp4',
  width: W,
  height: H,
  duration: TOTAL_DURATION,
  frame_rate: 30,
  elements: [
    // Soundtrack — runs the full length of the video.
    {
      id: 'mux-audio',
      type: 'audio',
      layer: 12,
      time: 0,
      duration: TOTAL_DURATION,
      source: '/mux-audio.mp3',
    },
    ...buildIntro(),
    ...buildOverall(),
    ...buildDevices(),
    ...buildVideoTitles(),
    ...buildStates(),
    ...buildBrowsers(),
    ...buildOutro(),
  ],
};
