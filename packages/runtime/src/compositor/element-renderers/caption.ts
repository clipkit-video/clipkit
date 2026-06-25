// Caption element renderer — word-timed text with kinetic styles.
//
// Each word in element.words has its own start/end time. The kinetic style
// (`tiktok_bounce`, `fade_reveal`, `kinetic_typewriter`, `word_pop`) defines
// how the word appears and which transform applies during its active window.
// The active word gets `highlight_color` tint; inactive visible words get
// `fill_color`.
//
// Layout: single line for v1. Wrapping is a follow-up.
// Characters are drawn via the same font-atlas + textured-quad pipeline as
// the text renderer — we just stack a per-word transform on top.

import type { CaptionElement, CaptionStyle, CaptionWord } from '@clipkit/protocol';
import { parseColorPremultiplied, type RGBA } from '../color.js';
import { mat4ApplyToPoint, mat4Multiply, mat4PlaneAt, mat4Rotation, quadWorldTransform } from '../mat4.js';
import { resolveAnchor, resolveLength } from '../unit.js';
import { resolveTextShadows, paintTextShadows } from './text.js';
import { applyAnimation, resolve3D } from '../resolve.js';
import { atlasKey, generateFontAtlas, type FontAtlas } from '../../text/font-atlas.js';
import { autoFitFontSize, withFontFallback } from '../../text/measure.js';
import { chunkCaptionWords, activeCaptionChunk } from '../../text/caption-chunk.js';
import { applyEasing } from '../../animation/easings.js';
import type { RenderContext } from '../render-context.js';

interface WordLayout {
  word: CaptionWord;
  /** Typographic width of this word (sum of glyph advances). */
  width: number;
  /** Cursor X (relative to this word's LINE start) where the word begins. */
  cursorStart: number;
  /** Index into the chars array where this word starts. */
  charStart: number;
  /** Number of (visible) chars in this word. */
  charCount: number;
  /** Which wrapped line this word sits on. */
  lineIndex: number;
}

interface CharLayout {
  /** Atlas tight bounding-box position. */
  glyphX: number;
  glyphY: number;
  glyphW: number;
  glyphH: number;
  /** Cursor X (relative to this char's LINE start) at which the pen lies. */
  cursorX: number;
  /** Offset from cursor X to quad's left edge. */
  offsetX: number;
  /** Offset from baseline to quad's top edge. */
  offsetY: number;
  /** Which wrapped line this char sits on. */
  lineIndex: number;
}

interface KineticResult {
  /** Visibility multiplier 0..1. 0 = invisible, 1 = full. */
  opacity: number;
  /** Uniform scale around the word's center. */
  scale: number;
  /** Should this word use `highlight_color` instead of `fill_color`? */
  highlighted: boolean;
}

