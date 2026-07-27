# Clipkit authoring card (CKP/1.0)

> The compact agent context for authoring Clipkit videos — everything needed
> for most compositions in ~8KB. For the full authoring guide + pattern
> catalog see AGENTS.md; for the formal spec see PROTOCOL.md.

A video is ONE JSON document: a canvas plus an `elements` array. No code, no
markup. Positions are px from the top-left (CSS model: x/y locate the element's
top-left corner unless you move the anchor). Times are seconds. `layer` is the
paint order — REQUIRED on every element, UNIQUE, and **the HIGHEST layer is the
TOP** (CSS z-index model — backgrounds go at layer 1).
Text renders full Unicode including color emoji (they keep their own colors;
fill_color tints regular glyphs only). Emoji artwork comes from the render
host's emoji font — cloud renders use Noto Color Emoji.

Check yourself with the validator instead of guessing or re-reading docs —
one call returns actionable schema errors + render-time warnings:
- CLI: `npx @clipkit/cli validate <file>`
- MCP: the `validate_project` tool

## Source root

```json
{ "clipkit_version": "1.0", "width": 1920, "height": 1080, "duration": 5,
  "frame_rate": 30, "background_color": "#101014", "elements": [ ... ] }
```

Optional root fields: `fonts` (custom font faces: `{family, weight, style, src}`),
`styles` (named appearance bundles, see below), `bloom`, `camera`, `lights`
(3D/PBR — skip for flat 2D).

## Fields on every element

`id`, `layer` (required, unique, highest = top), `time` (start, s), `duration`
(s | "auto" | "end"), `x`, `y` (px or "50%"), `x_anchor`/`y_anchor` (0 = left/top
default, "50%" = center — set both to "50%" and x/y position the center),
`width`/`height` (px or "50%"), `rotation` (deg), `scale`, `x_scale`/`y_scale`,
`opacity` (0-1), `blur_radius`, `blend_mode`
("normal"|"multiply"|"screen"|"add"|"overlay"|"hard-light"|"soft-light"),
`brightness`/`contrast`/`saturation`/`hue_rotate`, `effects`, `animations`,
`keyframe_animations`.

Any numeric field above also accepts a keyframe array or an expression (below).

## Element types (the ones you'll use)

**text** — `text` (or `spans` for mixed styling: `[{text, font_weight, font_style,
font_family, font_size, fill_color}]`), `font_family` (e.g. "Georgia, serif" —
system stacks; or register `fonts`), `font_size` (px or "auto" to fit),
`font_weight`, `font_style` ("normal"|"italic"), `fill_color`, `gradient`,
`stroke_color`+`stroke_width`, `letter_spacing`, `line_height`, `text_align`
("left"|"center"|"right"), `text_transform` ("uppercase"|...), `text_wrap`,
`text_shadow` `{color, offset_x, offset_y, blur, opacity}`,
`background_color`+`background_padding` (band behind text),
`mask` `{type:"linear-wipe", angle, progress, softness}` (progress is animatable
— keyframe it for a wipe reveal).

**shape** — `shape` ("rectangle"|"ellipse"), `fill_color` or `gradient`
(`{type:"linear", angle, stops:[{offset, color}]}` — also "radial"/"conic"),
`border_radius`, `stroke_color`+`stroke_width`, `shadow`
`{color, offset_x, offset_y, blur}`. Full-canvas gradient background = a
rectangle at layer 1 (bottom), width/height 100%.

**image** — `source` (URL), `fit` ("cover" default |"contain"|"fill"),
`border_radius`, crop fields.

**group** — `elements: [...]` children; the group's transform/opacity composes
onto all of them. `clip: true` clips children to the group box. Use a group to
move/scale/fade several elements as one.

Also available: `video`, `audio`, `caption` (word-timed karaoke text),
`particles` (emitter: `rate`, `velocity`, `gravity`, `color`, `burst`).

## Motion

**1. Presets** (fastest — `animations` array on the element):

```json
"animations": [
  { "type": "text-slide", "time": "start", "duration": 0.8, "split": "word",
    "stagger": 0.12, "direction": "up", "easing": "ease-out-cubic" },
  { "type": "fade-out", "time": "end", "duration": 0.5 }
]
```

Preset names: fade-in, fade-out, slide-left-in, slide-right-in, slide-up-in,
slide-down-in, slide-*-out (same four), scale-in, scale-out, rotate-in,
rotate-out, bounce-in, bounce-out, spin, shake, wiggle, squash, pan, shift,
drift, breathe, orbit, text-appear, text-slide, text-fly, text-typewriter,
text-wave, text-flip. The text-* presets take `split` ("letter"|"word"),
`stagger` (s between units), `order` ("forward"|"reverse"|"random"), `fade`.
`time` is "start", "end", or seconds from element start.

**2. Keyframes** (any numeric field):

```json
"opacity": [ { "time": 0, "value": 0 }, { "time": 0.6, "value": 1, "easing": "ease-out" } ],
"y": [ { "time": 0, "value": 640 }, { "time": 0.8, "value": 540, "easing": "ease-out-quart" } ]
```

A keyframe track is a BARE array of `{time, value, easing?}` objects — never a
wrapper object. Keyframe times are seconds FROM ELEMENT START. Fields not
listed as animatable (e.g. all `particles` emitter fields) are plain numbers. Easings: linear, ease, ease-in,
ease-out, ease-in-out, ease-in/out/in-out-{cubic,quad,quart,quint,sine,expo,
circ,back}, spring, elastic-in/out/in-out, bounce-in/out/in-out, or
"cubic-bezier(a,b,c,d)".

