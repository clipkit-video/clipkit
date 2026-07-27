# Pattern card: ui-screencast

**When to use:** faked app/product UI — chat apps, editors, panels — with
typing, cursor travel, clicks, message sends. Loads alongside the core card.

## Window chrome from shape rows

Butt plain rects edge-to-edge on low layers (sidebar 320, header 72;
hairline = 1px rect); repeated furniture = one element + repeat rows. Center
row text via the row's box + `"vertical_align": "middle"`, never
hand-computed baselines.

```json
[{"type":"shape","layer":1,"duration":"end","width":320,"height":1080,"fill_color":"#1a1917"},
  { "type": "text", "layer": 2, "duration": "end", "x": 32, "font_size": 15, "fill_color": "{c}", "text": "{r}",
    "y": {"expr":"199 + i * 46"},
    "repeat_data": [{"r":"Video projects","c":"#ece9e3"},{"r":"Launch plan","c":"#9c988f"}] }]
```

## State transitions (three HARD rules)

A screencast is a state machine: every UI state is its OWN element with an
explicit time/duration window, and states hand off by ENDING. Windows are
inclusive at both ends — butt-joined states double-draw on the shared frame
— so end each state 0.001s early.

**1. The placeholder ENDS exactly when typing starts.** Typed text and
placeholder share one box and must never coexist:

```json
[{ "type": "text", "layer": 22, "time": 0, "duration": 0.999, "text": "Message Atlas...",
    "x": 672, "y": 904, "width": 900, "height": 132, "vertical_align": "middle", "font_size": 24, "fill_color": "#75726b" },
  { "type": "text", "layer": 23, "x": 672, "y": 904, "width": 900, "height": 132, "vertical_align": "middle", "font_size": 24, "fill_color": "#f2efe9",
    "repeat_data": [{"text":"L|","time":1.0,"duration":0.099},{"text":"Le|","time":1.1,"duration":0.099},
      {"text":"Let's make a video|","time":1.2,"duration":3.399}] }]
```

Typing = a flipbook of growing prefixes (caret `|` baked in, one row per
keystroke, 0.1s step, 0.099 duration). The LAST row ENDS at the send moment
(the input clears); re-enter the placeholder as a NEW element (time 4.6,
duration "end", fade-in).

**2. The empty state ENDS the moment the first message sends.** Center
logo/greeting get `duration` = send time, opacity fading out just before:

```json
{ "type": "text", "layer": 18, "time": 0, "duration": 4.6, "x": 560, "y": 388, "width": 1120,
  "text_align": "center", "font_size": 40, "fill_color": "#ece9e3", "text": "How can I help you today?",
  "keyframe_animations": [{ "property": "opacity", "keyframes": [
    {"time":0,"value":0},{"time":0.9,"value":1},
    {"time":4.15,"value":1},{"time":4.5,"value":0,"easing":"ease-in-cubic"}] }] }
```

**3. Message bubbles anchor inside the conversation column ONLY.** Derive
the column from the chrome: sidebar 320 + centered 1080 input => column
x 580..1660; header 72, input top 904 => bubble y in (72, 904). Right-anchor
user bubbles to the column edge; never let x/y default — 0,0 is the nav
corner:

```json
{ "type": "shape", "layer": 28, "time": 4.6, "duration": "end", "x": 1660, "x_anchor": "100%", "y": 600,
  "width": 356, "height": 72, "border_radius": 22, "fill_color": "#35322b",
  "animations": [{"type":"fade-in","time":"start","duration":0.25},
    {"type":"slide-up-in","time":"start","duration":0.35,"distance":28,"easing":"ease-out-cubic"}] }
```

## Cursor travel + click

A `position` track with tangents bows the path (real mice arc); click = a
scale-dip track recovering ease-out-back, echoed on the button with a
brightness flash (bare array ok — filter field) + an expanding ripple.
Assistant side: a typing-dots bubble (3-ellipse repeat, `sin` exprs
phase-lagged by i) swaps into the reply bubble — rule-1 handoff again.

```json
{ "type": "shape", "layer": 34, "duration": "end", "width": 34, "height": 34, "view_box": [0, 0, 24, 24],
  "paths": [{"d":"M5 3 L5 20 L9.5 15.8 L12.6 22.2 L15.1 21 L12 14.8 L18.4 14.8 Z","fill":"#f7f5f1"}],
  "keyframe_animations": [
    { "property": "position", "keyframes": [
      {"time":2.9,"value":[1250,800],"easing":"ease-in-out-cubic","out_tangent":[200,-140]},
      {"time":4.1,"value":[1595,962],"easing":"ease-in-out-cubic","in_tangent":[-170,70]}] },
    { "property": "scale", "keyframes": [{"time":4.22,"value":1},
      {"time":4.32,"value":0.82,"easing":"ease-out-quad"},{"time":4.46,"value":1,"easing":"ease-out-back"}] }] }
```

## Gotchas

- BARE keyframe arrays on element x/y/width/height/opacity/scale/rotation
  silently hold the static value — animate those with keyframe_animations
  tracks, presets, or exprs (bare arrays work on filter + camera fields).
- Beat chain: type -> travel -> click -> send -> bubble -> dots -> reply;
  stagger element `time`s — keyframes read from the element's own start.
