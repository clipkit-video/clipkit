// Demo sources for the playground. Each one is a hand-crafted Clipkit
// project that exercises a different subset of the runtime — typography,
// shapes, captions, named-preset animations, keyframe animations.
//
// Pick one from the dropdown. Edit it live on the left pane.

import type { Source } from '@clipkit/protocol';
import { MUX_DEMO } from './mux-demo';

// ─── Original "Hello Clipkit" demo ─────────────────────────────────────────

export const HELLO_CLIPKIT: Source = {
  output_format: 'mp4',
  width: 1920,
  height: 1080,
  duration: 10,
  frame_rate: 30,
  elements: [
    {
      id: 'bg',
      type: 'shape',
      layer: 4,
      time: 0,
      duration: 10,
      shape: 'rectangle',
      x: 960,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 1600,
      height: 800,
      fill_color: '#1e293b',
      border_radius: 40,
      opacity: 100,
    },
    {
      id: 'accent',
      type: 'shape',
      layer: 3,
      time: 0,
      duration: 10,
      shape: 'ellipse',
      x: 400,
      y: 300,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 300,
      height: 300,
      fill_color: '#3b82f6',
      opacity: 100,
      animations: [
        { type: 'scale-in', duration: 0.8, easing: 'ease-out-back' },
        { type: 'fade-out', duration: 0.5, time: 'end' },
      ],
    },
    {
      id: 'title',
      type: 'text',
      layer: 2,
      time: 0,
      duration: 10,
      text: 'Hello Clipkit!',
      x: 960,
      y: 380,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 96,
      font_weight: 'bold',
      fill_color: '#ffffff',
      opacity: 100,
      animations: [
        { type: 'fade-in', duration: 1.0 },
        { type: 'slide-up-in', duration: 1.0, easing: 'ease-out-cubic' },
      ],
    },
    {
      id: 'captions',
      type: 'caption',
      layer: 1,
      time: 1,
      duration: 8,
      x: 960,
      y: 760,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 64,
      font_weight: 'bold',
      fill_color: '#ffffff',
      highlight_color: '#ffd60a',
      style: 'tiktok_bounce',
      words: [
        { text: 'Word', start: 0, end: 0.45 },
        { text: 'timed', start: 0.45, end: 0.95 },
        { text: 'captions', start: 0.95, end: 1.7 },
        { text: 'with', start: 1.7, end: 2.0 },
        { text: 'kinetic', start: 2.0, end: 2.6 },
        { text: 'styles!', start: 2.6, end: 3.6 },
      ],
    },
  ],
};

// ─── Launch teaser (16:9, 1920×1080, 8s) ───────────────────────────────────
// Clean brand reveal: wordmark scales in, tagline slides up, second line
// of copy replaces the first, gracefully fades out.

export const LAUNCH_TEASER: Source = {
  output_format: 'mp4',
  width: 1920,
  height: 1080,
  duration: 8,
  frame_rate: 30,
  background_color: '#0a0e27',
  elements: [
    // Solid navy background (the schema's background_color is set, but the
    // current runtime doesn't yet read it — we layer a shape to be safe).
    {
      id: 'bg',
      type: 'shape',
      layer: 7,
      time: 0,
      duration: 8,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      fill_color: '#0a0e27',
      opacity: 100,
    },
    // Three accent dots across the top — visual structure.
    {
      id: 'dot1',
      type: 'shape',
      layer: 6,
      time: 0.4,
      duration: 7.6,
      shape: 'ellipse',
      x: 880,
      y: 140,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 24,
      height: 24,
      fill_color: '#8b5cf6',
      animations: [{ type: 'fade-in', duration: 0.4 }, { type: 'scale-in', duration: 0.6, easing: 'ease-out-back' }],
    },
    {
      id: 'dot2',
      type: 'shape',
      layer: 5,
      time: 0.55,
      duration: 7.45,
      shape: 'ellipse',
      x: 960,
      y: 140,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 24,
      height: 24,
      fill_color: '#f97316',
      animations: [{ type: 'fade-in', duration: 0.4 }, { type: 'scale-in', duration: 0.6, easing: 'ease-out-back' }],
    },
    {
      id: 'dot3',
      type: 'shape',
      layer: 4,
      time: 0.7,
      duration: 7.3,
      shape: 'ellipse',
      x: 1040,
      y: 140,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 24,
      height: 24,
      fill_color: '#22d3ee',
      animations: [{ type: 'fade-in', duration: 0.4 }, { type: 'scale-in', duration: 0.6, easing: 'ease-out-back' }],
    },
    // Big "Clipkit" wordmark — center, bold.
    {
      id: 'wordmark',
      type: 'text',
      layer: 3,
      time: 0.3,
      duration: 7.7,
      text: 'Clipkit',
      x: 960,
      y: 480,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 220,
      font_weight: 'bold',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.6 },
        { type: 'scale-in', duration: 0.8, easing: 'ease-out-back' },
        { type: 'fade-out', duration: 0.6, time: 'end' },
      ],
    },
    // Tagline 1: visible 1.5s → 4.5s
    {
      id: 'tagline1',
      type: 'text',
      layer: 2,
      time: 1.5,
      duration: 3.0,
      text: 'The video runtime for AI.',
      x: 960,
      y: 640,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 56,
      font_weight: '500',
      fill_color: '#94a3b8',
      animations: [
        { type: 'fade-in', duration: 0.6 },
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.5, time: 'end' },
      ],
    },
    // Tagline 2: visible 5.0s → 7.5s (after tagline1 fades)
    {
      id: 'tagline2',
      type: 'text',
      layer: 1,
      time: 5.0,
      duration: 2.5,
      text: 'JSON in. Video out.',
      x: 960,
      y: 640,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 56,
      font_weight: '500',
      fill_color: '#94a3b8',
      animations: [
        { type: 'fade-in', duration: 0.6 },
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.5, time: 'end' },
      ],
    },
  ],
};

// ─── Social ad — 9:16 (1080×1920, 10s) ─────────────────────────────────────
// Punchy mobile ad. Big bold messaging stacks vertically, then kinetic
// captions at the bottom carry the value prop.

