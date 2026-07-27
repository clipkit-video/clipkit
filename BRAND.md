# Clipkit — Brand

> The load-bearing version of the Clipkit brand. AI agents and human
> contributors read this; the visual companion (with rendered swatches
> and type specimens) lives at [`brand/board.html`](./brand/board.html).
> When the two disagree, this file wins.

---

## 1. Essence

**The video runtime for agents.**

Clipkit is a developer tool — a GPU-rendered video runtime built on the
open Clipkit Protocol — and it should feel like one: **precise, fast,
and unfussy**. The visual language borrows from modern dev infrastructure
brands — Vercel, Linear, Resend — dark by default, mostly monochrome,
with two confident accent colors doing all the talking.

The runtime turns a **JSON timeline into a rendered video**. That
duality — structured code on one side, motion on the other — is the
heart of the brand. Wherever possible, show the JSON and the timeline
together.

The Clipkit Protocol is what makes the runtime portable: a documented,
versioned JSON format that anyone can implement. It's a credibility
feature, not the headline. Lead with the runtime; the protocol shows up
as *"how is this possible? → via the open Clipkit Protocol."*

| Attribute | Value |
|---|---|
| Personality | Precise · technical · honest · quietly confident |
| Reference brands | Vercel, Linear, Resend |
| Audience | AI agents and the developers shipping them |
| Default theme | Dark |
| Mood | Calm surface, punchy accents |
| Never | Playful, gradient-heavy, emoji-led, salesy |

---

## 2. Logo

Three equal-length rounded bars — **white, yellow, red** — offset
horizontally and stacked like clips on a timeline. The mark *is* the
product: tracks of media, layered in time.

### Construction

- Three bars of equal width and height.
- Bar width = 65% of container width.
- Bar height = 29% of container height (~3 stacked bars + 2 small gaps).
- Stagger:
  - **Bar 1 (top)** — white `#FAFAFA`, offset right (`left: 33%` of container).
  - **Bar 2 (middle)** — yellow `#FFB800`, flush left (`left: 0`).
  - **Bar 3 (bottom)** — red `#EF4444`, offset right (`left: 35%` of container).
- Bar corner radius ≈ 18% of bar height (rounded, not pill-shaped).
- Wordmark when locked up: Geist 600, tracking −0.02em, gap 14px from
  the mark.

### Do

- Keep the three-bar stagger and the white / yellow / red order, top
  to bottom.
- Use the icon alone at small sizes; pair with the wordmark elsewhere.
- Give the mark clear space equal to one bar's height on all sides.
- Set the wordmark in Geist, weight 600, tight tracking (−0.02em).

### Don't

- Recolor the bars or reorder them (the order encodes the timeline).
- Add gradients, glows, bevels, or drop shadows to the mark.
- Rotate, skew, or outline the bars.
- Set the wordmark in any font other than Geist.

### Variants

| Surface | Bar 1 | Bar 2 | Bar 3 | Wordmark |
|---|---|---|---|---|
| Dark `#0A0A0A` (canonical) | `#FAFAFA` | `#FFB800` | `#EF4444` | `#FAFAFA` |
| Cream `#FAF8F3` | `#181717` | `#FFB800` | `#EF4444` | `#181717` |
| Red `#EF4444` (reversed) | `#FFFFFF` | `#FFE08A` | `#7A1414` | `#FFFFFF` |

### Sizing

- Minimum width: **88px** (icon + wordmark lockup) or **24px** (icon
  alone).
- Favicon: icon alone, square crop with 12% padding.

---

## 3. Color

Two brand accents, one near-black surface system. Accents are for
**emphasis only** — a single red dot or yellow word carries more weight
than a field of color. Aim for **90% neutral, 10% accent**.

### Brand accents

| Token | Hex | RGB | OKLCH | Role |
|---|---|---|---|---|
| `--red` | `#EF4444` | `239 68 68` | `0.64 0.21 25` | **Primary.** Playhead, live/record state, key emphasis, the bottom logo bar. |
| `--yellow` | `#FFB800` | `255 184 0` | `0.81 0.17 82` | **Secondary.** Active caption word, string literals in code, the middle logo bar, selection background. |