export function renderCaptionElement(element: CaptionElement, ctx: RenderContext): void {
  const { canvas, backend } = ctx;
  const allWords = element.words;
  if (!allWords || allWords.length === 0) return;

  // Windowing (§ caption.max_length): show only the chunk active at this time.
  // Word times are element-local, so chunk selection uses the element-local time.
  const elementStartT = ctx.timeOffset + numberOr(element.time, 0);
  const localT = ctx.time - elementStartT;
  const chunks = chunkCaptionWords(allWords, element.max_length);
  const words = element.max_length === undefined
    ? allWords
    : (activeCaptionChunk(chunks, localT)?.words ?? []);
  if (words.length === 0) return;

  const fontFamily = withFontFallback(String(element.font_family ?? 'sans-serif'));
  const fontWeight = element.font_weight ?? 'bold';

  // font_size accepts: number (px), "auto" (fit to element.width), or
  // a unit string ("Nvh", "Nvw", "N%" — % is canvas height).
  let fontSize: number;
  if (element.font_size === 'auto') {
    const constraintWidth = element.width !== undefined
      ? resolveLength(element.width as never, canvas.width, canvas, canvas.width * 0.9)
      : canvas.width * 0.9;
    // Approximate the rendered text by joining words with spaces.
    const joined = words.map((w) => w.text).join(' ');
    fontSize = autoFitFontSize(joined, fontFamily, fontWeight, constraintWidth, 64);
  } else if (typeof element.font_size === 'number') {
    fontSize = element.font_size;
  } else if (typeof element.font_size === 'string') {
    fontSize = resolveLength(element.font_size, canvas.height, canvas, 64);
  } else {
    fontSize = 64;
  }

  // Resolve atlas (cached per family/size/weight).
  const key = atlasKey({ family: fontFamily, size: fontSize, weight: fontWeight });
  let atlas: FontAtlas;
  if (ctx.fontAtlases.has(key)) {
    atlas = ctx.fontAtlases.get(key)!;
  } else {
    atlas = generateFontAtlas({ family: fontFamily, size: fontSize, weight: fontWeight }, backend);
    ctx.fontAtlases.set(key, atlas);
  }

  // Position the caption block. Animations can move the element as a whole.
  const localX = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const localY = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const localRotation = applyAnimation(element, 'rotation', numberOr(element.rotation ?? (element as { z_rotation?: unknown }).z_rotation, 0), ctx);
  const localOpacity01 = applyAnimation(element, 'opacity', numberOr(element.opacity, 1), ctx);
  // Apply group transform stack: translate pivot to world coords, add
  // ambient rotation, multiply opacity. Same pattern as text.ts —
  // including the CKP/1.0 local-frame + plane-matrix path under 3D.
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff;
  let x: number, y: number, rotation: number;
  let glyphChain: import('../render-context.js').Mat4 | null = null;
  if (matrixPath) {
    glyphChain = mat4Multiply(
      ctx.modelMatrix,
      mat4PlaneAt(localX, localY, t3d?.z ?? 0, localRotation, t3d?.yRot ?? 0, t3d?.xRot ?? 0),
    );
    x = localX;
    y = localY;
    rotation = 0;
  } else {
    [x, y] = mat4ApplyToPoint(ctx.modelMatrix, localX, localY);
    rotation = localRotation + mat4Rotation(ctx.modelMatrix);
  }
  const opacity01 = localOpacity01 * ctx.opacityFactor;
  const xAnchor = resolveAnchor(element.x_anchor);
  const yAnchor = resolveAnchor(element.y_anchor);

  // Wrap words to the element's BOX width — captions must stay inside their box,
  // not run off-screen on one infinite line. Each char's `cursorX` is its pen
  // position relative to its own line's start (0).
  const SPACE_WIDTH = atlas.glyphs.get(' ')?.advance ?? fontSize * 0.3;
  const boxWidth = element.width !== undefined
    ? resolveLength(element.width as never, canvas.width, canvas, canvas.width * 0.9)
    : canvas.width * 0.9;
  const measure = (text: string): number => {
    let w = 0;
    for (const ch of text) w += atlas.glyphs.get(ch)?.advance ?? 0;
    return w;
  };

  // Greedy line-break: a word that would overflow `boxWidth` starts a new line.
  const lines: CaptionWord[][] = [];
  {
    let line: CaptionWord[] = [];
    let lineW = 0;
    for (const word of words) {
      const ww = measure(word.text);
      if (line.length > 0 && lineW + SPACE_WIDTH + ww > boxWidth) {
        lines.push(line);
        line = [];
        lineW = 0;
      }
      if (line.length > 0) lineW += SPACE_WIDTH;
      line.push(word);
      lineW += ww;
    }
    if (line.length > 0) lines.push(line);
  }

  const wordLayouts: WordLayout[] = [];
  const chars: CharLayout[] = [];
  const lineWidths: number[] = [];
  for (let li = 0; li < lines.length; li++) {
    let cursorX = 0;
    const lineWords = lines[li]!;
    for (let wi = 0; wi < lineWords.length; wi++) {
      const word = lineWords[wi]!;
      const wordCursorStart = cursorX;
      const startCharIdx = chars.length;
      for (const ch of word.text) {
        const g = atlas.glyphs.get(ch);
        if (!g) continue;
        if (g.width > 0 && g.height > 0) {
          chars.push({ glyphX: g.x, glyphY: g.y, glyphW: g.width, glyphH: g.height, cursorX, offsetX: g.offsetX, offsetY: g.offsetY, lineIndex: li });
        }
        cursorX += g.advance;
      }
      wordLayouts.push({ word, width: cursorX - wordCursorStart, cursorStart: wordCursorStart, charStart: startCharIdx, charCount: chars.length - startCharIdx, lineIndex: li });
      if (wi < lineWords.length - 1) cursorX += SPACE_WIDTH;
    }
    lineWidths.push(cursorX);
  }

  const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
  const lineHeight = (atlas.ascent + atlas.descent) * numberOr(element.line_height, 1.2);
  const totalHeight = Math.max(lines.length, 1) * lineHeight;

  // Anchor the BOX (width × stacked lines); align each line within it.
  const blockLeft = x - boxWidth * xAnchor;
  const blockTop = y - totalHeight * yAnchor;
  const alignF = element.text_align === 'left' ? 0 : element.text_align === 'right' ? 1 : 0.5;
  const lineLeft = lineWidths.map((w) => blockLeft + (boxWidth - w) * alignF);
  const lineBaseline = lines.map((_, li) => blockTop + atlas.ascent + li * lineHeight);
  const lineCenterY = lineBaseline.map((b) => b - atlas.ascent + (atlas.ascent + atlas.descent) / 2);

  // Block-level rotation: orbit each glyph's center around (x, y) by
  // the same angle we pass to drawTexturedQuad. Without the orbit
  // step, each letter would spin in place while the baseline stayed
  // horizontal. Same approach as the text renderer; matches
  // composeQuadTransform's CW-in-Y-down convention.
  const rotRad = (rotation * Math.PI) / 180;
  const rotCos = Math.cos(rotRad);
  const rotSin = Math.sin(rotRad);
  const rotateAroundPivot = rotation !== 0;

  // Style + colors.
  const style: CaptionStyle = (element.style as CaptionStyle | undefined) ?? 'tiktok_bounce';
  const baseColor = parseColorPremultiplied(
    typeof element.fill_color === 'string' ? element.fill_color : '#ffffff',
  );
  const highlightColor = parseColorPremultiplied(
    typeof element.highlight_color === 'string' ? element.highlight_color : '#ffd60a',
  );
  const elementOpacity = Math.max(0, Math.min(1, opacity01));

  // Element-local time. Word.start/end are relative to the element.
  const elementStart = ctx.timeOffset + numberOr(element.time, 0);
  const localTime = ctx.time - elementStart;

  // Shrink-wrapped background behind the caption phrase — sized to the
  // laid-out glyph bounds (totalWidth × the ascent/descent box), not the
  // element box. Opt-in; absent background_color ⇒ byte-identical.
  if (typeof element.background_color === 'string' && maxLineWidth > 0) {
    const bgC = parseColorPremultiplied(element.background_color);
    const padRaw = element.background_padding;
    const padX = Array.isArray(padRaw) ? numberOr(padRaw[0], 0) : numberOr(padRaw, 0);
    const padY = Array.isArray(padRaw) ? numberOr(padRaw[1], 0) : numberOr(padRaw, 0);
    const bgW = maxLineWidth + 2 * padX;
    const bgH = totalHeight + 2 * padY;
    let bgCx = blockLeft + boxWidth / 2;
    let bgCy = blockTop + totalHeight / 2;
    if (rotateAroundPivot) {
      const pdx = bgCx - x;
      const pdy = bgCy - y;
      bgCx = x + pdx * rotCos - pdy * rotSin;
      bgCy = y + pdx * rotSin + pdy * rotCos;
    }
    backend.drawShape({
      cx: bgCx, cy: bgCy, width: bgW, height: bgH, rotation,
      skewX: 0, skewY: 0,
      transform: glyphChain
        ? quadWorldTransform(glyphChain, bgCx, bgCy, bgW, bgH, 0, 0, 0, null)
        : undefined,
      color: [bgC[0] * elementOpacity, bgC[1] * elementOpacity, bgC[2] * elementOpacity, bgC[3] * elementOpacity],
      cornerRadius: numberOr(element.background_border_radius, 0),
      shape: 'rectangle',
      blend: element.blend_mode,
    });
  }

  // Per-glyph text shadows. Two passes when present: pass 0 paints all
  // shadows behind the words, pass 1 the fills (no shadows ⇒ one pass,
  // byte-identical).
  const textShadows = resolveTextShadows(element.text_shadow, elementOpacity);
  const shadowPasses = textShadows.length > 0 ? 2 : 1;
  for (let pass = 0; pass < shadowPasses; pass++) {
   const drawShadowPass = textShadows.length > 0 && pass === 0;
   const drawFillPass = textShadows.length === 0 || pass === 1;
  // Render each word with its kinetic transform.
  for (const wl of wordLayouts) {
    const kinetic = computeKineticTransform(style, wl.word, localTime);
    if (kinetic.opacity <= 0) continue;

    // Word's typographic center in screen space (the kinetic transform's anchor).
    const wordCenterX = lineLeft[wl.lineIndex]! + wl.cursorStart + wl.width / 2;
    const wordCenterY = lineCenterY[wl.lineIndex]!;

    // Choose tint color for this word.
    const color = kinetic.highlighted ? highlightColor : baseColor;
    const wordOpacity = elementOpacity * kinetic.opacity;
    const tint: RGBA = [
      color[0] * wordOpacity,
      color[1] * wordOpacity,
      color[2] * wordOpacity,
      color[3] * wordOpacity,
    ];

    // Render each glyph of this word.
    for (let i = 0; i < wl.charCount; i++) {
      const ch = chars[wl.charStart + i]!;

      // Absolute quad center before kinetic scale (per the char's wrapped line).
      const baseCx = lineLeft[ch.lineIndex]! + ch.cursorX + ch.offsetX + ch.glyphW / 2;
      const baseCy = lineBaseline[ch.lineIndex]! + ch.offsetY + ch.glyphH / 2;

      // Apply scale around word center.
      const dx = baseCx - wordCenterX;
      const dy = baseCy - wordCenterY;
      let cellCx = wordCenterX + dx * kinetic.scale;
      let cellCy = wordCenterY + dy * kinetic.scale;
      const cellW = ch.glyphW * kinetic.scale;
      const cellH = ch.glyphH * kinetic.scale;

      // Block-level rotation: orbit the kinetic-scaled cell center
      // around the element pivot.
      if (rotateAroundPivot) {
        const pdx = cellCx - x;
        const pdy = cellCy - y;
        cellCx = x + pdx * rotCos - pdy * rotSin;
        cellCy = y + pdx * rotSin + pdy * rotCos;
      }

      // Tight UVs — no inset needed, AA margin is baked into the atlas bounds.
      const u0 = ch.glyphX / atlas.width;
      const v0 = ch.glyphY / atlas.height;
      const u1 = (ch.glyphX + ch.glyphW) / atlas.width;
      const v1 = (ch.glyphY + ch.glyphH) / atlas.height;

      if (drawShadowPass) {
        paintTextShadows(textShadows, kinetic.opacity, (ox, oy, col) => {
          let scx = wordCenterX + (baseCx + ox - wordCenterX) * kinetic.scale;
          let scy = wordCenterY + (baseCy + oy - wordCenterY) * kinetic.scale;
          if (rotateAroundPivot) {
            const pdx = scx - x, pdy = scy - y;
            scx = x + pdx * rotCos - pdy * rotSin;
            scy = y + pdx * rotSin + pdy * rotCos;
          }
          backend.drawTexturedQuad({
            cx: scx, cy: scy, width: cellW, height: cellH, rotation,
            transform: glyphChain ? quadWorldTransform(glyphChain, scx, scy, cellW, cellH, 0, 0, 0, null) : undefined,
            texture: atlas.texture, uvRect: [u0, v0, u1, v1], tint: col, blend: element.blend_mode,
          });
        });
      }
      if (drawFillPass) {
        backend.drawTexturedQuad({
          cx: cellCx,
          cy: cellCy,
          width: cellW,
          height: cellH,
          rotation,
          transform: glyphChain
            ? quadWorldTransform(glyphChain, cellCx, cellCy, cellW, cellH, 0, 0, 0, null)
            : undefined,
          texture: atlas.texture,
          uvRect: [u0, v0, u1, v1],
          tint,
          blend: element.blend_mode,
        });
      }
    }
  }
  }
}

