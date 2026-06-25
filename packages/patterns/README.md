# @clipkit/patterns

> Authoring-time pattern library for ClipKit — composable motion-graphics units that emit primitive Source elements.

```bash
npm install @clipkit/patterns
```

Patterns are TypeScript functions that take parameters and a named theme, returning arrays of primitive ClipKit protocol elements (text, shapes, groups). Use them to author data visualizations (stat blocks, bar charts, ranked lists), cinematic scenes (hero reveals, glass panels), and component units (lower thirds, tilted showcases). Each pattern is a reusable authoring-time abstraction; the runtime sees only the primitive elements it emits.

`promo()` is the sequence composer — it assembles multiple scene builders into a complete, renderable Source, handling timeline sequencing, crossfades, theme webfont registration, and shared camera + motion blur setup.

## Usage

```typescript
import { statBlock, barChartRow, promo } from '@clipkit/patterns';

// Define scenes as builders that receive composer-assigned timing and dimensions
const scenes = [
  {
    duration: 3,
    build: (ctx) => {
      const elements = [];
      elements.push(...statBlock({
        id: 'stat-1',
        current: 2400,
        previous: 1840,
        label: 'Total views',
        color: 'blue',
        theme: 'mux',
        x: 200,
        y: 100,
        width: 400,
        time: ctx.time,
        duration: ctx.duration,
        layerBase: ctx.layer,
      }));
      return { type: 'group', id: ctx.id, elements };
    },
  },
];

// Compose into a renderable Source
const source = promo({
  scenes,
  theme: 'mux',
  width: 1280,
  height: 720,
});
```

## API

**Data patterns** — single-unit visualizations, return `Element[]`:
- `statBlock(props)` — themed number + label + optional trend indicator
- `barChartRow(props)` — animated horizontal bar + value + label
- `rankedList(props)` — ranked items with positions and optional values
- `pieCard(props)` — pie chart segment visualization
- `headerBar(props)` — full-width header bar for data scenes

**Scene builders** — full-frame compositions that take `SceneCtx`:
- `statsScene`, `barsScene`, `rankingScene`, `pieScene` — pre-built data-dashboard layouts

**Component patterns** — reusable UI units:
- `introCard`, `lowerThird`, `tiltedShowcase`, `cameraOrbit`, `litSurface`, `heroReveal`, `glassPanel`, `ctaOutro`, `kineticHeadline`

**Composer**:
- `promo(opts)` — sequence scenes + theme into one renderable `Source`

**Theming**:
- `THEMES` — named bundles (mux, minimal, cinematic)
- `getPalette(theme, color)` — fetch color palette for a theme + color slot
- `getFonts(theme)` — fetch font family names for sans / mono / display

**Beat-sync utilities** — map @clipkit/music-analysis BeatMap to motion:
- `pulseToTempo`, `accentOnBeats`, `snapToBeat`, `revealOnBeat`, `slideOnBeat`

**Helpers**:
- `liquidMorph` — shape → path → shape transition with liquid blobs
- `trendPill`, `trendPct` — trend indicators

## License

Apache-2.0 · part of [ClipKit](https://clipkit.dev) · [source](https://github.com/clipkit-video/clipkit)
