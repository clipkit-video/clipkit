import type { Keyframe, TextElement, TextMask, TextSpan, Expr } from '@clipkit/protocol';
import { isExpr, evalExpr } from '../../animation/expr.js';
import { parseColorPremultiplied } from '../color.js';
import { mat4ApplyToPoint, mat4Multiply, mat4PlaneAt, mat4Rotation, quadWorldTransform } from '../mat4.js';
import { resolveAnchor, resolveLength } from '../unit.js';
import { applyAnimation, resolve3D, resolveColorProperty, resolveScalePair, resolveSkewPair } from '../resolve.js';
import {
  compileTextAnimations,
  evaluateUnitEffect,
  hasUnitRotations,
  type UnitRotation,
} from '../../text/text-animation.js';
import { interpolateKeyframes } from '../../animation/keyframes.js';
import { atlasKey, generateFontAtlas, type FontAtlas } from '../../text/font-atlas.js';
import { autoFitFontSize, autoFitFontSizeBox, withFontFallback } from '../../text/measure.js';
import { getLogger } from '../../logger.js';
import type { MaskedTextAsset, RenderContext } from '../render-context.js';


// Coverage exponent approximating Chrome's gamma-corrected text AA.
// Linear alpha blending over-darkens the AA fringe of dark glyphs
// (reads ~half a weight step bold at 12-16px) and under-fills light
// ones. Dark tints thin (g > 1), light tints fill (g < 1); the curve
// is calibrated against the import-fidelity probe: swept 1.3/1.45/
// 1.6/1.8/2.1 base exponents; the metric kept (weakly) improving past
// 1.6 but glyphs visibly erode from ~1.8, so 1.6 is the keeper. tint
// is premultiplied — un-premultiply before taking luminance.
function textAlphaGamma(tint: readonly [number, number, number, number]): number {
  const a = tint[3];
  if (a <= 0.001) return 1;
  const lum = Math.min(1, Math.max(0,
    (0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2]) / a,
  ));
  return 1.6 - 0.75 * lum;
}