export const SOCIAL_AD: Source = {
  output_format: 'mp4',
  width: 1080,
  height: 1920,
  duration: 10,
  frame_rate: 30,
  background_color: '#0a0e27',
  elements: [
    {
      id: 'bg',
      type: 'shape',
      layer: 7,
      time: 0,
      duration: 10,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      fill_color: '#0a0e27',
    },
    // Big accent circle behind the heading.
    {
      id: 'orb',
      type: 'shape',
      layer: 6,
      time: 0,
      duration: 10,
      shape: 'ellipse',
      x: 540,
      y: 580,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 720,
      height: 720,
      fill_color: '#8b5cf6',
      opacity: 22,
      animations: [
        { type: 'scale-in', duration: 1.2, easing: 'ease-out-cubic' },
      ],
    },
    // Headline — three stacked lines, staggered reveal.
    {
      id: 'h1',
      type: 'text',
      layer: 5,
      time: 0.2,
      duration: 9.5,
      text: 'Stop',
      x: 540,
      y: 420,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 180,
      font_weight: 'bold',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.5 },
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
      ],
    },
    {
      id: 'h2',
      type: 'text',
      layer: 4,
      time: 0.7,
      duration: 9.0,
      text: 'writing React',
      x: 540,
      y: 580,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 110,
      font_weight: 'bold',
      fill_color: '#f97316',
      animations: [
        { type: 'fade-in', duration: 0.5 },
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
      ],
    },
    {
      id: 'h3',
      type: 'text',
      layer: 3,
      time: 1.3,
      duration: 8.4,
      text: 'for video.',
      x: 540,
      y: 720,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 110,
      font_weight: 'bold',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.5 },
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
      ],
    },
    // Word-timed captions at the bottom carrying the value prop.
    // Demonstrates the new auto-fit + relative-units support:
    //   width: "90%"     — element width = 90% of canvas width (= 972px on 1080×1920)
    //   font_size: "auto" — font size computed so the joined caption text fits in `width`
    {
      id: 'caps',
      type: 'caption',
      layer: 2,
      time: 3.5,
      duration: 6.0,
      x: 540,
      y: 1500,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '90%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: 'bold',
      fill_color: '#ffffff',
      highlight_color: '#22d3ee',
      style: 'tiktok_bounce',
      words: [
        { text: 'Just', start: 0, end: 0.45 },
        { text: 'write', start: 0.45, end: 0.95 },
        { text: 'JSON.', start: 0.95, end: 1.7 },
        { text: 'Get', start: 1.9, end: 2.25 },
        { text: 'video.', start: 2.25, end: 3.0 },
        { text: 'Built', start: 3.3, end: 3.7 },
        { text: 'for', start: 3.7, end: 4.0 },
        { text: 'agents.', start: 4.0, end: 5.0 },
      ],
    },
    // Wordmark footer.
    {
      id: 'mark',
      type: 'text',
      layer: 1,
      time: 8.5,
      duration: 1.5,
      text: 'clipkit.dev',
      x: 540,
      y: 1780,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 56,
      font_weight: '500',
      fill_color: '#94a3b8',
      animations: [{ type: 'fade-in', duration: 0.5 }],
    },
  ],
};

// ─── Motion test — exercises the named-preset library (16:9, 5s) ───────────
// No text-heavy storytelling — just a dense animation demo. Useful for
// eyeballing easing curves and timing.

