# @clipkit/mcp-server

An MCP server that exposes the Clipkit schema as tools, letting AI agents compose video projects programmatically. The Clipkit schema is the protocol — agents don't speak a custom DSL, they construct schema-valid JSON.

## Install + run

```bash
npx -y @clipkit/mcp-server
```

Or wire it into a host like Claude Desktop:

```json
{
  "mcpServers": {
    "clipkit": {
      "command": "npx",
      "args": ["-y", "@clipkit/mcp-server"],
      "env": {
        "CLIPKIT_API_URL": "https://clipkit.dev",
        "CLIPKIT_API_KEY": "ck_live_…"
      }
    }
  }
}
```

### Environment

| Var | Purpose |
|---|---|
| `CLIPKIT_API_URL` | Host for `create_promo` / `open_in_editor` links. Defaults to `https://clipkit.dev`. Set to `http://localhost:3000` when developing against a local web app. |
| `CLIPKIT_API_KEY` | Optional dashboard key (`ck_live_…`, from Settings → API keys). When set, projects are **owned by your team** (permanent on paid plans) and sent as `Authorization: Bearer`. Without it, projects are anonymous and expire after 7 days. |

## Tools

| Tool | Description |
|---|---|
| `create_promo` | Fastest path to a designed promo: an ordered list of scenes → composed via the pattern library → returns a shareable editor link. |
| `create_project` | Reset to a blank source. Optional dimensions, duration, fps, output format. |
| `set_project` | Replace the entire source with a validated JSON object. **The primary way to build** (a composition, or many elements at once). |
| `add_element` / `edit_element` / `delete_element` | Tweak a *single* element in an existing composition. `edit_element` merges a partial element (only the keys you pass change). |
| `get_project` | Return the current Clipkit source JSON. |
| `describe_project` | Plain-language summary — dimensions, timeline by track, element counts, render-time warnings. Cheaper to read than the full JSON. |
| `validate_project` | Schema validation **plus** render-time warnings even when valid (emoji/non-ASCII dropped by the font atlas, elements past the end, missing duration). |
| `preview_still` | Render one frame to a PNG and return it as an image — how a chat-mode agent *sees* its work. Free + rate-limited. |
| `transcribe_to_captions` | Transcribe a media `url` (or local `path`) into a word-timestamped caption element. Whisper in-process — no key, no upload. |
| `open_in_editor` | Validate the current project and return a link that opens it in the Clipkit editor (free). |
| `load_project` | Re-import a shared project by share id or editor URL — the round-trip for `open_in_editor`. |
| `render_video` | Render the current project to a finished MP4 in the cloud (paid — consumes credits, needs `CLIPKIT_API_KEY`). |

Every mutation goes through `@clipkit/protocol`'s validator before being applied. Invalid edits return a structured error with the offending path; valid edits are committed atomically.

## Workflow

1. **Compose** — `create_promo` for a designed video, or write a full source JSON and call `set_project`.
2. **See** — `preview_still` to look at a frame; `validate_project` / `describe_project` for a structural read-back. Loop: edit → `preview_still` → fix.
3. **Tweak** — `add_element` / `edit_element` / `delete_element` for single-element changes to a large composition.
4. **Deliver** — `open_in_editor` for a free editor link (and `load_project` to re-import it later), or `render_video` for a finished MP4.

## State

State is in-memory per server session. Each MCP connection gets a fresh project. There is no persistence; agents that want to save a project should call `get_project` and store the JSON externally.

## Schema reference

See [`@clipkit/protocol`](../schema/README.md) for the full element type catalog (`video`, `image`, `text`, `shape`, `audio`, `composition`, `caption`) and their fields.
