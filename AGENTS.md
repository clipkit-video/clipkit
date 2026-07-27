# Clipkit — Authoring guide (AGENTS.md)

> This file is the authoring-time context for AI tools (and humans)
> writing Clipkit videos. Paste it into a system prompt or attach it
> to a Claude project. For the **formal protocol spec** — element types,
> field semantics, conformance levels, normative MUST/SHOULD/MAY — see
> [`PROTOCOL.md`](./PROTOCOL.md).

Clipkit is a protocol for describing motion-graphics videos as JSON.
A `Source` document is the list of `elements` (with timing and
animations) that a conforming runtime turns into frames or MP4.

There are two layers you work with as an author:

1. **Primitives** — the element types defined by the Clipkit Protocol.
   The formal spec is in [PROTOCOL.md](./PROTOCOL.md). Section 1 below
   is a quick cheat sheet so you don't have to bounce out for common
   lookups, but PROTOCOL.md is the source of truth.
2. **Patterns** — authoring-time TypeScript helpers in `@clipkit/patterns`
   that produce primitive elements. You never reference patterns in
   a Source JSON; you call them in TS/JS and inline their output.
   Patterns are documented in section 2 (Pattern catalog).

Section 3 (Recipes) walks through complete example videos showing how
patterns compose into a full piece.

---

## 0. Which surface to use

Before authoring anything, pick the right surface for your context.
There are two — they layer cleanly, no overlap.

| You are running in… | Use… | How |
|---|---|---|
| **Claude Code, Cursor, Replit Agent, or any IDE-embedded AI with file + shell access** | `@clipkit/cli` | Write files (`video.ts` or a JSON source) using this doc as context. Run `npx @clipkit/cli render`, `validate`, or `preview` via Bash. Skip MCP entirely. |
| **Claude.ai chat, Claude Desktop without local tools, or any chat-mode AI without filesystem access** | `@clipkit/mcp-server` | Call the MCP tools — `set_project` to build (the full creative canvas), `create_promo` to compose from prebuilt scenes, `add_element`/`edit_element`/`delete_element` to tweak, `preview_still`/`validate_project`/`describe_project` to check, `open_in_editor`/`render_video` to deliver. The server holds state for you. |
| **A human developer** | `@clipkit/cli` | `npx @clipkit/cli init my-video`, edit files, `npx @clipkit/cli render`. Same path as IDE-embedded AI. |
| **CI / a build script** | `@clipkit/cli` | One-shot `clipkit render input.json --out out.mp4`. |

A few clarifications agents sometimes need:

- **The CLI and the MCP server are not interchangeable.** They target
  different deployments. CLI assumes you have a shell. MCP assumes you
  don't.
- **If you can run `Bash`, you're in CLI territory.** You don't need
  MCP at all — go straight to files + CLI.
- **There is no "Clipkit Skill."** The skill concept was considered and
  dropped because everything it would do (auto-load this doc, wrap CLI
  commands as slash commands) is already covered by the CLI and by MCP
  resource-loading. If a user asks about installing the skill, redirect
  them to the CLI.

Once you know your surface, continue to §1 for the schema cheat sheet.

---

## 1. Schema cheat sheet

Authoritative spec: **[PROTOCOL.md](./PROTOCOL.md)** (CKP/1.0). What
follows is the at-a-glance reference for things you look up constantly.

### Source root

```json
{
  "clipkit_version": "1.0",
  "output_format": "mp4",
  "width": 1920, "height": 1080,
  "duration": 30, "frame_rate": 30,
  "background_color": "#000000",
  "elements": [ /* ... */ ]
}
```

Optional root field `motion_blur: { "samples": 8, "shutter": 0.5 }`
adds whole-frame motion blur at render time — the frame becomes the
exact average of `samples` sub-frame renders across a shutter window
(`shutter` = fraction of the frame interval; 0.5 ≈ a film camera's
180° shutter). Use it when fast motion strobes: whip-pans, fast
travel, spinning elements. Renders cost `samples`× the frames, so keep
samples at 8 (default) unless trails visibly stair-step. Previews play
unblurred; the blur appears in the exported file.

### Element types

| `type` | Renders | Key fields |
|---|---|---|
| `shape` | rect / ellipse / rounded rect, **or** vector paths | primitive: `shape`, `fill_color`, `gradient`, `border_radius`; path form: `paths[]`, `view_box`, `gradients` |
| `text` | one-line text | `text`, `spans`, `font_family`, `font_size`, `background_color`, `text_shadow`, `mask` |
| `image` | bitmap | `source`, `fit`, `crop_*` |
| `video` | video frame at element time | `source`, `volume`, `trim_start`, `loop`, `fit`, `crop_*` |
| `audio` | non-visual; mixed in export | `source`, `volume` |
| `caption` | word-timed captions | `words`, `style`, `highlight_color` |
| `particles` | ballistic or convergence | `rate`/`burst`/`target_points`, `lifetime`, `velocity`, `z_velocity` |
| `group` | container; transforms/animates children as one | `elements[]`, `clip`, `mask`, `time_remap` |

A `shape` is **either** a primitive (`shape: "rectangle" | "ellipse"`, default
rectangle) **or** vector geometry (`paths`) — never both on one element. When
`paths` is present it wins and the primitive fields (`shape`, `fill_color`,
`gradient`, `border_radius`, `stroke_*`) are ignored; geometry and fill come
from inside each path. There is no `triangle`/`polygon` primitive — use `paths`
(e.g. `"M ... L ... L ... Z"`) for triangles and any arbitrary/morphing shape.

`text` and `caption` take `background_color` (+ `background_border_radius`,
`background_padding` as a number or `[x, y]`) for a solid bg drawn as **one
band per line**, each shrink-wrapped to that line's glyphs (the social-
caption look) — don't put a separate shape behind text; the integral bg
auto-sizes to the wrapped / auto-fit text and moves with it.