export const MOTION_TEST: Source = {
  output_format: 'mp4',
  width: 1920,
  height: 1080,
  duration: 5,
  frame_rate: 30,
  background_color: '#000000',
  elements: [
    {
      id: 'bg',
      type: 'shape',
      layer: 7,
      time: 0,
      duration: 5,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      fill_color: '#020617',
    },
    // A row of five shapes, each entering with a different preset.
    {
      id: 's1',
      type: 'shape',
      layer: 6,
      time: 0.1,
      duration: 4.8,
      shape: 'ellipse',
      x: 320,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 200,
      height: 200,
      fill_color: '#ef4444',
      animations: [
        { type: 'bounce-in', duration: 0.8 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 's2',
      type: 'shape',
      layer: 5,
      time: 0.3,
      duration: 4.6,
      shape: 'rectangle',
      x: 640,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 200,
      height: 200,
      fill_color: '#f97316',
      border_radius: 40,
      animations: [
        { type: 'scale-in', duration: 0.6, easing: 'ease-out-back' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 's3',
      type: 'shape',
      layer: 4,
      time: 0.5,
      duration: 4.4,
      shape: 'ellipse',
      x: 960,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 200,
      height: 200,
      fill_color: '#22d3ee',
      animations: [
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 's4',
      type: 'shape',
      layer: 3,
      time: 0.7,
      duration: 4.2,
      shape: 'rectangle',
      x: 1280,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 200,
      height: 200,
      fill_color: '#8b5cf6',
      border_radius: 100, // = ellipse-equivalent at this size, but via rounded rect
      animations: [
        { type: 'rotate-in', duration: 0.7, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 's5',
      type: 'shape',
      layer: 2,
      time: 0.9,
      duration: 4.0,
      shape: 'ellipse',
      x: 1600,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 200,
      height: 200,
      fill_color: '#22c55e',
      animations: [
        { type: 'slide-down-in', duration: 0.7, easing: 'ease-out-back' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // Label
    {
      id: 'label',
      type: 'text',
      layer: 1,
      time: 1.5,
      duration: 3.0,
      text: 'Five presets. One schema.',
      x: 960,
      y: 820,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 64,
      font_weight: 'bold',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.5 },
        { type: 'slide-up-in', duration: 0.6, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
  ],
};

// ─── Wrapped-style "year in review" stat card (9:16, 8s) ───────────────────
// Vibrant pink → purple gradient, huge spring-driven stat, supporting numbers.
// Exercises: linear gradient, spring easing, font_size auto/vh, multi-stop.

export const WRAPPED_STATS: Source = {
  output_format: 'mp4',
  width: 1080,
  height: 1920,
  duration: 8,
  frame_rate: 30,
  elements: [
    // Vibrant 3-stop gradient: pink → purple → deep violet.
    {
      id: 'bg',
      type: 'shape',
      layer: 7,
      time: 0,
      duration: 8,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      gradient: {
        type: 'linear',
        angle: 135,
        stops: [
          { offset: 0, color: '#ff0080' },
          { offset: 0.55, color: '#9333ea' },
          { offset: 1, color: '#3b0764' },
        ],
      },
    },
    {
      id: 'kicker',
      type: 'text',
      layer: 6,
      time: 0.3,
      duration: 7.7,
      text: 'YOUR YEAR',
      x: 540,
      y: 500,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '700',
      fill_color: '#fbcfe8',
      animations: [
        { type: 'fade-in', duration: 0.6 },
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
      ],
    },
    // The big stat — spring-driven scale-in is the signature Remotion moment.
    {
      id: 'big-stat',
      type: 'text',
      layer: 5,
      time: 0.8,
      duration: 7.2,
      text: '1,247',
      x: 540,
      y: 820,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#ffd60a',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'scale-in', duration: 1.2, easing: 'spring' },
      ],
    },
    {
      id: 'big-label',
      type: 'text',
      layer: 4,
      time: 1.7,
      duration: 6.3,
      text: 'videos created',
      x: 540,
      y: 1100,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '500',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.5 },
        { type: 'slide-up-in', duration: 0.7, easing: 'ease-out-cubic' },
      ],
    },
    // Supporting stats stack — spring slide-ups give each one a beat.
    {
      id: 'stat-1',
      type: 'text',
      layer: 3,
      time: 3.2,
      duration: 4.8,
      text: '240 hours of footage',
      x: 540,
      y: 1340,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '85%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '700',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.7, easing: 'spring' },
      ],
    },
    {
      id: 'stat-2',
      type: 'text',
      layer: 2,
      time: 3.9,
      duration: 4.1,
      text: '23 GB rendered',
      x: 540,
      y: 1470,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '700',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.7, easing: 'spring' },
      ],
    },
    {
      id: 'mark',
      type: 'text',
      layer: 1,
      time: 5.8,
      duration: 2.2,
      text: 'clipkit.dev',
      x: 540,
      y: 1780,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: '2.5vh',
      font_weight: '600',
      fill_color: '#fbcfe8',
      animations: [{ type: 'fade-in', duration: 0.6 }],
    },
  ],
};

// ─── Cinematic title sequence (16:9, 8s) ───────────────────────────────────
// Dark radial-gradient stage, elegant typography, slow spring on the wordmark.
// The opposite vibe from Wrapped — calm, dramatic, A24 / Apple-keynote.

export const CINEMATIC_OPENER: Source = {
  output_format: 'mp4',
  width: 1920,
  height: 1080,
  duration: 8,
  frame_rate: 30,
  elements: [
    // Radial gradient: subtle light center fading to deep navy at edges.
    // This is the "vignette" effect — without blur we approximate via gradient.
    {
      id: 'bg',
      type: 'shape',
      layer: 4,
      time: 0,
      duration: 8,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      gradient: {
        type: 'radial',
        cx: 0.5,
        cy: 0.5,
        radius: 0.75,
        stops: [
          { offset: 0, color: '#1e293b' },
          { offset: 0.55, color: '#0f172a' },
          { offset: 1, color: '#020617' },
        ],
      },
    },
    {
      id: 'kicker',
      type: 'text',
      layer: 3,
      time: 0.5,
      duration: 6.5,
      text: 'INTRODUCING',
      x: 960,
      y: 380,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '40%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '500',
      fill_color: '#94a3b8',
      animations: [
        { type: 'fade-in', duration: 1.0 },
        { type: 'fade-out', duration: 0.8, time: 'end' },
      ],
    },
    // The wordmark — slow spring is the signature beat.
    {
      id: 'wordmark',
      type: 'text',
      layer: 2,
      time: 1.3,
      duration: 5.7,
      text: 'Clipkit',
      x: 960,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '50%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.8 },
        { type: 'scale-in', duration: 1.4, easing: 'spring' },
        { type: 'fade-out', duration: 0.8, time: 'end' },
      ],
    },
    {
      id: 'tagline',
      type: 'text',
      layer: 1,
      time: 3.2,
      duration: 4.0,
      text: 'The video runtime for AI.',
      x: 960,
      y: 760,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '60%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '400',
      fill_color: '#cbd5e1',
      animations: [
        { type: 'fade-in', duration: 0.9 },
        { type: 'slide-up-in', duration: 0.9, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.7, time: 'end' },
      ],
    },
  ],
};

// ─── TikTok viral hook (9:16, 10s) ─────────────────────────────────────────
// "POV:" reveal → stacked spring text → kinetic captions. The viral creator
// formula: hook → escalate → payoff.

export const VIRAL_HOOK: Source = {
  output_format: 'mp4',
  width: 1080,
  height: 1920,
  duration: 10,
  frame_rate: 30,
  elements: [
    // Deep purple gradient — dramatic, not vibrant.
    {
      id: 'bg',
      type: 'shape',
      layer: 6,
      time: 0,
      duration: 10,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      gradient: {
        type: 'linear',
        angle: 180,
        stops: [
          { offset: 0, color: '#0c0a1e' },
          { offset: 1, color: '#3b1758' },
        ],
      },
    },
    {
      id: 'pov',
      type: 'text',
      layer: 5,
      time: 0.2,
      duration: 9.8,
      text: 'POV: you discover',
      x: 540,
      y: 420,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '85%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '700',
      fill_color: '#e9d5ff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.6, easing: 'spring' },
      ],
    },
    {
      id: 'h1',
      type: 'text',
      layer: 4,
      time: 0.9,
      duration: 9.1,
      text: 'a video engine',
      x: 540,
      y: 660,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '85%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.8, easing: 'spring' },
      ],
    },
    {
      id: 'h2',
      type: 'text',
      layer: 3,
      time: 1.6,
      duration: 8.4,
      text: 'that AI can use',
      x: 540,
      y: 850,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '85%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#22d3ee',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.8, easing: 'spring' },
      ],
    },
    // Word-timed payoff at the bottom.
    {
      id: 'caps',
      type: 'caption',
      layer: 2,
      time: 3.2,
      duration: 6.8,
      x: 540,
      y: 1450,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '90%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: 'bold',
      fill_color: '#ffffff',
      highlight_color: '#ffd60a',
      style: 'tiktok_bounce',
      words: [
        { text: 'No', start: 0, end: 0.3 },
        { text: 'more', start: 0.3, end: 0.6 },
        { text: 'React.', start: 0.6, end: 1.3 },
        { text: 'Just', start: 1.6, end: 1.9 },
        { text: 'JSON.', start: 1.9, end: 2.7 },
        { text: 'Built', start: 3.0, end: 3.3 },
        { text: 'for', start: 3.3, end: 3.5 },
        { text: 'agents.', start: 3.5, end: 4.5 },
      ],
    },
    {
      id: 'mark',
      type: 'text',
      layer: 1,
      time: 8.5,
      duration: 1.5,
      text: 'clipkit.dev',
      x: 540,
      y: 1780,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: '2.8vh',
      font_weight: '500',
      fill_color: '#c4b5fd',
      animations: [{ type: 'fade-in', duration: 0.4 }],
    },
  ],
};

// ─── Code Wrapped — github-unwrapped-style year-in-review (9:16, 15s) ─────
//
// Multi-scene narrative with the github-unwrapped signature beats:
//   1. Title reveal (spring-stacked text)
//   2. Big stat #1 (commits) — number lands with confetti burst
//   3. Repo grid — 16 tiles wipe in across the screen
//   4. Big stat #2 (languages) — colored language dots stagger in
//   5. Finale (top %) — second confetti burst
//   6. Outro
//
// Two particle elements:
//   - Ambient "snow" drizzle running the full length for atmosphere
//   - Two confetti bursts at the celebration peaks
//
// Total: 15 seconds, no external assets — all shapes + text + gradients +
// springs + particles.

