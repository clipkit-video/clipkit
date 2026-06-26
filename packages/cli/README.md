# @clipkit/cli

The Clipkit command-line interface — author and render Clipkit Protocol
videos locally.

## Install

```bash
npm install -g @clipkit/cli
# or, no install:
npx @clipkit/cli <command>
```

## Commands

### `clipkit init [name]`

Scaffold a new Clipkit project in a fresh directory.

```bash
clipkit init my-video
cd my-video
npm install
```

Generates `package.json`, `tsconfig.json`, a starter `video.ts`,
`AGENTS.md` (so AI agents working in this directory auto-load the
authoring context), and `README.md`.

### `clipkit new <template>`

Scaffold a known-good, render-tested Source from the `@clipkit/patterns`
library — an idiomatic starting point (fewer schema errors, better-looking
output) instead of a blank file. Templates: `promo`, `hero`, `kinetic`,
`title`, `cta`. Prints JSON to stdout, or `-o` to a file.

```bash
clipkit new promo -o video.json
clipkit new hero --theme minimal > hero.json
```

### `clipkit validate <file>`

Schema-check a Source against the Clipkit Protocol. Accepts `.json`,
`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, or `.cjs`. TypeScript
files are loaded via [`jiti`](https://github.com/unjs/jiti) — no
separate build step.

```bash
clipkit validate video.ts
# ✓ /…/video.ts is a valid Clipkit Protocol v1.0 document.

clipkit validate broken.json
# ✗ /…/broken.json failed validation (2 errors):
#   - elements.0.type: Invalid discriminator value
#   - width: Expected positive integer
```

Add `--explain` to surface protocol-aware *warnings* on success (things
that validate but the runtime will silently drop or clip — e.g. non-ASCII
text the font atlas can't render, or an element that runs past the
composition's end) and extra guidance on failure.

The file must export the Source as `default`, or as a named export
called `source`, `video`, `project`, or `composition`. If only one
named export exists, that's used.

### `clipkit explain <file>`

A plain-language read-back of a Source — dimensions, fps, duration, a
per-track timeline, an element breakdown, and the same protocol-aware
warnings as `validate --explain`. Verify what was authored without
rendering (the fast inner loop of an author → check → fix cycle).

```bash
clipkit explain video.json
# 1280×720 · 30fps · 6s · mp4
# 4 elements  (2 shape, 1 text, 1 caption)
# Timeline (by track, paint order low→high): …
```

### `clipkit preview <file>`

Open a Source in the Clipkit web editor — a live, editable preview with
zero local setup (no Chrome, no render, no credits; the editor renders it
in your browser). It uploads the Source and opens the returned link:

```bash
clipkit preview video.ts
# ✓ Preview ready (anonymous, expires in 7 days):
#
# https://clipkit.dev/editor?id=…
```

The link is shareable — copy it, send it, embed it. Without an API key the
preview is anonymous and expires in 7 days; logged in (see `clipkit login`)
it's owned by your team and permanent on paid plans. Pass `--no-open` to
print the link without launching a browser.

### `clipkit render <file> -o output.mp4`

Render the Source to a video file. Two engines:

```bash
# Local (default): headless Chrome on your machine — free, needs Google Chrome.
clipkit render video.ts -o out.mp4

# Cloud: Clipkit's GPU servers — needs `clipkit login`, consumes credits.
clipkit render video.ts -o out.mp4 --cloud

# Resolution / format / bitrate
clipkit render video.ts -o out.mp4 --resolution 1080p
```

Local rendering uses the optional `@clipkit/renderer` engine plus your
installed Google Chrome. If it isn't present, the command tells you how to
install it (or to use `--cloud`). Cloud rendering submits the job, shows live
progress, and downloads the finished file.

### `clipkit still <file> -o poster.png`

Render a single frame to a PNG — a fast visual sanity-check or thumbnail
without a full encode. Uses the same local engine as `render --local`
(needs Google Chrome). `-t/--time` picks the composition time.

```bash
clipkit still video.json -o poster.png --time 1.5
```

### `clipkit login` / `clipkit logout`

Store an API key for the cloud commands (`render --cloud`, team-owned
previews). `login` opens the dashboard's API-keys page, takes a pasted
`ck_live_…` key, and saves it to `~/.config/clipkit/config.json` (chmod
600). `logout` removes it.

```bash
clipkit login                      # interactive: opens /keys, prompts for the key
clipkit login --api-key ck_live_…  # non-interactive (CI)
```

Every cloud command resolves its key as: `--api-key` flag → `CLIPKIT_API_KEY`
env var → the stored config file. The API host follows the same order via
`--api-url` / `CLIPKIT_API_URL`, defaulting to `https://clipkit.dev`.

## For AI agents

Three commands make Clipkit easy to author against from an LLM:

### `clipkit docs [topic]`

Print the canonical authoring docs to stdout, so an agent can pull the spec
into context in one command. Topics: `agents` (the authoring guide, default)
and `protocol` (formal field semantics).

```bash
clipkit docs protocol > .context.md
```

### `clipkit schema`

Print the protocol as a JSON Schema (generated from the Zod source of
truth) — for constrained/structured generation, editor autocomplete, or
external validators.

```bash
clipkit schema > clipkit.schema.json
```

### `clipkit mcp`

Run the Clipkit [MCP](https://modelcontextprotocol.io) server over stdio, so
an agent gets the full toolset (compose, preview, render) from one command.
Wire it into your agent's MCP config:

```json
{ "command": "npx", "args": ["-y", "@clipkit/cli", "mcp"] }
```

## License

Apache-2.0. See `LICENSE`.
