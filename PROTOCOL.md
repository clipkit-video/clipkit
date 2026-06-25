# The Clipkit Protocol

**Version:** 1.0 (CKP/1.0)
**Status:** Draft
**License:** Apache-2.0

This document specifies the Clipkit Protocol — the JSON-based interchange
format for describing motion-graphics videos. Documents that conform to
this protocol can be rendered by any conforming runtime: the reference
implementation `@clipkit/runtime`, future server-side renderers, or
third-party implementations.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**,
and **REQUIRED** in this document are to be interpreted as described in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The reference implementation lives in [`packages/protocol`](./packages/protocol)
of this repository.

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Document structure](#2-document-structure)
3. [Coordinate system, units, and types](#3-coordinate-system-units-and-types)
4. [The element model](#4-the-element-model)
5. [Element types](#5-element-types)
6. [Animation](#6-animation)
7. [Time, duration, sequencing](#7-time-duration-sequencing)
8. [Asset references](#8-asset-references)
9. [Output and rendering](#9-output-and-rendering)
10. [Conformance levels](#10-conformance-levels)
11. [Versioning and extensions](#11-versioning-and-extensions)
12. [Implementation notes](#12-implementation-notes-non-normative)

---

## 1. Introduction

### 1.1. Goals

The Clipkit Protocol aims to be:

- **JSON-native.** A Clipkit document is plain JSON. Any tool that can
  write JSON can produce one. AI agents in particular benefit from this
  — they emit structured data better than they emit code.
- **Renderer-agnostic.** The protocol describes *what* a video looks
  like, not *how* to render it. A conforming runtime may use WebGPU,
  WebGL2, software rasterization, server-side headless browsers, or any
  other mechanism.
- **Composable.** Documents are built from a small set of primitive
  element types. Higher-level patterns are authoring concerns — they
  produce primitive elements; the protocol itself has no notion of
  "pattern."
- **Deterministic.** Given the same document and the same time, every
  conforming runtime MUST produce the same frame composition. Exact
  pixel output may differ between rasterization backends, but the
  scene description is unambiguous.

### 1.2. Non-goals

- **Visual editing format.** Editors MAY store additional state alongside
  a Source (selection, undo history, asset binaries) but that state is
  outside this protocol.
- **Media container.** Clipkit references external media (images, video,
  audio) by URL or path. The protocol does not embed binary media.
- **Audio mixing graph.** Audio elements are positioned in time; the
  exact mix algorithm (gains, codecs, bitrates) is implementation-defined.

### 1.3. Reference implementation

`@clipkit/protocol` is the canonical TypeScript + Zod implementation of
this protocol. Other implementations SHOULD treat it as authoritative on
ambiguous points until those points are resolved here.

---

## 2. Document structure

### 2.1. The Source object

A Clipkit document is a JSON object with the following shape:

```json
{
  "clipkit_version": "1.0",
  "output_format": "mp4",
  "width": 1920,
  "height": 1080,
  "duration": 30,
  "frame_rate": 30,
  "background_color": "#000000",
  "elements": [ /* ... */ ]
}
```

#### Fields

| Field | Type | Required? | Default | Meaning |
|---|---|---|---|---|
| `clipkit_version` | string | SHOULD | `"1.0"` | The protocol version this document targets. See §11. |
| `output_format` | string | MAY | `"mp4"` | One of `"mp4"` (video) or `"gif"` (animated). Clipkit is video-only. |
| `width` | integer | SHOULD | `1920` | Composition width in pixels. MUST be positive. |
| `height` | integer | SHOULD | `1080` | Composition height in pixels. MUST be positive. |
| `duration` | number \| `"auto"` | SHOULD | `"auto"` | Total composition duration in seconds. `"auto"` MUST be interpreted as the maximum end-time of any active element. |
| `frame_rate` | number | SHOULD | `30` | Frames per second. MUST be positive. |
| `background_color` | string | MAY | `"#000000"` | Color (§3.4) the frame is cleared to before any element draws. Absent → opaque black. |
| `motion_blur` | object | MAY | — | Whole-frame motion blur by exact sub-frame supersampling. See "Motion blur" below. |
| `camera` | object | MAY | — | Scene camera (CKP/1.0): perspective lens + movable pose (position/orientation) + `sort`. Absent = identity = exact 2D. See §4.4.2, §4.4.3. |
| `fonts` | array | MAY | — | Font faces the renderer MUST register before rendering. See "Fonts" below. |
| `elements` | array | REQUIRED | — | At least one element. See §4–5. |

#### Motion blur

`motion_blur` is an object with two optional fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `samples` | integer 1–32 | `8` | Sub-frame samples rendered per output frame. `1` disables blur. |
| `shutter` | number (0, 1] | `0.5` | Fraction of the frame interval the shutter is open. `0.5` corresponds to a 180° film shutter. |

When present with `samples` ≥ 2, the renderer MUST produce each output
frame as the arithmetic mean of `samples` full-scene renders taken at
sub-frame times centered on the frame time. For the output frame at
time `t` with frame rate `f` and composition duration `D`:

```
t_k = clamp(t + ((k + 0.5) / samples − 0.5) × shutter / f, 0, D)
        for k = 0 … samples−1
```

Each sample is a complete render of the composition at `t_k` under the
normal rendering model (every animated value, transition, and effect is
evaluated at `t_k`). The output pixel is the per-channel arithmetic
mean of the `samples` sample pixels in the output color space (8-bit
sRGB, after compositing over the opaque background), rounded once,
half away from zero. Accumulation MUST be carried at a precision that
makes the result exact before that single rounding (e.g. float
accumulation of 8-bit samples).

This is deterministic: the same document produces the same pixels.
Media elements evaluate `t_k` through their own media-time mapping
(§5.3.2); a video whose decoder quantizes to its own frame times
contributes the same decoded frame to several samples, which is
conformant.

Motion blur applies at export/render time. Interactive previews MAY
render the unblurred scene (a single sample at `t`) for speed and MUST
NOT be treated as the reference output when `motion_blur` is present.

#### Fonts

`fonts` is an array of font-face objects. The renderer MUST register
every face before the first frame renders, so a document carrying its
fonts is self-sufficient — text metrics don't depend on what the host
environment happens to have installed.

| Field | Type | Required? | Default | Meaning |
|---|---|---|---|---|
| `family` | string | REQUIRED | — | The `font_family` name text elements reference. |
| `weight` | number \| string | MAY | `"normal"` | CSS font-weight. Variable fonts MAY declare a range (e.g. `"100 900"`). |
| `style` | string | MAY | `"normal"` | `"normal"` or `"italic"`. |
| `src` | string | REQUIRED | — | URL of the font bytes: absolute, relative (resolved against the document hosting the Source), or a `data:` URI. |
| `unicode_range` | string | MAY | — | CSS unicode-range (e.g. `"U+0000-00FF, U+0131"`). Subsetted webfonts ship one file per script under identical `family`/`weight`/`style`; without the range every subset matches every codepoint, and the winning file may lack the glyphs being rendered. Renderers MUST honor it when matching glyphs to faces. |

Multiple entries MAY share a `family` (different weights, styles, or
unicode-range subsets). Renderers MUST treat each entry as a distinct
face, exactly as CSS treats multiple `@font-face` rules.

### 2.2. Forward compatibility

Documents MAY contain additional top-level fields not listed here.
Conforming runtimes MUST ignore unknown top-level fields (passthrough).
This applies to all objects in this protocol unless otherwise stated.

---

## 3. Coordinate system, units, and types

### 3.1. Coordinate system

- The origin `(0, 0)` is at the **top-left** of the composition.
- The positive **x** axis runs **right**.
- The positive **y** axis runs **down**.
- Positions, sizes, and offsets are in pixels relative to the composition
  width / height unless an explicit unit suffix is used (§3.3).

### 3.2. Anchors

Most elements support `x_anchor` and `y_anchor` values in `[0, 1]`.
These define which point inside the element's bounding box is positioned
at `(x, y)`:

- `0` = left edge (or top edge) — **the default**
- `0.5` = center
- `1` = right edge (or bottom edge)

By default both anchors are `0`, so `(x, y)` is the element's **top-left
corner** — the CSS `left`/`top` / SVG / Canvas convention. For example,
`x: 960` (anchor `0`) places the element's left edge at x=960;
`x: 960, x_anchor: 0.5` places its center at x=960. The anchor only
moves where the box sits — rotation and scale always pivot the element's
geometric center (§4.4), independent of the anchor.

### 3.3. Length values

Wherever a position or dimension is accepted, a string with one of the
following unit suffixes MAY be used:

| Unit | Meaning |
|---|---|
| `"100px"` | pixels (same as bare number `100`) |
| `"50%"` | percentage of the property's natural reference (width → composition width; etc.) |
| `"10vw"` | percentage of composition width |
| `"15vh"` | percentage of composition height |
| `"5vmin"` | percentage of the smaller composition dimension |
| `"5vmax"` | percentage of the larger composition dimension |

A bare number is interpreted as pixels.

> **Divergence from CSS:** `%` and the viewport units resolve against the
> **composition (canvas)**, never the parent element. `"50%"` is always
> half the canvas, even on a child nested inside a group. There is no
> parent-relative percentage; use pixels for child-relative sizing inside
> groups.

### 3.4. Color values

Colors are CSS-style strings. The reference runtime accepts:
- hex — `"#rgb"`, `"#rgba"`, `"#rrggbb"`, `"#rrggbbaa"`
- `rgb()` / `rgba()` — comma or space separated, alpha as 0..1 or `%`
- `hsl()` / `hsla()` — same separators, optional `deg` on the hue
- the 148 CSS named colors (`"red"`, `"rebeccapurple"`, …) and
  `"transparent"`

Unrecognized strings fall back to white. (Conformance: only hex support
is REQUIRED of a runtime; the rest are RECOMMENDED for CSS parity.)

Internally, all colors flow through rendering as straight-alpha sRGB,
premultiplied at the final composition step. Authors do not need to
think about this; it is mentioned to document the reference runtime's
behavior.

### 3.5. Keyframe values

Many properties accept either a static value or a `Keyframe[]` array
for animation. The keyframe form is:

```json
[
  { "time": 0,   "value": 0,    "easing": "ease-out-cubic" },
  { "time": 1.0, "value": 100,  "easing": "ease-out-cubic" }
]
```

`time` is in seconds, relative to the element's `time` (see §7).
`value` can be a number, a string, or `[x, y]` for position-like
properties. `easing` is OPTIONAL; see §6.4.

### 3.6. Expression values

Any **numeric** property (transform, `opacity`, blur/`brightness`/
`contrast`/`saturation`, effect params, camera/light numbers — every
property whose type admits a number) MAY instead be given as an
**expression object**: a closed-form, deterministic function of the
element's own clock.

```json
{ "y": { "expr": "540 + sin(t * PI) * 30" } }
{ "rotation": { "expr": "t * 90" } }
{ "x": { "expr": "960 + wiggle(3, 12)" } }
```

An expression is a **pure function of element-local time and the
element's own index** — nothing else. This is the entire safety
boundary, and it is NORMATIVE:

- It MUST NOT reference any other element (`ref()`, `valueAtTime`) or
  read any runtime input (mouse, audio). Those are Tier-B and are
  permanently unsupported.
- It MUST be deterministic: every conforming runtime MUST produce
  identical results for the same expression and clock. `noise`,
  `wiggle`, and `random` derive from the protocol's normative
  value-noise hash (bit-stable across runtimes; seed defaults to `0`,
  never to wall-clock).
- Because it is a function of `t`/`i`, it is **bakeable**: a runtime or
  tool MAY sample it to a `Keyframe[]` at any frame rate. A keyframe
  table and an expression are two encodings of the same value.

**Scope** — the only identifiers in scope:

| Variable | Meaning |
|---|---|
| `t` | element-local time, seconds (`0` at the element's `time`) |
| `dur` | element duration, seconds |
| `i` | element index within its generated/particle set (default `0`) |
| `n` | sibling count (default `1`) |
| `value` | the property's base value (its documented default) |

Constants: `PI`, `TAU`, `E`. Functions (the ONLY callable identifiers):

```
sin cos tan asin acos atan atan2 sinh cosh tanh
abs sign sqrt cbrt pow exp log log2 floor ceil round trunc fract
min max mod hypot
clamp(x,lo,hi)  lerp(a,b,u)  mix(=lerp)  step(edge,x)  smoothstep(e0,e1,x)
linear(x,x0,x1,y0,y1)    // map x∈[x0,x1] → [y0,y1], clamped
ease(x,x0,x1,y0,y1)      // same, cubic in-out
noise(x[,seed])          // value noise, ∈[-1,1]
wiggle(freq,amp[,seed])  // amp · fractal noise(t·freq)
random(seed)             // deterministic [0,1) hash, time-independent
```

Operators: `+ - * / % ^` (`^` = exponent, right-assoc), unary `-`,
comparisons `< > <= >= == !=`, logical `&& || !`, and the ternary
`cond ? a : b`. Nothing else — no member access, assignment, indexing,
statements, or string values.

**Evaluation (NORMATIVE).** A conforming runtime MUST evaluate
expressions with a restricted parser/evaluator, NOT a general
code-execution facility (`eval` / `Function`). Any unknown identifier or
function, member access, assignment, or string literal is a parse error;
a parse error or a non-finite (`NaN` / `±∞`) result MUST fall back to the
property's base value. Expressions are numeric-only in this version;
string/text expressions are reserved.

---

## 4. The element model

Every element extends a common base:

```ts
interface BaseElement {
  id?: string;
  name?: string;
  type: ElementType;           // discriminator
  layer: number;               // REQUIRED, unique per container; 1..1000; LOWER draws in front (layer 1 = on top)
  time?: number | string;      // seconds
  duration?: number | string | "auto" | "end";

  // Transform (numbers OR length strings OR Keyframe[])
  x?: number | string | Keyframe[];
  y?: number | string | Keyframe[];
  x_anchor?: number | string;
  y_anchor?: number | string;
  width?: number | string | Keyframe[];
  height?: number | string | Keyframe[];
  rotation?: number | Keyframe[];  // degrees, around center
  scale?: number | Keyframe[];

  // Visual
  opacity?: number | Keyframe[];   // 0..1 (CSS convention), default 1
  visible?: boolean;               // false skips rendering (§4.2)
  blend_mode?: 'normal' | 'multiply' | 'screen' | 'add' | 'overlay' | 'hard-light' | 'soft-light';  // §4.5
  blur_radius?: number | Keyframe[];   // Gaussian σ in px (§4.6)
  brightness?: number | Keyframe[];    // multiplier, 1 = unchanged (§4.6)
  contrast?: number | Keyframe[];      // multiplier, 1 = unchanged (§4.6)
  saturation?: number | Keyframe[];    // multiplier, 1 = unchanged (§4.6)
  hue_rotate?: number | Keyframe[];    // degrees, default 0 (§4.6)
  effects?: Effect[];                  // ordered stylize passes (§4.7)
  material?: Material;                 // PBR material; only shaded under scene lights (§4.8)

  // Animation
  animations?: Animation[];
  keyframe_animations?: KeyframeAnimation[];
}
```

### 4.1. The `type` discriminator

`type` is REQUIRED and identifies which variant the object is. Conforming
runtimes MUST recognize the values defined in §5. Documents containing
unknown `type` values are valid documents; runtimes MAY skip such
elements with a warning rather than failing the whole document.

### 4.2. Draw order

Every element owns a **`layer`** — a unique integer 1..1000 within its
container (the top-level `elements`, each group's `elements`, each group
mask's `elements`), like an After Effects layer. **Lower `layer` draws
in front; layer 1 is on top.** Elements draw back-to-front by **depth**
(`z`, §4.4), then by `layer`:

```
draw_key  = (depth descending, i.e. farther first), then layer descending
            (highest layer drawn first/behind, layer 1 drawn last/on top)
```

`z` is the single depth axis (§4.4.2): with no camera it is pure
stacking order (no perspective), with a camera it additionally
foreshortens. `layer` orders elements *within* equal depth — when depths
are equal (e.g. a 2D document where every `z` is 0), draw order is
exactly layer descending, so layer 1 ends up on top. `layer` is
**required and unique per container** (duplicate layers are a validation
error), so no two elements tie; the sort MUST nonetheless be stable. The
same rule applies to a group's children, locally within the group.
(There is no separate `z_index` field — depth ordering is unified onto
`z`. `camera.sort: 'paint'` opts a camera composition back into fixed
`layer` order; see §4.4.3.)

Elements with `visible: false` MUST NOT be rendered. Inactive elements
(§7.1) MUST NOT be rendered.

### 4.3. Anchors and bounding boxes

The element's bounding box is `width × height` pixels, with its
anchor point at `(x, y)`. The visual center MUST be computed
from the anchor:

```
center_x = x + (0.5 - x_anchor) * width
center_y = y + (0.5 - y_anchor) * height
```

Rotation rotates the element around its center.

### 4.4. Transform composition

Every element supports, in addition to position and rotation:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `scale` | number | `1` | Uniform scale factor. |
| `x_scale`, `y_scale` | number \| `"N%"` | `1` | Per-axis scale factors; `"150%"` ≡ `1.5`. |
| `x_skew`, `y_skew` | number (degrees) | `0` | Shear, CSS `skewX`/`skewY` semantics: positive `x_skew` moves the bottom edge right; positive `y_skew` moves the right edge down. |

Since CKP/1.0, every element also supports a 3D transform:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `z_rotation` | number (degrees) \| Keyframe[] | `0` | Rotation in the element's plane. Exact alias for `rotation` — authoring BOTH on one element MUST be rejected by validators. |
| `x_rotation` | number (degrees) \| Keyframe[] | `0` | Rotation around the element's local x axis; positive tips the top edge away from the viewer. |
| `y_rotation` | number (degrees) \| Keyframe[] | `0` | Rotation around the element's local y axis; positive turns the right edge away from the viewer. |
| `z` | number (px) \| Keyframe[] | `0` | Depth toward (+) / away from (−) the viewer. The depth axis for §4.2 draw order: higher `z` draws nearer the viewer (on top), with `layer` ordering elements within equal depth (lower layer in front). Under a camera it additionally drives perspective foreshortening; with no camera it is pure stacking. |

All are animatable. The effective axis scales are
`sx = scale × x_scale`, `sy = scale × y_scale`.

#### 4.4.1. The local matrix (normative)

An element's local transform is the 4×4 matrix, in pixels, with the
anchor-derived center `(cx, cy)` (§4.3) as the pivot:

```
M_local = T(cx, cy, z) · Rz(z_rotation) · Ry(y_rotation) · Rx(x_rotation)
          · K(x_skew, y_skew) · S(sx, sy, 1) · T(−cx, −cy, 0)
```

where `Rx/Ry/Rz` are the standard right-handed rotation matrices in
the protocol's coordinate system (x right, y DOWN, z toward the
viewer; positive `z_rotation` is therefore clockwise on screen, as in
CKP/1.0), and `K` embeds the 2D shear `[[1, tan(x_skew)],
[tan(y_skew), 1]]` (CSS `skew(x, y)` semantics) in the xy plane. With
`x_rotation = y_rotation = z = 0` this reduces exactly to the CKP/1.0
composition **scale → shear → rotate** around the anchor-derived
center; documents without 3D fields MUST render identically under
both models.

Group transforms stack multiplicatively onto children:
`M = M_parent · M_local`, evaluated in the group's local space, and
opacities multiply down the group chain. Children of a group that
does NOT rasterize to a layer (no `clip`, `mask`, filter fields, or
`effects` — see §4.4.3) therefore live in the parent's 3D space:
nested 3D rotations compose, with no opt-in flag.

#### 4.4.2. The camera

A Source MAY declare one scene camera — a perspective lens (`perspective`,
`origin_x`, `origin_y`) plus an optional rigid **pose** (a position and a
look orientation) that moves the viewpoint through the scene:

```ts
camera?: {
  perspective: number | Keyframe[];  // focal distance in px, > 0
  origin_x?: number | string;        // default "50%" (canvas center)
  origin_y?: number | string;        // default "50%"

  // Eye position offset from the default eye, px, about the origin. Default 0.
  x?: number | Keyframe[];           // +x right
  y?: number | Keyframe[];           // +y down
  z?: number | Keyframe[];           // +z = eye toward the scene (dolly in)

  // Eye orientation, degrees, Euler (applied Rz·Ry·Rx). Default 0.
  x_rotation?: number | Keyframe[];  // pitch (tilt)
  y_rotation?: number | Keyframe[];  // yaw (pan)
  z_rotation?: number | Keyframe[];  // roll

  sort?: 'depth' | 'paint';          // compositing order, §4.4.3. Default 'depth'.
}
```

The lens follows CSS Transforms Module Level 2 `perspective()`
semantics: with `d = perspective` and origin `(ox, oy)`,

```
P = T(ox, oy, 0) · [ 1 0 0 0 ; 0 1 0 0 ; 0 0 1 0 ; 0 0 −1/d 1 ] · T(−ox, −oy, 0)
```

The pose is the **inverse of the camera's rigid world transform**, taken
about the origin so it composes with the lens. With eye position
`(x, y, z)` and rotation `R = Rz·Ry·Rx`,

```
V = T(ox, oy, 0) · R⁻¹ · T(−x, −y, −z) · T(−ox, −oy, 0)
```

and the camera matrix applied once at the root is

```
camera = P · V
```

so every element renders through `P · V · M_chain · M_local`, followed
by the perspective divide. Orientation is given as explicit Euler angles
rather than a look-at target: a target would derive orientation from
geometry (hidden runtime math); a "look at this point" gesture is an
authoring convenience that resolves to these angles, not a schema field.

**Identity reduction (normative).** With the pose at its defaults
(`x=y=z=0`, all rotations `0`), `V = I` and `camera = P` **bit-for-bit**:
a document that uses only `perspective`/origin renders identically to a
pre-pose runtime. Smaller `d` = stronger foreshortening; `perspective`
is animatable (camera push/pull), as are all pose fields (orbit, pan,
tilt, dolly).

**No camera ⇒ camera = I.** 3D rotations still render (affine
foreshortening — a y-rotated card narrows but its edges stay parallel).
`z` has no *perspective* effect without a camera, but it still **orders**
(§4.2, §4.4.3): `z` is the single depth axis, so without a camera it acts
as pure stacking order. A document with no 3D fields (all `z = 0`) and no
camera renders as pure layer stacking — equal depth collapses to `layer`
order (descending, so layer 1 is on top).

#### 4.4.3. Compositing under 3D (normative)

- **Paint order — depth (2.5D).** `z` is the single depth axis and it
  orders **always**: each sibling draw list (the top-level elements, and
  the children of each non-flattened group) is painted **back-to-front
  by depth** — the eye-space `z` of the sibling's anchor (its `z` with no
  camera; `z` after `P · V` under a camera), far cards first. With **no
  camera** this is pure stacking with no perspective; with a **camera**
  it is the same ordering plus foreshortening. This is whole-card
  (per-element) 2.5D sorting — flat cards ordered by distance — NOT a
  per-pixel depth buffer. The sort is **stable**: equal depths break by
  `layer` order (descending — layer 1 drawn last/on top), so a document
  where every `z = 0` collapses to exact `layer` order, and the same
  Source always yields the same pixels. A flattened group (clip / mask / filters /
  effects) is a single card and sorts by its own anchor depth as a
  unit; the §4.4.3 flattening rule means its children are already
  coplanar inside the flat layer and keep their in-layer order. An
  element's own internal quads (a particle system's particles, a text
  element's glyphs) are likewise NOT reached by this sort — they follow
  their own documented order (e.g. particles in spawn order, §5.13).
  **Limitation (normative, not a bug):** because the unit of sorting is
  the whole card, cards that interpenetrate, or whose anchor-depth order
  disagrees with their true per-pixel order, can be ordered "wrong" at
  some camera angles. There is no per-pixel resolution in the 2.5D
  model. `sort: 'paint'` opts a camera composition back into fixed
  `layer` order for authors who want explicit, camera-stable
  layering. There is no depth buffer in the rendering model.
- **Flattening at layer boundaries.** A group with `clip: true` or
  `mask` renders its children in its own flat 2D layer space exactly
  as in CKP/1.0, and the finished layer's quad is then transformed by
  the full matrix chain. 3D declared INSIDE such a subtree composes
  only within that flat layer's plane; 3D declared ON or ABOVE it
  projects the layer as a unit. (This is how a clipped UI-mock group
  tilts as one card.)
- **Effect surfaces are screen-space.** Filter fields (`blur_radius`,
  `brightness`, `contrast`, `saturation`, `hue_rotate`) and `effects`
  entries evaluate on the element's PROJECTED rendering: the element
  (or group subtree) draws with its full transform — including 3D and
  the camera — into a surface-sized layer, and the filter/effect chain
  runs on those screen-space pixels. This matches CKP/1.0, where the
  element's own transform is likewise baked into its effect surface
  before filtering, and means e.g. a glow's radius or a stroke's width
  is uniform in screen pixels on a tilted card. A shape's native
  `shadow` foreshortens with the element's plane, but its
  `offset_x`/`offset_y` translate in the PARENT plane — consistent
  with CKP/1.0, where a rotated shape's shadow offset stays
  screen-aligned.
- **Glass.** Glass is legal under 3D. The pane is a true plane in the
  scene: pane-local coordinates come from the inverse of the pane's
  plane homography (the restriction of the full §4.4 matrix chain to
  the pane's plane — equivalent to exact per-fragment ray/plane
  intersection), the §4.7 optical model runs unchanged in that local
  frame, and refracted sample points map FORWARD through the
  homography onto the screen-space backdrop snapshot. See §4.7 "Glass
  under 3D" for the normative model and degenerate cases. With no 3D
  on the element or its un-flattened chain, the orthographic CKP/1.0
  path applies bit-for-bit.
- **Anti-aliasing.** SDF edge anti-aliasing remains derivative-based
  and scales naturally under projection; the §1 cross-backend
  tolerance language applies unchanged.

### 4.5. Blend modes

`blend_mode` selects how the element's pixels combine with the pixels
already drawn beneath it. It is **element-local**: it changes only this
element's compositing math and MUST NOT alter how any other element
renders. With premultiplied sources:

| Value | Color math | Character |
|---|---|---|
| `normal` (default) | `out = src + dst·(1 − src.a)` | Standard over. |
| `multiply` | `out = src·dst + dst·(1 − src.a)` | Darkens; white is neutral; uncovered pixels leave the destination unchanged. |
| `screen` | `out = src + dst·(1 − src)` | Lightens; black is neutral. |
| `add` | `out = src + dst` | Linear dodge; overlaps sum toward white (glow). |
| `overlay` | `B(cb,cs)` = `2·cb·cs` if `cb ≤ 0.5` else `1 − 2·(1−cb)·(1−cs)` | Multiply in dark backdrop areas, screen in light ones; boosts contrast. |
| `hard-light` | `B(cb,cs)` = overlay with source and backdrop swapped | Like shining a harsh light through the source. |
| `soft-light` | `B(cb,cs)` per W3C soft-light | A gentler `hard-light` (soft dodge/burn). |

The blend function `B(cb, cs)` operates on **straight-alpha** (un-
premultiplied) backdrop `cb` and source `cs` per channel; the result
composites via the general separable formula
`co = αs·(1−αb)·cs + αs·αb·B(cb,cs) + (1−αs)·αb·cb`, with
`αo = αs + αb·(1 − αs)`. For `normal`/`multiply`/`screen`/`add` this
reduces to the closed forms above, expressible with fixed-function
blending. `overlay`/`hard-light`/`soft-light` are **piecewise on the
backdrop (or source)** and cannot be; a conforming runtime isolates
the element to its own layer and composites it against a snapshot of
the backdrop. The alpha channel always composites normally, so
coverage is unaffected by the mode.

On a `group`, `blend_mode` applies when the group's flattened layer is
composited — which only exists when the group is layered via
`clip: true` or `mask` (§5.8). On an unlayered group the field MUST be
ignored (children draw directly to the parent surface with their own
modes); runtimes SHOULD warn. Children inside a layered group
composite against each other inside the layer, isolated from the
backdrop — matching CSS `isolation: isolate` semantics.

### 4.6. Filters

Four element-local filter fields, all animatable, all following CSS
`filter` function semantics:

| Field | Default | Meaning |
|---|---|---|
| `blur_radius` | `0` | Gaussian blur; the value is the standard deviation σ in canvas pixels (CSS `blur(σ)`). |
| `brightness` | `1` | Color multiplier: `c' = c × v` (CSS `brightness(v)`). |
| `contrast` | `1` | Scale around mid-gray: `c' = (c − 0.5) × v + 0.5` (CSS `contrast(v)`). |
| `saturation` | `1` | Lerp against Rec. 709 luma: `c' = mix(luma(c), c, v)`; `0` = grayscale (CSS `saturate(v)`). |
| `hue_rotate` | `0` | Hue rotation by `v` DEGREES: `c' = M(v) × c` with the SVG `feColorMatrix type="hueRotate"` matrix below (CSS `hue-rotate(v)`). |

The `hue_rotate` matrix, NORMATIVE, with `cosθ`/`sinθ` of the angle:

```
M = [ 0.213+0.787cosθ−0.213sinθ  0.715−0.715cosθ−0.715sinθ  0.072−0.072cosθ+0.928sinθ ]
    [ 0.213−0.213cosθ+0.143sinθ  0.715+0.285cosθ+0.140sinθ  0.072−0.072cosθ−0.283sinθ ]
    [ 0.213−0.213cosθ−0.787sinθ  0.715−0.715cosθ+0.715sinθ  0.072+0.928cosθ+0.072sinθ ]
```

Blur evaluation is a NORMATIVE downsample ladder (so identical sources
produce identical pixels everywhere): bilinearly halve the image until
the residual `σ / f ≤ 4` (`f` a power of two, max 16), apply a
25-tap Gaussian (taps at `σ/f ÷ 4` spacing over ±3σ, weights
`exp(−d²/2σ²)` normalized by their sum) horizontally then vertically
at the reduced size, and bilinearly upsample at the consuming draw.
Sparse full-resolution taps are not an acceptable substitute — they
leave a visible σ/4-pixel grid on hard edges.

A filtered element — any type, `group` included, layered or not — is
rendered with its normal transform into a transparent offscreen layer,
then that layer is composited back through the filter. Filters MUST
apply in the order **blur → brightness → contrast → saturation →
hue_rotate**, and
the color ops MUST operate on straight (unpremultiplied) color so
translucent pixels don't skew toward the contrast midpoint. Channel
results clamp to [0, 1] before re-premultiplying; the alpha channel is
never changed by color ops.

Filters are element-local: the blur may bleed past the element's box
(like CSS `filter: blur()`) but never reads or alters other elements'
pixels. The element's `opacity` applies inside the layer and its
`blend_mode` applies at the filter composite, so all three features
compose. On a group, filtering flattens the subtree first — children
are filtered as one image, not individually.

### 4.7. Stylize effects

`effects` is an ordered array of stylize passes over the element's
rendered pixels, applied AFTER the filter fields:

```
layer → blur → brightness → contrast → saturation → hue_rotate → effects[0] → … → effects[n]
```

```json
{ "effects": [{ "type": "pixelate", "cell_size": 12 }] }
```

Each effect is an object discriminated by `type`. Effect params accept
`number | Keyframe[]`; keyframes evaluate against element-local time.
(Effect params are NOT addressable from `keyframe_animations` — there
is no property-path syntax into the array.) Like filters, effects are
element-local, work on every element type (a `group` flattens its
subtree first), and the element's `blend_mode` applies at the final
composite. Runtimes encountering an effect `type` they don't implement
MUST skip that effect (rendering the element without it) and SHOULD
warn.

**Effects read only the element's own rendered pixels — with ONE
exclusion: `glass`.** Glass additionally reads the element's
*backdrop*: the current surface's pixels at the element's position in
draw order (§4.2), i.e. everything drawn before it on the same
surface. It gets this carve-out because the effect is widely known and
in high demand, and there is no proper decomposition — refraction
needs the pixels behind the pane — and the alternative, a first-class
glass element type, is deliberately not part of this protocol. No
other effect type reads the backdrop, and backdrop-sampling blend
modes (overlay, soft-light) remain excluded (§4.5). Note the
relationship stays one-way: glass READS what is beneath it but never
alters how any other element renders.

Pixel-grid coordinates below are the element's layer pixels at output
resolution; cells are aligned to the layer's origin. Color math runs
on straight (unpremultiplied) color; "ink" factors scale color and
alpha together (premultiplied output).

#### `pixelate`

| Param | Default | Meaning |
|---|---|---|
| `cell_size` | `8` (min 1) | Cell size in canvas pixels. |

Every pixel takes the color sampled at its cell's center:
`out(p) = src((floor(p / cell) + 0.5) × cell)`.

#### `dither`

| Param | Default | Meaning |
|---|---|---|
| `levels` | `4` (min 2) | Quantization levels per color channel. |

Ordered dithering with the 4×4 Bayer matrix
`[0 8 2 10; 12 4 14 6; 3 11 1 9; 15 7 13 5]`:
`t = (B[y mod 4][x mod 4] + 0.5) / 16`, then per channel
`c' = clamp(floor(c × (levels−1) + t) / (levels−1), 0, 1)`.
Alpha (coverage) is not dithered.

#### `halftone`

| Param | Default | Meaning |
|---|---|---|
| `cell_size` | `8` (min 2) | Dot-grid cell size in canvas pixels. |
| `angle` | `45` | Grid rotation in degrees. |

In grid space (pixel coords rotated by `angle`), each cell draws a dot
at its center, colored with the source sample at that center and sized
by its luminance: `luma = Rec709(c) × α`, `r = 0.5 × cell × √luma`
(area-proportional ink). Pixel ink is
`(1 − smoothstep(r−1, r+1, d)) × clamp(r, 0, 1)` where `d` is the
grid-space distance to the dot center; outside dots the output is
transparent.

#### `ascii`

| Param | Default | Meaning |
|---|---|---|
| `cell_size` | `12` (min 4) | Glyph cell size in canvas pixels. |

Each cell samples its center color; `luma = Rec709(c) × α` selects a
glyph by `i = clamp(floor(luma × 10), 0, 9)` from the ten-step density
ramp `space . - : = + % * @ #`. The glyph tints with the cell's color;
uninked pixels are transparent. Glyph shapes are NORMATIVE — the
embedded 8×8 bitmap font below (one byte per row, MSB = leftmost
pixel), upscaled nearest-neighbor to the cell — so the effect never
depends on platform fonts:

| Glyph | Rows (hex) |
|---|---|
| space | `00 00 00 00 00 00 00 00` |
| `.` | `00 00 00 00 00 18 18 00` |
| `-` | `00 00 00 7E 00 00 00 00` |
| `:` | `00 18 18 00 00 18 18 00` |
| `=` | `00 00 7E 00 7E 00 00 00` |
| `+` | `00 18 18 7E 18 18 00 00` |
| `%` | `00 C6 CC 18 30 66 C6 00` |
| `*` | `00 66 3C FF 3C 66 00 00` |
| `@` | `7C C6 DE DE DE C0 78 00` |
| `#` | `6C 6C FE 6C FE 6C 6C 00` |

#### `glow`, `drop_shadow`, `stroke` (layer styles)

Layer styles composite BENEATH the element's own pixels (premultiplied
under-operator: `out = content + style × (1 − content.α)`), on any
element type.

| Effect | Params (defaults) | Math |
|---|---|---|
| `glow` | `radius` 20, `intensity` 1, `color` `"#FFFFFF"` | silhouette alpha blurred by σ = radius (§4.6 ladder), × intensity (clamped to 1), × color. |
| `drop_shadow` | `offset_x` 0, `offset_y` 12, `blur` 18, `color` `"#000000"`, `opacity` 0.6 | silhouette alpha blurred by σ = blur, sampled at p − offset, × color × opacity. |
| `stroke` | `width` 4, `color` `"#FFFFFF"` | outline band outside the silhouette: max alpha over a 16-tap ring of radius = width, × color. |

Numeric params are animatable; they chain in array order like all
effects (a drop_shadow listed before a glow renders beneath it).

#### `chroma_key`, `luma_key` (keying)

Keying makes pixels of the element's own rendered layer transparent
based on their color. All math operates on the STRAIGHT-alpha color
`c = premultiplied.rgb / α` (with `c = 0` where `α = 0`); the resulting
coverage factor `a` scales the pixel's alpha (and its premultiplied
color with it).

**`chroma_key`** — params `color` (default `"#00FF00"`), `tolerance`
(default `0.18`), `softness` (default `0.1`), `spill` (default `0.5`).
With `k` the key color and BT.709 luma `Y(x) = 0.2126·x.r + 0.7152·x.g
+ 0.0722·x.b`:

```
CbCr(x) = ( (x.b − Y(x)) / 1.8556 , (x.r − Y(x)) / 1.5748 )
d       = | CbCr(c) − CbCr(k) |              — Euclidean distance
a       = softness > 0 ? clamp((d − tolerance) / softness, 0, 1)
                       : (d > tolerance ? 1 : 0)
```

Spill suppression caps the key color's dominant channel (ties resolve
green → red → blue): with `i` that channel and `j, k` the others,
`c.i −= spill × max(0, c.i − max(c.j, c.k))`, applied to every pixel
regardless of `d`. Output: `α' = α × a`, color `c × α'`.

**`luma_key`** — params `threshold` (default `0.5`), `softness`
(default `0.1`), `invert` (default `false`):

```
a = softness > 0 ? clamp((Y(c) − threshold) / softness, 0, 1)
                 : (Y(c) > threshold ? 1 : 0)
invert → a = 1 − a
```

Pixels darker than `threshold` are removed (with `invert`, brighter).
`tolerance` / `softness` / `threshold` / `spill` are animatable;
`color` and `invert` are static. Keying reads only the element's own
pixels — to key a green-screen video, put the effect on the `video`
element (`color` set to the screen's actual green); a group keys its
composited children as one layer.

#### `levels`, `lut` (grading)

Both operate per pixel on the straight-alpha color; alpha is never
changed.

**`levels`** — params `in_black` 0, `in_white` 1, `gamma` 1,
`out_black` 0, `out_white` 1 (all animatable, points clamped to
[0, 1], gamma > 0). Per channel:

```
x   = clamp((c − in_black) / (in_white − in_black), 0, 1)
y   = x^(1/gamma)                — gamma > 1 brightens mid-tones
out = clamp(out_black + y × (out_white − out_black), 0, 1)
```

**`lut`** — params `source` (URL of a `.cube` file — http(s), relative,
or `data:` URI), `intensity` 1 (animatable, 0..1). The file MUST
declare `LUT_3D_SIZE N` (2 ≤ N ≤ 256) with the default 0..1 domain;
data lines are `r g b` triples ordered red-fastest, then green, then
blue. Values clamp to [0, 1]. The graded color is the TRILINEAR
interpolation of the lattice at `c × (N−1)` per axis, and the output
is `mix(c, graded, intensity)`. A LUT that fails to load or parse MUST
skip the pass with a warning (the element still renders). The lattice
is sampled at the pipeline's working precision (8-bit per channel in
the reference runtime).

#### `fractal_noise`, `turbulent_displace` (procedural noise)

Both build on one NORMATIVE noise function so identical documents
produce identical pixels on every runtime. All integer math is 32-bit
unsigned (wrapping); lattice coordinates convert int→uint by two's
complement.

```
pcg(v)   : s = v × 747796405 + 2891336453            (mod 2³²)
           w = ((s >> ((s >> 28) + 4)) XOR s) × 277803737   (mod 2³²)
           → (w >> 22) XOR w
h(c, seed) = pcg(c.x XOR pcg(c.y XOR pcg(c.z XOR pcg(seed)))) / (2³²−1)
noise(p, seed): value noise — trilinear blend of h at the 8 corners of
           floor(p)'s lattice cell, weights faded per axis by
           u = f³(f(6f − 15) + 10)
fbm(p, octaves, seed) = Σₒ 0.5° × noise(p × 2°, seed + o)  /  Σₒ 0.5°
           for o = 0 … octaves−1   (lacunarity 2, gain 0.5)
```

**`fractal_noise`** — params `scale` 100 (canvas px per lattice cell),
`evolution` 0, `offset_x`/`offset_y` 0 (canvas px), `octaves` 4
(integer 1–8, static), `seed` 0 (integer, static; use values < 2²⁴).
The element's pixels are replaced by grayscale noise, keeping its
alpha footprint:

```
v = fbm((p + offset) / scale  ⊕  evolution as the 3rd axis, octaves, seed)
out = (v, v, v) × α, α unchanged
```

Grayscale by design — chain `levels` to shape contrast and a `lut` to
color it (gray has no chroma for `hue_rotate` to act on). Animate
`evolution` for in-place churn, the offsets to scroll. On a text
element the glyphs become a noise-filled matte.

**`turbulent_displace`** — params `amount` 16 (max displacement,
canvas px), `scale` 120, `evolution` 0, `octaves` 2 (1–8, static),
`seed` 0 (static). Each output pixel samples the element's layer at a
noise-displaced position (bilinear, clamped to the layer):

```
d = ( fbm(p/scale ⊕ evolution, octaves, seed)        − 0.5 ,
      fbm(p/scale ⊕ evolution, octaves, seed + 7919) − 0.5 ) × 2 × amount
out(p) = layer(p + d)
```

`scale`, `evolution`, offsets, and `amount` are animatable; `octaves`
and `seed` are static.

#### `glass`

Liquid glass — a refractive pane over the backdrop, following the
widely-adopted liquidglass optical model (reference:
github.com/ybouane/liquidglass). Glass applies to `shape` elements
(primitive rectangle / ellipse and path shapes) and `text` elements,
where the pane geometry is known from the element's own geometry rather
than rasterized alpha.

Glass is **legal under 3D**: 3D transforms (`x_rotation` /
`y_rotation` / `z`) and a camera on a glass-carrying element or its
un-flattened ancestor chain are valid. The pane is a true plane in the
scene and the runtime projects the §4.7 optical model through the
pane's plane homography (see "Glass under 3D" below). With no 3D in
play the orthographic path applies bit-for-bit.

| Param | Default | Meaning |
|---|---|---|
| `blur_radius` | `0` | Backdrop Gaussian blur σ in px. `0` = CLEAR glass (pure refraction, the default material); `> 0` = FROSTED. |
| `refraction` | `21` | Lens bend strength (≈ px of displacement; internally the reference dial = `refraction / 30`). The magnitude is used. |
| `edge_width` | `40` | Bevel z-radius — how deep the lens curvature reaches. With `mode: "dome"` and `edge_width` = the shape's radius, the pane is a half-sphere magnifier. |
| `mode` | `"pill"` | Lens cross-section: `"pill"` (biconvex — entry + exit refraction + depth-scaled centre magnification) or `"dome"` (flat bottom, curved top — uniform magnification toward the centre). |
| `edge_highlight` | `0.35` | Scales the stock light rig (rim 0.22×, inner glow 0.15×, 1.5px top-biased inner stroke 0.55×, Fresnel). `0.35` reproduces the reference defaults exactly. |
| `dispersion` | `0.05` | Chromatic aberration along the surface normal (×18 px, edge-weighted). |
| `shadow` | `0.3` | Drop-shadow opacity, painted ONLY outside the pane's SDF (spread 10 px, vertical offset 1 px — glass never frosts its own shadow). |
| `backdrop_saturation` | `1` | Saturation of the sampled backdrop (`1` = unchanged). |
| `tint` | none | Color drawn over the glass; alpha = strength. Not keyframable in v1. |

All numeric params are animatable. The pane's `fill_color` is unused
under glass; its `opacity` scales the pane. An `ellipse` evaluates as
the rounded-rect SDF with `r = min(half)` — a circle when square, a
stadium otherwise. Pane content (labels, icons) goes on lower layers (nearer the front).

The model, NORMATIVE, evaluated per pixel in pane-local rotated
coordinates `p` with half-size `half`, corner radius `r`, z-radius
`zR = edge_width`, and the reference dial `dial = |refraction| / 30`:

```
sdf      = roundedRectSDF(p, half, r)
inside   = −sdf
h(d)     = √(d × (2·zR − d)) clamped to [0, zR]   — half-circle bevel
∇h       = central differences of h at step 2 px (the sdf is ANALYTIC:
            no field facets, no measured-divergence cap, no rim "lip")
N        = normalize(−∇h, 1)
depth    = smoothstep(0, zR, inside)
edge     = smoothstep(0.35 × min(half), 0, inside)

pill:    refr = (2·∇h + ∇h·(h/zR)·0.5) × (1 − 1/1.5) × dial × 30
                + (−p / half) × dial × 4 × depth
dome:    refr = −p × dial × depth × 0.35

chroma   = N.xy × dispersion × 18 × (edge×0.7 + 0.3) × 2;
           R/G/B sample at refr + chroma / refr / refr − chroma
col      = mix(sharp, frosted, 1 − edge × 0.15)
           — frosted everywhere, 15% sharp at the rim; with
             blur_radius 0 both textures are identical (clear glass)
col      = saturate(col, backdrop_saturation); mix toward tint;
           × (1 + 0.06 × depth)
fresnel  = (1 − |N.z|)⁴ × (edge_highlight / 0.35)
spec     = Blinn-Phong on N: L(0.4,0.7,1)^90 + L(−0.3,−0.5,1)^50×0.3
           + diffuse L(0.1,0.3,1)^6×0.1 + L(0,0.9,0.4)^120×0.6
           (specular dial; reference default 0)
stroke   = 1.5px inner band × (0.4 + 0.6·topBias) × edgeHL × 0.55
rim/glow = edge × edgeHL × 0.22  /  smoothstep(5,0,inside) × edgeHL × 0.15
env      = (N.y×0.5 + 0.5) × fresnel × 0.08
fin      = col + spec + rim + glow + stroke + env, then
           mix(fin, white, fresnel × 0.2)
out      = premultiply(fin, aaMask × opacity)

shadow (sdf > 0 only, offset down by offY):
d        = max(sdfShadow − 1, 0);  s = spread
α        = (e^(−d²/s²) × 0.65
            + e^(−0.08·d / max(0.04·s, 0.01)) × 0.35) × shadow
```

**Glass under 3D (CKP/1.0, NORMATIVE).** When the pane carries 3D
fields or sits under an un-flattened non-affine chain (§4.4), the
model above runs unchanged in the pane's LOCAL frame; only the
coordinate hand-off changes:

- Let `H` be the pane's plane homography — the 3×3 restriction of the
  full §4.4 matrix chain (camera included) to the pane's plane,
  origin at the pane's center, y down. Per fragment, pane-local
  `p = (H⁻¹ · (px, 1)).xy / w`; a non-positive `w` lies past the
  plane's horizon and outputs nothing. This is exactly the camera-ray
  / pane-plane intersection, in projective form.
- Refracted and dispersed sample points (`p + refr ± chroma`) map
  FORWARD through `H` to surface px (clamped to the surface) and
  sample the same screen-space backdrop snapshot. Glass refracts the
  COMPOSITED IMAGE at the screen plane — it does not re-render the
  scene from the refracted direction.
- The light rig, bevel field and SDF are defined in the pane's local
  frame and tilt WITH the pane (highlights track the surface, not the
  screen).
- Degenerate case: a singular `H` (an edge-on pane with no
  perspective anywhere in its chain) is invisible — runtimes MUST
  draw nothing. Under perspective an off-axis edge-on pane projects
  to a thin wedge; that wedge is correct rendering, not an error.
- The shadow term evaluates in pane-local coordinates like everything
  else, so the shadow projects with the pane.

With no 3D in play the orthographic path applies unchanged —
documents valid in CKP/1.0 render bit-identically.

### 4.8. Lighting and materials (CKP/1.0, NORMATIVE)

A Source MAY declare `lights` and an `environment`; an element MAY carry
a `material`. Lighting is **opt-in and additive**: a document with no
`lights` and no element `material` renders **bit-identically** to one
without these fields. Only elements with a `material` are shaded.

**Shading model (PBR).** When an element has a `material` and the Source
has `lights`, the element renders its content normally — those pixels are
the **albedo** — and the runtime shades each fragment with one model,
identical in 2D and 3D:

```
out = albedo · (ambient + Σ_dir diffuse(N,L)·Lc)         // Lambert
    + Σ_dir specular_GGX(N,L,V,roughness)·F(V,H,F0)·Lc    // Cook-Torrance
    + (kd·albedo·envAvg + envc·Fr) · reflectivity         // environment (IBL)
    + emissive·albedo
```

where `envc = mix(env(R), envAvg, roughness)` is the environment sampled
along the reflection ray `R = reflect(−V,N)` and blurred toward its
average by roughness; `Fr` is the roughness-aware Schlick–Fresnel at the
view angle; `kd = (1−Fr)·(1−metalness)` is the dielectric diffuse weight;
and `envAvg` is the environment's mean color (its diffuse irradiance).

- **N** is the element's world-space face normal (from its §4.4 3D
  orientation), perturbed per-fragment by `material.normal_map` when
  present (a tangent-space map sampled in the element's UV space, scaled
  by `normal_scale`; the tangent/bitangent come from the quad's U/V axes).
- **V** is the view vector: per-fragment `normalize(eye − fragmentWorld)`
  under a camera, or `(0,0,1)` with no camera. This is the only term the
  camera affects — so specular and reflections **sweep as the camera
  moves** (3D); with no camera you animate the lights instead (2D). The
  math is the same.
- **F0** (Fresnel base reflectance) is `0.04` for dielectric, the albedo
  for metal, interpolated by `metalness`. Fresnel uses Schlick.
- **roughness** widens the GGX specular lobe and blurs the environment
  reflection; **reflectivity** is an art dial over the environment term.

**Lights** (`source.lights`):
- `{ type: 'ambient', color?, intensity? }` — uniform fill.
- `{ type: 'directional', azimuth?, elevation?, color?, intensity? }` —
  a parallel light; `azimuth`/`elevation` (degrees) give its direction.
  All scalar fields animatable.

**Environment** (`source.environment`) is what reflective surfaces
sample along the reflection vector. Phase 1: `{ type: 'gradient', stops }`
— a gradient "sky" indexed by the reflection ray's vertical component
(offset 0 = looking down, 1 = up), so a surface mirrors the sky when it
tilts up and the ground when it tilts down, and the reflection shifts as
the surface (or camera) moves. Up to 4 stops. The environment also
contributes a diffuse irradiance (its average color) to dielectric
surfaces. The other type is `{ type: 'image', src }` — an
**equirectangular** (2:1 lat-long) image the surface mirrors along the
reflection vector (real photographic reflections); roughness blurs it
toward the image's average color. Both share one IBL path.

**Bloom** (`source.bloom`, Phase 2) is a whole-frame post-process:
pixels brighter than `threshold` (luma, soft `knee`) are blurred by
`radius` and added back × `intensity`, so bright regions — specular
highlights, emissive surfaces, bright media — bleed light across element
boundaries. It is **brightness-driven**: the amount each region blooms
comes from its own brightness, not a per-element knob (use the
per-element `glow` effect for deliberate, art-directed halos). Opt-in;
absent ⇒ no bloom (byte-identical). All fields animatable.

**Material** (`element.material`): `roughness` (0 mirror‑tight .. 1
matte), `metalness` (0 dielectric .. 1 metal), `reflectivity` (env
strength), `emissive` (self-illumination toward the unlit pixels),
`normal_map` (tangent-space normal map URL — flat texel = `#8080ff`) and
`normal_scale` (perturbation strength). Scalars animatable. Absent ⇒
unlit.

**Determinism / cost.** No `material` ⇒ the element takes the exact
unlit path (no shading pass), so unlit content is byte-identical and
pays nothing. The model is local illumination (no shadows, no global
illumination) — flat 2.5D surfaces lit per-fragment.

---

## 5. Element types

CKP/1.0 defines eight element types — `video`, `image`, `text`,
`shape`, `audio`, `group`, `caption`, and `particles`. (The former
`svg` element was absorbed into `shape`, which carries vector `paths`.)
Each section below specifies the fields, semantics, and required
behavior for one type.

### 5.1. `shape`

A `shape` draws geometry in one of two representations, selected by whether
it carries `paths`:

- **Primitive** — `shape: "rectangle" | "ellipse"` with optional rounded
  corners, gradient fills, and stroke. Rendered as a resolution-independent
  SDF. `fill_color`, `stroke_color`, `stroke_width`, and `border_radius` are
  animatable via `keyframe_animations` (e.g. `property: "border_radius"`).
- **Path** — arbitrary vector geometry via `paths`: keyframeable `d`
  morphing, per-sub-path fill/stroke, and stroke trim/draw-on. Rasterized,
  so resolution is bound by `view_box`. Specified in §5.6.

When `paths` is present the primitive fields are ignored.

```ts
interface ShapeElement extends BaseElement {
  type: "shape";
  // Primitive form (ignored when `paths` is present):
  shape?: "rectangle" | "ellipse";        // default "rectangle"
  fill_color?: string;                     // hex, default "#ffffff"
  gradient?: LinearGradient | RadialGradient;  // overrides fill_color
  stroke_color?: string;
  stroke_width?: number;
  border_radius?: number;                  // PIXELS — see §5.1.2
  shadow?: BoxShadow;                      // drop shadow cast by the shape
  // Path form (§5.6):
  view_box?: [number, number, number, number]; // default [0, 0, 100, 100]
  gradients?: PathGradient[];
  paths?: PathDef[];                       // ≥1 when present
}

interface BoxShadow {
  color: string;       // §3.4
  offset_x?: number;   // px. Default 0
  offset_y?: number;   // px. Default 12
  blur?: number;       // Gaussian σ px (0 = crisp). Default 18
}
```

`shadow` casts a soft drop shadow beneath the shape. Under 3D the shadow
foreshortens with the element's plane, while `offset_x`/`offset_y`
translate in the parent plane (§4.4.3).

#### 5.1.1. Gradients

```ts
interface LinearGradient {
  type: "linear";
  angle?: number;       // degrees, CSS linear-gradient() convention:
                        //   0 = to top, clockwise. 90 = to right,
                        //   180 = to bottom (default), 270 = to left.
  stops: GradientStop[]; // 2..4 stops
}
interface RadialGradient {
  type: "radial";
  cx?: number;          // 0..1 of bounding box, default 0.5
  cy?: number;
  radius?: number;      // 0..1, default 0.5
  stops: GradientStop[];
}
interface GradientStop {
  offset: number;       // 0..1
  color: string;        // hex
}
```

Implementations MUST support at least 4 stops. The gradient direction
for linear gradients uses CSS-style angle conventions.

#### 5.1.2. Corner radius

`border_radius` is in PIXELS, not a normalized 0..1 value. Runtimes MUST
clamp the value to half the shorter of `width`/`height` so that values
exceeding the shape produce a pill or circle rather than visual artifacts.

Conforming runtimes MUST render corner arcs as **true quarter-circles**,
not stretched ellipses. This means SDF-based renderers MUST perform
corner math in pixel space, not in normalized UV space.

### 5.2. `text`

Multi-line text. Text soft-wraps within the box (`text_wrap`), honors
explicit `\n` breaks, `line_height`, and per-line backgrounds. The
default font is **Inter** (not a platform stack); `font_family` selects
another registered family (§2.1 `fonts`).

```ts
interface TextElement extends BaseElement {
  type: "text";
  text?: string;                       // static text
  spans?: TextSpan[];                  // inline-styled runs (§5.2.4)

  font_family?: string;                // registered family name; default Inter
  font_size?: number | string;         // "auto" fits to width
  font_weight?: number | string;       // "400", "bold", etc.
  font_style?: "normal" | "italic";
  fill_color?: string;
  stroke_color?: string;
  stroke_width?: number;
  text_align?: "left" | "center" | "right";
  letter_spacing?: number;

  background_color?: string;           // solid bg, SHRINK-WRAPPED to glyphs
  background_border_radius?: number;   // corner radius (px) for the bg
  background_padding?: number | [number, number]; // bg padding px (or [x,y])
  text_shadow?: TextShadow | TextShadow[];  // per-glyph shadow(s)

  mask?: TextMask;                     // reveal mask
}

interface TextShadow {
  color: string;       // §3.4
  offset_x?: number;   // px, text-local frame. Default 0
  offset_y?: number;
  blur?: number;       // Gaussian softness px (0 = crisp). Default 0
  opacity?: number;    // 0..1, multiplies color alpha. Default 1
}
```

`text_shadow` is a **per-glyph** drop shadow (CSS `text-shadow`): each glyph
casts its own, so it tracks per-letter animation and overlapping glyphs —
unlike the silhouette `drop_shadow` effect (§4.7), which shadows the
flattened text as one shape. Pass an **array** for stacked shadows, painted
back-to-front (list farthest → nearest for a clean 3D extrusion). Shadows
are drawn behind every glyph (a two-pass render) so they never get clipped
by neighbouring letters. Works the same on `caption`. (Reach for the
`drop_shadow` effect instead when you want one soft shadow of the whole
text silhouette.)

`background_color` draws a solid background behind the text as **one band
per line**, each shrink-wrapped to that line's glyphs (line width × the
font ascent/descent box) — NOT the element's `width`/`height` box — so
centered or ragged multi-line text gets per-line pills, and it tracks
wrapping and `font_size: "auto"`. `background_border_radius` rounds each
band; `background_padding` (a number, or `[x, y]`) insets it outward. It
rotates, scales, and skews with the element. For a per-run highlight band
use a span `background` (§5.2.4); for a drop shadow use a `drop_shadow`
effect (§4.7). The same fields work on `caption` (one band around the
caption phrase).

#### 5.2.1. `text` content

`text` (or `spans`, §5.2.4) provides the content. If `spans` is present it
takes precedence over `text`. If neither is present the element renders
nothing (and runtimes MAY skip the element entirely).

#### 5.2.2. `font_size: "auto"`

When `font_size` is the string `"auto"`, the runtime MUST compute a
font size such that the rendered text fits inside the element's `width`.
The exact algorithm is implementation-defined but MUST be deterministic
for the same text + font + width inputs.

#### 5.2.3. Text mask

```ts
interface TextMask {
  type: "linear-wipe";
  angle?: number;                      // degrees, default -45
  progress?: number | Keyframe[];      // 0..1
  softness?: number;                   // 0..1, default 0.3
}
```

When present, the text is rendered into an offscreen surface and
multiplied by a linear-gradient alpha mask. `progress` controls the
reveal position; `softness` controls the wipe edge width.

#### 5.2.4. Spans

`spans` carries inline-styled runs. When present it takes precedence
over `text`. Runs lay out left-to-right; a span whose
`text` is exactly `"\n"` is a hard line break. Each span inherits the
element's `font_family` / `font_size` / `font_weight` / `fill_color` /
`letter_spacing` unless it overrides them.

```ts
interface TextSpan {
  text: string;
  font_family?: string;
  font_size?: number | string;
  font_weight?: number | string;
  font_style?: "normal" | "italic";
  fill_color?: string;
  letter_spacing?: number;             // px tracking; inherits element's
  background_color?: string;           // flat full-line-box band
  background?: TextSpanBackground;     // stylized band; overrides above
  nowrap?: boolean;                    // atomic for word-wrap
}
```

`letter_spacing` (element and span level) is pixels of tracking added
after EVERY character, including the last — Chrome's model, so boxes
measured in a browser reproduce exactly. `nowrap` marks the span atomic
for word-wrap (CSS `white-space: nowrap` semantics): the runtime never
breaks inside it. `background` draws a band behind the span's glyphs
(`color`, plus optional `height_ratio`, `inset_y_ratio`, `padding_x`,
`skew_x`, `border_radius` — see the schema for exact semantics).

### 5.3. `image` and `video`

```ts
interface ImageElement extends BaseElement {
  type: "image";
  source: string;                      // URL or path
  fit?: "cover" | "contain" | "fill" | "none";   // default "cover"
  border_radius?: number;              // corner radius px, default 0
  crop_x?: number;                     // source crop, normalized 0..1 (see §5.3.1)
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
}

interface VideoElement extends BaseElement {
  type: "video";
  source: string;
  fit?: "cover" | "contain" | "fill" | "none";   // default "cover"
  crop_x?: number;                     // source crop, normalized 0..1 (see §5.3.1)
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  volume?: number | Keyframe[];        // 0..100, default 100 (animatable)
  playback_rate?: number | Keyframe[]; // media seconds per timeline second, default 1
                                       //   (schema type; the runtime requires it static — §5.3.2)
  trim_start?: number;                 // seconds into the media, default 0
  trim_duration?: number;              // playable media window after trim_start
  loop?: boolean;
}
```

Asset reference rules are defined in §8.

#### 5.3.1. Object fit and source crop

`fit` follows CSS `object-fit` against the element box:

| Value | Behavior |
|---|---|
| `cover` (default) | scale media to fill the box; crop the overflow, centered |
| `contain` | scale media to fit inside the box; letterbox |
| `fill` | stretch media to the box exactly |
| `none` | natural media size, centered, cropped to the box |

**Source crop.** `crop_x` / `crop_y` / `crop_width` / `crop_height` select a normalized
sub-rectangle of the **source** media (each in `0..1`, origin top-left)
that is shown in place of the whole source. The default is the whole
source — `crop_x = 0, crop_y = 0, crop_width = 1, crop_height = 1` — and
omitting the fields is identical to that identity crop.

Crop applies BEFORE `fit`: the cropped sub-rectangle becomes the
effective media, and `fit` then maps it into the element box exactly as
in §5.3.1. The element box (its `x` / `y` / `width` / `height`) is
**unchanged** — crop only chooses which part of the source fills it, so
crop composes orthogonally with transform, `border_radius`, filters, and
3D. A runtime MUST clamp the rect to the unit square (`crop_width` to
`1 − crop_x`, `crop_height` to `1 − crop_y`); a zero-area crop is treated
as the identity.

Each component MAY be keyframed (§6.3). Animating the crop origin pans
across the source and animating its size zooms — a Ken Burns move with no
change to the element's layout.

#### 5.3.2. Media time mapping

The playable *trim window* is:

```
window_start  = max(0, trim_start)
window_length = min(trim_duration ?? ∞, media_duration − window_start)
```

The media time sampled at composition time `t` is:

```
consumed = max(0, t − element.time) × playback_rate
media_t  = window_start + (consumed mod window_length)     if loop
         = window_start + min(consumed, window_length − ε) otherwise
```

i.e. `loop` wraps WITHIN the trim window; without `loop` the last frame
holds. `playback_rate` MUST be a static number (keyframed rates are not
defined in CKP/1.0).

**Time remapping.** A video MAY carry `time_remap` — a keyframe array
(§6.3 semantics: destination-keyframe easing, element-local time) whose
VALUES are media times in seconds. When present, it REPLACES the
mapping above entirely (`trim_start`, `trim_duration`,
`playback_rate`, and `loop` are ignored):

```
media_t = clamp(interpolate(time_remap, t − element.time), 0, media_duration − ε)
```

Speed ramps are steep segments, freeze frames are flat ones, and
reverse playback follows decreasing values; easings shape the ramp.
Decoders quantize `media_t` to the media's own frames, which is
conformant (§2.1 motion-blur note applies the same way).

**Varispeed audio.** Audio under a warped clock — a video's embedded
track under `time_remap`, or any sound element inside a time-remapped
group (§5.8.3) — plays VARISPEED, tape-style: at each instant the
audio advances through the media at `rate(t) = d(media_t)/dt`, and
pitch shifts with the rate (2× plays an octave up, slow-motion plays
low). Flat segments (rate 0) are silent; decreasing segments play the
media REVERSED at `|rate|`. The reference implementation samples the
effective media-time function at 10 ms through the full warp chain,
splits it into monotonic runs, and schedules each run with a rate
curve (reversed runs play a sample-reversed copy of the buffer).
Pitch-preserving time-stretch is NOT defined in CKP/1.0. Fade
envelopes (`audio_fade_in`/`audio_fade_out`) are not applied under
warps in v1.

#### 5.3.3. Video audio

If the media container carries an audio track, conforming Level 3
runtimes MUST play/mix its FIRST audio track using the same timing as
§5.3.2, with gain `volume / 100`. `playback_rate` resamples the audio
(pitch shifts accordingly; time-stretch is not defined in CKP/1.0).
Videos without an audio track are silent — not an error.

#### 5.3.4. Audio fades

`audio_fade_in` / `audio_fade_out` (on both `audio` and `video`
elements, seconds, default 0) shape the gain over the element's
TIMELINE window `[0, L]`:

```
g(τ) = volume/100 × min(1, τ / fade_in) × min(1, (L − τ) / fade_out)
```

(each factor is 1 when its fade is 0). The envelope is piecewise linear
between its corner points; runtimes MUST reproduce it within normal
gain-ramp accuracy, including when playback starts mid-fade (seek).

### 5.4. `audio`

```ts
interface AudioElement extends BaseElement {
  type: "audio";
  source: string;
  volume?: number | Keyframe[];        // 0..100
  trim_start?: number;
  trim_duration?: number;
  loop?: boolean;
}
```

Audio elements have no visual representation. They contribute to the
mixed audio track produced by export-conformant runtimes (§10.3).
Preview-only runtimes MAY play them via `HTMLAudioElement` or similar.

### 5.5. `caption`

Word-timed captions with optional kinetic styling.

```ts
interface CaptionElement extends BaseElement {
  type: "caption";
  words: { text: string; start: number; end: number }[]; // start/end relative to element.time
  style?: "tiktok_bounce" | "fade_reveal" | "kinetic_typewriter" | "word_pop";
  // Windowing — how much of the transcript shows at once (§5.5.1). A whole
  // transcript otherwise renders as one block; with `max_length` set, the words
  // are split into chunks and only the chunk active at the current time shows.
  max_length?: number | "auto";          // number = max LETTERS per chunk;
                                          // "auto" = a few words per chunk;
                                          // absent = show all at once.

  // Text-like styling
  font_family?: string;
  font_size?: number | string;         // "auto" fits joined words to width
  font_weight?: number | string;
  fill_color?: string;
  highlight_color?: string;
  highlight_background_color?: string;
  text_align?: "left" | "center" | "right";
}
```

`words[*].start` and `words[*].end` are seconds RELATIVE to the
element's `time`. The exact kinetic behavior for each `style` is
defined by the reference implementation; deviations MAY occur in third-
party renderers but the timing MUST match.

#### 5.5.1. Windowing (`max_length`)

A full transcript on one element would render as a single unreadable block.
`max_length` splits `words` into CHUNKS; at any time only the chunk active then
is shown (within the element's box, wrapped). Chunking:

- **number** — grow a chunk word-by-word until adding the next word would exceed
  this many LETTERS (characters), then start a new chunk.
- **`"auto"`** — chunk by a few words (and break on pauses) — the speech default.
- **absent** — no windowing; the whole transcript shows at once.

The active chunk at element-local time `t` is the last chunk whose first word has
started (so a chunk lingers through silent gaps until the next begins). Word
kinetics (`style`) apply WITHIN the active chunk. Word `start`/`end` are
unchanged — `max_length` is a display rule, not a re-timing.

### 5.6. `shape` paths (vector geometry)

A `shape` (§5.1) that carries `paths` renders as arbitrary vector geometry —
a restricted SVG-path subset (this absorbs the former standalone `svg`
element). Conforming runtimes MUST support viewBox-scaled paths with linear
gradients, clip-to-path, stroke-dashoffset progress, and per-path opacity.

The path-form fields live on `ShapeElement` (§5.1): `view_box`, `gradients`,
and `paths`. Their element types:

```ts
interface PathGradient {
  id: string;
  type: "linear";
  x1: number; y1: number; x2: number; y2: number;  // viewBox coords
  stops: GradientStop[];
}

interface PathDef {
  d: string | Keyframe[];               // SVG path data, or d-string keyframes (§5.6.2)
  fill?: string;                        // hex or "url(#gradient-id)"
  stroke?: string;
  stroke_width?: number;
  stroke_progress?: number | Keyframe[]; // 0..1
  trim_start?: number | Keyframe[];      // §5.6.1
  trim_end?: number | Keyframe[];
  trim_offset?: number | Keyframe[];
  clip_path?: string;                   // another path that clips this one
  stroke_linecap?: "butt" | "round" | "square";
  stroke_linejoin?: "miter" | "round" | "bevel";
  opacity?: number;                     // 0..1
}
```

`stroke_progress` MUST drive the standard `stroke-dasharray` /
`stroke-dashoffset` reveal — a `progress` of `0` shows no stroke; `1`
shows the entire stroke. Implementations MUST measure path length
deterministically (the reference implementation uses
`SVGPathElement.getTotalLength()`).

#### 5.6.1. Trim paths

Each path MAY carry a trim window: only the stroke between
`trim_start` and `trim_end` — fractions of the path's TOTAL LENGTH,
0..1 — is drawn. `trim_offset` rotates the window around the path,
WRAPPING at the ends (an offset of 1 is a full lap), so an animated
offset is the classic traveling-dash "snake" and an animated
`trim_end` is the draw-on reveal. All three are animatable;
`stroke_progress` remains as sugar for `[0, progress]` and is ignored
when any trim field is present. Fill is unaffected — trimming applies
to the STROKE only.

Reference evaluation: with window width `w = clamp(trim_end, 0, 1) −
clamp(trim_start, 0, 1)` (nothing draws when w ≤ 0; the full stroke
when w ≥ 1) and wrapped anchor `a = (trim_start + trim_offset) mod 1`,
the stroke uses a dash pattern of `[w·L, L − w·L]` with dash offset
`−a·L`, where `L` is the path's total length — the pattern's period
equals `L`, so windows crossing the path's start wrap exactly.

#### 5.6.2. Path morphing

A path's `d` MAY be a keyframe array whose values are d-strings.
Between two keyframes the path MORPHS when the pair is COMPATIBLE —
identical command-letter sequences, equal numeric-argument counts, and
no arc commands (`A`/`a`, whose boolean flags cannot interpolate):
every numeric argument interpolates with the destination keyframe's
easing. An INCOMPATIBLE pair SNAPS: the source value holds until the
destination keyframe's time. No path normalization is performed — the
protocol stays literal; authors export morph targets with matching
command structure (the standard practice).

### 5.7. `particles`

A deterministic particle system with two modes: ballistic emission
and target-point convergence.

```ts
interface ParticlesElement extends BaseElement {
  type: "particles";
  // Common
  size?: number;                       // pixels, default 12
  size_variation?: number;             // 0..1, default 0.4
  particle_shape?: "square" | "circle";
  color?: string | string[];           // array randomizes per particle
  rotation_speed?: number;             // deg/s
  lifetime?: number;                   // seconds per particle, default 1.5
  fade_at?: number;                    // 0..1 fraction of lifetime where fade begins, default 0.7

  // Ballistic emission
  rate?: number;                       // particles per second
  velocity?: number;                   // initial speed px/s
  spread?: number;                     // cone in degrees, default 360
  direction?: number;                  // 0=right, 90=down, -90=up
  gravity?: number;                    // px/s², positive=down

  // Depth (CKP/1.0, §5.7.3)
  z_velocity?: number;                 // px/s along the plane normal, default 0
  z_spread?: number;                   // uniform vz range width px/s, default 0

  // Burst (used by both modes)
  burst?: boolean;
  burst_count?: number;

  // Convergence (set target_points to enter convergence mode)
  target_points?: [number, number][];  // canvas-space targets
  convergence_easing?: EasingFunction;
  scatter_radius?: number;             // disk radius around emitter
}
```

#### 5.7.1. Determinism

Every particle's position, rotation, size, and color MUST be a pure
function of `(element.id, particle_index, age)`. This means a runtime
that seeks to time T MUST produce the same composition as a runtime
that played continuously to T. The reference implementation seeds a
PRNG with a hash of `element.id` and the particle index; third-party
runtimes MAY use any algorithm that produces the same output as the
reference.

#### 5.7.2. Convergence mode

When `target_points` is present and non-empty:

- Each particle `n` is assigned the target `target_points[n % length]`.
- Each particle's start position is randomly placed within a disk of
  radius `scatter_radius` (default = `max(canvas_width, canvas_height)`)
  centered on `(x, y)`.
- The particle's position is `lerp(start, target, easing(age/lifetime))`
  using `convergence_easing` (default `"ease-out-quart"`).

#### 5.7.3. Depth (CKP/1.0)

Per particle, `vz = z_velocity + (r − 0.5) × z_spread` with `r` the
particle's uniform random draw, and its depth offset is `vz × age` px
along the emitter plane's normal (+z toward the viewer, §4.4). The
offset applies in BOTH modes (it is orthogonal to the in-plane
position) and is part of the §5.7.1 determinism contract. There is no
z gravity — `gravity` stays in-plane y. Like the `z` field (§4.4.2),
depth has no visual effect without perspective in the chain, and
particles draw in spawn order, never depth-sorted among themselves —
the §4.4.3 camera sort orders whole elements, not a particle system's
internal quads. With both fields absent or 0 the simulation is
exactly the 2D one.

### 5.8. `group`

```ts
interface GroupElement extends BaseElement {
  type: "group";
  elements: Element[];
  clip?: boolean;            // default false
  mask?: {
    mode: "alpha" | "alpha-inverted" | "luma" | "luma-inverted";
    elements: Element[];
  };
}
```

A positioned container. Children's `x`/`y` are coordinates in the
group's LOCAL space, origin at the group's top-left box corner; a
child's `time` is relative to the group's start; child `layer` and `z`
order locally (§4.2). The group's transform (§4.4) and
opacity stack multiplicatively onto children. Percentage/viewport units
inside a group still resolve against the COMPOSITION canvas.

#### 5.8.1. Clipping

With `clip: true` (requires explicit `width` and `height`), children
render into an offscreen layer the size of the group's box; pixels
outside the box are discarded (CSS `overflow: hidden`). The group's
own transform and opacity apply to the composited layer as a whole —
opacity therefore applies ONCE to the flattened layer (overlapping
semi-transparent children do not double-blend).

`border_radius` (px) rounds the clip box: children are masked to a
rounded rectangle, matching a rounded card that clips its content (CSS
`overflow: hidden` + `border-radius`). It is clamped to half the
smaller box dimension and is ignored on an unclipped group. (Rounded
clipping currently applies to the plain `clip` path; a `mask` group
ignores `border_radius` since the mask layer already defines coverage.)

#### 5.8.2. Masks

The mask belongs to the group it masks — declared on the masked
element, never inferred from siblings or layer adjacency. Mask
`elements` render into a second box-sized layer using the same local
coordinate space and timing rules as children, and may animate.
The content layer composites through the mask layer per pixel:

```
factor = mask.alpha              (alpha)
       = 1 − mask.alpha          (alpha-inverted)
       = luminance(mask.rgb)     (luma; Rec. 709 weights 0.2126/0.7152/0.0722,
                                  computed on premultiplied values)
       = 1 − luminance(mask.rgb) (luma-inverted)
output = content × factor
```

`mask` requires explicit `width`/`height` and implies clipping (both
layers are box-sized).

#### 5.8.3. Group time remapping

A group MAY carry `time_remap` — a keyframe array (§6.3 semantics)
whose VALUES are warped local times in seconds. The group's SUBTREE
runs on the warped clock:

```
local  = t − group_start
warped = max(0, interpolate(time_remap, local))
```

Children evaluate exactly as if the group's local time were `warped`:
their `time` windows, animations, keyframes, transitions, and nested
media all read the warped clock. Nested remapped groups compose (each
warps its parent's clock in turn). The group's OWN animated properties
(opacity, rotation, scale, position) read REAL time — the container
moves on the composition's clock; only its contents are warped.

Flat segments freeze the subtree, steep segments speed-ramp it, and
decreasing values run it backwards. Nested video decodes the frame at
its warped media time (through §5.3.2's mapping). Audio inside a
remapped subtree follows the varispeed rule (§5.3.2).

### 5.9. No nested-composition element

CKP deliberately has NO `composition` (pre-comp) element. Both things a
pre-comp bundles are covered by orthogonal features on plain elements:

- **Reuse** is an authoring-time concern: template functions expand into
  plain elements before the Source is serialized (see `@clipkit/patterns`
  for the first-party library). The wire format stays fully decomposed —
  a runtime never resolves references or instantiates templates.
- **Nested timing** is `time_remap` on a plain `group` (§5.8.3).

A Source containing `type: "composition"` is invalid under CKP/1.0.

---

## 6. Animation

Every animatable property may be driven in three ways: a static value,
a named-preset animation, or a keyframe animation. These compose with
the precedence:

```
keyframe_animation > named_animation > static_value
```

That is, if both a keyframe animation and a named animation target the
same property at the same time, the keyframe wins.

### 6.1. Static values

The value as written in JSON. No interpolation; the value is used as-is
for the entire duration the element is active.

### 6.2. Named animations

```ts
interface Animation {
  type: AnimationType;
  duration?: number;                   // seconds; defaults in §6.2.1
  easing?: Easing;                     // default "ease-out" unless noted
  time?: "start" | "end" | number;     // start, relative to element.time

  // Parameters read by specific types (ignored otherwise):
  frequency?: number;                  // Hz — shake (8), wiggle (2), text-wave (1.5)
  rotation?: number;                   // degrees — spin (360), wiggle amplitude (8),
                                       //           text-flip start angle (90)
  distance?: number;                   // px — pan/shift (200), shake (24),
                                       //      text-slide (40), text-fly (140), text-wave (12)
  direction?: "left" | "right" | "up" | "down";  // pan/shift/text-slide/text-fly
  scale?: number;                      // squash depth 0..1 (0.3)
  split?: "letter" | "word";           // text-* unit granularity (§6.5)
  stagger?: number;                    // text-* seconds between units (§6.5)
  axis?: "x" | "y" | "z";              // text-flip rotation axis (§6.5, CKP/1.0)
}
```

`time: "start"` (or absent) resolves to local time `0`; `"end"` to
`element_duration − duration`; a number is local seconds.

Normative tween recipes (deltas apply to the listed property; *relative*
adds to the static value, *absolute* replaces it during the window):

| Type | Property | From → To | Mode | Notes |
|---|---|---|---|---|
| `fade-in` / `fade-out` | opacity | 0→1 / 1→0 | absolute | |
| `slide-left-in` | x | −200→0 | relative | starts left, moves right into place |
| `slide-right-in` | x | +200→0 | relative | |
| `slide-up-in` | y | +200→0 | relative | starts below, rises |
| `slide-down-in` | y | −200→0 | relative | |
| `slide-*-out` | x/y | 0→±200 | relative | motion direction matches the name |
| `scale-in` / `scale-out` | scale | 0→1 / 1→0 | absolute | |
| `rotate-in` / `rotate-out` | rotation | −90→0 / 0→+90 | relative | |
| `bounce-in` / `bounce-out` | scale | 0→1 / 1→0 | absolute | default easing `ease-out-back` / `ease-in-back` |
| `spin` | rotation | 0→`rotation` | relative | default easing `linear` |
| `shake` | x | oscillation, amplitude `distance`→0 | relative | `sin(2π·frequency·t)` × eased envelope |
| `wiggle` | rotation | oscillation, constant amplitude `rotation` | relative | same formula |
| `squash` | y_scale, x_scale | 1→1−`scale`→1; 1→1+0.6·`scale`→1 | absolute | two half-duration phases; in `ease-in-quad`, out `ease-out-back` |
| `pan` | x or y | −`distance`/2→+`distance`/2 along `direction` | relative | drifts through rest position; default easing `linear` |
| `shift` | x or y | 0→`distance` along `direction` | relative | **fill-forward**: the end value holds for the rest of the element's life |
| `drift` | x, y | smooth random walk, amplitude `distance` (30) | relative | offsets = `(noise1d(frequency·t, seed) − 0.5) × 2 × distance` per axis (y uses `seed + 7919`); `frequency` default 0.5, `seed` default 0 |
| `breathe` | scale | oscillation, amplitude `scale` (0.05) | relative | `scale × sin(2π·frequency·t)`, `frequency` default 0.4 |
| `orbit` | x, y | circle of radius `distance` (40) | relative | `x += r·sin(2πft + π/2)`, `y += ±r·sin(2πft)` (`direction: "left"` flips y = counter-clockwise); `frequency` default 0.5 rev/s |
| `text-*` | per-unit | — | — | §6.5 |

`drift`'s noise is NORMATIVE — the 1D form of §4.7's lattice noise:
`noise1d(x, seed)` is the quintic-faded linear interpolation between
`h(⌊x⌋)` and `h(⌊x⌋+1)` where `h(i) = pcg(i XOR pcg(seed)) / (2³²−1)`
and `pcg` is §4.7's hash. Same seed → identical motion everywhere.

#### 6.2.1. Duration defaults

`duration` defaults to `0.5`, EXCEPT `spin`, `shake`, `wiggle`, `pan`,
`drift`, `breathe`, `orbit` and `text-wave`, which default to the
element's full duration when both `time` and `duration` are omitted
(they read as "for the element's life"). Outside its window a tween stops contributing (the property
returns to its static value), except `shift`'s documented fill-forward.

### 6.3. Keyframe animations

```ts
interface KeyframeAnimation {
  property: string;                    // name of the BaseElement field
  loop?: boolean | "ping-pong";        // repeat the pattern (see below)
  keyframes: Keyframe[];               // monotonically increasing times
  easing?: EasingFunction;             // default per-keyframe
}
```

For times before the first keyframe, the value is clamped to the first
keyframe's value. After the last keyframe, clamped to the last value.
Between keyframes `i` and `i+1`, the value is interpolated using the
easing on keyframe `i+1` (or the animation's `easing` if not specified
per-keyframe). A single-keyframe track is a constant.

#### 6.3.1. Color keyframes

When EVERY keyframe `value` in a track parses as a color (§3.4 — `#…`,
`rgb(…)`, `rgba(…)`), the track is a *color track*: values interpolate
componentwise in straight-alpha RGB space (alpha included), using the
same easing rules. Color tracks are honored on `fill_color` (shape and
plain text) and `stroke_color` (shape). Unparseable colors fall back to
opaque white anywhere colors are parsed.

With `loop`, local time folds before interpolation: `true` wraps —
`t' = t mod span` — and `"ping-pong"` reflects — `t' = span − |((t mod
2·span)) − span|` — where `span` is the LAST keyframe's `time`. The
pattern repeats for the element's whole life; without `loop`, time
past the last keyframe holds the final value (unchanged default).
Looping applies to scalar, color, and `position` keyframe animations.

### 6.4. Easing functions

CKP/1.0 defines 36 named easing functions plus two parametric forms.
Mathematical definitions are in the reference implementation
(`packages/runtime/src/animation/easings.ts`); the polynomial/sine/expo/
circ/back families follow easings.net.

```
linear

ease, ease-in, ease-out, ease-in-out
ease-in-cubic,  ease-out-cubic,  ease-in-out-cubic
ease-in-quad,   ease-out-quad,   ease-in-out-quad
ease-in-quart,  ease-out-quart,  ease-in-out-quart
ease-in-quint,  ease-out-quint,  ease-in-out-quint
ease-in-sine,   ease-out-sine,   ease-in-out-sine
ease-in-expo,   ease-out-expo,   ease-in-out-expo
ease-in-circ,   ease-out-circ,   ease-in-out-circ
ease-in-back,   ease-out-back,   ease-in-out-back

elastic-in, elastic-out, elastic-in-out     (decaying sinusoidal overshoot)
bounce-in,  bounce-out,  bounce-in-out      (piecewise-parabolic ball drop)

spring         (damped harmonic oscillator: mass=1, damping=10, stiffness=100;
                ~5% overshoot then settles. Remotion's signature feel.)
```

Parametric forms (string-valued):

- `cubic-bezier(x1, y1, x2, y2)` — CSS timing-function semantics;
  `x1`/`x2` MUST be clamped to `[0, 1]`, `y1`/`y2` are unbounded.
- `steps(n)` — `n` equidistant steps, jump-at-end (CSS `steps(n, end)`).

Unknown easing names MUST fall back to `linear` (never error). Output
MUST match the reference within ±0.001 at any input value in `[0, 1]`.

### 6.5. Per-unit text animations

The `text-*` animation types apply to `text` elements only (ignored on
other element types; `caption` elements have their own kinetic system).
The text splits into *units* and each unit runs the same animation,
offset in time by `stagger` seconds per unit index.

**Unit indexing.** Letter index counts drawn glyphs (whitespace
excluded); word index counts whitespace-separated runs. Both run
continuously across spans and line breaks. Unit `u` starts at
`time + u × stagger`.

**Defaults.** `split`: `"word"` for `text-appear`/`text-slide`/
`text-fly`, `"letter"` for `text-typewriter`/`text-wave`/`text-flip`.
`stagger`: `0.09` for word splits, `0.035` for letter splits.
Per-unit `duration` default `0.5`.

| Type | Per-unit effect | Defaults |
|---|---|---|
| `text-appear` | opacity 0→1 over `duration` | easing `ease-out-cubic` |
| `text-slide` | opacity 0→1 + displaced `distance` px opposite `direction`, settling at rest | `distance` 40, `direction` up, easing `ease-out-cubic` |
| `text-fly` | as `text-slide`, farther | `distance` 140, easing `ease-out-back` |
| `text-typewriter` | opacity steps 0→1 at the unit's start time | no fade |
| `text-wave` | y offset `distance × sin(2π·frequency·t − 0.6·u)` | `distance` 12, `frequency` 1.5; full-length default (§6.2.1) |
| `text-flip` | opacity 0→1 + 3D rotation `rotation × (1−eased)` degrees about `axis` through the unit's center, settling flat (CKP/1.0) | `rotation` 90, `axis` `"x"`, easing `ease-out-cubic` |

Per-unit effects fold into the glyph's tint (opacity) and an
element-local offset applied BEFORE the element transform (§4.4), so
kinetic type composes with scale/skew/rotation.

**`text-flip` semantics (CKP/1.0).** The rotation pivot is the unit's
rest-layout center — the glyph cell's center for letter splits, the
word's glyph bounding-box center for word splits — translated by the
unit's current per-unit offset, so a unit sliding and flipping stays
rigid. A word split rotates the word as ONE slab (its glyphs never
splay). When multiple `text-flip` animations target an element, word
rotations compose OUTSIDE letter rotations. Axis `"x"` flips up
(rotation about the horizontal axis), `"y"` swings in, `"z"` spins
in-plane. Like all 3D (§4.4.2), the depth component is orthographic
without a `camera`; the foreshortening is `cos θ` exactly. An active
`text-flip` puts the text element on the full-matrix path; elements
without one are unaffected (§4.4.3 cost rules).

CKP/1.0 defines text animations as entrances only: `time: "end"` on a
`text-*` animation MUST be ignored.

### 6.6. Transitions (non-feature)

CKP/1.0 deliberately defines NO transition primitive — every transition
decomposes into existing primitives, and the document is exactly what
renders:

- **Crossfades, pushes, zoom swaps** — two overlapping elements with
  paired animations (AGENTS.md §"Transitions").
- **Wipes (circular, linear, stripe, soft-edged)** — the incoming slide
  inside a masked group (§5.8.2) whose mask elements animate: a growing
  ellipse, a sweeping rectangle, a luma gradient band (AGENTS.md
  §"Wipes").

An earlier draft reserved a first-class two-layer transition object for
wipes; group masks made it unnecessary and it is no longer planned.

### 6.7. Spatial motion paths

A `keyframe_animations` entry with `property: "position"` moves the
element along a path; it overrides the element's `x` and `y` (and
any scalar `x`/`y` keyframe animations). Keyframe `value`s are
`[x, y]` pairs in canvas pixels — or `[x, y, z]` triples for a 3D
path (z in pixels, +z toward the viewer, §4.4). A 3D path
additionally overrides the element's `z` (and any scalar `z`
keyframe animations); a 2D path leaves `z` untouched. All keyframes
of one position path MUST agree in dimensionality — mixing `[x, y]`
and `[x, y, z]` in one animation is a validation error (no silent
z = 0 promotion).

```json
{ "property": "position", "auto_orient": true, "keyframes": [
    { "time": 0, "value": [200, 800], "out_tangent": [240, -300] },
    { "time": 2, "value": [1700, 300], "in_tangent": [-200, -120],
      "easing": "ease-in-out" }
] }
```

Each consecutive keyframe pair is one CUBIC BEZIER segment with
control points

```
P0 = a.value                 P3 = b.value
P1 = P0 + a.out_tangent      P2 = P3 + b.in_tangent
```

where an omitted tangent defaults to the straight-line third-point
(`P1 = P0 + (P3−P0)/3`, `P2 = P3 − (P3−P0)/3`) — a path with no
handles is exact polyline motion. On a 3D path, tangents are
`[dx, dy]` or `[dx, dy, dz]`; a 2-component tangent's `dz` defaults
to the straight-line third-point in z (the omitted-handle rule,
applied per axis). 3-component tangents on a 2D path are a
validation error.

Travel is ARC-LENGTH parameterized (NORMATIVE): the destination
keyframe's easing maps segment-local time to a fraction `u` of the
segment's length; the bezier parameter is found on a 64-chord
cumulative-length table (curve sampled at `t = i/64`, `i = 0…64`;
linear interpolation between chords). With linear easing the element
travels at constant speed however the handles stretch the curve's
parameterization. On a 3D path the chord lengths are measured on the
3D curve — constant speed means constant speed through depth too.
Before the first keyframe the element holds the first point; after
the last, the last point.

`auto_orient: true` adds the path's travel direction —
`atan2(dy, dx)` of the bezier derivative at the sampled parameter, in
degrees — to the element's own `rotation`. Orientation is STRICTLY
IN-PLANE: on a 3D path the tangent's xy projection is used and `dz`
is ignored — auto_orient never derives `x_rotation` or `y_rotation`
(a path does not tilt the element's plane). A zero xy derivative
(z-only travel or coincident control points) falls back to the
segment chord's xy projection. Position values are numbers (pixels);
length strings are not valid inside path keyframes.

Like the `z` field itself (§4.4.2), path z has no visual effect
without perspective somewhere in the chain — under no camera the
element renders at the path's xy projection.

---

## 7. Time, duration, sequencing

### 7.1. Element activity windows

An element is *active* at composition time `t` if:

```
start <= t <= start + duration
```

where:

- `start = element.time` (default `0`).
- `duration = element.duration` if numeric, else the composition's
  remaining time if `"auto"` or `"end"`.

Inactive elements MUST NOT be rendered.

### 7.2. Local time

Many properties (keyframes, named-animation timing, particle simulation)
operate in *local time* — seconds elapsed since the element
became active. Local time `0` corresponds to composition time
`element.time`.

For animation evaluation, local time MUST be clamped to the element's
duration:

```
local_t = min(t − element.time, element_duration)
```

Rationale: the activity check (§7.1) computes the element's end as
`time + duration` while local time computes `t − time`; at exact frame
boundaries these two float roundings can disagree by ~1 ulp, leaving an
element active at a local time fractionally PAST its duration — which
would skip every end-anchored animation for one frame and flash the
static value. The clamp makes the boundary frame well-defined.

### 7.3. The composition duration

If `Source.duration` is `"auto"`, the composition's effective duration
is the maximum end time across all elements. Otherwise, it is the
declared value.

Runtimes MUST produce frames from composition time `0` to `duration`
inclusive of `0`, exclusive of `duration`. At 30 fps and `duration: 5`
this produces 150 frames at times `0, 1/30, 2/30, ..., 149/30`.

---

## 8. Asset references

Asset-bearing elements (`image`, `video`, `audio`) carry a `source`
string identifying the asset. The protocol does not embed binaries.

### 8.1. Allowed schemes

Conforming runtimes MUST attempt to resolve:

- `https://` URLs
- `http://` URLs (MAY require user opt-in for mixed content)

Conforming runtimes MAY additionally support:

- `file://` URLs (local file references)
- Absolute paths (`/path/to/file`)
- Relative paths (`./asset.png`) — resolved against an
  implementation-defined base
- `data:` URIs

Runtimes MUST fail with a clear error when a `source` cannot be
resolved. They MUST NOT silently substitute a placeholder.

### 8.2. Preloading

Runtimes SHOULD provide a `preload` step that resolves all asset
references before rendering begins. This is REQUIRED for export
conformance (§10.3) — exports cannot tolerate runtime asset failures.

---

## 9. Output and rendering

### 9.1. Determinism

Given identical `(Source, time)` inputs, every conforming runtime MUST
produce visually equivalent frames. "Visually equivalent" means:

- Same element positions, sizes, rotations, opacities to within ±0.5 px.
- Same animation values to within ±0.001 for normalized properties.
- Same particle state (positions, alphas, sizes) to within ±0.5 px /
  ±0.001 alpha.
- Color output MAY differ by up to ~1/255 per channel due to
  rasterization backends. Pixel-exact equivalence is NOT REQUIRED.

### 9.2. Frame timing

A runtime asked to produce frame `f` of a composition with `frame_rate`
FPS MUST render the scene state at composition time:

```
t = f / frame_rate
```

`f = 0` is the first frame.

### 9.3. Output formats

| Format | Behavior |
|---|---|
| `mp4` | Encoded video. H.264 baseline + AAC audio is the recommended baseline. Higher profiles MAY be used. |
| `gif` | Animated GIF. Audio is silently dropped. |

Runtimes MAY support output formats beyond these.

---

## 10. Conformance levels

CKP defines three nested conformance levels. An implementation MAY claim
any level it actually supports.

### 10.1. Level 1 — Validation

The implementation MUST be able to parse a Source JSON object and
report whether it is a valid CKP/1.0 document. Specifically:

- Accept any valid document per §2–8.
- Reject documents with invalid `type` discriminators on required
  fields, missing REQUIRED fields, or out-of-range values.
- Tolerate unknown additional fields (forward compatibility, §2.2).

The `@clipkit/protocol` package provides Level 1 validation as a
reference.

### 10.2. Level 2 — Rendering

The implementation MUST also be able to produce frame images from a
valid Source. Specifically:

- All element types (§5) MUST render.
- All animations (§6) MUST animate.
- Output MUST satisfy the determinism requirements (§9.1).

A Level 2 implementation MUST NOT silently skip element types unless
the document is at a higher protocol version than the implementation
supports.

### 10.3. Level 3 — Export

The implementation MUST also be able to produce encoded output:
typically MP4 with mixed audio.

- All Level 2 requirements.
- Audio elements (§5.4) MUST be mixed into the output track.
- Output duration MUST match `Source.duration` precisely (frame-accurate).

The reference runtime `@clipkit/runtime` is a Level 3 implementation: it
sums all sources to the master bus, then applies a fixed peak limiter
(transparent below 0 dBFS) so a hot mix is contained rather than
hard-clipped. The same limiter runs in preview, so what you hear matches
the render. The exact mix algorithm otherwise remains
implementation-defined (§1).

---

## 11. Versioning and extensions

### 11.1. The `clipkit_version` field

Documents SHOULD declare their protocol version:

```json
{ "clipkit_version": "1.0", "elements": [...] }
```

Absence is interpreted as `"1.0"` for the lifetime of CKP/1.x.

### 11.2. Version compatibility

Versions follow `MAJOR.MINOR` (semver-style without patch):

- **Same MINOR**: runtimes MUST render documents at the same minor
  version with no warning.
- **Higher MINOR**: runtimes MUST attempt to render. They SHOULD warn
  that unknown fields may be ignored.
- **Higher MAJOR**: runtimes MUST refuse to render and report the
  version mismatch. Major versions indicate breaking changes.
- **Lower MAJOR**: runtimes MUST render if they implement the older
  major version. Backward compatibility within a major line is
  permanent.

### 11.3. Adding fields

Any minor version MAY add fields to existing element types. Unknown
fields in older runtimes pass through harmlessly per §2.2.

### 11.4. Adding element types

Any minor version MAY add new element types. Runtimes that do not
recognize a new `type` MAY skip the element with a warning.

### 11.5. Breaking changes

Removing fields, changing field types, or changing the meaning of an
existing field requires a major-version bump.

### 11.6. Extension namespace

Implementations and tools MAY include vendor-specific fields prefixed
with `x_`. The protocol reserves bare names; `x_` names are
implementation-defined and ignored by other implementations. Names
the protocol itself defines (e.g. `x_scale`, `x_skew`, `x_rotation`)
are bare protocol names, not extensions, regardless of prefix.

### 11.7. Version history

| Version | Additions |
|---|---|
| 1.0 | Initial protocol, including the 3D transform model (§4.4): `x_rotation` / `y_rotation` / `z_rotation` (alias of `rotation`) / `z` on every element; Source-level `camera`; paint-order + flattening compositing rules (§4.4.3); glass under 3D via the pane-plane homography (§4.7); 3D motion paths (`[x, y, z]` position keyframes, §6.7); `text-flip` per-unit 3D reveals (§6.5); particle depth (`z_velocity` / `z_spread`, §5.7.3). These are opt-in and additive — documents that use none of them render the same as a pure-2D source. |

---

## 12. Implementation notes (non-normative)

These notes are advisory. They reflect lessons from the reference
implementation and MAY help third-party implementers avoid pitfalls.

### 12.1. Premultiplied alpha

All blending in the reference runtime uses premultiplied alpha:
textures are uploaded premultiplied, shaders output premultiplied
values, and the canvas swap-chain is configured with
`alphaMode: "premultiplied"`. This avoids the "dark halo" artifacts
that appear with straight-alpha blending. Third-party runtimes are
free to use any blending convention internally as long as final output
matches §9.1.

### 12.2. Corner radii on non-square rectangles

If you implement rounded rectangles with a signed-distance function
in shaders, the SDF MUST operate in pixel space, not in normalized UV
space. UV space is anisotropic for non-square rectangles, so doing the
corner math in UV stretches the arc into an ellipse. Pass the
rectangle's `(width, height)` to the shader and convert
`uv * size` before the SDF.

### 12.3. Font atlases

The reference runtime generates a glyph atlas per (family, size,
weight). It covers ASCII (0x20–0x7E) only; characters outside this
range are silently dropped. Third-party implementations MAY support
larger glyph ranges; documents SHOULD avoid relying on non-ASCII text
in v1.0 unless the target runtime is known to support it.

### 12.4. Particle PRNG

The reference runtime uses a `mulberry32` PRNG seeded by
`FNV-1a(element.id) + n * 0x9e3779b9`. Third-party runtimes are NOT
required to match this exact PRNG, only the *outputs* implied by §5.7.1.

---

## Appendix A: Reference implementation map

| Spec section | Reference implementation |
|---|---|
| §2 Source | `packages/protocol/src/types.ts` (Source) + `zod.ts` (sourceSchema) |
| §3 Units | `packages/runtime/src/compositor/unit.ts` |
| §4 Element model | `packages/protocol/src/types.ts` (BaseElement) |
| §5.1 shape | `packages/runtime/src/compositor/element-renderers/shape.ts` |
| §5.2 text | `packages/runtime/src/compositor/element-renderers/text.ts` |
| §5.3–5.4 video/image/audio | `packages/runtime/src/{compositor/element-renderers,audio}/` |
| §5.5 caption | `packages/runtime/src/compositor/element-renderers/caption.ts` |
| §5.6 shape paths | `packages/runtime/src/svg/svg-renderer.ts` |
| §5.7 particles | `packages/runtime/src/compositor/element-renderers/particles.ts` |
| §6 Animation | `packages/runtime/src/animation/` |
| §10 Conformance | `packages/protocol/src/validate.ts` |

## Appendix B: Document history

- *2026-05-28* — CKP/1.0 draft. Initial publication alongside the
  reference runtime.