For text shadows: `text_shadow` ({`color`, `offset_x`, `offset_y`, `blur`,
`opacity`}, or an **array** for stacked / 3D-extrusion shadows) is
**per-glyph** — each letter casts its own, tracking per-letter animation.
Use the `drop_shadow` *effect* instead for one soft shadow of the whole
text silhouette.

`image` and `video` take `fit` (CSS `object-fit`: `cover` default,
`contain`, `fill`, `none`) and a source **crop** — `crop_x` / `crop_y` /
`crop_width` / `crop_height`, normalized `0..1` of the source, origin
top-left, default `0,0,1,1` (whole source). Crop selects a sub-rectangle
of the media BEFORE `fit` maps it into the box; the element box is
unchanged. Each crop component is keyframeable — animate the origin to
pan and the size to zoom (Ken Burns) without touching layout.

There is deliberately NO nested-composition ("pre-comp") element. Reuse
is an authoring-time concern — component patterns in `@clipkit/patterns`
(section 2) expand into plain elements before serialization. Nested
timing (speed-ramp / freeze / reverse a whole scene) is `time_remap` on
a plain `group`.

### Shared transform fields (every element)

`x`, `y`, `x_anchor` (0..1), `y_anchor` (0..1), `width`, `height`,
`rotation` (degrees), `scale`, `opacity` (0..1 — CSS convention),
and the CKP/1.0 3D fields `x_rotation` / `y_rotation` / `z_rotation` /
`z` (see "3D transforms" below).

All of `x` / `y` / `width` / `height` accept numbers (pixels) or
length strings — `"50%"`, `"10vw"`, `"15vh"`, `"5vmin"`, `"5vmax"`.

> ⚠️ **`%` is relative to the CANVAS, not the parent** (unlike CSS).
> `"50%"` on `x` means half the canvas width regardless of nesting.
> `vw`/`vh`/`vmin`/`vmax` likewise resolve against the canvas. There is
> no parent-relative percentage; use pixels inside groups when you need
> child-relative sizing.

### Coming from CSS/HTML

Clipkit deliberately tracks CSS where an agent's CSS prior would
otherwise misfire, and deliberately diverges where the protocol earns
it. Aligned (write them like CSS): **`opacity`** is `0..1` (default 1);
**gradient `angle`** is the CSS convention (`0deg` = to top, clockwise,
so `90` = to right, `180`/default = to bottom); **colors** accept hex,
`rgb()/rgba()`, `hsl()/hsla()`, the 148 CSS named colors, and
`transparent`. Field name map:

| CSS | Clipkit | Note |
|---|---|---|
| `left` / `top` | `x` / `y` | top-left corner, like CSS |
| `width` / `height` | `width` / `height` | px or canvas-% / vw / vh |
| `opacity` | `opacity` | `0..1`, default 1 |
| `border-radius` | `border_radius` | px |
| `color` / `background` | `fill_color` | SVG-flavored name |
| `border` color | `stroke_color` / `stroke_width` | |
| `z-index` | `z` (+ `layer`) | see below |
| `transform: rotate()` | `rotation` (= `z_rotation`) | degrees |
| `transform: scale()` | `scale` / `x_scale` / `y_scale` | |
| `linear-gradient(θ)` | `gradient.angle` | same θ convention |
| `transition` / `@keyframes` | `animations` / `keyframe_animations` | declarative timeline |

**Positioning is the CSS model:** `x`/`y` place the element's **top-left
corner** (`x_anchor`/`y_anchor` default `0`), exactly like `left`/`top` /
SVG / Canvas. Set `x_anchor: 0.5, y_anchor: 0.5` to position by center
(or `1` for the far edge). Rotation and scale always pivot the element's
center — like CSS `transform-origin` — independent of the anchor. So a
full-frame layer is just `x:0, y:0, width:W, height:H`.

**Layers (required).** Every element gets its own integer `layer` (1..1000),
like CSS `z-index`: **the highest layer is on top**, lower numbers go toward
the back (backgrounds at layer 1). Give each element a UNIQUE layer — number them 1..N within a container
(the top-level `elements`, each group's `elements`, each group mask's
`elements`). Duplicate layers are a validation error. `z` depth still wins over
`layer`; `layer` orders elements within equal depth.