const REPO_TILE_COLORS = ['#22d3ee', '#a855f7', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6'];
const CONFETTI_PALETTE = ['#ef4444', '#f97316', '#fbbf24', '#22c55e', '#06b6d4', '#a855f7', '#ec4899'];
const LANGUAGE_COLORS = [
  { color: '#3178c6', name: 'TS' },
  { color: '#f7df1e', name: 'JS' },
  { color: '#3776ab', name: 'PY' },
  { color: '#00add8', name: 'GO' },
  { color: '#ce422b', name: 'RS' },
  { color: '#7f52ff', name: 'KT' },
  { color: '#fa7343', name: 'SW' },
  { color: '#22c55e', name: '+5' },
];

// Build the 16-tile repo grid programmatically — 4 columns × 4 rows of
// small rounded rectangles. Each tile staggers in with a tiny delay; the
// whole grid wipes in over ~0.8s.
function buildRepoGrid(): Source['elements'] {
  const tiles: Source['elements'] = [];
  const COLS = 4;
  const ROWS = 4;
  const TILE_W = 180;
  const TILE_H = 130;
  const GAP = 20;
  const totalW = COLS * TILE_W + (COLS - 1) * GAP;
  const totalH = ROWS * TILE_H + (ROWS - 1) * GAP;
  const originX = (1080 - totalW) / 2 + TILE_W / 2;
  const originY = 960 - totalH / 2 + TILE_H / 2;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const stagger = i * 0.04;
      // TODO(layer): verify stacking direction
      tiles.push({
        id: `repo-${i}`,
        type: 'shape',
        layer: 11,
        time: 6.8 + stagger,
        duration: 11.0 - 6.8 - stagger,
        shape: 'rectangle',
        x: originX + c * (TILE_W + GAP),
        y: originY + r * (TILE_H + GAP),
        x_anchor: '50%',
        y_anchor: '50%',
        width: TILE_W,
        height: TILE_H,
        fill_color: REPO_TILE_COLORS[i % REPO_TILE_COLORS.length]!,
        border_radius: 16,
        opacity: 80,
        animations: [
          { type: 'fade-in', duration: 0.35 },
          { type: 'scale-in', duration: 0.5, easing: 'spring' },
          { type: 'fade-out', duration: 0.5, time: 'end' },
        ],
      });
    }
  }
  return tiles;
}

function buildLanguageDots(): Source['elements'] {
  const dots: Source['elements'] = [];
  const COUNT = LANGUAGE_COLORS.length;
  const DOT = 110;
  const GAP = 18;
  const totalW = COUNT * DOT + (COUNT - 1) * GAP;
  const originX = (1080 - totalW) / 2 + DOT / 2;
  const y = 1140;

  for (let i = 0; i < COUNT; i++) {
    const stagger = i * 0.07;
    const lang = LANGUAGE_COLORS[i]!;
    // TODO(layer): verify stacking direction
    dots.push({
      id: `lang-dot-${i}`,
      type: 'shape',
      layer: 12,
      time: 8.4 + stagger,
      duration: 11.0 - 8.4 - stagger,
      shape: 'ellipse',
      x: originX + i * (DOT + GAP),
      y,
      x_anchor: '50%',
      y_anchor: '50%',
      width: DOT,
      height: DOT,
      fill_color: lang.color,
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'scale-in', duration: 0.6, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    });
    dots.push({
      id: `lang-label-${i}`,
      type: 'text',
      layer: 13,
      time: 8.5 + stagger,
      duration: 11.0 - 8.5 - stagger,
      text: lang.name,
      x: originX + i * (DOT + GAP),
      y,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'sans-serif',
      font_size: 36,
      font_weight: '800',
      fill_color: '#0a0e27',
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    });
  }
  return dots;
}

