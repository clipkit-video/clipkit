# Pattern card: data-viz

**When to use:** stat reveals, year-in-review dashboards, KPI/progress rows —
numbers and bars ARE the story. Loads alongside the core card; idioms only.

## Count-up flipbook (the data-viz idiom)

An animating number is N short-lived copies of ONE text element. Rows are the
display strings; element `duration` == `repeat_stagger`, so exactly one copy is
on screen at a time. The last row holds with `"duration": "end"`.

```json
{ "type": "text", "id": "value-1", "layer": 16, "time": 1.0, "duration": 0.14,
  "x": 1760, "y": 356, "x_anchor": "100%", "font_size": 44,
  "font_family": "Inter, sans-serif", "font_weight": 800, "fill_color": "#67e8f9",
  "text": "{v}", "repeat_stagger": 0.14,
  "animations": [ { "type": "fade-in", "time": "start", "duration": 0.05 } ],
  "repeat_data": [
    { "v": "0" }, { "v": "1.4M" }, { "v": "2.4M" }, { "v": "3.1M" },
    { "v": "3.6M" }, { "v": "3.9M" }, { "v": "4.1M" }, { "v": "4.2M", "duration": "end" } ] }
```

Copies are UNIFORM in time, so bake easing into the values: shrinking deltas
toward the target read as ease-out. Format in the data ("4.2M", "1,240",
"4.8/5") — the renderer never formats numbers.

Exact-sync variant: rows can instead each patch `time` + `duration`
(element-local seconds) when a counter must hit landmarks with a bar or beat:

```json
"repeat_data": [
  { "v": "0K",   "time": 1.1,  "duration": 0.07 },
  { "v": "61K",  "time": 1.17, "duration": 0.07 },
  { "v": "114K", "time": 1.24, "duration": 0.07 },
  { "v": "318K", "time": 1.31, "duration": 5.69 } ]
```

## Bar rows: one element per role

A 4-row dashboard is 3 elements (tracks, bars, labels) plus one flipbook per
value. `i` spaces the grid, row data drives width/colors/text, `repeat_stagger`
cascades the rows.

```json
{ "type": "shape", "id": "tracks", "layer": 4, "time": 0, "duration": "end",
  "x": 160, "y": { "expr": "402 + i * 170" }, "width": 1600, "height": 50,
  "border_radius": 25, "fill_color": "#242a4a", "opacity": 0.55, "repeat": 4 },
{ "type": "shape", "id": "bars", "layer": 8, "time": 1.0, "duration": "end",
  "x": 160, "y": { "expr": "402 + i * 170" }, "height": 50, "border_radius": 25,
  "width": { "expr": "ease(t, 0, 1.1, 0, w)" }, "repeat_stagger": 0.4,
  "gradient": { "type": "linear", "angle": 90,
    "stops": [ { "offset": 0, "color": "{c0}" }, { "offset": 1, "color": "{c1}" } ] },
  "effects": [ { "type": "glow", "radius": 18, "intensity": 0.55, "color": "{c0}" } ],
  "repeat_data": [
    { "w": 1472, "c0": "#22d3ee", "c1": "#6366f1" },
    { "w": 1088, "c0": "#6366f1", "c1": "#a855f7" },
    { "w": 1248, "c0": "#a855f7", "c1": "#ec4899" },
    { "w": 1536, "c0": "#ec4899", "c1": "#f59e0b" } ] },
{ "type": "text", "id": "labels", "layer": 12, "time": 1.0, "duration": "end",
  "x": 160, "y": { "expr": "360 + i * 170" }, "font_size": 28, "letter_spacing": 2,
  "font_family": "Inter, sans-serif", "font_weight": 600, "fill_color": "#aab4d9",
  "text": "{label}", "repeat_stagger": 0.4,
  "animations": [ { "type": "fade-in", "time": "start", "duration": 0.4 } ],
  "repeat_data": [ { "label": "HOURS WATCHED" }, { "label": "NEW SUBSCRIBERS" },
    { "label": "TITLES ADDED" }, { "label": "AVG. RATING" } ] }
```

Track and bar share x/y/height/border_radius; bar target `w` = fraction of
track width (1472 = 92% of 1600). Bare `w`/`c0` bind inside exprs; `{c0}`
substitutes in strings — even inside nested gradient stops.

## Gotchas

- One flipbook element per counter: an element can't repeat in two dimensions,
  so counters never merge into the bar/label sets.
- Right-anchor counters (`"x_anchor": "100%"`): row width varies, anchoring
  pins the number to the column edge instead of jittering.
- Forget the final `"duration": "end"` row and the number vanishes mid-video.
- Copy k starts at element `time` + k * stagger. Use the SAME stagger on bars
  and labels (0.4 here) so each row arrives as a unit; start values when their
  bar starts, not when it lands.
- Land everything well before root `duration` so the end frame holds calm.
