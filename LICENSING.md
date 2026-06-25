# Licensing

Clipkit uses two licenses. **Almost everything is Apache-2.0.** Two
components — the rendering **runtime** and the hosted **render-service** —
are under the **Business Source License 1.1 (BSL)**, which converts to
Apache-2.0 four years after each release. This document explains which is
which, and — more importantly — what you're actually allowed to do.

## Summary

| Component | License | Reason |
|---|---|---|
| `PROTOCOL.md` (the spec) | Apache-2.0 | A protocol must be maximally implementable. Apache's patent grant protects third-party implementers. |
| `@clipkit/protocol` | Apache-2.0 | Schema + validators belong in everyone's projects. |
| `@clipkit/runtime` | **BSL 1.1 → Apache-2.0 after 4 years** | The GPU engine that turns a Clipkit document into frames. One of two pieces we protect — see below. |
| `@clipkit/render-service` | **BSL 1.1 → Apache-2.0 after 4 years** | The server-side rendering pipeline behind clipkit.dev. The other protected piece. |
| `@clipkit/editor`, `@clipkit/editor-core`, `@clipkit/playback` | Apache-2.0 | The editor + playback stack. Lives in user apps; embed freely. |
| `@clipkit/patterns`, `@clipkit/lint`, `@clipkit/speech-to-text`, `@clipkit/music-analysis`, `@clipkit/sfx` | Apache-2.0 | Authoring-time helpers; live in user code. |
| `@clipkit/mcp-server`, `@clipkit/cli` | Apache-2.0 | Wide integration surface — installed by agents and users. |
| `apps/web` | Proprietary, never published | The hosted SaaS dashboard. |
| `apps/playground` | Apache-2.0 | Public demo. |

"Clipkit" and the Clipkit logo are trademarks. See [TRADEMARK.md](./TRADEMARK.md).

## Why this split

Clipkit is **protocol-first**: the protocol is the product, and the
reference implementations exist so people actually have something to adopt.
That's why we give away — under Apache-2.0 — the entire protocol **and the
whole authoring stack**: the editor, playback, patterns, transcription,
music analysis, SFX, the CLI, and the MCP server.

The two pieces we hold back are the ones that *are* the hosted rendering
business: the **runtime** (the engine that renders a Clipkit document into
video) and the **render-service** (the headless pipeline that does it at
scale). If a competitor could take those and stand up a cheaper hosted
Clipkit-rendering API, the hosted business that funds this whole project
would be undercut by our own code. So both are BSL 1.1 — and both
**auto-convert to Apache-2.0 four years after each release.**

## What BSL means for you (the part that matters)

The BSL's Additional Use Grant is written to permit essentially everything
except running a competing rendering service. In plain English:

| Can I… | |
|---|---|
| Embed the runtime in my own app or website? | ✅ **Yes** |
| Use the editor (which depends on the runtime)? | ✅ **Yes** — see next section |
| Build my own editor, platform, or SaaS on top of the runtime? | ✅ **Yes** |
| Render videos for my own product or app? | ✅ **Yes** |
| Render videos **for my customers** as part of a broader product (e.g. a social-media automation tool)? | ✅ **Yes**, even commercially |
| Use it internally at my company? | ✅ **Yes** |
| Personal / educational / research use? | ✅ **Yes** |
| Build my **own** independent Clipkit-Protocol renderer from scratch? | ✅ **Yes** |
| Offer a hosted/managed service to third parties whose **primary purpose** is rendering Clipkit-Protocol documents into video? | ❌ **Not until the change date** (4 years) |
| Call my product "Clipkit"? | ⚠️ Only per [TRADEMARK.md](./TRADEMARK.md) — you may say "Clipkit-compatible" |

The single restricted case is the "fork-and-host a competing render API"
play. If you're not selling Clipkit rendering *as the service*, BSL doesn't
get in your way.

## "The editor is Apache but depends on a BSL runtime — what does that mean?"

Nothing scary. `@clipkit/editor`, `@clipkit/editor-core`, and
`@clipkit/playback` are Apache-2.0. They depend on `@clipkit/runtime` (BSL),
and the runtime's Additional Use Grant **explicitly permits embedding it as
a dependency of the editor**. So you can install the editor, build your
product on it, and ship it commercially. The BSL only ever bites if you use
the runtime to run a competing hosted rendering service — which embedding
the editor in your app is not.

## Why BSL over the alternatives

- **vs Apache-2.0 + trademark only** — Doesn't stop the fork-and-host play.
  Trademark protects the brand, not the engine.
- **vs AGPL-3.0** — Blanket-banned by many enterprise legal teams; hurts
  adoption far beyond the cloud-fork case it targets.
- **vs Elastic License v2 / SSPL** — Permanent restriction; doesn't signal
  genuine open-source intent, and SSPL is community-radioactive after
  MongoDB/Redis. BSL's four-year conversion to Apache-2.0 is the difference.

The BSL is precedent-supported (CockroachDB, MariaDB, Couchbase, HashiCorp
Terraform pre-2023). Canonical text: https://mariadb.com/bsl11/. The pinned
Clipkit parameters live at the top of each BSL `LICENSE` file (see
`packages/runtime/LICENSE` and `packages/render-service/LICENSE`); the
template is [BSL.template.md](./BSL.template.md).

## If you're implementing the protocol from scratch

- The protocol spec is Apache-2.0. Implement it freely, including a
  renderer of your own.
- You may call your implementation "Clipkit-compatible" — see
  [TRADEMARK.md](./TRADEMARK.md). You may not call it "Clipkit" without
  permission.

## Change history

- *2026-05-28* — Initial license split. Apache-2.0 across published
  packages; BSL 1.1 reserved for `render-service`.
- *2026-06-25* — **`@clipkit/runtime` moved Apache-2.0 → BSL 1.1.** Reserving
  the wrapper alone left the engine forkable; the runtime now carries the
  same Competing-Service restriction (with an explicit embedding grant) and
  the same four-year Apache-2.0 conversion. Added the editor stack
  (`editor`, `editor-core`, `playback`, `sfx`) as Apache-2.0. Corrected
  `packages/schema` → `@clipkit/protocol` and `packages/sdk` → `@clipkit/editor`.
</content>