export function renderTextElement(element: TextElement, ctx: RenderContext): void {
  // If the element has a reveal mask, take the offscreen-canvas path: we
  // rasterize the text + apply the mask via Canvas2D destination-in
  // compositing, then upload as a single texture. The mask animates per
  // frame, so this re-rasterizes every render.
  if (element.mask) {
    renderMaskedTextElement(element, ctx);
    return;
  }

  // Inline-styled spans take a separate path: each span has its own
  // family/size/weight/color and may carry a background_color.
  if (element.spans && element.spans.length > 0) {
    renderSpannedTextElement(element, ctx);
    return;
  }

  const { canvas, backend } = ctx;
  const elementStart = ctx.timeOffset + numberOr(element.time, 0);
  const localTime = ctx.time - elementStart;
  const text = resolveText(element, localTime);
  if (text.length === 0) return;

  const fontFamily = withFontFallback(String(element.font_family ?? 'sans-serif'));
  const fontWeight = element.font_weight ?? 'normal';

  // font_size accepts:
  //   number          — pixels
  //   "auto"          — fit to element.width (or canvas width if not set)
  //   "Npx" / "Nvh" / "Nvw" / "Nvmin" / "Nvmax" / "N%" (% = % of canvas height)
  let fontSize: number;
  if (element.font_size === 'auto') {
    const constraintWidth = (element.width !== undefined
      ? resolveLength(element.width as never, canvas.width, canvas, canvas.width)
      : canvas.width) - 2 * resolveLength(element.x_padding as never, canvas.width, canvas, 0);
    const autoMin = resolveLength(element.font_size_minimum as never, canvas.height, canvas, 8);
    const autoMax = resolveLength(element.font_size_maximum as never, canvas.height, canvas, 400);
    if (element.height !== undefined) {
      // 2D fill mode: with BOTH width and height authored, the text
      // wraps and takes the largest size whose wrapped lines fit the
      // box. Resizing the box in the editor refits live.
      const boxH =
        resolveLength(element.height as never, canvas.height, canvas, 0) -
        2 * resolveLength(element.y_padding as never, canvas.height, canvas, 0);
      fontSize = autoFitFontSizeBox(
        text, fontFamily, fontWeight,
        Math.max(1, constraintWidth), Math.max(1, boxH),
        numberOr(element.line_height, 1), autoMin, autoMax,
      );
    } else {
      fontSize = autoFitFontSize(
        text, fontFamily, fontWeight, Math.max(1, constraintWidth), 48, autoMin, autoMax,
      );
    }
  } else if (typeof element.font_size === 'number') {
    fontSize = element.font_size;
  } else if (typeof element.font_size === 'string') {
    fontSize = resolveLength(element.font_size, canvas.height, canvas, 48);
  } else {
    fontSize = 48;
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

  const localX = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const localY = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const localRotation = applyAnimation(element, 'rotation', numberOr(element.rotation ?? (element as { z_rotation?: unknown }).z_rotation, 0), ctx);
  const localOpacity01 = applyAnimation(element, 'opacity', numberOr(element.opacity, 1), ctx);
  // Element scale (uniform + per-axis). Layout happens at natural size;
  // glyph quads scale geometrically around the pivot at draw time, so
  // the font atlas is untouched (no per-frame atlas regeneration).
  const { sx, sy } = resolveScalePair(element, ctx);
  // Shear: glyph offsets shear around the pivot AND each glyph quad
  // shears, so the block reads as one solid skewed object.
  const { skewX, skewY } = resolveSkewPair(element, ctx);
  const tanSkewX = Math.tan((skewX * Math.PI) / 180);
  const tanSkewY = Math.tan((skewY * Math.PI) / 180);
  const xAnchor = resolveAnchor(element.x_anchor);
  const yAnchor = resolveAnchor(element.y_anchor);

  // Apply group transform stack to the element pivot + rotation. Glyphs
  // orbit around the world pivot by the cumulative rotation. (Group
  // scale doesn't propagate to font_size — accept as a small limitation.)
  //
  // CKP/1.0 3D (§4.4): under 3D — or any non-affine chain — the glyph
  // math runs in the element's LOCAL frame (pivot = authored position,
  // block rotation 0) and every quad projects through the element's
  // plane matrix, which carries Rz·Ry·Rx around the pivot so the block
  // tilts as one plane in the same order as leaf quads.
  //
  // text-flip (§6.5) rotates units out of the element's plane, so an
  // active flip forces the matrix path even on otherwise-2D elements.
  const textAnims = compileTextAnimations(element);
  const unitRotations = textAnims !== null && hasUnitRotations(textAnims);
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff || unitRotations;
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

  // Content padding insets the text box on each side.
  const xPad = resolveLength(element.x_padding as never, canvas.width, canvas, 0);
  const yPad = resolveLength(element.y_padding as never, canvas.height, canvas, 0);

  // Split into lines: explicit "\n" always breaks; soft wrap engages
  // when the element has a width and text_wrap !== false.
  //
  // letter_spacing follows Chrome: added after EVERY character,
  // including the last. The importer captures boxes that fit text WITH
  // its tracking (negative on most modern UI type) — measuring without
  // it overshoots the box and wraps lines the browser kept whole.
  const letterSpacing = numberOr(element.letter_spacing, 0);
  // Kerning bookkeeping mirrors the draw loops below exactly — prev
  // only updates on chars that HAVE a glyph, so measure and draw can
  // never disagree about a line's width.
  const advanceOf = (s: string): number => {
    let w = 0;
    let prev = '';
    for (const ch of s) {
      const g = atlas.glyphs.get(ch);
      if (g) {
        w += g.advance + letterSpacing + atlas.kern(prev, ch);
        prev = ch;
      }
    }
    return w;
  };
  const explicitWidth =
    typeof element.width === 'number'
      ? element.width
      : typeof element.width === 'string'
        ? resolveLength(element.width, canvas.width, canvas, Number.NaN)
        : Number.NaN;
  const wrapLimit = Number.isFinite(explicitWidth)
    ? Math.max(0, explicitWidth - 2 * xPad)
    : Number.POSITIVE_INFINITY;
  // Auto-size and wrap interaction:
  //   auto + width only   → sized to fit ONE line; never soft-wraps
  //                         (explicit "\n" still breaks).
  //   auto + width+height → 2D fill mode; wrapping is intrinsic to
  //                         the fit, so soft wrap stays on.
  const autoFillsBox = element.font_size === 'auto' && element.height !== undefined;
  const wrapEnabled =
    element.text_wrap !== false &&
    (element.font_size !== 'auto' || autoFillsBox) &&
    Number.isFinite(wrapLimit);

  // Boxes captured from a browser fit their text EXACTLY, so a wrap
  // decision at "> limit" sits on a knife edge of float rounding and
  // sub-pixel metric differences. Half a pixel of slack keeps lines
  // the browser kept, and is invisible when the text really is long.
  const WRAP_EPS = 0.5;
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (!wrapEnabled || advanceOf(raw) <= wrapLimit + WRAP_EPS) {
      lines.push(raw);
      continue;
    }
    // Greedy word wrap. An over-wide single word stays on its own line
    // and overflows (CSS word-wrap: normal).
    let current = '';
    for (const word of raw.split(' ')) {
      const candidate = current.length > 0 ? `${current} ${word}` : word;
      if (current.length > 0 && advanceOf(candidate) > wrapLimit + WRAP_EPS) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) lines.push(current);
  }
  const lineWidths = lines.map(advanceOf);
  const textWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;

  // CSS-style line-box vertical positioning. line_height is a ratio of
  // font_size — line box = font_size × line_height. The font's natural
  // glyph block (ascent + descent) sits CENTERED in the line box, with
  // the surplus split evenly between top and bottom leading. When
  // line_height < 1, leadingTop goes negative and adjacent lines
  // overlap visually — same as CSS. Without this, headlines with
  // tight line-heights (0.98, 0.95) take more vertical space than
  // CSS does and eat into the gap before whatever sits below.
  const glyphBlock = atlas.ascent + atlas.descent;
  const lineHeightRatio = numberOr(element.line_height, 1);
  const lineBoxHeight = fontSize * lineHeightRatio;
  const leadingTop = (lineBoxHeight - glyphBlock) / 2;

  // Box width: explicit element.width, else natural text width plus
  // padding. Content (the text block) lives inside the padding insets;
  // per-line horizontal alignment distributes each line's slack by
  // alignFrac (x_alignment overrides text_align when present).
  const boxWidth = Number.isFinite(explicitWidth)
    ? explicitWidth
    : textWidth + 2 * xPad;
  const contentWidth = Math.max(0, boxWidth - 2 * xPad);
  const textAlign: 'left' | 'center' | 'right' = element.text_align ?? 'left';
  const alignFrac = alignmentFraction(
    element.x_alignment,
    textAlign === 'center' ? 0.5 : textAlign === 'right' ? 1 : 0,
  );

  // Box height: explicit element.height, else all line boxes plus
  // padding. y_alignment (or vertical_align) places the text block
  // inside the content area.
  const totalTextHeight = lineBoxHeight * lines.length;
  let boxHeight = totalTextHeight + 2 * yPad;
  if (typeof element.height === 'number') boxHeight = element.height;
  else if (typeof element.height === 'string') {
    boxHeight = resolveLength(element.height, canvas.height, canvas, boxHeight);
  }
  const verticalAlign: 'top' | 'middle' | 'bottom' = element.vertical_align ?? 'top';
  const vFrac = alignmentFraction(
    element.y_alignment,
    verticalAlign === 'middle' ? 0.5 : verticalAlign === 'bottom' ? 1 : 0,
  );
  const vSlack = Math.max(0, boxHeight - 2 * yPad - totalTextHeight);

  // Anchor on the BOX; content starts inside the padding.
  const blockLeft = x - boxWidth * xAnchor + xPad;
  const contentTop = y - boxHeight * yAnchor + yPad + vSlack * vFrac;

  // Color, with element opacity baked into alpha. fill_color is
  // animatable via color-valued keyframe_animations.
  const baseColor = parseColorPremultiplied(
    resolveColorProperty(
      element,
      'fill_color',
      typeof element.fill_color === 'string' ? element.fill_color : '#ffffff',
      ctx,
    ),
  );
  const opacityFactor = Math.max(0, Math.min(1, opacity01));
  const tint: readonly [number, number, number, number] = [
    baseColor[0] * opacityFactor,
    baseColor[1] * opacityFactor,
    baseColor[2] * opacityFactor,
    baseColor[3] * opacityFactor,
  ];

  // Walk characters and emit one textured-quad per visible glyph.
  // Each glyph stores tight bounds (with AA margin baked in) plus offsets
  // from the cursor position; no UV inset needed because the AA margin
  // itself isolates the glyph's quad from neighboring cells.
  //
  // Rotation: each glyph quad rotates around its OWN center via the
  // backend transform. For block-level rotation (the user expects
  // "rotate the whole word"), we additionally orbit each glyph's
  // center around the element pivot (x, y) by the same angle, so
  // glyphs both reposition relative to the pivot AND orient with it.
  // Without the orbit step, each letter spins in place while the
  // baseline stayed horizontal — the "every letter rotated separately"
  // bug.
  //
  // Convention matches composeQuadTransform: CW in screen-pixel space
  // (Y-down), so positive `rotation` rotates the same direction CSS
  // `rotate(...)` does.
  const rotRad = (rotation * Math.PI) / 180;
  const rotCos = Math.cos(rotRad);
  const rotSin = Math.sin(rotRad);
  const rotateAroundPivot = rotation !== 0;

  // Map an element-local layout point through the same scale → shear →
  // pivot-orbit chain the glyph cell centers go through (used for
  // text-flip unit pivots; rotation is 0 on the matrix path).
  const mapCell = (px: number, py: number): [number, number] => {
    const sdx = (px - x) * sx;
    const sdy = (py - y) * sy;
    const ddx = sdx + tanSkewX * sdy;
    const ddy = sdy + tanSkewY * sdx;
    if (!rotateAroundPivot) return [x + ddx, y + ddy];
    return [x + ddx * rotCos - ddy * rotSin, y + ddx * rotSin + ddy * rotCos];
  };

  // Per-unit text animations (compiled above for the matrix-path
  // decision). Null for the common case — zero overhead.
  const animLocalTime = ctx.time - (ctx.timeOffset + numberOr(element.time, 0));

  // text-flip pivot pre-pass (§6.5): unit rotations pivot at the
  // unit's REST-layout center (letter = glyph cell, word = bounding
  // box of the word's glyphs). Mirrors the draw loop's walk exactly.
  let letterPivots: [number, number][] | null = null;
  let wordPivots: [number, number][] | null = null;
  if (unitRotations) {
    letterPivots = [];
    const wordBoxes: { l: number; r: number; t: number; b: number }[] = [];
    let pl = 0, pw = 0, pInWord = false;
    for (let li = 0; li < lines.length; li++) {
      let cursorX = blockLeft + Math.max(0, contentWidth - lineWidths[li]!) * alignFrac;
      const baselineY = contentTop + li * lineBoxHeight + leadingTop + atlas.ascent;
      let pPrev = '';
      for (const ch of lines[li]!) {
        const isSpace = /\s/.test(ch);
        if (isSpace && pInWord) { pw += 1; pInWord = false; }
        else if (!isSpace) pInWord = true;
        const g = atlas.glyphs.get(ch);
        if (!g) continue;
        cursorX += atlas.kern(pPrev, ch);
        pPrev = ch;
        if (g.width === 0 || g.height === 0) { cursorX += g.advance + letterSpacing; continue; }
        const l = cursorX + g.offsetX;
        const t = baselineY + g.offsetY;
        letterPivots[pl] = [l + g.width / 2, t + g.height / 2];
        const wb = (wordBoxes[pw] ??= { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity });
        wb.l = Math.min(wb.l, l); wb.r = Math.max(wb.r, l + g.width);
        wb.t = Math.min(wb.t, t); wb.b = Math.max(wb.b, t + g.height);
        pl += 1;
        cursorX += g.advance + letterSpacing;
      }
      if (pInWord) { pw += 1; pInWord = false; }
    }
    wordPivots = wordBoxes.map((b) => [(b.l + b.r) / 2, (b.t + b.b) / 2]);
  }

  // Shrink-wrapped background behind the text — ONE band PER LINE, each
  // hugging that line's glyphs (width × the ascent/descent box) rather
  // than one box around the whole block, so centered/ragged multi-line
  // text gets the social-caption look. Opt-in: absent background_color ⇒
  // nothing drawn (byte-identical).
  if (typeof element.background_color === 'string' && textWidth > 0 && lines.length > 0) {
    const bgC: readonly [number, number, number, number] = (() => {
      const c = parseColorPremultiplied(element.background_color);
      return [c[0] * opacityFactor, c[1] * opacityFactor, c[2] * opacityFactor, c[3] * opacityFactor];
    })();
    const [padX, padY] = resolveBgPadding(element.background_padding);
    const cr = numberOr(element.background_border_radius, 0);
    for (let li = 0; li < lines.length; li++) {
      const lw = lineWidths[li]!;
      if (lw <= 0) continue; // blank line — no band
      const lineLeft = blockLeft + Math.max(0, contentWidth - lw) * alignFrac;
      const cxLocal = lineLeft + lw / 2;
      const cyLocal = contentTop + li * lineBoxHeight + leadingTop + glyphBlock / 2;
      const [bgCx, bgCy] = mapCell(cxLocal, cyLocal);
      const bgW = (lw + 2 * padX) * sx;
      const bgH = (glyphBlock + 2 * padY) * sy;
      backend.drawShape({
        cx: bgCx, cy: bgCy, width: bgW, height: bgH, rotation, skewX, skewY,
        transform: glyphChain
          ? quadWorldTransform(glyphChain, bgCx, bgCy, bgW, bgH, 0, skewX, skewY, null)
          : undefined,
        color: bgC,
        cornerRadius: cr,
        shape: 'rectangle',
        blend: element.blend_mode,
      });
    }
  }

  const textShadows = resolveTextShadows(element.text_shadow, opacityFactor);

  // Two passes when shadows exist: pass 0 paints every glyph's shadow (so
  // shadows sit behind ALL glyphs — stacked extrusions read cleanly),
  // pass 1 paints the fills. No shadows ⇒ one fill pass (byte-identical).
  const shadowPasses = textShadows.length > 0 ? 2 : 1;
  let letterIdx = 0;
  let wordIdx = 0;
  let inWord = false;
  for (let pass = 0; pass < shadowPasses; pass++) {
   const drawShadowPass = textShadows.length > 0 && pass === 0;
   const drawFillPass = textShadows.length === 0 || pass === 1;
   letterIdx = 0;
   wordIdx = 0;
   inWord = false;
   for (let li = 0; li < lines.length; li++) {
    const lineText = lines[li]!;
    const lineSlack = Math.max(0, contentWidth - lineWidths[li]!);
    let cursorX = blockLeft + lineSlack * alignFrac;
    const baselineY = contentTop + li * lineBoxHeight + leadingTop + atlas.ascent;
    let prevCh = '';

    for (const ch of lineText) {
    const isSpace = /\s/.test(ch);
    if (isSpace && inWord) {
      wordIdx += 1;
      inWord = false;
    } else if (!isSpace) {
      inWord = true;
    }

    const g = atlas.glyphs.get(ch);
    if (!g) continue;
    cursorX += atlas.kern(prevCh, ch);
    prevCh = ch;
    if (g.width === 0 || g.height === 0) {
      // Whitespace / zero-ink glyph — nothing to draw, just advance.
      cursorX += g.advance + letterSpacing;
      continue;
    }

    const unitLetterIdx = letterIdx;
    const fx = textAnims
      ? evaluateUnitEffect(textAnims, animLocalTime, letterIdx, wordIdx)
      : null;
    letterIdx += 1;
    if (fx && fx.opacity <= 0) {
      cursorX += g.advance + letterSpacing;
      continue;
    }

    // text-flip (§6.5): conjugate the unit rotations about the unit
    // centers (word OUTSIDE letter) into this glyph's chain. Pivots
    // ride the unit's current dx/dy so the unit stays rigid while it
    // slides + flips.
    let chain = glyphChain;
    if (chain && fx?.flips) {
      const conjugate = (pivot: [number, number] | undefined, rot: UnitRotation | undefined) => {
        if (!pivot || !rot) return;
        const [ux, uy] = mapCell(pivot[0] + fx.dx, pivot[1] + fx.dy);
        chain = mat4Multiply(chain!, mat4PlaneAt(ux, uy, 0, rot[2], rot[1], rot[0]));
      };
      conjugate(wordPivots?.[wordIdx], fx.flips.word);
      conjugate(letterPivots?.[unitLetterIdx], fx.flips.letter);
    }

    const quadLeft = cursorX + g.offsetX + (fx ? fx.dx : 0);
    const quadTop = baselineY + g.offsetY + (fx ? fx.dy : 0);
    // Scale, then shear, then orbit the glyph's offset from the pivot.
    const sdx = (quadLeft + g.width / 2 - x) * sx;
    const sdy = (quadTop + g.height / 2 - y) * sy;
    const dx = sdx + tanSkewX * sdy;
    const dy = sdy + tanSkewY * sdx;
    let cellCx = x + dx;
    let cellCy = y + dy;

    if (rotateAroundPivot) {
      cellCx = x + dx * rotCos - dy * rotSin;
      cellCy = y + dx * rotSin + dy * rotCos;
    }

    // Pixel-snap glyph quads in the plain axis-aligned case so the
    // atlas texels map 1:1 onto the framebuffer grid — otherwise a glyph
    // landing on a fractional position is bilinear-sampled across two
    // pixels, widening its AA fringe (text reads heavier/softer than
    // Chrome's pixel-snapped DOM text). Skipped when rotated/skewed/
    // scaled/3D or animated, where a fixed grid doesn't apply. Snapping
    // the quad's top-left keeps width integral (atlas bounds are
    // integer), so the right edge lands on the grid too.
    if (!chain && rotation === 0 && skewX === 0 && skewY === 0 && sx === 1 && sy === 1 && !fx) {
      cellCx = Math.round(cellCx - g.width / 2) + g.width / 2;
      cellCy = Math.round(cellCy - g.height / 2) + g.height / 2;
    }

    const u0 = g.x / atlas.width;
    const v0 = g.y / atlas.height;
    const u1 = (g.x + g.width) / atlas.width;
    const v1 = (g.y + g.height) / atlas.height;

    const glyphTint: readonly [number, number, number, number] =
      fx && fx.opacity < 1
        ? [tint[0] * fx.opacity, tint[1] * fx.opacity, tint[2] * fx.opacity, tint[3] * fx.opacity]
        : tint;

    // Per-glyph text shadows, painted under every glyph (pass 0).
    if (drawShadowPass) {
      const sw = g.width * sx, sh = g.height * sy;
      paintTextShadows(textShadows, fx && fx.opacity < 1 ? fx.opacity : 1, (ox, oy, col) => {
        const [scx, scy] = mapCell(quadLeft + ox + g.width / 2, quadTop + oy + g.height / 2);
        backend.drawTexturedQuad({
          cx: scx, cy: scy, width: sw, height: sh, rotation, skewX, skewY,
          transform: chain ? quadWorldTransform(chain, scx, scy, sw, sh, 0, skewX, skewY, null) : undefined,
          texture: atlas.texture, uvRect: [u0, v0, u1, v1], tint: col,
          blend: element.blend_mode, alphaGamma: textAlphaGamma(col),
        });
      });
    }

    if (drawFillPass) {
      backend.drawTexturedQuad({
        cx: cellCx,
        cy: cellCy,
        width: g.width * sx,
        height: g.height * sy,
        rotation,
        skewX,
        skewY,
        transform: chain
          ? quadWorldTransform(chain, cellCx, cellCy, g.width * sx, g.height * sy, 0, skewX, skewY, null)
          : undefined,
        texture: atlas.texture,
        uvRect: [u0, v0, u1, v1],
        tint: glyphTint,
        blend: element.blend_mode,
        alphaGamma: textAlphaGamma(glyphTint),
      });
    }

    cursorX += g.advance + letterSpacing;
    }

    // A line break is a word boundary for text-* word splits.
    if (inWord) {
      wordIdx += 1;
      inWord = false;
    }
   }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Spanned-text rendering path
// ────────────────────────────────────────────────────────────────────────────
//
// When element.spans is set, each span carries its own font_family / size /
// weight / fill_color / background_color. We lay out spans left-to-right
// across one or more lines (split on '\n' spans), measuring each piece
// against its own atlas, then draw per-span glyphs with the span's tint.
// Background colors render as a drawShape pass before the glyphs.
//
// Layout limitations (v1):
//   - No automatic line wrapping; only explicit '\n' span breaks.
//   - Line height = the tallest atlas on that line; baselines align
//     against that atlas's ascent.
//   - Anchors apply to the overall bounding box (max line width, total
//     line height).

interface ResolvedBackground {
  /** Premultiplied RGBA. */
  color: readonly [number, number, number, number];
  /** 0..1 fraction of line-box height the band occupies (default 1). */
  heightRatio: number;
  /** 0..1 fraction of line-box height for top inset (default 0). */
  insetYRatio: number;
  /** Pixels of horizontal padding past the text glyphs (default 0). */
  paddingX: number;
  /** Horizontal skew in degrees (default 0). */
  skewX: number;
  /** Pixels of corner radius (default 0). */
  borderRadius: number;
}

interface ResolvedSpan {
  text: string;
  atlas: FontAtlas;
  tint: readonly [number, number, number, number];
  background?: ResolvedBackground;
  width: number;
  /** Pixels added after every character (Chrome letter-spacing model). */
  letterSpacing: number;
  /** When true, wrapLine treats this span as one atomic chunk. */
  nowrap: boolean;
}

interface SpanLine {
  spans: ResolvedSpan[];
  width: number;
  ascent: number;
  descent: number;
}

function renderSpannedTextElement(element: TextElement, ctx: RenderContext): void {
  const { canvas, backend } = ctx;
  const elementStart = ctx.timeOffset + numberOr(element.time, 0);
  const _localTime = ctx.time - elementStart;

  const elementFamily = String(element.font_family ?? 'sans-serif');
  const elementWeight = element.font_weight ?? 'normal';
  const elementSize = resolveFontSize(element, ctx);
  const elementColorStr =
    typeof element.fill_color === 'string' ? element.fill_color : '#ffffff';
  const textAlign: 'left' | 'center' | 'right' = element.text_align ?? 'left';

  // Resolve every span — measure widths and harvest atlases. Hard line
  // breaks (span with text === '\n') start a new line at this stage;
  // soft breaks from word-wrap come in the next pass.
  const lines: SpanLine[] = [];
  let current: SpanLine = { spans: [], width: 0, ascent: 0, descent: 0 };

  const tt = element.text_transform;
  for (const span of element.spans!) {
    if (span.text === '\n') {
      lines.push(current);
      current = { spans: [], width: 0, ascent: 0, descent: 0 };
      continue;
    }
    const inputSpan = tt && tt !== 'none'
      ? { ...span, text: applyTextTransform(span.text, tt) }
      : span;
    const resolved = resolveSpan(inputSpan, {
      family: elementFamily,
      size: elementSize,
      weight: elementWeight,
      color: elementColorStr,
      letterSpacing: numberOr(element.letter_spacing, 0),
    }, ctx);
    current.spans.push(resolved);
    current.width += resolved.width;
    current.ascent = Math.max(current.ascent, resolved.atlas.ascent);
    current.descent = Math.max(current.descent, resolved.atlas.descent);
  }
  lines.push(current);

  // Word-wrap pass: if element.width is set, break any line that
  // exceeds it at the nearest word boundary.
  //
  // Exceptions where we DON'T re-wrap:
  //   - Spans contain explicit hard breaks (lines.length > 1) — the
  //     importer already captured CSS's exact wrap.
  //   - Any span carries layout-relevant styling (nowrap, background,
  //     fill_color, font_*) — the source was hand-tuned and our atlas
  //     measurement disagrees with CSS by a few pixels (no kerning),
  //     so re-wrapping turns a clean 1-line "Start your <highlight>"
  //     into a 2-line break that overlaps the CTA box below.
  const maxWidth = typeof element.width === 'number'
    ? element.width
    : typeof element.width === 'string'
      ? resolveLength(element.width, canvas.width, canvas, Infinity)
      : Infinity;
  // When the importer emits ANY spans for a text element it has
  // already captured CSS's exact wrap (via Range API). Re-wrapping
  // based on our kerning-free atlas measurement just creates phantom
  // breaks like the "8.1s" case where "s" ends up on its own line
  // because our width measurement of "8.1" + "s" exceeds the box
  // by a few px. So: always trust the input for spanned text.
  const respectAuthorBreaks = true;
  const wrappedLines: SpanLine[] = [];
  for (const line of lines) {
    if (respectAuthorBreaks || line.width <= maxWidth || !Number.isFinite(maxWidth)) {
      wrappedLines.push(line);
    } else {
      wrappedLines.push(...wrapLine(line, maxWidth));
    }
  }

  // Box metrics for anchor math (use post-wrap measurements). Each line
  // takes line_height × font_size of vertical space (matching CSS); the
  // tight glyph block sits centered within that line box.
  const lineHeightRatio = numberOr(element.line_height, 1);
  let totalWidth = 0;
  let totalHeight = 0;
  for (const line of wrappedLines) {
    totalWidth = Math.max(totalWidth, line.width);
    const lineBoxHeight = elementSize * lineHeightRatio;
    totalHeight += lineBoxHeight;
  }

  const localX = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const localY = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const localRotation = applyAnimation(element, 'rotation', numberOr(element.rotation ?? (element as { z_rotation?: unknown }).z_rotation, 0), ctx);
  const localOpacity01 = applyAnimation(element, 'opacity', numberOr(element.opacity, 1), ctx);
  // Element scale — applied geometrically around the pivot at draw time
  // (layout stays at natural size; atlases untouched).
  const { sx, sy } = resolveScalePair(element, ctx);
  // Element shear — same treatment as scale (see orbit()).
  const { skewX, skewY } = resolveSkewPair(element, ctx);
  const tanSkewX = Math.tan((skewX * Math.PI) / 180);
  const tanSkewY = Math.tan((skewY * Math.PI) / 180);
  // Apply group transform stack: translate pivot, add ambient rotation,
  // multiply opacity. Glyphs orbit the pivot below. Under 3D the same
  // local-frame + plane-matrix treatment as the plain-text path; an
  // active text-flip forces the matrix path (§6.5).
  const textAnims = compileTextAnimations(element);
  const unitRotations = textAnims !== null && hasUnitRotations(textAnims);
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff || unitRotations;
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
  const opacityFactor = Math.max(0, Math.min(1, opacity01));
  const xAnchor = resolveAnchor(element.x_anchor);
  const yAnchor = resolveAnchor(element.y_anchor);

  // Anchor against element.width / element.height when set (matches
  // the importer's box-based layout); fall back to natural text bounds
  // otherwise. vertical_align places the text block inside the box.
  // Padding insets the content; percent alignments override the named
  // align fields when present (same rules as the plain-text path).
  const xPad = resolveLength(element.x_padding as never, canvas.width, canvas, 0);
  const yPad = resolveLength(element.y_padding as never, canvas.height, canvas, 0);

  const blockBoxWidth = Number.isFinite(maxWidth) ? maxWidth : totalWidth + 2 * xPad;
  const contentWidth = Math.max(0, blockBoxWidth - 2 * xPad);
  const alignFrac = alignmentFraction(
    element.x_alignment,
    textAlign === 'center' ? 0.5 : textAlign === 'right' ? 1 : 0,
  );
  let blockBoxHeight = totalHeight + 2 * yPad;
  if (typeof element.height === 'number') blockBoxHeight = element.height;
  else if (typeof element.height === 'string') {
    blockBoxHeight = resolveLength(element.height, canvas.height, canvas, blockBoxHeight);
  }
  const verticalAlign: 'top' | 'middle' | 'bottom' = element.vertical_align ?? 'top';
  const vFrac = alignmentFraction(
    element.y_alignment,
    verticalAlign === 'middle' ? 0.5 : verticalAlign === 'bottom' ? 1 : 0,
  );
  const vSlack = Math.max(0, blockBoxHeight - 2 * yPad - totalHeight);
  const blockLeft = x - blockBoxWidth * xAnchor + xPad;
  const blockTop = y - blockBoxHeight * yAnchor + yPad + vSlack * vFrac;

  // Block-level rotation: orbit each glyph (and bg rect) around the
  // pivot (x, y) by the cumulative rotation. Same approach as the
  // single-text path; matches CSS rotate() with transform-origin: center.
  const rotRad = (rotation * Math.PI) / 180;
  const rotCos = Math.cos(rotRad);
  const rotSin = Math.sin(rotRad);
  const rotateAroundPivot = Math.abs(rotation) > 0.01;
  // Scale, then shear, then orbit the point's offset from the pivot.
  function orbit(px: number, py: number): [number, number] {
    const sdx = (px - x) * sx;
    const sdy = (py - y) * sy;
    const dx = sdx + tanSkewX * sdy;
    const dy = sdy + tanSkewY * sdx;
    if (!rotateAroundPivot) return [x + dx, y + dy];
    return [x + dx * rotCos - dy * rotSin, y + dx * rotSin + dy * rotCos];
  }

  // Per-unit text animations — indices run continuously across spans
  // and lines so a multi-line headline staggers as one sequence.
  // (Compiled above for the matrix-path decision.)
  const animLocalTime = ctx.time - (ctx.timeOffset + numberOr(element.time, 0));

  // text-flip pivot pre-pass (§6.5) — REST-layout unit centers,
  // mirroring the draw walk below.
  let letterPivots: [number, number][] | null = null;
  let wordPivots: [number, number][] | null = null;
  if (unitRotations) {
    letterPivots = [];
    const wordBoxes: { l: number; r: number; t: number; b: number }[] = [];
    let pl = 0, pw = 0, pInWord = false;
    let preLineTop = blockTop;
    for (const line of wrappedLines) {
      const glyphBlock = line.ascent + line.descent;
      const lineBoxHeight = elementSize * lineHeightRatio;
      const baselineY = preLineTop + (lineBoxHeight - glyphBlock) / 2 + line.ascent;
      let cursorX = blockLeft + Math.max(0, contentWidth - line.width) * alignFrac;
      for (const sp of line.spans) {
        let pPrev = '';
        for (const ch of sp.text) {
          const isSpace = /\s/.test(ch);
          if (isSpace && pInWord) { pw += 1; pInWord = false; }
          else if (!isSpace) pInWord = true;
          const g = sp.atlas.glyphs.get(ch);
          if (!g) continue;
          cursorX += sp.atlas.kern(pPrev, ch);
          pPrev = ch;
          if (g.width === 0 || g.height === 0) { cursorX += g.advance + sp.letterSpacing; continue; }
          const l = cursorX + g.offsetX;
          const t = baselineY + g.offsetY;
          letterPivots[pl] = [l + g.width / 2, t + g.height / 2];
          const wb = (wordBoxes[pw] ??= { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity });
          wb.l = Math.min(wb.l, l); wb.r = Math.max(wb.r, l + g.width);
          wb.t = Math.min(wb.t, t); wb.b = Math.max(wb.b, t + g.height);
          pl += 1;
          cursorX += g.advance + sp.letterSpacing;
        }
      }
      preLineTop += lineBoxHeight;
    }
    wordPivots = wordBoxes.map((b) => [(b.l + b.r) / 2, (b.t + b.b) / 2]);
  }

  let letterIdx = 0;
  let wordIdx = 0;
  let inWord = false;

  // Shrink-wrapped background — ONE band PER LINE, each hugging that
  // line's glyphs (same rule as the plain-text path). Opt-in; absent ⇒
  // byte-identical.
  if (typeof element.background_color === 'string' && totalWidth > 0 && wrappedLines.length > 0) {
    const c = parseColorPremultiplied(element.background_color);
    const bgC: readonly [number, number, number, number] =
      [c[0] * opacityFactor, c[1] * opacityFactor, c[2] * opacityFactor, c[3] * opacityFactor];
    const [padX, padY] = resolveBgPadding(element.background_padding);
    const cr = numberOr(element.background_border_radius, 0);
    const lbh = elementSize * lineHeightRatio;
    let preTop = blockTop;
    for (const line of wrappedLines) {
      const lw = line.width;
      if (lw > 0) {
        const gblk = line.ascent + line.descent;
        const lineLeft = blockLeft + Math.max(0, contentWidth - lw) * alignFrac;
        const cxLocal = lineLeft + lw / 2;
        const cyLocal = preTop + (lbh - gblk) / 2 + gblk / 2;
        const [bgCx, bgCy] = orbit(cxLocal, cyLocal);
        const bgW = (lw + 2 * padX) * sx;
        const bgH = (gblk + 2 * padY) * sy;
        backend.drawShape({
          cx: bgCx, cy: bgCy, width: bgW, height: bgH, rotation, skewX, skewY,
          transform: glyphChain
            ? quadWorldTransform(glyphChain, bgCx, bgCy, bgW, bgH, 0, skewX, skewY, null)
            : undefined,
          color: bgC,
          cornerRadius: cr,
          shape: 'rectangle',
          blend: element.blend_mode,
        });
      }
      preTop += lbh;
    }
  }

  // Draw each line. Two passes when shadows exist (pass 0 = all glyph
  // shadows behind everything incl. spans, pass 1 = fills); see the
  // plain-text path. No shadows ⇒ one fill pass (byte-identical).
  const textShadows = resolveTextShadows(element.text_shadow, opacityFactor);
  const shadowPasses = textShadows.length > 0 ? 2 : 1;
  for (let pass = 0; pass < shadowPasses; pass++) {
   const drawShadowPass = textShadows.length > 0 && pass === 0;
   const drawFillPass = textShadows.length === 0 || pass === 1;
   letterIdx = 0;
   wordIdx = 0;
   inWord = false;
   let lineTop = blockTop;
   for (const line of wrappedLines) {
    const glyphBlock = line.ascent + line.descent;
    const lineBoxHeight = elementSize * lineHeightRatio;
    const leadingTop = (lineBoxHeight - glyphBlock) / 2;
    const baselineY = lineTop + leadingTop + line.ascent;
    // Per-line alignment within the box bounds.
    const slack = Math.max(0, contentWidth - line.width);
    const lineLeft = blockLeft + slack * alignFrac;
    let cursorX = lineLeft;

    for (const sp of line.spans) {
      // Background fill behind the span. height_ratio shrinks the band
      // inside the line box; inset_y_ratio shifts it down; padding_x
      // extends past the text glyphs on each side; skew_x shears it.
      // Orbits the element pivot for rotated blocks.
      if (sp.background && drawFillPass) {
        const bg = sp.background;
        const bgHeight = Math.max(0, lineBoxHeight * bg.heightRatio);
        const bgTop = lineTop + lineBoxHeight * bg.insetYRatio;
        const bgWidth = sp.width + bg.paddingX * 2;
        const bgCxLocal = cursorX + sp.width / 2;
        const bgCyLocal = bgTop + bgHeight / 2;
        const [bgCx, bgCy] = orbit(bgCxLocal, bgCyLocal);
        backend.drawShape({
          cx: bgCx,
          cy: bgCy,
          width: bgWidth * sx,
          height: bgHeight * sy,
          rotation,
          // Band's own decorative skew composes with the element shear.
          skewX: bg.skewX + skewX,
          skewY,
          transform: glyphChain
            ? quadWorldTransform(glyphChain, bgCx, bgCy, bgWidth * sx, bgHeight * sy, 0, bg.skewX + skewX, skewY, null)
            : undefined,
          color: [
            bg.color[0] * opacityFactor,
            bg.color[1] * opacityFactor,
            bg.color[2] * opacityFactor,
            bg.color[3] * opacityFactor,
          ],
          cornerRadius: bg.borderRadius,
          shape: 'rectangle',
          blend: element.blend_mode,
        });
      }

      // Glyphs.
      const tint: readonly [number, number, number, number] = [
        sp.tint[0] * opacityFactor,
        sp.tint[1] * opacityFactor,
        sp.tint[2] * opacityFactor,
        sp.tint[3] * opacityFactor,
      ];

      let prevCh = '';
      for (const ch of sp.text) {
        const isSpace = /\s/.test(ch);
        if (isSpace && inWord) {
          wordIdx += 1;
          inWord = false;
        } else if (!isSpace) {
          inWord = true;
        }

        const g = sp.atlas.glyphs.get(ch);
        if (!g) continue;
        cursorX += sp.atlas.kern(prevCh, ch);
        prevCh = ch;
        if (g.width === 0 || g.height === 0) {
          cursorX += g.advance + sp.letterSpacing;
          continue;
        }

        const unitLetterIdx = letterIdx;
        const fx = textAnims
          ? evaluateUnitEffect(textAnims, animLocalTime, letterIdx, wordIdx)
          : null;
        letterIdx += 1;
        if (fx && fx.opacity <= 0) {
          cursorX += g.advance + sp.letterSpacing;
          continue;
        }

        // text-flip (§6.5): unit rotations conjugated about the unit
        // centers (word OUTSIDE letter), pivots riding the unit's dx/dy.
        let chain = glyphChain;
        if (chain && fx?.flips) {
          const conjugate = (pivot: [number, number] | undefined, rot: UnitRotation | undefined) => {
            if (!pivot || !rot) return;
            const [ux, uy] = orbit(pivot[0] + fx.dx, pivot[1] + fx.dy);
            chain = mat4Multiply(chain!, mat4PlaneAt(ux, uy, 0, rot[2], rot[1], rot[0]));
          };
          conjugate(wordPivots?.[wordIdx], fx.flips.word);
          conjugate(letterPivots?.[unitLetterIdx], fx.flips.letter);
        }

        const quadLeft = cursorX + g.offsetX + (fx ? fx.dx : 0);
        const quadTop = baselineY + g.offsetY + (fx ? fx.dy : 0);
        let [cellCx, cellCy] = orbit(quadLeft + g.width / 2, quadTop + g.height / 2);
        // Pixel-snap in the plain axis-aligned case (see plain-text path)
        // so glyphs aren't bilinear-blurred across the framebuffer grid.
        if (!chain && rotation === 0 && skewX === 0 && skewY === 0 && sx === 1 && sy === 1 && !fx) {
          cellCx = Math.round(cellCx - g.width / 2) + g.width / 2;
          cellCy = Math.round(cellCy - g.height / 2) + g.height / 2;
        }
        const u0 = g.x / sp.atlas.width;
        const v0 = g.y / sp.atlas.height;
        const u1 = (g.x + g.width) / sp.atlas.width;
        const v1 = (g.y + g.height) / sp.atlas.height;
        const glyphTint: readonly [number, number, number, number] =
          fx && fx.opacity < 1
            ? [tint[0] * fx.opacity, tint[1] * fx.opacity, tint[2] * fx.opacity, tint[3] * fx.opacity]
            : tint;
        if (drawShadowPass) {
          const sw = g.width * sx, shh = g.height * sy;
          paintTextShadows(textShadows, fx && fx.opacity < 1 ? fx.opacity : 1, (ox, oy, col) => {
            const [scx, scy] = orbit(quadLeft + ox + g.width / 2, quadTop + oy + g.height / 2);
            backend.drawTexturedQuad({
              cx: scx, cy: scy, width: sw, height: shh, rotation, skewX, skewY,
              transform: chain ? quadWorldTransform(chain, scx, scy, sw, shh, 0, skewX, skewY, null) : undefined,
              texture: sp.atlas.texture, uvRect: [u0, v0, u1, v1], tint: col,
              blend: element.blend_mode, alphaGamma: textAlphaGamma(col),
            });
          });
        }
        if (drawFillPass) {
          backend.drawTexturedQuad({
            cx: cellCx,
            cy: cellCy,
            width: g.width * sx,
            height: g.height * sy,
            rotation,
            skewX,
            skewY,
            transform: chain
              ? quadWorldTransform(chain, cellCx, cellCy, g.width * sx, g.height * sy, 0, skewX, skewY, null)
              : undefined,
            texture: sp.atlas.texture,
            uvRect: [u0, v0, u1, v1],
            tint: glyphTint,
            blend: element.blend_mode,
            alphaGamma: textAlphaGamma(glyphTint),
          });
        }
        cursorX += g.advance + sp.letterSpacing;
      }
    }
    lineTop += lineBoxHeight;
   }
  }
}

interface SpanDefaults {
  family: string;
  size: number;
  weight: number | string;
  color: string;
  letterSpacing: number;
}

/**
 * Greedy word-wrap a single line into N lines whose widths fit under
 * maxWidth. Splits each span's text on whitespace boundaries; words
 * inherit their original span's atlas + tint + background. A span that
 * straddles a break is represented as two resolved spans on two lines.
 *
 * Doesn't break inside a word — if a single word is wider than
 * maxWidth, it stays on its own line and overflows (matches CSS
 * word-wrap: normal behavior).
 */
function wrapLine(line: SpanLine, maxWidth: number): SpanLine[] {
  // Slice each span into per-word resolved sub-spans.
  type Chunk = { word: string; resolved: ResolvedSpan; width: number };
  const chunks: Chunk[] = [];
  for (const sp of line.spans) {
    // nowrap spans (CSS `white-space: nowrap` / `display: inline-block`)
    // are atomic — emit a single chunk for the whole span so the wrap
    // algorithm treats it as one indivisible word. Without this, a
    // highlighted phrase like "before you leave" would split mid-band.
    if (sp.nowrap) {
      chunks.push({ word: sp.text, resolved: sp, width: sp.width });
      continue;
    }
    // Split on whitespace runs but KEEP the whitespace (so word + space
    // are emitted as separate chunks; the trailing space is dropped if
    // it lands at a line break, which is what we want).
    const parts = sp.text.split(/(\s+)/).filter((p) => p !== '');
    for (const part of parts) {
      let w = 0;
      let prev = '';
      for (const ch of part) {
        const g = sp.atlas.glyphs.get(ch);
        if (g) {
          w += g.advance + sp.letterSpacing + sp.atlas.kern(prev, ch);
          prev = ch;
        }
      }
      chunks.push({ word: part, resolved: sp, width: w });
    }
  }

  const result: SpanLine[] = [];
  let current: SpanLine = { spans: [], width: 0, ascent: 0, descent: 0 };
  for (const chunk of chunks) {
    const isWhitespace = chunk.word.trim() === '';
    // Wrap point: adding this chunk would overflow, AND the current line
    // isn't empty. (Empty line + huge word still emits the word; we let
    // it overflow rather than infinite-loop.)
    if (current.width + chunk.width > maxWidth && current.spans.length > 0) {
      result.push(current);
      current = { spans: [], width: 0, ascent: 0, descent: 0 };
      // Drop a whitespace chunk that lands at the start of a new line.
      if (isWhitespace) continue;
    }
    current.spans.push({
      ...chunk.resolved,
      text: chunk.word,
      width: chunk.width,
    });
    current.width += chunk.width;
    current.ascent = Math.max(current.ascent, chunk.resolved.atlas.ascent);
    current.descent = Math.max(current.descent, chunk.resolved.atlas.descent);
  }
  if (current.spans.length > 0) result.push(current);
  return result;
}

function resolveSpan(
  span: TextSpan,
  defaults: SpanDefaults,
  ctx: RenderContext,
): ResolvedSpan {
  const family = span.font_family ?? defaults.family;
  const weight = span.font_weight ?? defaults.weight;
  let size: number;
  if (typeof span.font_size === 'number') size = span.font_size;
  else if (typeof span.font_size === 'string') {
    size = resolveLength(span.font_size, ctx.canvas.height, ctx.canvas, defaults.size);
  } else {
    size = defaults.size;
  }

  const key = atlasKey({ family, size, weight });
  let atlas = ctx.fontAtlases.get(key);
  if (!atlas) {
    atlas = generateFontAtlas({ family, size, weight }, ctx.backend);
    ctx.fontAtlases.set(key, atlas);
  }

  const letterSpacing = numberOr(span.letter_spacing, defaults.letterSpacing);
  // Kern within the span only (resets at span boundaries) — the draw
  // walk resets its pair state per span too, so widths stay exact.
  let width = 0;
  let prev = '';
  for (const ch of span.text) {
    const g = atlas.glyphs.get(ch);
    if (g) {
      width += g.advance + letterSpacing + atlas.kern(prev, ch);
      prev = ch;
    }
  }

  const fillColor = span.fill_color ?? defaults.color;
  const tint = parseColorPremultiplied(fillColor);

  // span.background (rich) takes precedence over span.background_color
  // (shortcut for a flat full-line-box rectangle).
  let background: ResolvedBackground | undefined;
  if (span.background) {
    const opacityFactor = span.background.opacity !== undefined
      ? Math.max(0, Math.min(1, span.background.opacity))
      : 1;
    const baseColor = parseColorPremultiplied(span.background.color);
    background = {
      color: [
        baseColor[0] * opacityFactor,
        baseColor[1] * opacityFactor,
        baseColor[2] * opacityFactor,
        baseColor[3] * opacityFactor,
      ],
      heightRatio: span.background.height_ratio ?? 1,
      insetYRatio: span.background.inset_y_ratio ?? 0,
      paddingX: span.background.padding_x ?? 0,
      skewX: span.background.skew_x ?? 0,
      borderRadius: span.background.border_radius ?? 0,
    };
  } else if (span.background_color) {
    background = {
      color: parseColorPremultiplied(span.background_color),
      heightRatio: 1,
      insetYRatio: 0,
      paddingX: 0,
      skewX: 0,
      borderRadius: 0,
    };
  }

  return { text: span.text, atlas, tint, background, width, letterSpacing, nowrap: span.nowrap === true };
}

function resolveFontSize(element: TextElement, ctx: RenderContext): number {
  if (element.font_size === 'auto') return 48;
  if (typeof element.font_size === 'number') return element.font_size;
  if (typeof element.font_size === 'string') {
    return resolveLength(element.font_size, ctx.canvas.height, ctx.canvas, 48);
  }
  return 48;
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Resolve background_padding (number | [x, y]) to [padX, padY] px. */
function resolveBgPadding(p: unknown): [number, number] {
  if (Array.isArray(p)) return [numberOr(p[0], 0), numberOr(p[1], 0)];
  const v = numberOr(p, 0);
  return [v, v];
}

export interface ResolvedTextShadow {
  /** Premultiplied RGBA, shadow opacity already baked in. */
  color: readonly [number, number, number, number];
  dx: number;
  dy: number;
  blur: number;
}

/**
 * Resolve `text_shadow` (TextShadow | TextShadow[]) to a back-to-front
 * list. `elementOpacity` (the element's resolved 0..1 opacity) is baked
 * into each shadow's alpha so shadows fade with the element.
 */
export function resolveTextShadows(raw: unknown, elementOpacity = 1): ResolvedTextShadow[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: ResolvedTextShadow[] = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const sh = s as { color?: unknown; offset_x?: unknown; offset_y?: unknown; blur?: unknown; opacity?: unknown };
    if (typeof sh.color !== 'string') continue;
    const c = parseColorPremultiplied(sh.color);
    const op = Math.max(0, Math.min(1, numberOr(sh.opacity, 1))) * elementOpacity;
    out.push({
      color: [c[0] * op, c[1] * op, c[2] * op, c[3] * op],
      dx: numberOr(sh.offset_x, 0),
      dy: numberOr(sh.offset_y, 0),
      blur: Math.max(0, numberOr(sh.blur, 0)),
    });
  }
  return out;
}

// Unit-disk Gaussian taps (offset × blurσ, weight; weights sum to 1).
// Per-glyph soft shadow without a blur shader: each tap re-draws the
// glyph faintly. Two rings + center is enough for a smooth shadow at the
// blur radii people use (it's low-frequency, very forgiving).
const SHADOW_TAPS: readonly (readonly [number, number, number])[] = (() => {
  const raw: [number, number, number][] = [[0, 0, 1]];
  const rings = [{ r: 0.62, n: 6 }, { r: 1.18, n: 8 }];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ring.r;
      raw.push([Math.cos(a) * ring.r, Math.sin(a) * ring.r, Math.exp(-(ring.r * ring.r) / 0.7)]);
    }
  }
  const total = raw.reduce((s, t) => s + t[2], 0);
  return raw.map(([x, y, w]) => [x, y, w / total] as const);
})();