// ─── Kinetic styles ───────────────────────────────────────────────────────

function computeKineticTransform(
  style: CaptionStyle,
  word: CaptionWord,
  localTime: number,
): KineticResult {
  const tSinceStart = localTime - word.start;
  const wordDuration = Math.max(0.01, word.end - word.start);
  const beforeStart = tSinceStart < 0;
  const duringWord = tSinceStart >= 0 && tSinceStart <= wordDuration;
  const afterEnd = tSinceStart > wordDuration;

  switch (style) {
    case 'tiktok_bounce':
      return tiktokBounce(tSinceStart, wordDuration, beforeStart, duringWord, afterEnd);
    case 'fade_reveal':
      return fadeReveal(tSinceStart, wordDuration, beforeStart, duringWord, afterEnd);
    case 'kinetic_typewriter':
      return kineticTypewriter(beforeStart, duringWord, afterEnd);
    case 'word_pop':
      return wordPop(tSinceStart, beforeStart, duringWord, afterEnd);
  }
}

function tiktokBounce(
  t: number,
  _duration: number,
  beforeStart: boolean,
  duringWord: boolean,
  _afterEnd: boolean,
): KineticResult {
  // Before: invisible. During: scales 0.6 → 1.0 with back ease in 0.15s, holds 1.0.
  // After: stays visible at scale 1.0 (so the caption builds up over time).
  if (beforeStart) return { opacity: 0, scale: 1, highlighted: false };
  if (duringWord) {
    const POP = 0.18;
    if (t < POP) {
      const e = applyEasing('ease-out-back', t / POP);
      return { opacity: 1, scale: 0.6 + 0.4 * e, highlighted: true };
    }
    return { opacity: 1, scale: 1, highlighted: true };
  }
  return { opacity: 1, scale: 1, highlighted: false };
}