### Accent variants

| Variant | Red | Yellow | When to use |
|---|---|---|---|
| Loud | `#FF3030` | `#FFCA1F` | Very small UI elements where the canonical hex looks under-saturated. |
| Muted | `#C25555` | `#C99A3B` | Inline text emphasis where the canonical hex is too loud. |

Selection fill is yellow on dark text: `background: var(--yellow); color: #181717`.

### Dark surface system (canonical)

Used everywhere unless explicitly in light mode.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0A0A0A` | Page background. |
| `--bg-2` | `#111111` | Slight elevation (subtle stripes, table headers). |
| `--bg-3` | `#161616` | Filled controls inside surfaces. |
| `--surface` | `#141414` | Card / panel background. |
| `--border` | `#232323` | Hairline dividers. |
| `--border-strong` | `#2E2E2E` | Active or hovered borders. |
| `--fg` | `#FAFAFA` | Primary text. |
| `--fg-2` | `#E5E5E5` | Body text. |
| `--muted` | `#8A8A8A` | Secondary text, labels. |
| `--muted-2` | `#5F5F5F` | Tertiary / placeholder text. |
| `--code-bg` | `#0E0E0E` | Code blocks. |

### Light surface system (warm cream)

Used only when a surface explicitly needs to be light — landing-page
sections, customer assets, etc.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#FAF8F3` | Page background. |
| `--bg-2` | `#F4F1E9` | Slight elevation. |
| `--surface` | `#FFFFFF` | Card / panel background. |
| `--border` | `#E5E0D2` | Hairline dividers. |
| `--border-strong` | `#D6D0BF` | Active borders. |
| `--fg` | `#181717` | Primary text. |
| `--muted` | `#6A6864` | Secondary text. |
| `--muted-2` | `#9C9A94` | Tertiary text. |

---

## 4. Typography

### Geist & Geist Mono

**Geist Sans** for everything human-readable — headlines, body, UI.
**Geist Mono** for everything machine — code, labels, eyebrows, metrics,
timestamps, captions of intent. The sans/mono split mirrors the
product's human-vs-machine duality.

Headlines run **tight**: weight 600, tracking −0.02em to −0.035em as
size grows. Body stays at weight 400, 1.6 line-height. **Never use a
third family.**

### Type scale

| Token | Family | Weight | Tracking | Example use |
|---|---|---|---|---|
| Display | Geist | 600 | −0.035em | Hero headlines, "JSON in. Video out." |
| Heading | Geist | 600 | −0.02em | Section headers, "The video runtime for AI" |
| Body | Geist | 400 | 0 | Paragraphs. |
| Eyebrow / label | Geist Mono | 500 | +0.08em, uppercase | "how it works", "powered by mux data" |
| Code | Geist Mono | 400 | 0 | JSON snippets, terminal output. |

### Loading Geist

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;900&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Code syntax coloring (when rendering JSON)

The brand uses syntax coloring in JSON specimens:

