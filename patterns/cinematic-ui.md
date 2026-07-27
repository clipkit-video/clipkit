# Pattern card: cinematic-ui

**When to use:** product-launch hero shots — a faked app/dashboard panel
presented cinematically: slow camera push-in + tilt, z-depth parallax, light
sweep, wordmark reveal. Chrome/typing idioms: ui-screencast.

## Camera rig + depth planes

Root `camera` pose fields take keyframe arrays (`origin_*` static-only,
default center). Camera does the DOLLY ONLY — keep it level; negative
camera `x_rotation` can drop a clip-group's children (empty slab).

```json
{ "camera": { "perspective": 1500,
  "z": [{"time":0.4,"value":0},{"time":6.4,"value":200,"easing":"ease-in-out-sine"}] } }
```

The tilt goes on the PANEL GROUP as `keyframe_animations` tracks. Element
semantics: POSITIVE `x_rotation` = top leans BACK (the popular product
tilt); small positive `y_rotation` angles it to the side. Rake big, settle
near-flat but OFF 0:

```json
"keyframe_animations": [
  {"property":"x_rotation","keyframes":[{"time":0.4,"value":18},{"time":6.4,"value":2.5,"easing":"ease-in-out-sine"}]},
  {"property":"y_rotation","keyframes":[{"time":0.4,"value":10},{"time":6.4,"value":1.5,"easing":"ease-in-out-sine"}]}]
```

2-3 depth planes via `z`: backdrop glows z -150 (oversized radial-gradient
falloff, no blur), panel group z 0, wordmark + bokeh z 60, vignette z 90
(multiply radial, clear center, top). Camera draw order =
back-to-front by z (ties keep layer order); a plane scales by
p/(p - z - dolly) — far barely moves, near leads. Dolly
magnifies away from origin; pre-place fg text to survive full push.

## The panel: one clip group

A `clip: true` group with `border_radius` IS the window; children use LOCAL
coords (origin = group top-left), own layer order. Chrome, cards, chart =
rects + repeat rows; bars grow upward via `y_anchor "100%"` + height expr.
Entrance: fade-in preset + a scale 0.965 -> 1 track on the group.

```json
{ "type": "group", "layer": 4, "z": 0, "duration": "end",
  "x": 960, "y": 400, "x_anchor": "50%", "y_anchor": "50%", "width": 1240, "height": 680,
  "clip": true, "border_radius": 24,
  "elements": [
    {"type":"shape","layer":1,"duration":"end","width":1240,"height":680,"fill_color":"#0d1220"},
    { "type": "shape", "shape": "ellipse", "layer": 2, "duration": "end", "y": 21, "width": 12, "height": 12,
      "x": {"expr":"26 + i * 22"}, "fill_color": "{c}",
      "repeat_data": [{"c":"#ff5f57"},{"c":"#febc2e"},{"c":"#28c840"}] },
    { "type": "shape", "layer": 3, "time": 1.15, "duration": "end", "y": 476, "y_anchor": "100%",
      "x": {"expr":"300 + i * 75"}, "width": 44, "border_radius": 6, "fill_color": "#4f8cff",
      "height": {"expr":"ease(t,0,0.8,0,h)"}, "repeat_stagger": 0.07,
      "repeat_data": [{"h":64},{"h":120},{"h":196}] }] }
```

Groups have no `shadow`: pair a same-size rounded rect beneath (same z,
lower layer) — and give it the SAME rotation tracks as the panel, or it
shows as a flat box behind the tilt.

## Light sweep + wordmark

ONE sweep: a rotated screen-blend rect INSIDE the panel group (the clip
crops it); softness from a transparent→white→transparent gradient, NOT
blur; an x track moves it, an opacity track fades its ends.

```json
{ "type": "shape", "layer": 21, "time": 2.6, "duration": 2,
  "x_anchor": "50%", "y_anchor": "50%", "width": 380, "height": 1500, "rotation": 16,
  "blend_mode": "screen",
  "gradient": { "type": "linear", "angle": 90, "stops": [
    {"offset":0,"color":"rgba(223,233,255,0)"},{"offset":0.5,"color":"rgba(223,233,255,0.4)"},
    {"offset":1,"color":"rgba(223,233,255,0)"}] },
  "keyframe_animations": [{ "property": "x", "keyframes": [
    {"time":0,"value":-300},{"time":1.8,"value":1560,"easing":"ease-in-out-sine"}] }] }
```

Wordmark on the fg plane after the dolly settles: glow + blur-settle +
opacity track (+ a spring scale 0.9 -> 1 track).

```json
{ "type": "text", "layer": 6, "z": 60, "time": 5.4, "duration": "end",
  "x": 960, "y": 765, "x_anchor": "50%", "y_anchor": "50%", "text": "MERIDIAN",
  "font_weight": 800, "font_size": 88,
  "effects": [{"type":"glow","radius":26,"intensity":0.55,"color":"#7fa8ff"}],
  "blur_radius": [{"time":0,"value":12},{"time":0.8,"value":0,"easing":"ease-out-cubic"}],
  "keyframe_animations": [{ "property": "opacity", "keyframes": [
    {"time":0,"value":0},{"time":0.9,"value":1,"easing":"ease-out-cubic"}] }] }
```

## Tracks, not bare arrays

BARE keyframe arrays on element x/y/width/height/opacity/scale/rotation
silently hold the static value — use `keyframe_animations`, presets, or
exprs. Bare arrays DO animate camera + filter fields (blur/brightness).

## Render budget (critical)

- Safe envelope: ONE camera, <=2 lights, ONE glass surface, ONE particle
  emitter, blur_radius on <=3 elements. A schema-VALID comp past it
  timed out at the 300s render cap (this card's demo renders in 11s).
- ~12+ per-element blur_radius in one frame exports BLACK, silently. Prefer
  gradient-alpha softness, glow, screen-blend sheens.
- `motion_blur` multiplies cost by `samples`; add last. Keep 3D rotations
  off exact 0 — settling AT 0 can drop a group's children (18 -> 2.5 here;
  under ~2.5 degrees at rest reads as flat anyway).
- End-card text goes BELOW the panel: raise/shrink the panel so the
  wordmark clears its bottom edge; keep the tagline >=140px off the canvas
  bottom.
