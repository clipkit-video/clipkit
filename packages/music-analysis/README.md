# @clipkit/music-analysis

Analyze an audio file into a **beat map** — tempo, beat grid, downbeats,
transient onsets, and structural sections — so motion graphics can be synced to
music.

Think of it as an importer with the last step removed. The After Effects and
Lottie importers parse a foreign format into an IR and then *convert* that IR to
a Clipkit Source. This package parses audio into an IR — the `BeatMap` — and
**stops there**. It does not emit a Source.

## Where it sits

```
audio file ─▶ @clipkit/music-analysis ─▶ BeatMap ─▶ @clipkit/patterns helpers ─▶ keyframes
                  (analysis: churns)      (stable     (mapping: intent → exact
                                           contract)    times) + the AI's taste
```

Three jobs, deliberately split:

1. **Analysis** (this package) — produce the facts: *where are the beats?*
2. **Mapping** (`@clipkit/patterns`) — turn intent into exact keyframes:
   *punch the logo on each downbeat.*
3. **Taste** (the AI agent, via `@clipkit/mcp-server`) — decide *which* moment
   gets *which* move, reading the beat map as authoring context.

## Not part of the protocol

The beat map is **authoring-time data**. The runtime never reads it. Consumers
bake it down to ordinary keyframes / pure expressions, so the rendered Source
stays a deterministic function of time with **no audio dependency** — same
document, same pixels, on every backend. Resist the urge to let an expression
sample an audio envelope at render time; bake to keyframes instead.

## Two tiers of sync

- **Tier 1 — tempo-parametric (pure).** Just `bpm` + `phase` drive a pure
  expression that breathes on the beat (e.g.
  `1 + 0.05 * max(0, sin(TAU * (bpm/60) * (t - phase)))`). ~70% of the feel,
  zero new runtime concepts.
- **Tier 2 — event-baked (precise).** `downbeats` / `onsets` / `sections` place
  accents and transitions on exact musical time.

## Status

Scaffold. The `BeatMap` contract (`src/beat-map.ts`) and the `analyzeAudio`
signature (`src/analyze.ts`) are the stable parts; the analyzer behind them is
where the experimentation happens. `analyzeAudio` currently returns an empty map
so the contract and downstream wiring can be built against a real type today.

## Usage

```ts
// analyzeAudio reads files (node:fs) → import it from the Node-only subpath.
import { analyzeAudio } from '@clipkit/music-analysis/node';
import type { BeatMap } from '@clipkit/music-analysis';

const map: BeatMap = await analyzeAudio('track.mp3');
// → feed to a patterns helper, or hand to an agent as authoring context

// Browser-safe helpers (beatGrid, decodeWav, analyzePcm, types) live on the
// main entry: import { beatGrid } from '@clipkit/music-analysis';
```