- **Keys** — `var(--muted)` (#8A8A8A) or `var(--fg-2)` (#E5E5E5).
- **Strings** — `var(--yellow)` (#FFB800).
- **Numbers** — `var(--red)` (#EF4444).
- **Booleans / null** — `var(--muted)`.
- **Punctuation** (`:` `,` `{` `}` `[` `]`) — `var(--muted-2)` (#5F5F5F).

This mapping is the same in the brand board's code block. Use it
consistently — it makes JSON specimens immediately recognizable as
Clipkit.

---

## 5. The timeline motif

The logo's three bars extend into a full visual system: stacked tracks,
a red playhead, and offset blocks. Use it for dividers, section markers,
hero visuals, and empty states.

| Motif | Use |
|---|---|
| **Tracks + playhead** | Hero visuals, loaders, anything showing the product compose. Three stacked tracks (background `var(--bg-3)`), each with colored blocks at offset positions; vertical red playhead line crosses them. |
| **Frame bars** | Render / GPU contexts. Row of thin vertical bars at varied heights — accent only the first 1–2 bars (white, then yellow). The rest are `var(--border-strong)`. |
| **Ghost bars** | Oversized, low-opacity background accent behind CTAs. Three logo bars at ~14–60% opacity, scaled up, mostly off-canvas. |

The motif is not the same as the logo. The logo is locked geometry;
the motif is a flexible visual system inspired by it.

---

## 6. Voice & tone

Write like a senior engineer explaining a tool to a peer: **direct,
concrete, a little opinionated, never hype.** Lead with the technical
truth. Respect the reader's intelligence. Admit the limits — the honest
comparison with Remotion is a feature, not a risk.

Short sentences. Active voice. Real numbers over adjectives. When in
doubt, show the JSON instead of describing it.

| Trait | In practice |
|---|---|
| Direct | "JSON in. Video out." |
| Concrete | "renders in 3.4s" not "blazing fast" |
| Honest | "If you're hand-authoring, use Remotion." |
| Lowercase labels | `how it works`, `mcp`, `agents` |

### We say / we don't say

| We say | Not |
|---|---|
| The video runtime for agents. | The ultimate AI-powered video platform! |
| Describe the video. Render the video. | Create stunning videos in seconds 🚀 |
| GPU-rendered. In your browser. | Cloud-based AI rendering pipeline. |
| Built on the open Clipkit Protocol. | Proprietary AI technology. |
| The schema is the protocol. | Powerful, intuitive, easy-to-use API. |
| Pay per second of output. No minimums. | Flexible pricing for teams of all sizes. |

### Do

- Lead with the technical truth.
- Show numbers, not adjectives ("renders in 3.4s" not "blazing fast").
- Admit limits when they exist (honest Remotion comparison is fine).
- Use lowercase for mono labels and eyebrows.
- Show JSON instead of describing it when in doubt.

### Don't

- Use emoji.
- Use exclamation marks.
- Say "blazing," "stunning," "powerful," "intuitive," "easy-to-use," or
  any near-synonym.
- Use marketing-speak superlatives ("the ultimate," "the best,"
  "next-generation").

---

## 7. Copy-paste tokens

Drop this into `:root` and you have the dark theme.

```css
/* Clipkit — brand tokens (dark, canonical) */
--red: #EF4444;       --yellow: #FFB800;
--bg: #0A0A0A;        --bg-2: #111111;       --bg-3: #161616;
--surface: #141414;   --border: #232323;     --border-strong: #2E2E2E;
--fg: #FAFAFA;        --fg-2: #E5E5E5;
--muted: #8A8A8A;     --muted-2: #5F5F5F;    --code-bg: #0E0E0E;

/* fonts — Geist + Geist Mono (Google Fonts) */
--font-sans: 'Geist', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
```

Light-theme overrides:

```css
--bg: #FAF8F3;  --surface: #FFFFFF;  --border: #E5E0D2;
--fg: #181717;  --muted: #6A6864;
```

---

## 8. One-line brief for an AI

For pasting into a system prompt when authoring Clipkit-branded assets:

> Clipkit is a developer tool — "the video runtime for agents." A
> GPU-rendered engine that turns a JSON timeline into MP4, built for
> LLMs, agents, and the apps that ship them. It's powered by the open
> Clipkit Protocol but lead with the runtime, not the protocol — the
> protocol is a feature credit. Dark by default (`#0A0A0A` bg,
> `#FAFAFA` text), Geist + Geist Mono. Two accents only: red `#EF4444`
> (playhead/live/emphasis) and yellow `#FFB800` (active caption word /
> code strings). ~90% neutral, 10% accent. Logo is three equal,
> horizontally-offset rounded bars (white, yellow, red, top to bottom)
> like timeline clips. Voice: direct, concrete, honest, no hype, no
> emoji. Show JSON, not adjectives.

---

## Document history

- *2026-05-28* — Initial port from `brand/board.html` (v1 of the brand
  board).