export const CODE_WRAPPED: Source = {
  output_format: 'mp4',
  width: 1080,
  height: 1920,
  duration: 15,
  frame_rate: 30,
  elements: [
    // ── Background: deep purple → navy radial gradient ──────────────────
    {
      id: 'bg',
      type: 'shape',
      layer: 1,
      time: 0,
      duration: 15,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      gradient: {
        type: 'radial',
        cx: 0.5,
        cy: 0.4,
        radius: 0.85,
        stops: [
          { offset: 0, color: '#3b1758' },
          { offset: 0.55, color: '#1a0f3a' },
          { offset: 1, color: '#06061a' },
        ],
      },
    },

    // ── Ambient drizzle running the whole length ────────────────────────
    {
      id: 'ambient-particles',
      type: 'particles',
      layer: 2,
      time: 0,
      duration: 15,
      x: 540,
      y: -40, // spawn just above the frame
      x_anchor: '50%',
      y_anchor: '50%',
      rate: 12,
      lifetime: 8,
      velocity: 30,
      direction: 90, // straight down (then drifts via spread)
      spread: 40,
      gravity: 8,
      size: 6,
      size_variation: 0.6,
      particle_shape: 'circle',
      color: ['#ffffff', '#c4b5fd', '#67e8f9'],
      rotation_speed: 0,
      fade_at: 0.5,
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 1 — Title (0.0s – 1.8s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'kicker-1',
      type: 'text',
      // TODO(layer): verify stacking direction — SCENE-1 trio shared old track 3; split to unique layers (back→front: kicker-1, title-year, title-tag)
      layer: 20,
      time: 0.3,
      duration: 1.7,
      text: 'YOUR',
      x: 540,
      y: 740,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '50%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '500',
      fill_color: '#c4b5fd',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.3, time: 'end' },
      ],
    },
    {
      id: 'title-year',
      type: 'text',
      layer: 19,
      time: 0.55,
      duration: 1.45,
      text: '2025',
      x: 540,
      y: 960,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'scale-in', duration: 0.9, easing: 'spring' },
        { type: 'fade-out', duration: 0.3, time: 'end' },
      ],
    },
    {
      id: 'title-tag',
      type: 'text',
      layer: 3,
      time: 1.0, // (SCENE-1 trio: front-most, keeps lowest layer)
      duration: 1.0,
      text: 'IN CODE',
      x: 540,
      y: 1200,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '60%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '700',
      fill_color: '#22d3ee',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.3, time: 'end' },
      ],
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 2 — Commits stat with confetti burst (1.8s – 6.5s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'commits-kicker',
      type: 'text',
      layer: 4,
      time: 2.0,
      duration: 4.3,
      text: 'you wrote',
      x: 540,
      y: 700,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '60%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '500',
      fill_color: '#c4b5fd',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'commits-number',
      type: 'text',
      layer: 5,
      time: 2.4,
      duration: 3.9,
      text: '8,447',
      x: 540,
      y: 980,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '80%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#fbbf24',
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'scale-in', duration: 1.0, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'commits-label',
      type: 'text',
      layer: 6,
      time: 3.1,
      duration: 3.2,
      text: 'commits',
      x: 540,
      y: 1240,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '50%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '600',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // CONFETTI BURST #1 — fires when the big number lands.
    {
      id: 'confetti-1',
      type: 'particles',
      layer: 7,
      time: 2.7,
      duration: 3.5,
      x: 540,
      y: 980,
      x_anchor: '50%',
      y_anchor: '50%',
      burst: true,
      burst_count: 140,
      lifetime: 3.0,
      velocity: 900,
      spread: 360,
      direction: -90,
      gravity: 700,
      size: 18,
      size_variation: 0.5,
      particle_shape: 'square',
      color: CONFETTI_PALETTE,
      rotation_speed: 540,
      fade_at: 0.75,
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 3 — Repo grid (6.5s – 8.4s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'repos-kicker',
      type: 'text',
      layer: 8,
      time: 6.5,
      duration: 4.5,
      text: 'across',
      x: 540,
      y: 480,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '40%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '500',
      fill_color: '#c4b5fd',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'repos-count',
      type: 'text',
      layer: 9,
      time: 6.7,
      duration: 4.3,
      text: '47 repos',
      x: 540,
      y: 660,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'scale-in', duration: 0.7, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // The grid of 16 tiles is generated programmatically below.
    ...buildRepoGrid(),

    // ════════════════════════════════════════════════════════════════════
    // SCENE 4 — Languages (8.4s – 11.0s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'langs-kicker',
      type: 'text',
      layer: 10,
      time: 8.4,
      duration: 2.6,
      text: 'in 12 languages',
      x: 540,
      y: 1380,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '700',
      fill_color: '#22d3ee',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    ...buildLanguageDots(),

    // ════════════════════════════════════════════════════════════════════
    // SCENE 5 — Finale (11.0s – 14.0s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'finale-1',
      type: 'text',
      layer: 14,
      time: 11.0,
      duration: 3.0,
      text: "you're in the",
      x: 540,
      y: 700,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '500',
      fill_color: '#c4b5fd',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'finale-percent',
      type: 'text',
      layer: 15,
      time: 11.4,
      duration: 2.6,
      text: 'TOP 3%',
      x: 540,
      y: 1000,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '80%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '900',
      fill_color: '#fbbf24',
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'scale-in', duration: 1.1, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'finale-context',
      type: 'text',
      layer: 16,
      time: 12.0,
      duration: 2.0,
      text: 'of GitHub devs',
      x: 540,
      y: 1280,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '60%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '600',
      fill_color: '#ffffff',
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.5, easing: 'spring' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // CONFETTI BURST #2 — bigger, longer.
    {
      id: 'confetti-2',
      type: 'particles',
      layer: 17,
      time: 11.7,
      duration: 3.3,
      x: 540,
      y: 1000,
      x_anchor: '50%',
      y_anchor: '50%',
      burst: true,
      burst_count: 200,
      lifetime: 3.5,
      velocity: 1100,
      spread: 360,
      direction: -90,
      gravity: 750,
      size: 20,
      size_variation: 0.55,
      particle_shape: 'square',
      color: CONFETTI_PALETTE,
      rotation_speed: 720,
      fade_at: 0.8,
    },

    // ════════════════════════════════════════════════════════════════════
    // OUTRO (14.0s – 15.0s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'outro-mark',
      type: 'text',
      layer: 18,
      time: 14.0,
      duration: 1.0,
      text: 'made with clipkit.dev',
      x: 540,
      y: 960,
      x_anchor: '50%',
      y_anchor: '50%',
      width: '70%',
      font_family: 'sans-serif',
      font_size: 'auto',
      font_weight: '600',
      fill_color: '#c4b5fd',
      animations: [{ type: 'fade-in', duration: 0.5 }],
    },
  ],
};

// ─── Vercel template — recreation of remotion-dev/template-vercel ─────────
//
// 1280×720, 30fps, 6.67s. Direct port of Remotion's Vercel template.
//
//   0.0–2.0s   Rings + Next.js logo (paths draw in with stroke evolution)
//   2.0–3.0s   Logo shrinks, rings scale outward to fill screen with white
//   2.5–end    Title "Vercel and Remotion" reveals with -45° linear wipe mask
//
// Exercises every feature added for the recreation:
//   - `svg` element with viewBox, linear gradients, clip-to-path, and
//     stroke_progress (the SVG stroke-dashoffset trick)
//   - keyframed width/height for the ring scale-out
//   - text `mask: { type: 'linear-wipe' }` for the diagonal reveal

const N_MASK_PATH =
  'M149.508 157.52L69.142 54H54V125.97H66.1136V69.3836L139.999 164.845C143.333 162.614 146.509 160.165 149.508 157.52Z';

// 6 visible plates with uniform edge-to-edge gaps. Outermost diameter
// matches Remotion's largest visible plate (1728 = h×0.3×8 ≈ canvas edge).
// Step in radius is 144 (= diameter step 288) so all 6 fit within the
// composition without one being effectively invisible off-canvas.
const RING_OUTER_DIAMETERS = [1728, 1440, 1152, 864, 576, 288]; // back → front
const RING_EXPLODE_SCALE = 8;

function ringScaleKeyframes(baseDiameter: number) {
  const exploded = baseDiameter * RING_EXPLODE_SCALE;
  return [
    {
      property: 'width',
      keyframes: [
        { time: 0, value: baseDiameter },
        { time: 2.0, value: baseDiameter },
        { time: 3.0, value: exploded, easing: 'ease-in-quart' as const },
      ],
    },
    {
      property: 'height',
      keyframes: [
        { time: 0, value: baseDiameter },
        { time: 2.0, value: baseDiameter },
        { time: 3.0, value: exploded, easing: 'ease-in-quart' as const },
      ],
    },
  ];
}

function buildRings(): Source['elements'] {
  // Each "ring" is a single white circle with a radial gradient that
  // brightens at the center and fades to a subtle gray at the edge —
  // approximating the original's `shadow-[0_0_100px_rgba(0,0,0,0.05)]`
  // soft drop shadow. When the smaller circles stack on top of larger
  // ones, the visible gray edges read as concentric soft "rings", and
  // each disc itself looks like a raised plate.
  const out: Source['elements'] = [];
  // TODO(layer): verify stacking direction
  let layer = 2;
  for (let i = 0; i < RING_OUTER_DIAMETERS.length; i++) {
    const d = RING_OUTER_DIAMETERS[i]!;
    out.push({
      id: `ring-${i}`,
      type: 'shape',
      layer: layer++,
      time: 0,
      duration: 3.0,
      shape: 'ellipse',
      x: 640,
      y: 360,
      x_anchor: '50%',
      y_anchor: '50%',
      width: d,
      height: d,
      gradient: {
        type: 'radial',
        cx: 0.5,
        cy: 0.5,
        radius: 0.5,
        stops: [
          // Reversed from the obvious "white center → gray edge": Remotion
          // stacks a smaller circle ON TOP of each larger one and the
          // smaller's blurred drop shadow lands on the larger's surface
          // near the smaller's edge. So globally the image darkens
          // toward the center and lightens toward the canvas edges.
          { offset: 0, color: '#d8d8d8' },
          { offset: 0.3, color: '#f0f0f0' },
          { offset: 1, color: '#ffffff' },
        ],
      },
      keyframe_animations: ringScaleKeyframes(d),
    });
  }
  return out;
}