**3. Expressions** (procedural motion, any numeric field):

```json
"rotation": { "expr": "10 * sin(t * 2)" },
"width": { "expr": "ease(t, 0, 0.8, 0, 900)" }
```

Variables: `t` (element-local s), `dur`, `value` (the base value), `i`/`n`
(copy index/count in generated sets). Functions: sin cos tan abs sign sqrt pow
exp log floor ceil round fract min max mod clamp lerp mix step smoothstep
linear(x,x0,x1,y0,y1) ease(x,x0,x1,y0,y1) noise(x,seed) wiggle(freq,amp)
random(seed). `ease(t, 0, 0.8, 0, 900)` maps t 0→0.8s onto 0→900, clamped,
cubic in-out.

**4. keyframe_animations** — explicit tracks with `property` + `keyframes` +
optional `loop`; use for motion paths and camera rigs.

## Generated sets (never hand-list near-identical elements)

`repeat: N` renders N copies (2-500); `{i}`/`{i1}` in strings substitute the
0-/1-based copy index; `i`/`n` bind in expressions. `repeat_stagger: 0.15`
starts copy k at time + k*0.15. `repeat_data` gives each copy its own data —
each row patches fields AND binds its keys in strings `{key}` and expressions:

```json
{ "type": "shape", "layer": 5, "time": 0.5, "x": 200, "y": { "expr": "300 + i * 120" },
  "height": 80, "fill_color": "{color}", "width": { "expr": "ease(t, 0, 0.8, 0, w)" },
  "repeat_stagger": 0.2,
  "repeat_data": [ { "w": 900, "color": "#1ba6ff" }, { "w": 700, "color": "#ffd60a" } ] }
```

Works on text/shape/image/group (a group repeats its whole subtree).

## Styles (shared appearance)

```json
"styles": { "headline": { "font_family": "Georgia, serif", "font_weight": 700,
  "fill_color": "#f3ead7", "letter_spacing": 2 } }
```

Element side: `"style": "headline"` — merges UNDER the element's own fields.
A style bundle allows ONLY these appearance fields: `font_family`,
`font_weight`, `font_size`, `letter_spacing`, `fill_color`, `stroke_color`,
`stroke_width`, `gradient`, `border_radius`, `opacity`. Anything else
(`text_align`, `line_height`, `font_style`, `text_transform`, timing, layer)
goes on the element itself — putting it in a style fails validation, as does an
unknown style name.

## Complete example (product title card, 4s, 1280x720)

```json
{ "clipkit_version": "1.0", "width": 1280, "height": 720, "duration": 4,
  "background_color": "#0d1117",
  "styles": { "head": { "font_family": "Inter, sans-serif", "font_weight": 800, "fill_color": "#ffffff" } },
  "elements": [
    { "type": "shape", "id": "bg", "layer": 1, "time": 0, "duration": "end",
      "width": "100%", "height": "100%",
      "gradient": { "type": "linear", "angle": 135,
        "stops": [ { "offset": 0, "color": "#0d1117" }, { "offset": 1, "color": "#1a2333" } ] } },
    { "type": "text", "id": "title", "style": "head", "layer": 4, "time": 0.3, "duration": "end",
      "x": "50%", "y": 280, "x_anchor": "50%", "font_size": 96, "text": "Ship video, not code.",
      "animations": [ { "type": "text-slide", "time": "start", "duration": 0.7,
        "split": "word", "stagger": 0.1, "direction": "up", "easing": "ease-out-cubic" } ] },
    { "type": "shape", "id": "rule", "layer": 3, "time": 1.1, "duration": "end",
      "x": "50%", "y": 400, "x_anchor": "50%", "height": 4, "fill_color": "#ffd60a",
      "width": { "expr": "ease(t, 0, 0.5, 0, 320)" } },
    { "type": "text", "id": "sub", "layer": 2, "time": 1.3, "duration": "end",
      "x": "50%", "y": 440, "x_anchor": "50%", "font_size": 30, "fill_color": "#8b949e",
      "font_family": "Inter, sans-serif", "text": "One JSON document in. One MP4 out.",
      "animations": [ { "type": "fade-in", "time": "start", "duration": 0.6 } ] }
  ] }
```

## Gotchas

- `layer` required + unique per element; HIGHEST = TOP (opaque backgrounds go on
  layer 1 / the LOWEST number, or they cover everything).
- Unicode + emoji are fine in text; emoji render in their own colors (untinted).
- Author `rotation` or `z_rotation`, not both (same slot).
- Set root `duration` explicitly; give hold time after the last entrance so the
  end frame is calm.
- Keyframe/preset times are element-local (element `time` offsets the clock).
- Validate before you finish: `clipkit validate <file>` (or the MCP
  `validate_project` tool).
- Authoring a known archetype? Load ONE pattern card alongside this card —
  proven idioms, ~4-5KB each: `data-viz` (count-ups, bar/progress rows),
  `cinematic-ui` (product hero shots, camera rigs), `ui-screencast` (faked
  app UI, typing, cursor, state transitions). CLI `clipkit docs
  pattern-<name>`, MCP `read_docs` topic `pattern-<name>`.
- Need more than this card covers (3D/camera, particles detail, video/audio
  trims, Lottie import, the pattern catalog)? Fetch the full guide: CLI
  `clipkit docs agents`, MCP `read_docs` — don't guess at fields.