const scaleRGBA = (c: readonly [number, number, number, number], k: number): [number, number, number, number] =>
  [c[0] * k, c[1] * k, c[2] * k, c[3] * k];

/**
 * Paint one glyph's text shadows via `drawTinted(localOffsetX, offsetY,
 * premultipliedColor)` — the caller supplies the per-path quad draw at a
 * local offset. Hard shadows are one tap; soft shadows spread the tap
 * kernel by `blur`. `glyphAlpha` fades the shadow with a fading glyph.
 */
export function paintTextShadows(
  shadows: ResolvedTextShadow[],
  glyphAlpha: number,
  drawTinted: (ox: number, oy: number, color: readonly [number, number, number, number]) => void,
): void {
  for (const sh of shadows) {
    if (sh.blur <= 0.001) {
      drawTinted(sh.dx, sh.dy, glyphAlpha < 1 ? scaleRGBA(sh.color, glyphAlpha) : sh.color);
    } else {
      for (const [tx, ty, w] of SHADOW_TAPS) {
        drawTinted(sh.dx + tx * sh.blur, sh.dy + ty * sh.blur, scaleRGBA(sh.color, w * glyphAlpha));
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Masked-text rendering path
// ────────────────────────────────────────────────────────────────────────────
//
// For elements with a `mask` field, we bypass the font atlas and render the
// text into an OffscreenCanvas with Canvas2D's fillText, then apply a
// linear-gradient alpha mask via destination-in compositing, then upload
// as a single texture and draw one textured quad.
//
// Cost: O(text length × glyph rasterization) per frame. Fine for short
// title text; would be wasteful for long copy.

// 2× supersampling — keeps text crisp when the textured quad is scaled up
// by the backend.
const TEXT_SUPERSAMPLE = 2;

function renderMaskedTextElement(element: TextElement, ctx: RenderContext): void {
  const { canvas, backend, maskedTexts } = ctx;
  const elementStart = ctx.timeOffset + numberOr(element.time, 0);
  const localTime = ctx.time - elementStart;
  const text = resolveText(element, localTime);
  if (text.length === 0) return;

  const fontFamily = withFontFallback(String(element.font_family ?? 'sans-serif'));
  const fontWeight = String(element.font_weight ?? 'normal');
  const fontStyle = element.font_style === 'italic' ? 'italic' : 'normal';

  // Resolve font size (number / "auto" / unit string).
  let fontSize: number;
  if (element.font_size === 'auto') {
    const constraintWidth = (element.width !== undefined
      ? resolveLength(element.width as never, canvas.width, canvas, canvas.width)
      : canvas.width) - 2 * resolveLength(element.x_padding as never, canvas.width, canvas, 0);
    const autoMin = resolveLength(element.font_size_minimum as never, canvas.height, canvas, 8);
    const autoMax = resolveLength(element.font_size_maximum as never, canvas.height, canvas, 400);
    fontSize = autoFitFontSize(
      text, fontFamily, fontWeight, Math.max(1, constraintWidth), 48, autoMin, autoMax,
    );
  } else if (typeof element.font_size === 'number') {
    fontSize = element.font_size;
  } else if (typeof element.font_size === 'string') {
    fontSize = resolveLength(element.font_size, canvas.height, canvas, 48);
  } else {
    fontSize = 48;
  }

  // Measure text once with a probe context. We need both the bounding box
  // and the actual ascent/descent so the canvas is sized correctly.
  const probe = getProbeContext();
  const fontSpec = `${fontStyle} ${fontWeight} ${fontSize * TEXT_SUPERSAMPLE}px ${fontFamily}`;
  probe.font = fontSpec;
  const metrics = probe.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  const textW = Math.max(1, Math.ceil(metrics.width));
  const textH = Math.max(1, Math.ceil(ascent + descent));

  // Add a small padding to avoid clipping AA fringes at the edges.
  const PAD = Math.max(4, Math.ceil(fontSize * TEXT_SUPERSAMPLE * 0.1));
  const canvasW = textW + PAD * 2;
  const canvasH = textH + PAD * 2;

  // Display-space sizes (un-supersampled).
  const displayW = canvasW / TEXT_SUPERSAMPLE;
  const displayH = canvasH / TEXT_SUPERSAMPLE;

  // Get-or-create the cached OffscreenCanvas + Texture. Re-allocate if the
  // required dimensions changed (font_size, text content, or DPI shift).
  const cacheKey = typeof element.id === 'string' ? element.id : `__masked_text_${text}`;
  let asset = maskedTexts.get(cacheKey);
  if (!asset || asset.canvas.width !== canvasW || asset.canvas.height !== canvasH) {
    const off = new OffscreenCanvas(canvasW, canvasH);
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const texture = backend.createTexture(off);
    asset = { canvas: off, ctx: offCtx as OffscreenCanvasRenderingContext2D, texture } satisfies MaskedTextAsset;
    maskedTexts.set(cacheKey, asset);
  }

  // ── Pass 1: draw the text ─────────────────────────────────────────────
  const offCtx = asset.ctx;
  offCtx.save();
  offCtx.setTransform(1, 0, 0, 1, 0, 0);
  offCtx.clearRect(0, 0, canvasW, canvasH);
  offCtx.font = fontSpec;
  offCtx.fillStyle = typeof element.fill_color === 'string' ? element.fill_color : '#ffffff';
  offCtx.textBaseline = 'alphabetic';
  offCtx.textAlign = 'left';
  offCtx.fillText(text, PAD, PAD + ascent);
  offCtx.restore();

  // ── Pass 2: apply the mask ────────────────────────────────────────────
  const mask = element.mask!;
  const progress = clamp01(resolveMaskProgress(mask.progress, localTime));
  applyLinearWipeMask(offCtx, canvasW, canvasH, mask.angle ?? -45, progress, mask.softness ?? 0.3);

  // ── Pass 3: upload + draw ─────────────────────────────────────────────
  backend.updateTexture(asset.texture, asset.canvas);

  // Element transform — placement uses display-space dimensions.
  const x = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const y = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const rotation = applyAnimation(element, 'rotation', numberOr(element.rotation ?? (element as { z_rotation?: unknown }).z_rotation, 0), ctx);
  const opacity01 = applyAnimation(element, 'opacity', numberOr(element.opacity, 1), ctx);
  const xAnchor = resolveAnchor(element.x_anchor);
  const yAnchor = resolveAnchor(element.y_anchor);

  // Quad center: place top-left at (x - displayW * xAnchor, y - displayH * yAnchor),
  // then offset by half display size to get the center.
  const left = x - displayW * xAnchor;
  const top = y - displayH * yAnchor;
  const cx = left + displayW / 2;
  const cy = top + displayH / 2;

  const opacity = clamp01(opacity01);
  if (opacity <= 0) return;

  // CKP/1.0 3D (§4.4): masked text is a single flattened quad — the
  // same block-level matrix hand-off as svg.
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff;
  backend.drawTexturedQuad({
    cx,
    cy,
    width: displayW,
    height: displayH,
    rotation,
    transform: matrixPath
      ? quadWorldTransform(ctx.modelMatrix, cx, cy, displayW, displayH, rotation, 0, 0, t3d)
      : undefined,
    texture: asset.texture,
    tint: [opacity, opacity, opacity, opacity],
    blend: element.blend_mode,
  });
}

function resolveMaskProgress(value: number | Keyframe[] | Expr | undefined, localTime: number): number {
  if (value === undefined) return 1;
  if (typeof value === 'number') return value;
  if (isExpr(value)) return evalExpr(value, { t: localTime, dur: 0, i: 0, n: 1, value: 1 });
  if (Array.isArray(value)) return interpolateKeyframes(value, localTime);
  return 1;
}

/**
 * Apply a linear-gradient alpha mask. The gradient line passes through the
 * canvas center at `angleDeg` (CSS convention: 0° = top, clockwise). As
 * `progress` goes 0 → 1, the opaque-stop sweeps across, revealing the
 * underlying pixels. `softness` controls the width of the wipe edge.
 *
 * Uses `globalCompositeOperation = 'destination-in'`: existing pixels are
 * multiplied by the gradient's alpha, with transparent regions of the
 * gradient erasing the underlying text.
 */
function applyLinearWipeMask(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  angleDeg: number,
  progress: number,
  softness: number,
): void {
  // CSS angle θ: 0° = "to top" (gradient direction = (0, -1)); +90° = "to right".
  // Convert to a unit vector.
  const theta = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(theta);
  const dy = -Math.cos(theta);

  // Projection of the canvas's diagonal onto the gradient direction — this
  // is the gradient line length per the CSS spec.
  const lineLen = Math.abs(width * dx) + Math.abs(height * dy);
  if (lineLen === 0) return;

  const ccx = width / 2;
  const ccy = height / 2;
  const x0 = ccx - (lineLen / 2) * dx;
  const y0 = ccy - (lineLen / 2) * dy;
  const x1 = ccx + (lineLen / 2) * dx;
  const y1 = ccy + (lineLen / 2) * dy;

  // Stops in [0, 1]:
  //  - rightStop = (1 - progress) * (1 + softness)
  //  - leftStop  = max(0, rightStop - softness)
  // Maps so that progress=0 → fully transparent, progress=1 → fully opaque,
  // and intermediate values produce a soft wipe edge of width `softness`.
  const soft = clamp01(softness);
  const rightStop = (1 - progress) * (1 + soft);
  const leftStop = Math.max(0, rightStop - soft);
  const lClamp = clamp01(leftStop);
  const rClamp = Math.max(lClamp, clamp01(rightStop));

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(lClamp, 'rgba(0,0,0,0)');
  grad.addColorStop(rClamp, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// Lazy-initialized 1×1 OffscreenCanvas just for text measurement.
let _probeCanvas: OffscreenCanvas | null = null;
let _probeCtx: OffscreenCanvasRenderingContext2D | null = null;
function getProbeContext(): OffscreenCanvasRenderingContext2D {
  if (!_probeCtx) {
    _probeCanvas = new OffscreenCanvas(1, 1);
    _probeCtx = _probeCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  }
  return _probeCtx!;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Re-export TextMask so we don't get an unused-import warning if the file's
// trimmed back later.
export type { TextMask };

/** Resolve the rendered text for an element. */
function resolveText(element: TextElement, _localTime: number): string {
  return applyTextTransform(String(element.text ?? ''), element.text_transform);
}

/** Case transform applied before layout (text_transform). */
function applyTextTransform(
  text: string,
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize' | undefined,
): string {
  switch (transform) {
    case 'uppercase': return text.toUpperCase();
    case 'lowercase': return text.toLowerCase();
    case 'capitalize':
      return text.replace(/(^|\s)(\S)/g, (_, pre: string, ch: string) => pre + ch.toUpperCase());
    default: return text;
  }
}

/**
 * Percentage-based content alignment: "0%" → 0, "50%" → 0.5, numbers
 * are fractions. Falls back when absent/unparseable.
 */
function alignmentFraction(v: number | string | undefined, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.min(1, v.trim().endsWith('%') ? n / 100 : n));
    }
  }
  return fallback;
}