export const VERCEL_TEMPLATE: Source = {
  output_format: 'mp4',
  width: 1280,
  height: 720,
  duration: 6.67,
  frame_rate: 30,
  elements: [
    // White background.
    {
      id: 'bg',
      type: 'shape',
      layer: 1,
      time: 0,
      duration: 6.67,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      fill_color: '#ffffff',
    },

    // Concentric rings (8 shapes — 4 outer/inner pairs).
    ...buildRings(),

    // Next.js logo — 4-path SVG with stroke evolution on each path,
    // clip-to-N-outline on the first two, gradient strokes.
    {
      id: 'next-logo',
      type: 'shape',
      layer: 100,
      time: 0,
      duration: 3.0,
      x: 640,
      y: 360,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 100,
      height: 100,
      view_box: [0, 0, 180, 180],
      gradients: [
        {
          id: 'gradient0',
          type: 'linear',
          x1: 109,
          y1: 116.5,
          x2: 144.5,
          y2: 160.5,
          stops: [
            { offset: 0, color: 'rgba(255,255,255,1)' },
            { offset: 1, color: 'rgba(255,255,255,0)' },
          ],
        },
        {
          id: 'gradient1',
          type: 'linear',
          x1: 121,
          y1: 54,
          x2: 120.799,
          y2: 106.875,
          stops: [
            { offset: 0, color: 'rgba(255,255,255,1)' },
            { offset: 1, color: 'rgba(255,255,255,0)' },
          ],
        },
      ],
      paths: [
        // Black disc — the logo's circular background.
        {
          d: 'M 0 90 A 90 90 0 1 0 180 90 A 90 90 0 1 0 0 90 Z',
          fill: '#000000',
        },
        // Stroke 1: left vertical of the "N", clipped to N outline.
        {
          d: 'M 60.0568 54 v 71.97',
          stroke: 'url(#gradient0)',
          stroke_width: 12.1136,
          stroke_progress: [
            { time: 0, value: 0 },
            { time: 1.0, value: 1, easing: 'ease-out-cubic' },
          ],
          clip_path: N_MASK_PATH,
        },
        // Stroke 2: diagonal of the "N", clipped to N outline (delayed 0.5s).
        {
          d: 'M 63.47956 56.17496 L 144.7535 161.1825',
          stroke: 'url(#gradient0)',
          stroke_width: 12.1136,
          stroke_progress: [
            { time: 0, value: 0 },
            { time: 0.5, value: 0 },
            { time: 1.5, value: 1, easing: 'ease-out-cubic' },
          ],
          clip_path: N_MASK_PATH,
        },
        // Stroke 3: right vertical accent (no clip, delayed 1s, max 0.7).
        {
          d: 'M 121 54 L 121 126',
          stroke: 'url(#gradient1)',
          stroke_width: 12,
          stroke_progress: [
            { time: 0, value: 0 },
            { time: 1.0, value: 0 },
            { time: 2.0, value: 0.7, easing: 'ease-out-cubic' },
          ],
        },
      ],
      // Shrink-out at the same time the rings explode.
      keyframe_animations: [
        {
          property: 'width',
          keyframes: [
            { time: 0, value: 100 },
            { time: 2.0, value: 100 },
            { time: 3.0, value: 0, easing: 'ease-in-cubic' },
          ],
        },
        {
          property: 'height',
          keyframes: [
            { time: 0, value: 100 },
            { time: 2.0, value: 100 },
            { time: 3.0, value: 0, easing: 'ease-in-cubic' },
          ],
        },
      ],
    },

    // Title text with diagonal mask reveal — starts at the midpoint of the
    // transition (frame 75 in Remotion's template).
    {
      id: 'title',
      type: 'text',
      layer: 200,
      time: 2.5,
      duration: 4.17,
      text: 'Vercel and Clipkit',
      x: 640,
      y: 360,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: 'Inter, sans-serif',
      font_size: 70,
      font_weight: 'bold',
      fill_color: '#000000',
      mask: {
        type: 'linear-wipe',
        angle: -45,
        progress: [
          { time: 0, value: 0 },
          { time: 2.67, value: 1, easing: 'ease-out-cubic' },
        ],
        softness: 0.3,
      },
    },
  ],
};

// ─── Clipkit launch video (16:9, 24s) ─────────────────────────────────────
//
// Authored against the Clipkit Brand Board. The brand is intentionally
// restrained dev-tool aesthetic (Vercel / Linear / Resend):
//   - Background #0A0A0A throughout. No gradients anywhere.
//   - Geist (sans) for headlines + body, Geist Mono for eyebrows + code.
//   - Two accent colors only: red #EF4444 and yellow #FFB800. Used
//     sparingly, ~90% neutral.
//   - The mark is three rounded bars (white / yellow / red) offset
//     horizontally and stacked — built here from three shape elements
//     whose widths animate in from 0, mimicking tracks rendering.
//
// Scene structure:
//   0–3s    Hook      Mono eyebrow + big diagonal-wipe headline
//   3–7s    Mark      The 3-bar logo draws in, "Clipkit" wordmark slides
//                     in beside it, mono tagline below
//   7–12s   Protocol  "Powered by the Clipkit Protocol" + tiny JSON snippet
//   12–18s  Stats     Three calm numbers (60 / 9 / 0) with mono captions
//   18–23s  CTA       Big Clipkit lockup + "clipkit.dev" mono mark
//   23–24s  Hold      Final still, then fade

const CK_BG = '#0A0A0A';
const CK_SURFACE = '#141414';
const CK_BORDER = '#232323';
const CK_FG = '#FAFAFA';
const CK_FG2 = '#E5E5E5';
const CK_MUTED = '#8A8A8A';
const CK_MUTED2 = '#5F5F5F';
const CK_RED = '#EF4444';
const CK_YELLOW = '#FFB800';

const GEIST = 'Geist, ui-sans-serif, system-ui, -apple-system, sans-serif';
const GEIST_MONO = 'Geist Mono, ui-monospace, "SF Mono", Menlo, monospace';

