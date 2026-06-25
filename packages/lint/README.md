# @clipkit/lint

Protocol-aware *soft* checks and plain-language summaries for Clipkit Sources.

These are pure functions over a validated `Source` — no I/O, no rendering. They catch the things
that pass schema validation but still surprise you at render time, and they describe a project in
words so a human or an agent can sanity-check it without rendering. Shared by `@clipkit/cli`
(`explain`, `validate --explain`) and `@clipkit/mcp-server` (`validate_project`,
`describe_project`).

```ts
import { lintSource, describe } from '@clipkit/lint';

for (const w of lintSource(source)) console.log(`${w.where}: ${w.message}`);
console.log(describe(source));
```

## `lintSource(source) → LintWarning[]`

Returns warnings for things the runtime will silently drop or clip:

- **No top-level `duration`** — the runtime can't tell how long the composition is.
- **Element runs past the composition end** — it'll be cut off.
- **Non-ASCII text / caption words** — the runtime text atlas is a fixed ASCII coverage font, so
  emoji, accents, smart quotes, and CJK are silently dropped.

`LintWarning` is `{ where: string; message: string }` — `where` is an element id or `(source)`.

## `describe(source) → string`

A plain-language read-back: dimensions · fps · duration · format, an element breakdown by type, a
per-track timeline (paint order low→high), and the `lintSource` warnings.
