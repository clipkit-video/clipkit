# @clipkit/protocol

The canonical implementation of the [Clipkit Protocol](../../PROTOCOL.md). Conforming runtimes target this package: it exports the Zod schemas every implementation validates against, the TypeScript types every consumer reads, and the defaults for every element kind. Runtime validation here is the trust boundary between AI-generated JSON and the rest of the system.

## Install

```ts
import {
  validate,
  type Source,
  type Element,
  applyDefaults,
} from '@clipkit/protocol';
```

## Source structure

```ts
{
  output_format?: 'mp4' | 'gif' | 'jpg' | 'png',  // default 'mp4'
  width?: number,                                   // pixels, default 1920
  height?: number,                                  // pixels, default 1080
  duration?: number | 'auto',                       // seconds, default 'auto'
  frame_rate?: number,                              // fps, default 30
  background_color?: string,
  elements: Element[],
}
```

## Element types

Every element has a `type` discriminator plus the base properties shared across all types: `id`, `name`, `track`, `time`, `duration`, `x`, `y`, `x_anchor`, `y_anchor`, `width`, `height`, `rotation`, `scale`, `opacity`, `animations`, `keyframe_animations`.

Numeric properties may also accept a `Keyframe[]` array for time-driven values.

### `video`

```ts
{ type: 'video', source: string, volume?, playback_rate?, trim_start?, trim_duration?, loop? }
```

### `image`

```ts
{ type: 'image', source: string, fit?: 'cover' | 'contain' | 'fill' | 'none', brightness?, contrast?, saturation?, blur? }
```

### `text`

```ts
{
  type: 'text',
  text: string,
  font_family?, font_size?, font_weight?, font_style?,
  fill_color?, stroke_color?, stroke_width?,
  text_align?, vertical_align?, y_alignment?,
  line_height?, letter_spacing?,
  background_color?, background_border_radius?,
  shadow_color?, shadow_x?, shadow_y?, shadow_blur?,
}
```

### `shape`

```ts
{
  type: 'shape',
  shape?: 'rectangle' | 'ellipse' | 'triangle' | 'polygon',
  path?: string,        // SVG path (overrides `shape`)
  fill_color?, stroke_color?, stroke_width?, border_radius?,
  sides?,               // polygon only
}
```

### `audio`

```ts
{ type: 'audio', source: string, volume?, trim_start?, trim_duration?, loop? }
```

### `caption` *(Clipkit extension)*

Word-timed captions with kinetic styles.

```ts
{
  type: 'caption',
  words: [
    { text: 'Hello', start: 0.0, end: 0.4 },
    { text: 'world', start: 0.4, end: 0.9 },
  ],
  style?: 'tiktok_bounce' | 'fade_reveal' | 'kinetic_typewriter' | 'word_pop',
  // ...all text styling properties (font_family, fill_color, etc.)
  highlight_color?: string,             // active word color
  highlight_background_color?: string,  // active word background
}
```

`words[].start` and `words[].end` are seconds, relative to the caption element's `time`.

## Animations

Two parallel systems:

**Named animations** (`animations: Animation[]`) — preset entrance/exit motions.

```ts
{ type: 'fade-in' | 'slide-up-in' | 'scale-out' | ..., duration?, easing?, time?: 'start' | 'end' | number }
```

The full list of types: `fade-in`, `fade-out`, `slide-left-in`, `slide-right-in`, `slide-up-in`, `slide-down-in`, `slide-left-out`, `slide-right-out`, `slide-up-out`, `slide-down-out`, `scale-in`, `scale-out`, `rotate-in`, `rotate-out`, `bounce-in`, `bounce-out`.

**Keyframe animations** (`keyframe_animations: KeyframeAnimation[]`) — arbitrary property-over-time control.

```ts
{
  property: 'x' | 'opacity' | string,
  keyframes: [{ time: 0, value: 0, easing: 'ease-out' }, { time: 1, value: 100 }],
  easing?,
}
```

## Validation

```ts
import { validate } from '@clipkit/protocol';

const result = validate(sourceJson);
if (result.valid) {
  console.log(result.data); // typed as Source
} else {
  result.errors.forEach(e => console.log(e.path, e.message));
}
```

Pure function — no I/O. Accepts a parsed object or a raw JSON string. Unknown properties are preserved (`.passthrough()` semantics) so vendor-specific fields round-trip unchanged.

## Defaults

```ts
import { applyDefaults } from '@clipkit/protocol';

const element = applyDefaults({ type: 'video', source: 'clip.mp4' });
// → video with track: 1, time: 0, x: '50%', y: '50%', etc.
```

## Const-driven design

The const arrays in `types.ts` are the single source of truth. Adding a value there propagates to Zod enums and any consumers that iterate the registry:

- `ELEMENT_TYPES` — every valid `type` discriminator.
- `OUTPUT_FORMATS` — `mp4`, `gif`, `jpg`, `png`.
- `CAPTION_STYLES` — kinetic caption presets.
- `ANIMATION_TYPES` — named animation presets.
- `EASING_FUNCTIONS` — all 29 supported easings.
- `UNITS` — `px`, `%`, `vw`, `vh`, `vmin`, `vmax`.