// ── Clipkit mark helper — three rounded bars (W, Y, R) offset horizontally,
//    each drawing in from width 0 with a small stagger.
function clipkitMark(opts: {
  id: string;
  /** Top-left x of the mark in canvas pixels. */
  x: number;
  /** Top-left y. */
  y: number;
  /** Overall width of the mark; height auto-scales to 38/44 of width. */
  width: number;
  time: number;
  duration: number;
  layerBase: number;
  /** Set to false to skip the width-grow animation (e.g. static CTA mark). */
  animateIn?: boolean;
}): Source['elements'] {
  // TODO(layer): verify stacking direction
  const { id, x, y, width, time, duration, layerBase } = opts;
  const animateIn = opts.animateIn ?? true;
  const height = (width * 38) / 44;
  const barW = width * 0.65;
  const barH = height * 0.29;
  const cornerR = barH * 0.18;

  const bars = [
    { fill: CK_FG, leftPct: 0.33, topPct: 0.0,   delay: 0.0 },
    { fill: CK_YELLOW, leftPct: 0.0,  topPct: 0.355, delay: 0.18 },
    { fill: CK_RED,    leftPct: 0.35, topPct: 0.71,  delay: 0.36 },
  ];

  return bars.map((b, i) => {
    const left = x + width * b.leftPct;
    const top = y + height * b.topPct;
    const base: Source['elements'][number] = {
      id: `${id}-bar-${i}`,
      type: 'shape',
      layer: layerBase + i,
      time,
      duration,
      shape: 'rectangle',
      x: left,
      y: top,
      x_anchor: 0,
      y_anchor: 0,
      width: barW,
      height: barH,
      fill_color: b.fill,
      border_radius: cornerR,
    };
    if (!animateIn) return base;
    return {
      ...base,
      keyframe_animations: [
        {
          property: 'width',
          keyframes: [
            { time: 0, value: 0 },
            { time: b.delay, value: 0 },
            { time: b.delay + 0.55, value: barW, easing: 'ease-out-cubic' },
          ],
        },
      ],
    };
  });
}