function fadeReveal(
  t: number,
  duration: number,
  beforeStart: boolean,
  duringWord: boolean,
  _afterEnd: boolean,
): KineticResult {
  const FADE = 0.12;
  if (beforeStart) {
    // Begin fade-in just before start.
    if (t > -FADE) {
      const p = (t + FADE) / FADE; // 0..1
      return { opacity: p, scale: 1, highlighted: false };
    }
    return { opacity: 0, scale: 1, highlighted: false };
  }
  if (duringWord) return { opacity: 1, scale: 1, highlighted: true };
  // afterEnd: fade out over FADE seconds.
  const sinceEnd = t - duration;
  if (sinceEnd < FADE) return { opacity: 1 - sinceEnd / FADE, scale: 1, highlighted: false };
  return { opacity: 0, scale: 1, highlighted: false };
}

function kineticTypewriter(
  beforeStart: boolean,
  duringWord: boolean,
  _afterEnd: boolean,
): KineticResult {
  // Word appears at its start, stays visible, gets highlighted only while active.
  if (beforeStart) return { opacity: 0, scale: 1, highlighted: false };
  return { opacity: 1, scale: 1, highlighted: duringWord };
}

function wordPop(
  t: number,
  beforeStart: boolean,
  duringWord: boolean,
  _afterEnd: boolean,
): KineticResult {
  if (beforeStart) return { opacity: 0, scale: 1, highlighted: false };
  if (duringWord) {
    // 1.0 → 1.15 → 1.0 sine pop over first 0.15s.
    const POP = 0.15;
    if (t < POP) {
      const scale = 1 + 0.15 * Math.sin((t / POP) * Math.PI);
      return { opacity: 1, scale, highlighted: true };
    }
    return { opacity: 1, scale: 1, highlighted: true };
  }
  return { opacity: 1, scale: 1, highlighted: false };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