Kept divergences (intentional — don't "fix" them):
- **`z` not `z_index`.** `z` is the single depth axis (layering +
  perspective foreshortening); `layer` orders within equal depth (higher = front). See "3D
  transforms".
- **snake_case keys** and SVG-flavored `fill_color` / `stroke_color`.
- **Easing names are a superset of CSS** (`ease-out-back`, springs, …).

### Expressions (procedural motion)

A numeric property can be a **formula** instead of a number or a keyframe
table — a pure function of the element's own clock. Reach for it on the
motions that are one line as math and a nightmare as keyframes: bobs,
orbits, spins, handheld shake, staggered reveals.

```jsonc
{ "y": { "expr": "540 + sin(t * PI) * 30" } }      // bob ±30px at 0.5 Hz
{ "rotation": { "expr": "t * 90" } }                // 90°/s spin
{ "x": { "expr": "960 + wiggle(3, 12)" } }          // handheld shake, ±12px
{ "opacity": { "expr": "clamp(t / 0.4, 0, 1)" } }   // 0.4s linear fade-in
```

In scope: `t` (element-local seconds), `dur`, `i` (index in a generated
set), `n` (sibling count), `value` (the property's base default); the
constants `PI`/`TAU`/`E`; and a fixed function set (`sin cos … clamp lerp
smoothstep linear ease noise wiggle random`). Operators `+ - * / % ^`,
comparisons, `&& || !`, and `cond ? a : b`. The full normative grammar is
PROTOCOL.md §3.6.

Use `i` for staggered fleets — give every generated element the **same**
expression and they self-offset by index:

```jsonc
{ "y": { "expr": "300 + i * 80" },                       // stack by index
  "opacity": { "expr": "clamp((t - i * 0.1) / 0.3, 0, 1)" } }  // ripple-in
```

The rules that keep it safe and portable (all NORMATIVE):
- **No cross-element references, no runtime inputs.** An `expr` sees only
  its own clock — never another element, the mouse, or audio. (Those are
  "Tier-B" and permanently unsupported. If you're tempted, bake the
  relationship into keyframes, or parent the elements.)
- **Deterministic.** `noise`/`wiggle`/`random` are seeded hashes, not
  wall-clock RNG, so every render is identical; `seed` defaults to `0`.
- **Bakeable.** An expression and a `Keyframe[]` are interchangeable — the
  importer/editor can sample one into the other.
- A typo (unknown name, member access, a string) does **not** stop the
  render — the property silently falls back to its base value. So if a
  move "does nothing," check the formula.

### Generated sets (`repeat` / `repeat_data`) — one element, N copies

Where do `i`/`n` get their values? From generated sets. An **image,
text, shape or group** element renders as N copies via `repeat: N`
(identical copies) or `repeat_data: [row, …]` (one copy per row).
A row is **a partial element patch + a variable scope**: keys naming
element fields (`time`, `duration`, `text`, `fill_color`, …) override
that field for the copy; ALL row keys are in scope for the copy and its
descendants — `{key}` in strings, bare identifiers in expressions
(numeric values only). `repeat_stagger` delays copy k by `k * s`
seconds (a row's own `time` wins). A grid, chart, step sequence,
slideshow or word sequence is ONE element — never hand-list
near-identical siblings:

```jsonc
{ "type": "group", "layer": 2, "time": 0.8, "repeat_stagger": 0.2,
  "repeat_data": [
    { "label": "engine a", "w": 900, "color": "#1ba6ff" },   // one row = one chart row
    { "label": "engine b", "w": 640, "color": "#8a5cff" } ],
  "y": { "expr": "380 + i * 90" },
  "elements": [
    { "type": "text",  "layer": 1, "text": "{label}", "x": 200 },
    { "type": "shape", "layer": 2, "shape": "rectangle", "x": 460, "height": 24,
      "fill_color": "{color}", "width": { "expr": "ease(t, 0, 0.8, 0, w)" } } ] }
```

Not valid on video/audio/caption/particles (schema rejects it). Spec:
PROTOCOL.md §3.7.

### Styles — declare appearance once, reference by name

Source-level `styles` are named appearance bundles (font, fill, stroke,
gradient, radius, opacity) that image/text/shape elements reference via
`style: "h1"` — the `fonts` pattern for field bundles. One merge rule,
no cascade: defaults < style < the element's own fields; the element
always wins. Nine headlines sharing a look = one bundle + nine
one-word references. Unknown style names fail validation. Spec:
PROTOCOL.md §2.3.

```jsonc
{ "styles": { "h1": { "font_family": "Inter", "font_weight": "800",
                      "font_size": 120, "fill_color": "#f4f7fb" } },
  "elements": [ { "type": "text", "layer": 1, "style": "h1", "text": "One." } ] }
```

### 3D transforms (CKP/1.0)

Every element also takes `x_rotation` (tip top edge away), `y_rotation`
(turn right edge away), `z_rotation` (alias of `rotation` — author one
or the other, both is a validation error), and `z` — **the one depth
axis** (px toward the viewer). `z` is also the stacking control: it
orders elements always (higher `z` = in front), and *additionally*
foreshortens once a camera is present. There is no separate `z_index` —
use `z` for layering, `layer` orders within equal depth (higher = front, unique per container). Add a
Source-level camera for true perspective:

```jsonc
{ "camera": { "perspective": 1200 },          // px; smaller = stronger
  "elements": [{ "type": "group", "clip": true, "y_rotation": -24,
                 "width": 620, "height": 420, "elements": [ /* UI mock */ ] }] }
```

The tilted-UI promo recipe: put the screenshot/mock in a `clip: true`
group and rotate THE GROUP — the flattened layer projects as one card.

The camera also MOVES (CKP/1.0): `x`/`y`/`z` position and `x_rotation`/
`y_rotation`/`z_rotation` Euler orientation (all keyframeable) orbit,
pan, tilt, and dolly the viewpoint — not just push/pull on `perspective`.
A "look at the logo" move is authored as resolved orientation angles
(there is no `target` field). Identity pose = the plain perspective lens.

GOTCHAS:
- **Paint order is by `z` depth — always.** Sibling cards paint
  back-to-front by `z` (nearer = in front), whether or not there's a
  camera; a camera just adds perspective on top. So adding/removing a
  camera never reorders — only the foreshortening appears. With every
  `z = 0` it collapses to `layer` order (the highest layer on top, like a plain 2D doc).
  Set `camera.sort: "paint"` to force fixed `layer` order under a camera.
  The sort is whole-card (no per-pixel depth buffer): interpenetrating or
  depth-ambiguous cards can mis-order — keep cards from crossing, or use
  `sort: "paint"`.
- **Animate 3D via `keyframe_animations`** (`property: "y_rotation"`),
  not a keyframe array in the field itself (same rule as `rotation`).
- **No camera = affine + flat.** 3D rotations still foreshorten (a
  y-rotated card narrows) but edges stay parallel, and `z` orders the
  stack without adding perspective; add the camera for converging
  perspective and parallax.
- **Glass works in 3D** — tilt a glass pane (`y_rotation` + camera)
  and the whole optical model rides the plane: footprint, refraction,
  highlights and shadow all project correctly. Signature move: a glass
  panel swinging over a UI card. (Edge-on with no camera = invisible.)
- **Plain groups nest 3D for free** (children live in the parent's 3D
  space); `clip`/`mask` groups flatten, then the layer tilts as a unit.
  Filter fields and `effects` evaluate on the PROJECTED pixels — glow
  radius / stroke width stay uniform in screen px on a tilted card.

3D text reveals — `{ "type": "text-flip", "axis": "x" }` flips each
letter in from 90° to flat about its own center (AE's classic 3D
per-character entrance). `axis: "y"` swings units in sideways, `"z"`
spins them in-plane; `split: "word"` flips whole words as rigid slabs;
`rotation` sets the start angle (try 180 for a full tumble). Composes
with `text-slide` (units slide AND flip). Pair with a `camera` for true
perspective on the mid-flip letters; without one the flip still reads
(pure foreshortening). Captions don't take text-* animations.

### Lighting + materials (CKP/1.0)

Surfaces can respond to light — PBR. **Opt-in:** with no `lights` and no
`material`, everything renders unlit exactly as before. Add scene
`lights` + a `material` on an element and the runtime shades it (the
element's own pixels are the albedo).

```jsonc
{ "lights": [ { "type": "ambient", "intensity": 0.4 },
              { "type": "directional", "azimuth": 45, "elevation": 30, "intensity": 1.2 } ],
  "environment": { "type": "gradient",
                   "stops": [ { "offset": 0, "color": "#0b0f1a" },
                              { "offset": 1, "color": "#7da2ff" } ] },
  "camera": { "perspective": 1400 },
  "elements": [ { "type": "group", "clip": true, "y_rotation": -20,
                  "material": { "roughness": 0.25, "metalness": 0.6, "reflectivity": 1 },
                  "elements": [ /* dark UI */ ] } ] }
```

- **`material`**: `roughness` (0 glossy/tight .. 1 matte), `metalness`
  (0 dielectric .. 1 metal), `reflectivity` (env-reflection strength),
  `emissive` (self-lit), `normal_map` (tangent-space normal map URL for
  surface detail/bumps — flat = `#8080ff`) + `normal_scale`. Scalars
  animatable.
- **The reflection sweeps with the camera.** Specular + environment
  reflection are view-dependent, so orbiting/dollying the camera slides
  the highlight across a glossy dark UI — the premium look. In 2D (no
  camera) animate the **lights** instead for the sweep.
- **`environment`** is what reflective surfaces mirror: either a gradient
  "sky" (`{ type: 'gradient', stops }`, offset 0 = down, 1 = up) or an
  **equirectangular image** (`{ type: 'image', src }`) for real
  photographic reflections. Roughness blurs the reflection toward the
  environment average. It's what makes glossy screens/metal look
  expensive.
- **Works on shapes AND textured surfaces** — images, video, and
  flattened `clip` groups light from their own pixels, so a whole UI card
  wrapped in a clip group shades as one lit plane. `@clipkit/patterns`
  ships `litSurface()` for exactly this.
- **Bloom** (`source.bloom { threshold, knee, intensity, radius }`): a
  whole-frame post that makes BRIGHT things bleed light (specular hits,
  emissive surfaces, bright media) — driven by each pixel's brightness,
  not a per-element knob. For a deliberate per-element halo (even on a
  dark element), use the `glow` effect instead.
- **Editor authoring:** Material is a per-element inspector block; Lights,
  Environment, and Bloom live under Video settings (source scope).
- Local illumination only (no cast shadows yet). Flat 2.5D surfaces.

### Blend modes + filters (every element)

`blend_mode`: `"multiply"` (darken; white neutral), `"screen"`
(lighten; black neutral), `"add"` (glow). Element-local. On a group it
needs `clip: true` or a `mask` (the group must flatten to a layer).

Filters, all animatable, CSS semantics: `blur_radius` (Gaussian σ px),
`brightness` / `contrast` / `saturation` (multipliers, 1 = unchanged,
`saturation: 0` = grayscale). Work on any element including groups —
a group filters as one flattened image.

There is no `color_overlay` field — it decomposes: put a same-sized
shape of the overlay color on a higher layer, in front of the element (use
`opacity` or `blend_mode: "multiply"` for tint strength). For a
grayscale-then-tint look, combine `saturation: 0` with an overlay.

### Stylize effects (every element)

`effects` is an ordered array of passes, applied after the filters:

```json
"effects": [{ "type": "pixelate", "cell_size": 12 }]
```

Types: `pixelate` (`cell_size`), `dither` (`levels`, 2 = 1-bit retro),
`halftone` (`cell_size`, `angle`), `ascii` (`cell_size`). Every param
takes a number or keyframes (element-local time) — animating
`cell_size` from 1 upward makes a great "depixelate" reveal. Effects
chain in array order and work on groups (the subtree flattens first).
Layer styles — `glow` (`radius`, `intensity`, `color`), `drop_shadow`
(`offset_x/y`, `blur`, `color`, `opacity`), `stroke` (`width`,
`color`) — composite beneath the element and work on text, images,
and groups (not just shapes). Backdrop readers — `glass` (`refraction`,
`dispersion`, `blur_radius`, `tint`, … on shapes) and `backdrop_blur`
(`radius`) — sample what's drawn BENEATH the element: put a translucent
shape over content and add the effect for a refractive or frosted panel.
Programmable — `pixel_shader` (`source`) runs a Pixel-Expr program per
pixel: the `Expr` language + vectors/swizzles and the inputs `uv` (vec2
0..1), `t`, `resolution`, `aspect`, compiled to GLSL+WGSL. ONE expression
→ a color (`float`→gray, `vec3`→rgb, `vec4`→rgba); funcs incl. `mix`,
`smoothstep`, `length`, `noise`, `hash`, `fbm(p)` (fractal noise), `voronoi(p)`
→ `(F1, F2, cellHash)` (cellular — `F2−F1` = crisp borders), `hsv2rgb`, ctors
`vec2/3/4`/`rgb`. Put it on
a frame-filling shape for a generative background, e.g. `mix(rgb(.02,.06,
.16), rgb(.7,.87,.93), noise(uv*8.0 + vec2(t*.1, 0.0)))`. Set
`reads_backdrop: true` to sample the scene behind via `backdrop(uv2)`→vec4
(refraction/chromatic), and multiply offsets by the `coverage` input to ramp
the effect to zero at the element edge (no hard seam). Author with `let NAME =
EXPR;` locals, declare keyframeable `params` (named float knobs read by name in
source), and `fold(N, init, acc-body)` bounded loops. Raymarch with the SDF
stdlib (`sdSphere`/`sdBox`/`sdRoundBox`/`sdTorus`/`opUnion`/`opSubtract`/`opSmoothUnion`/`opExtrude`/`rotX/Y/Z`):
`def shape(p) = ...;` names the scene SDF, `fold(80, 0, acc + shape(ro+rd*acc))`
marches it, `normal(shape, p)` gives a general central-difference normal — then
shade, or make glass with `refract` + `backdrop`. Declare up to 4 image inputs
with `textures` (`{ name: url }`) and sample them via `texture(name, uv)`→vec4
— image distortion (`texture(grid, uv + flow)`), gradient ramps, or MSDF
wordmarks (decode `median(s.r, s.g, s.b)` then `smoothstep` around `0.5`).

Group time remapping — `time_remap` on a GROUP warps the clock for
everything inside it: slow a whole composed scene to 20% at the
dramatic beat, freeze it, or run it backwards — children's animations
and nested videos all follow — and so does AUDIO, varispeed-style
(ramps pitch with speed, freezes silent, reverse plays backwards).
The group's own position/opacity still animate on real time, so you
can move a frozen scene around. Same keyframe shape as video
time_remap below.

Time remapping — `time_remap` on a video element maps element-local
time → media seconds with plain keyframes: `[{time: 0, value: 0},
{time: 1, value: 3}]` is a 3× speed ramp, a flat segment is a freeze
frame, decreasing values play in reverse, easings make the ramps
cinematic. It replaces `trim_start`/`playback_rate`/`loop`. Audio
follows the warp VARISPEED, like tape: ramps pitch up/down with
speed, freezes go silent, reverse plays the sound backwards — usually
exactly the cinematic speed-ramp sound you want.

GOTCHA: the runtime keys ONE decoder + texture per unique video URL.
Two video elements with the same URL but different playheads
(different `time_remap`, trims, or rates) will fight over it — all
copies display the same frames and seeking thrashes. Give each its
own URL; a query suffix on the same file (`clip.mp4?copy=2`) is
enough.

Trim paths — on any shape path: `trim_start`/`trim_end` draw only that
slice of the stroke (animate `trim_end` 0\u21921 for the logo-draws-itself
reveal), `trim_offset` rotates the window with wrap (animate it for
the traveling-dash "snake"). `stroke_progress` is the simple sugar.
Path morphing: keyframe the `d` itself — values with the SAME command
structure (e.g. two cubics with equal point counts) tween smoothly;
mismatched structures snap. Author morph targets with matching
commands, like every motion tool expects.

Living motion, one line each — `drift` (seeded organic float; the
"alive logo" look: `{type: "drift", distance: 20}`), `breathe` (gentle
scale pulse), `orbit` (circular motion: `distance` radius,
`direction: "left"` for counter-clockwise). All run the element's full
life by default and are exactly seeded — same seed, same motion. And
any keyframe_animation can now `loop: true` (repeat) or
`loop: "ping-pong"` (back-and-forth) — build one cycle, loop forever.

Motion paths — `keyframe_animations` with `property: "position"` and
`[x, y]` values moves an element along a bezier path: `out_tangent` /
`in_tangent` on the keyframes shape the curve (omit them for straight
polyline hops), `auto_orient: true` turns the element to face its
travel direction. Speed is arc-length-true: linear easing = constant
speed; easings shape acceleration along the path. Use for swooping
entrances, orbit flybys, anything that should move like it has
momentum instead of lerping x and y separately.

3D paths — use `[x, y, z]` values (and optionally `[dx, dy, dz]`
tangents) to carve the path through depth; the path then drives `z`
too, and arc-length speed is true in 3D. Don't mix `[x, y]` and
`[x, y, z]` keyframes in one path (validation error). Two gotchas:
path z is invisible without a `camera` (same as the `z` field), and
`auto_orient` stays in-plane — it spins `rotation` from the xy
direction but never tilts the element's plane (add `x_rotation` /
`y_rotation` yourself if you want banking). Signature move: fly an
element from deep background to right up against the camera along a
curve.

Procedural noise — `fractal_noise` (`scale`, `evolution`, `offset_x/y`,
`octaves`, `seed`) fills the element's footprint with seeded grayscale
fBM: animate `evolution` for churning fog/plasma, chain `levels` to
shape contrast and a duotone `lut` for color (grayscale has no hue, so
`hue_rotate` alone can't tint it), or put it on TEXT for noise-filled
type. `turbulent_displace` (`amount`, `scale`, `evolution`, `octaves`,
`seed`) warps the element's own pixels — wavy text, heat shimmer.
Same seed = same pixels, always (the noise function is normative).

Grading — the `hue_rotate` filter field (degrees, joins
blur/brightness/contrast/saturation on every element) plus two
effects: `levels` (`in_black`, `in_white`, `gamma`, `out_black`,
`out_white` — punchy shadows = `in_black: 0.08, gamma: 1.15`) and
`lut` (`source` = a .cube file URL or data: URI, `intensity` to dial
it back). A LUT is the one-liner for a whole color story
(teal-orange, film stocks); levels is the surgical tool.

Keying — `chroma_key` (`color`, `tolerance`, `softness`, `spill`)
removes a screen color by chroma distance: put it on a green-screen
`video` element with `color` set to the screen's ACTUAL green (sample
it — real screens are darker than `#00FF00`), then place the video
over any backdrop. `spill` (default 0.5) desaturates green bounce on
the subject. `luma_key` (`threshold`, `softness`, `invert`) drops dark
pixels — the way to lift white-on-black mattes, flares, and smoke
stock onto a scene. On a group, the composited children key as one
layer.

`glass` is the one effect that reads the BACKDROP (everything drawn
beneath the element). It applies to SHAPE elements only (the pane
geometry must be exact; other element types skip it with a warning).
Defaults give the classic clear liquid-glass button — most uses need
NO params at all:

```json
{ "type": "shape", "border_radius": 65, "width": 380, "height": 300,
  "fill_color": "#FFFFFF",
  "effects": [{ "type": "glass" }] }
```

Two materials, one dial: `blur_radius: 0` (default) = CLEAR glass,
`blur_radius > 0` = FROSTED. `mode: "dome"` + `edge_width` = the
shape's radius = a half-sphere magnifier:

```json
{ "id": "magnifier", "type": "shape", "shape": "ellipse",
  "width": 320, "height": 320, "fill_color": "#FFFFFF",
  "effects": [{ "type": "glass", "mode": "dome",
                "edge_width": 160, "refraction": 25 }] }
```

Other dials (reference-tuned defaults — change sparingly):
`refraction` (bend strength, ≈px), `edge_width` (lens depth; small =
flat card with curl at the rim), `edge_highlight` (the whole light
rig), `dispersion` (color fringing), `shadow` (built-in, outside-only
— never add a shadow sibling under glass), `backdrop_saturation`,
`tint`. The pane's fill color is ignored — only its geometry matters.
A crisp ring is a stroked transparent sibling above; wrap pane + ring
in an UNLAYERED group (no clip/mask) to move them as one element.

### Easings (the 36)

`linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, plus
ease-{in,out,in-out}-{cubic, quad, quart, quint, sine, expo, circ,
back}, plus `spring` (damped harmonic oscillator — overshoots ~5% then
settles; Remotion's signature feel), `elastic-{in,out,in-out}` (decaying
sinusoidal wobble), and `bounce-{in,out,in-out}` (ball-drop bounces — the
easing curves, distinct from the bounce-in/out animation PRESETS, which
are scale tweens). Two parametric forms also count: `cubic-bezier(x1, y1,
x2, y2)` and `steps(n)`.

Quick guide:
- **`spring`** — hero text reveals, signature scale-ins
- **`ease-out-cubic`** — smooth, well-behaved ramps; default choice
- **`ease-out-quart`** — fast start, long slow tail; great for measure bars
- **`ease-out-back`** — slight overshoot at the end (UI bounce)
- **`linear`** — when you specifically want no easing

### Particles — two modes

Ballistic (emit + physics):

```json
{
  "type": "particles",
  "x": 540, "y": 960,
  "burst": true, "burst_count": 140,
  "lifetime": 2.5, "velocity": 900, "spread": 360, "gravity": 700,
  "color": ["#22d3ee", "#ec4899", "#22c55e", "#fbbf24"],
  "particle_shape": "square", "size": 18, "rotation_speed": 540,
  "fade_at": 0.8
}
```

Convergence (assemble into a target shape):

```json
{
  "type": "particles",
  "x": 960, "y": 540,
  "burst": true, "burst_count": 500,
  "target_points": [[100, 200], [110, 200], /* ... */ ],
  "scatter_radius": 1100,
  "convergence_easing": "ease-out-quart",
  "lifetime": 1.6, "size": 10, "particle_shape": "circle"
}
```

Depth — add `z_velocity` (px/s toward the viewer, can be negative) and
`z_spread` (random vz range) to blow particles out of the screen:
nearer ones grow, receding ones shrink. Needs a Source `camera` to be
visible (no perspective = no depth cue), and pairs beautifully with a
tilted emitter (`x_rotation` on the particles element): confetti
erupting off a card's surface. Paint order stays spawn order — depth
never re-sorts.

### Shape paths — vector graphics

```json
{
  "type": "shape",
  "view_box": [0, 0, 180, 180],
  "gradients": [
    { "id": "g1", "type": "linear", "x1": 0, "y1": 0, "x2": 180, "y2": 0,
      "stops": [{ "offset": 0, "color": "#FF4E00" }, { "offset": 1, "color": "#FF1791" }] }
  ],
  "paths": [
    { "d": "M 10 10 L 90 90", "stroke": "url(#g1)", "stroke_width": 5,
      "stroke_progress": [{ "time": 0, "value": 0 }, { "time": 1, "value": 1 }] }
  ]
}
```

`stroke_progress` from 0→1 makes the path draw in via dashoffset. Use a
thick stroke on a small circle for pie/donut charts.

### Diagonal text reveal

```json
{
  "type": "text", "text": "Vercel and Clipkit", "font_size": 70,
  "mask": {
    "type": "linear-wipe", "angle": -45,
    "progress": [{ "time": 0, "value": 0 }, { "time": 2.7, "value": 1, "easing": "ease-out-cubic" }],
    "softness": 0.3
  }
}
```

That's the at-a-glance set. For full normative semantics — units, edge
cases, conformance — go to [PROTOCOL.md](./PROTOCOL.md).

## 2. Pattern catalog

Patterns live in `@clipkit/patterns`. Each is a TS function that emits
plain elements — most return `Element[]` you spread into your `elements`
array; *component* patterns (IntroCard, LowerThird) return a single
`group` element you push, so the unit moves / animates / time-remaps as
one. They're opinionated: pick a variant by passing a `color` slot
("pink" | "green" | "blue" | "lavender" | "purple" | "yellow" | "gray")
and a `theme` (`'mux'` is the default; `'minimal'` exists too).

Common params shared by most patterns:

- `id`: string — prefix for produced element ids
- `theme?: 'mux' | 'minimal'` — default `'mux'`
- `color`: ColorName — picks the accent palette
- `time`, `duration`: number — scene-local seconds
- `layerBase`: number — pattern uses a small range starting here

### HeaderBar

The scene framing for dashboard-style scenes: white header strip with
left logo + middle title + right date, colored body fill below.

```ts
headerBar({
  id: 'overall',
  title: 'Overall stats',
  dateRange: 'Nov. 17 - Dec. 16 2021',
  bodyColor: 'pink',
  canvasWidth: 1920,
  canvasHeight: 1080,
  logo: { viewBox: [0, 0, 215, 70], paths: MUX_LOGO_PATHS, gradients: [MUX_GRADIENT] },
  time: 4.33,
  duration: 6.0,
  layerBase: 100,
})
```

Use as the first elements of every scene that follows the "logo + title"
convention.

### StatBlock

Themed top border, big spring-counted number, label, optional trend pill.

```ts
statBlock({
  id: 'views',
  current: 195654112,
  previous: 159560036,        // optional — adds the trend pill
  label: 'Total views',
  color: 'pink',
  x: 120, y: 380,
  width: 1680,
  time: 4.33, duration: 6.0,
  layerBase: 200,
})
```

Stack two with `y` 340 px apart for a "Total views / Total minutes watched"
layout.

### BarChartRow

Row with an animated white background bar, top border, value count-up,
optional icon, label, optional trend pill. Used for "Top 5 by X" lists.

```ts
barChartRow({
  id: 'phone',
  value: 130733672,
  max: 130733672,             // the leading value in the dataset
  previous: 133478441,        // optional — adds trend pill
  label: 'Phone',
  icon: { viewBox: [0, 0, 32, 52], paths: PHONE_ICON_PATHS },
  color: 'green',
  x: 120, y: 320,
  width: 1680,
  time: 10.33, duration: 6.0,
  staggerIndex: 0,            // 0..n for cascading entry
  layerBase: 400,
})
```

Loop over your dataset, increment `y` by `168` and `staggerIndex` by 1
per row.

### RankedList

Numbered list of items with rank, name, value, animated measure bar.
1 or 2 columns. Used for "Top 10" style scenes.

```ts
rankedList({
  id: 'titles',
  items: [
    { label: 'Burgandy Alert', value: 2733413 },
    { label: 'Tough Affection', value: 1694421 },
    // ...
  ],
  color: 'lavender',
  x: 120, y: 320,
  width: 1680,
  columns: 2,
  time: 16.33, duration: 6.0,
  layerBase: 600,
})
```

### PieCard

Animated pie chart (white slice growing over the colored body), big
percentage label, count-up view count, optional trend pill, optional
logo on a rounded white square, bottom label. One card per data point;
position multiple horizontally for a "Top 4 X" scene.

```ts
pieCard({
  id: 'chrome',
  value: 2233793,
  total: 3396911,             // dataset total — drives the percentage
  previous: 2337628,          // optional — adds trend pill
  label: 'Chrome',
  logoUrl: '/chrome.png',     // optional — image over the white square
  color: 'blue',
  cx: 300,                    // center x of the card
  time: 28.33, duration: 6.0,
  staggerIndex: 0,
  layerBase: 1000,
})
```

### IntroCard (component)

Full-frame opening title: themed backdrop, optional all-caps kicker,
big headline, accent rule wipe, optional subtitle. Entrance + exit
animation built in. Returns ONE `group` element — position, animate, or
`time_remap` the whole card as a unit.

```ts
elements.push(introCard({
  id: 'open',
  kicker: 'Mux Data',
  headline: '2021 in review',
  subtitle: 'Your year of video, in numbers',
  color: 'pink',
  canvasWidth: 1920, canvasHeight: 1080,
  time: 0, duration: 4,
  layer: 100,
}))
```

Note components return a single `Element` — `push`, don't spread.

### LowerThird (component)

Broadcast-style name strip: accent bar + white panel + bold name +
optional role line. Slides in from the left, fades out at the end of
its window. Returns ONE `group` element.

```ts
elements.push(lowerThird({
  id: 'speaker',
  name: 'Dana Cruz',
  role: 'Head of Video',
  color: 'blue',
  x: 80, y: 900,              // left edge / vertical center
  time: 12, duration: 5,
  layer: 300,
}))
```

### TiltedShowcase (component)

The promo signature shot: a screenshot in a browser-chrome frame,
tilted in 3D (CKP/1.0) and gently swinging. Returns ONE `clip: true`
group, so the framed card projects as a unit. Pair with a Source-level
`camera: { perspective: 1200 }` for converging perspective.

```ts
elements.push(tiltedShowcase({
  id: 'app-shot',
  source: '/screens/dashboard.png',
  color: 'blue',
  x: 960, y: 540,            // card center
  width: 760, height: 500,
  tilt: 22,                  // swings ±22°; 0 = static
  z: 40,
  time: 2, duration: 6,
  layer: 200,
}))
```

### cameraOrbit (scene camera)

Unlike the others, this returns a `Camera` for `source.camera` (not an
element): a ready-made keyframed move — orbit (`yaw`), constant `pitch`
tilt, `dolly` (z), `truck` (x). Place content at varied `z` for parallax;
depth-correct occlusion is automatic (§4.4.3).

```ts
const source = {
  camera: cameraOrbit({ perspective: 1500, yaw: 40, pitch: 6, dolly: 120, duration: 5 }),
  elements: [ /* cards at different z */ ],
};
```

### TrendPill (helper)

Small pill rendering a signed percentage delta. Used internally by
StatBlock, BarChartRow, PieCard, but exported so you can place one
standalone.

```ts
trendPill({
  id: 'standalone-trend',
  cx: 1500, cy: 540,
  delta: trendPct(2233793, 2337628),  // → -4.4
  color: 'pink',
  time: 4.33, duration: 6.0,
  layerBase: 250,
})
```

---

## 3. Recipe gallery

Example videos demonstrating patterns in context. Source files live in
`apps/playground/src/`:

- **`mux-demo.ts`** — `MUX_DEMO`. 1920×1080, 39 s, 7 scenes (intro, big
  stats, devices, top-10 titles, US heatmap, browsers, outro). The
  full-fidelity reference; every pattern in section 2 shows up here.
- **`examples.ts`** — `VERCEL_TEMPLATE`. 1280×720, 6.7 s. Showcases the
  SVG stroke-evolution primitive (Next.js logo paths drawing in), the
  text linear-wipe mask, and keyframe-animated rings.
- **`examples.ts`** — `CODE_WRAPPED`. 9:16, 15 s. Particle confetti
  bursts at celebration moments, gradient backgrounds, spring stat
  reveals — the github-unwrapped-style template.

When you author a new video, lean on these as references. If a scene
"looks like X scene in mux-demo," call the same pattern with the same
shape of args.

### Captions from media (transcription)

To caption a video or audio clip, you don't hand-write `words` — transcribe
the media into a `caption` element. Runs Whisper **locally** (no API key, no
upload) via `@clipkit/speech-to-text`; needs `ffmpeg` on the host.

- **CLI** (local files): `clipkit transcribe <file>` prints the caption
  `words[]` JSON to stdout (progress on stderr). Add `--element` for a full
  `caption` element ready to drop into a Source, `--model Xenova/whisper-small`
  for accuracy or `…-tiny.en` for speed, `--out cap.json` to write a file.
- **MCP** (chat-mode agents): the `transcribe_media` tool takes a local
  `path`, transcribes, and adds a `caption` element to the current project
  (`add: false` to only return it).

Both produce the same thing: a `caption` element with `words: [{ text, start,
end }]` (times relative to the caption's `time`). The protocol/runtime are
unchanged — this only *fills* the caption the renderer already supports. Style
it with the usual `caption` fields (`style`, `highlight_color`, …).

---

## 4. Authoring guidance

A few rules of thumb that go beyond the schema:

- **Lead with patterns; reach for primitives only for one-offs.** If a
  scene fits HeaderBar + BarChartRow, do that. Don't reinvent.
- **Stagger entrances.** For lists, use `staggerIndex` (or compute a
  `time: time + i*0.07` offset for primitives). All-at-once entrances
  look amateurish.
- **Sound matters.** Set up an `audio` element early. The runtime mixes
  it into the export and the playground plays it during preview.
- **Pace by frames at 30 fps.** Most scenes are 180 frames = 6 s. Title
  intros are 100–130 frames. Outros 120–150. Big stat reveals 180.
- **Trend pills are optional.** Only add `previous` to a pattern if the
  comparison is genuinely interesting; otherwise let the number land
  on its own.

---

## 5. Output format

Whatever you generate, the final output the user runs is a Clipkit
`Source` JSON object. Patterns are TypeScript-only — they help you
construct that JSON but never appear in it.

If you're emitting code for the user:

```ts
import type { Source } from '@clipkit/protocol';
import { headerBar, statBlock /* ... */ } from '@clipkit/patterns';

export const MY_VIDEO: Source = {
  width: 1920, height: 1080, duration: 30, frame_rate: 30,
  elements: [
    ...headerBar({ ... }),
    ...statBlock({ ... }),
    // ...
  ],
};
```

If you're emitting raw JSON (no TS), inline the patterns' output
directly. There's no `{ "type": "stat_block" }` — only the primitive
elements the patterns produce.

---

## Appendix — Protocol change checklist (maintainers)

> **This section is for editing the protocol itself, not for authoring
> videos.** If you're writing a Source, ignore it. If you're adding or
> changing an element type, field, effect, animation preset, output
> format, etc., work this list — a protocol change "bleeds down" into
> more places than it looks.

**The schema source of truth (`packages/protocol/src/`) — all manual:**

- `types.ts` — the interface / const enum (`ELEMENT_TYPES`,
  `ANIMATION_TYPES`, `OUTPUT_FORMATS`, the effect union, …).
- `zod.ts` — the matching validator. Const-driven enums sync from the
  arrays; a new interface needs a new schema object. **Put the field's
  default in its `.describe()` text** — that string is the only place a
  default is declared protocol-side. It's surfaced to agents via
  `get_schema` → `zodToJsonSchema`, so the wording an agent reads ("…
  (default 1)") comes straight from here. Keep it honest against the
  runtime.
- `CLIPKIT_PROTOCOL_VERSION` in `types.ts` — bump only on a real spec
  change.

There is **no central defaults table.** (A former `defaults.ts` /
`applyDefaults()` was dead code — never imported or called — and has
been deleted; don't re-add it.) The *effective* default for a field is
the inline `?? fallback` in whichever runtime renderer reads it
(`packages/runtime/src/compositor/element-renderers/*.ts`, e.g.
`fillColor = span.fill_color ?? defaults.color` in `text.ts`) — one
fallback per field, at its point of use. So a new field with a default
means **two** edits that must agree: the runtime's `??` fallback, and
the `.describe()` text in `zod.ts` that documents it.

**Runtime (`packages/runtime/src/`):** a new field on an existing
element auto-works if the renderer already reads it. A new **element
type** needs a renderer in `compositor/element-renderers/`; a new
**effect type** needs handling in the effect chain; a new **animation
preset** needs a handler in `animation/presets.ts`.

**Editor inspector — mostly automatic.** The registry deriver
(`editor-core/src/registry/derive.ts`) reads the zod schema by
structure, so a new field gets a working control with no edits. Only
touch `registry/overrides.ts` when the auto-derived control is wrong
(range, label, section, or it fell back to a raw JSON chip). Verify
with `node probes/probe-editor-registry.mjs` — it asserts every field
has exactly one knob and lists anything that fell through.

**Docs (all hand-written, no codegen):**

- `PROTOCOL.md` — the formal spec.
- This file (`AGENTS.md`) — authoring patterns, if it's a preset/effect.
- `apps/web/content/docs/fields/*.md` — per-element field reference
  (separate from PROTOCOL.md; easy to miss).
- `packages/mcp-server/src/embedded-docs.ts` — a COPY of the agent
  guidance baked into the MCP server; it does **not** auto-sync with
  this file, so it drifts silently.

**Agent / MCP surface:** `packages/mcp-server/src/tools.ts` —
tool input schemas are hand-written. A new top-level Source field or a
new `output_format` needs a parameter added here. Element-field CRUD
validates against zod automatically.

**Situational:** `apps/web/lib/playground/examples.ts` (showcase the
new feature) and `packages/snapshot-importer/` (if it should map from
imported HTML/CSS).

The genuinely forgettable manual ones: **the runtime `??` fallback that
sets the field's default, the matching `.describe()` default text in
`zod.ts`, the `content/docs/fields/*.md` reference, and the MCP
`embedded-docs.ts` copy** — then run the registry probe.