export const CLIPKIT_LAUNCH: Source = {
  output_format: 'mp4',
  width: 1920,
  height: 1080,
  duration: 24,
  frame_rate: 30,
  elements: [
    // ════════════════════════════════════════════════════════════════════
    // GLOBAL BACKGROUND
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'bg',
      type: 'shape',
      layer: 1,
      time: 0,
      duration: 24,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      fill_color: CK_BG,
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 1 — HOOK (0–3s)
    // ════════════════════════════════════════════════════════════════════
    // Mono eyebrow, top-left.
    {
      id: 'hook-eyebrow',
      type: 'text',
      layer: 10,
      time: 0.4,
      duration: 2.4,
      text: 'the video runtime',
      x: 120,
      y: 120,
      x_anchor: 0,
      font_family: GEIST_MONO,
      font_size: 22,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.3, time: 'end' },
      ],
    },
    // Big headline with diagonal wipe.
    {
      id: 'hook-headline',
      type: 'text',
      layer: 11,
      time: 0.6,
      duration: 2.4,
      text: 'JSON in. Video out.',
      x: 960,
      y: 540,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST,
      font_size: 160,
      font_weight: '600',
      letter_spacing: -5,
      fill_color: CK_FG,
      mask: {
        type: 'linear-wipe',
        angle: -45,
        progress: [
          { time: 0, value: 0 },
          { time: 1.2, value: 1, easing: 'ease-out-cubic' },
        ],
        softness: 0.3,
      },
      animations: [{ type: 'fade-out', duration: 0.4, time: 'end' }],
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 2 — MARK REVEAL (3–7s)
    // ════════════════════════════════════════════════════════════════════
    // Three bars draw in left-to-right with stagger.
    ...clipkitMark({
      id: 'mark-hero',
      x: 700,
      y: 450,
      width: 240,
      time: 3.0,
      duration: 3.8,
      layerBase: 20,
    }),
    // Wordmark "Clipkit" slides in after the bars are placed.
    {
      id: 'mark-hero-wordmark',
      type: 'text',
      layer: 25,
      time: 4.0,
      duration: 2.8,
      text: 'Clipkit',
      x: 980,
      y: 555,
      x_anchor: 0,
      font_family: GEIST,
      font_size: 140,
      font_weight: '600',
      letter_spacing: -3,
      fill_color: CK_FG,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-right-in', duration: 0.6, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // Mono tagline below the lockup.
    {
      id: 'mark-hero-tag',
      type: 'text',
      layer: 26,
      time: 4.6,
      duration: 2.2,
      text: 'the video runtime for AI',
      x: 960,
      y: 730,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 26,
      font_weight: '500',
      letter_spacing: 5,
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 3 — THE PROTOCOL (7–12s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'proto-eyebrow',
      type: 'text',
      layer: 30,
      time: 7.2,
      duration: 4.6,
      text: 'powered by the clipkit protocol',
      x: 960,
      y: 300,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 22,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.5 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'proto-headline-1',
      type: 'text',
      layer: 31,
      time: 7.5,
      duration: 4.3,
      text: 'A JSON timeline.',
      x: 960,
      y: 470,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST,
      font_size: 110,
      font_weight: '600',
      letter_spacing: -3,
      fill_color: CK_FG,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.6, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'proto-headline-2',
      type: 'text',
      layer: 32,
      time: 8.1,
      duration: 3.7,
      text: 'A finished video.',
      x: 960,
      y: 600,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST,
      font_size: 110,
      font_weight: '600',
      letter_spacing: -3,
      fill_color: CK_FG2,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-up-in', duration: 0.6, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // Tiny JSON sample below — one accent yellow word, monospace.
    {
      id: 'proto-json-1',
      type: 'text',
      layer: 33,
      time: 9.0,
      duration: 2.8,
      text: '{ "type": ',
      x: 720,
      y: 790,
      x_anchor: 0,
      font_family: GEIST_MONO,
      font_size: 28,
      font_weight: '500',
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'proto-json-2',
      type: 'text',
      layer: 34,
      time: 9.2,
      duration: 2.6,
      text: '"text"',
      x: 855,
      y: 790,
      x_anchor: 0,
      font_family: GEIST_MONO,
      font_size: 28,
      font_weight: '500',
      fill_color: CK_YELLOW,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'proto-json-3',
      type: 'text',
      layer: 35,
      time: 9.4,
      duration: 2.4,
      text: ', "x": ',
      x: 955,
      y: 790,
      x_anchor: 0,
      font_family: GEIST_MONO,
      font_size: 28,
      font_weight: '500',
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'proto-json-4',
      type: 'text',
      layer: 36,
      time: 9.6,
      duration: 2.2,
      text: '960',
      x: 1050,
      y: 790,
      x_anchor: 0,
      font_family: GEIST_MONO,
      font_size: 28,
      font_weight: '500',
      fill_color: CK_RED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'proto-json-5',
      type: 'text',
      layer: 37,
      time: 9.8,
      duration: 2.0,
      text: ' }',
      x: 1110,
      y: 790,
      x_anchor: 0,
      font_family: GEIST_MONO,
      font_size: 28,
      font_weight: '500',
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 4 — STATS (12–18s)
    // ════════════════════════════════════════════════════════════════════
    {
      id: 'stats-eyebrow',
      type: 'text',
      layer: 40,
      time: 12.0,
      duration: 5.8,
      text: 'built for the browser',
      x: 960,
      y: 280,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 22,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // Stat 1: 60 fps
    {
      id: 'stat-1-eyebrow',
      type: 'text',
      layer: 41,
      time: 12.4,
      duration: 5.4,
      text: 'render',
      x: 320,
      y: 460,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 18,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_MUTED2,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'stat-1-num',
      type: 'text',
      layer: 42,
      time: 12.5,
      duration: 5.3,
      text_template: '{{n}}',
      vars: {
        n: [
          { time: 0, value: 0 },
          { time: 1.2, value: 60, easing: 'ease-out-cubic' },
        ],
      },
      number_format: 'integer',
      x: 320,
      y: 600,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST,
      font_size: 220,
      font_weight: '600',
      letter_spacing: -6,
      fill_color: CK_FG,
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'stat-1-label',
      type: 'text',
      layer: 43,
      time: 13.0,
      duration: 4.8,
      text: 'fps WebGPU',
      x: 320,
      y: 760,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 22,
      font_weight: '500',
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },

    // Stat 2: 9 — accent yellow (the brand's "key emphasis" color)
    {
      id: 'stat-2-eyebrow',
      type: 'text',
      layer: 44,
      time: 12.7,
      duration: 5.1,
      text: 'elements',
      x: 960,
      y: 460,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 18,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_MUTED2,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'stat-2-num',
      type: 'text',
      layer: 45,
      time: 12.8,
      duration: 5.0,
      text_template: '{{n}}',
      vars: {
        n: [
          { time: 0, value: 0 },
          { time: 1.2, value: 9, easing: 'ease-out-cubic' },
        ],
      },
      number_format: 'integer',
      x: 960,
      y: 600,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST,
      font_size: 220,
      font_weight: '600',
      letter_spacing: -6,
      fill_color: CK_YELLOW,
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'stat-2-label',
      type: 'text',
      layer: 46,
      time: 13.3,
      duration: 4.5,
      text: 'element types',
      x: 960,
      y: 760,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 22,
      font_weight: '500',
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },

    // Stat 3: 0
    {
      id: 'stat-3-eyebrow',
      type: 'text',
      layer: 47,
      time: 13.0,
      duration: 4.8,
      text: 'config',
      x: 1600,
      y: 460,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 18,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_MUTED2,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'stat-3-num',
      type: 'text',
      layer: 48,
      time: 13.1,
      duration: 4.7,
      text: '0',
      x: 1600,
      y: 600,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST,
      font_size: 220,
      font_weight: '600',
      letter_spacing: -6,
      fill_color: CK_FG,
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    {
      id: 'stat-3-label',
      type: 'text',
      layer: 49,
      time: 13.6,
      duration: 4.2,
      text: 'config required',
      x: 1600,
      y: 760,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 22,
      font_weight: '500',
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },

    // ════════════════════════════════════════════════════════════════════
    // SCENE 5 — CTA (18–23s)
    // ════════════════════════════════════════════════════════════════════
    // Big mark lockup, static (already-rendered look).
    ...clipkitMark({
      id: 'mark-cta',
      x: 660,
      y: 420,
      width: 320,
      time: 18.0,
      duration: 4.8,
      layerBase: 50,
    }),
    {
      id: 'mark-cta-wordmark',
      type: 'text',
      layer: 53,
      time: 18.7,
      duration: 4.1,
      text: 'Clipkit',
      x: 1010,
      y: 560,
      x_anchor: 0,
      font_family: GEIST,
      font_size: 180,
      font_weight: '600',
      letter_spacing: -4,
      fill_color: CK_FG,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'slide-right-in', duration: 0.5, easing: 'ease-out-cubic' },
        { type: 'fade-out', duration: 0.5, time: 'end' },
      ],
    },
    // Mono CTA mark.
    {
      id: 'cta-url',
      type: 'text',
      layer: 54,
      time: 19.4,
      duration: 3.4,
      text: 'clipkit.dev',
      x: 960,
      y: 780,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 36,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_FG2,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.5, time: 'end' },
      ],
    },
    // Small red emphasis dot (the brand's "single red dot" pattern).
    {
      id: 'cta-dot',
      type: 'shape',
      layer: 55,
      time: 19.8,
      duration: 3.0,
      shape: 'ellipse',
      x: 1182,
      y: 798,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 10,
      height: 10,
      fill_color: CK_RED,
      animations: [
        { type: 'fade-in', duration: 0.3 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
    // Mono kicker: open source / apache 2.0.
    {
      id: 'cta-eyebrow',
      type: 'text',
      layer: 56,
      time: 18.2,
      duration: 4.6,
      text: 'open source · apache 2.0',
      x: 960,
      y: 280,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: GEIST_MONO,
      font_size: 22,
      font_weight: '500',
      letter_spacing: 4,
      fill_color: CK_MUTED,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'fade-out', duration: 0.4, time: 'end' },
      ],
    },
  ],
};

// ─── Registry — order shown in the playground dropdown ─────────────────────

export const EXAMPLES = [
  { id: 'launch',    name: '★ Clipkit launch (16:9)',      source: CLIPKIT_LAUNCH },
  { id: 'hello',     name: 'Hello Clipkit (16:9)',         source: HELLO_CLIPKIT },
  { id: 'mux',       name: '★ Mux Data demo (16:9)',       source: MUX_DEMO },
  { id: 'vercel',    name: '★ Vercel template (16:9)',     source: VERCEL_TEMPLATE },
  { id: 'codewrap',  name: '★ Code Wrapped (9:16)',        source: CODE_WRAPPED },
  { id: 'wrapped',   name: '★ Year in Review (9:16)',      source: WRAPPED_STATS },
  { id: 'cinematic', name: '★ Cinematic opener (16:9)',    source: CINEMATIC_OPENER },
  { id: 'viral',     name: '★ Viral hook (9:16)',          source: VIRAL_HOOK },
  { id: 'teaser',    name: 'Launch teaser (16:9)',         source: LAUNCH_TEASER },
  { id: 'social',    name: 'Social ad (9:16)',             source: SOCIAL_AD },
  { id: 'motion',    name: 'Motion test (16:9)',           source: MOTION_TEST },
] as const;

export type ExampleId = (typeof EXAMPLES)[number]['id'];
