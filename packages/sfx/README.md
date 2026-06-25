# @clipkit/sfx

> Procedural sound-effects synthesis engine — pure DSP, no dependencies, emits 16-bit stereo PCM audio.

```bash
npm install @clipkit/sfx
```

A lightweight procedural synth library for UI, game, and motion sound design. Generate 11 core SFX types (whoosh, impact, riser, pop, glitch, etc.) as raw stereo PCM, or render from a curated named catalog. Each synth layers filtered noise, pitched sweeps, and reverb tails—all deterministic and tunable in pitch and stereo. Route through a pro finishing chain (transient shape, air EQ, saturation, parallel compression, stereo width) and export as WAV.

Built for @clipkit/score (sound design) and the editor's audio browser. Pure algorithm—no recordings, no impulse responses—so catalog entries are license-clean and infinitely reproducible.

## Usage

```typescript
import { whoosh, riser, finish, encodeWav, renderSfx } from '@clipkit/sfx';

// Generate raw synth
const sfx = whoosh({ duration: 0.5, tune: 220, gain: 0.3 });

// Polish through finishing chain
const finished = finish(sfx);

// Or render by catalog name (finishes by default)
const impact = renderSfx('impact', { tune: 440 });

// Export as 16-bit WAV bytes
const wav = encodeWav(finished);
```

## API

**Synth primitives** (all return `Sfx` — stereo PCM with sample rate):
- `whoosh(opts)` — swish + vwoom sweep, tunable pitch, air
- `impact(opts)` — thud + sub drop + click transient
- `riser(opts)` — uplifter with rising tone + swell
- `pop(opts)` — bright snap, scale-in blip + click
- `tick(opts)` — tiny UI tap, high blip
- `glitch(opts)` — bitcrushed stutter, sample-held tone+noise
- `shimmer(opts)` — sparkle, stacked partials + tremolo
- `braam(opts)` — cinematic dread hit, detuned brass cluster
- `downlifter(opts)` — downer, tone pitching down
- `sweep(opts)` — resonant filter sweep across stereo field
- `subDrop(opts)` — low whump, sine drop
- `glueBus(L, R, opts)` — shared reverb + saturation for cohesion

**Finishing chain:**
- `finish(audio, opts)` — transient shape, air EQ, saturation, compression, width, ceiling

**Catalog (16 named entries):**
- `renderSfx(name, opts)` — render by name (whoosh, impact, braam, pop, tick, glitch, shimmer, riser, downlifter, sweep, boom, ding-correct, buzzer-wrong, notification, power-up, coin)
- `listSfx()` — all catalog entries
- `sfxCategories()` — distinct categories

**Export:**
- `encodeWav(audio)` → `Uint8Array` (16-bit PCM WAV, ready to serve/save)

## License

Apache-2.0 · part of [ClipKit](https://clipkit.dev) · [source](https://github.com/clipkit-video/clipkit)
