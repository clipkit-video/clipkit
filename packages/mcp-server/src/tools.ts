// Tool registrations for the Clipkit MCP server.
//
// Each tool reads/writes a project via the injected ProjectStore, addressed by
// an optional project_id (the store's single "current" project when omitted).
// Inputs are validated via Zod (raw-shape, MCP SDK convention). Outputs are MCP
// CallToolResult: a content array of text chunks.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OUTPUT_FORMATS, ELEMENT_TYPES, validate } from '@clipkit/protocol';
import { lintSource, describe, unknownKeys, unknownElementKeys, droppedKeys } from '@clipkit/lint';
import { AGENTS_MD, PROTOCOL_MD, BRAND_MD } from './embedded-docs.js';
import { SOURCE_SCHEMA_JSON, elementSchemaJson } from './schema-json.js';
import { toCaptionWords } from '@clipkit/speech-to-text/caption';
// NB: `@clipkit/speech-to-text/node` (the Whisper transcriber) is imported
// DYNAMICALLY inside the transcribe_to_captions handler — never at module top
// level. That module resolves its worker via
// `fileURLToPath(new URL('./worker.js', import.meta.url))`, which a bundler (the
// hosted Next.js /mcp route bundles this file) rewrites into a broken call that
// throws at module-init. Keeping it lazy keeps the heavy node-only path out of
// the route's module graph until a transcription is actually requested.
import { z } from 'zod';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankSource, cloneSource, locateElement } from './state.js';
import { openProject, type ProjectStore } from './project-store.js';
import {
  promo,
  heroReveal,
  kineticHeadline,
  ctaOutro,
  introCard,
  tiltedShowcase,
  statsScene,
  barsScene,
  rankingScene,
  pieScene,
  type ColorName,
  type ThemeName,
  type SceneCtx,
} from '@clipkit/patterns';

// ── promo composition helpers (used by the create_promo tool) ───────────────

const COLORS = ['pink', 'green', 'blue', 'lavender', 'purple', 'yellow', 'gray'] as const;
const colorField = z.enum(COLORS).optional().describe('Accent color slot. Default "green".');
const durationField = z.number().positive().optional().describe('Scene length in seconds. Sensible default per scene type.');

// One scene of a promo — discriminated by `type`, each maps to a pattern that
// bakes in the camera / glass / lighting / motion / layout.
const sceneSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hero'), wordmark: z.string(), tagline: z.string().optional(), color: colorField, duration: durationField }),
  z.object({ type: z.literal('kinetic'), text: z.string(), subtitle: z.string().optional(), color: colorField, duration: durationField }),
  z.object({ type: z.literal('showcase'), screenshot: z.string().url(), color: colorField, duration: durationField }),
  z.object({ type: z.literal('title'), headline: z.string(), kicker: z.string().optional(), subtitle: z.string().optional(), color: colorField, duration: durationField }),
  z.object({ type: z.literal('cta'), wordmark: z.string(), tagline: z.string().optional(), cta: z.string(), color: colorField, duration: durationField }),
  z.object({ type: z.literal('stats'), title: z.string().optional(), dateRange: z.string().optional(), stats: z.array(z.object({ label: z.string(), current: z.number(), previous: z.number().optional() })).min(1).max(4), color: colorField, duration: durationField }),
  z.object({ type: z.literal('bars'), title: z.string().optional(), dateRange: z.string().optional(), bars: z.array(z.object({ label: z.string(), value: z.number(), previous: z.number().optional() })).min(1).max(6), color: colorField, duration: durationField }),
  z.object({ type: z.literal('ranking'), title: z.string().optional(), dateRange: z.string().optional(), items: z.array(z.object({ label: z.string(), value: z.number() })).min(1).max(12), color: colorField, duration: durationField }),
  z.object({ type: z.literal('pie'), title: z.string().optional(), dateRange: z.string().optional(), cards: z.array(z.object({ label: z.string(), value: z.number(), total: z.number(), previous: z.number().optional() })).min(1).max(4), color: colorField, duration: durationField }),
]);
type SceneSpec = z.infer<typeof sceneSchema>;

const DEFAULT_DURATION: Record<SceneSpec['type'], number> = {
  hero: 2.6, kinetic: 2.2, showcase: 3.0, title: 2.4, cta: 2.0,
  stats: 4.0, bars: 4.5, ranking: 4.5, pie: 4.0,
};

function buildSceneElement(s: SceneSpec, ctx: SceneCtx) {
  const color: ColorName = (s.color as ColorName | undefined) ?? 'green';
  const base = { id: ctx.id, theme: ctx.theme, time: ctx.time, duration: ctx.duration, layer: ctx.layer, color };
  const W = ctx.canvasWidth, H = ctx.canvasHeight;
  switch (s.type) {
    case 'hero': return heroReveal({ ...base, canvasWidth: W, canvasHeight: H, wordmark: s.wordmark, tagline: s.tagline });
    case 'kinetic': return kineticHeadline({ ...base, canvasWidth: W, canvasHeight: H, text: s.text, subtitle: s.subtitle });
    case 'title': return introCard({ ...base, canvasWidth: W, canvasHeight: H, headline: s.headline, kicker: s.kicker, subtitle: s.subtitle });
    case 'cta': return ctaOutro({ ...base, canvasWidth: W, canvasHeight: H, wordmark: s.wordmark, tagline: s.tagline, cta: s.cta });
    case 'showcase': return tiltedShowcase({ ...base, x: W / 2, y: H / 2, source: s.screenshot });
    case 'stats': return statsScene({ ...base, canvasWidth: W, canvasHeight: H, title: s.title, dateRange: s.dateRange, stats: s.stats });
    case 'bars': return barsScene({ ...base, canvasWidth: W, canvasHeight: H, title: s.title, dateRange: s.dateRange, bars: s.bars });
    case 'ranking': return rankingScene({ ...base, canvasWidth: W, canvasHeight: H, title: s.title, dateRange: s.dateRange, items: s.items });
    case 'pie': return pieScene({ ...base, canvasWidth: W, canvasHeight: H, title: s.title, dateRange: s.dateRange, cards: s.cards });
  }
}

// POST a Source to the Clipkit share API → an editor URL (or an error string).
// If CLIPKIT_API_KEY is set (a dashboard `ck_live_…` key), the share is sent
// as Bearer auth so it's owned by that team (permanent on paid plans) rather
// than anonymous + TTL'd. CLIPKIT_API_URL overrides the host (e.g. localhost).
async function shareSource(source: unknown): Promise<{ url: string } | { error: string }> {
  const base = process.env.CLIPKIT_API_URL ?? 'https://clipkit.dev';
  const apiKey = process.env.CLIPKIT_API_KEY;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source }),
    });
    if (!res.ok) return { error: `share API returned ${res.status}` };
    const data = (await res.json()) as { url?: string };
    return data.url ? { url: data.url } : { error: 'share API returned no url' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// Fetch a previously shared Source back by share id or editor URL. GET
// /api/projects/:id returns { source }; it's public + read-only, so no key needed.
async function loadShare(idOrUrl: string): Promise<{ source: unknown } | { error: string }> {
  const base = (process.env.CLIPKIT_API_URL ?? 'https://clipkit.dev').replace(/\/$/, '');
  let id = idOrUrl.trim();
  const q = /[?&]id=([^&#]+)/.exec(id);
  if (q) {
    id = decodeURIComponent(q[1]!);
  } else if (/^https?:\/\//i.test(id)) {
    // A URL without ?id= — take the last non-empty path segment.
    try {
      const segs = new URL(id).pathname.split('/').filter(Boolean);
      if (segs.length) id = decodeURIComponent(segs[segs.length - 1]!);
    } catch {
      /* fall through with id as-is */
    }
  }
  try {
    const res = await fetch(`${base}/api/projects/${encodeURIComponent(id)}`);
    if (res.status === 404) return { error: `No share found for "${id}" (it may have expired).` };
    if (!res.ok) return { error: `share API returned ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { source?: unknown };
    return data.source !== undefined ? { source: data.source } : { error: 'share API returned no source' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// Download a remote media file to a temp path so the local Whisper transcriber
// (which reads from the filesystem) can use it. The caller unlinks it when done.
async function fetchToTemp(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let ext = '.bin';
  try {
    const m = /\.([a-z0-9]{1,5})$/i.exec(new URL(url).pathname);
    if (m) ext = m[0];
  } catch {
    /* keep .bin */
  }
  const tmp = join(tmpdir(), `clipkit-transcribe-${Date.now()}-${Math.floor(Math.random() * 1e9)}${ext}`);
  await writeFile(tmp, buf);
  return tmp;
}

// Render ONE frame of a Source via the cloud /api/v1/still endpoint and return a
// base64 PNG (so the agent can SEE its work) — or an error string. Stills are
// FREE + rate-limited; an API key (if set) just grants a more generous bucket.
async function stillSource(
  source: unknown,
  time: number,
): Promise<{ data: string; mimeType: string; width: number; height: number } | { error: string }> {
  const base = (process.env.CLIPKIT_API_URL ?? 'https://clipkit.dev').replace(/\/$/, '');
  const apiKey = process.env.CLIPKIT_API_KEY;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${base}/api/v1/still`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source, time }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: string;
      mimeType?: string;
      width?: number;
      height?: number;
      error?: string;
      message?: string;
    };
    if (res.status === 429) {
      return { error: 'Rate limited — wait a moment, then preview again.' };
    }
    if (!res.ok || !json.data) {
      return { error: json.message ?? json.error ?? `still API returned ${res.status}` };
    }
    return {
      data: json.data,
      mimeType: json.mimeType ?? 'image/png',
      width: json.width ?? 0,
      height: json.height ?? 0,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// Render a Source via the cloud API and return a signed MP4 URL (or an error).
// Cloud rendering is the paid, server-GPU path; it requires CLIPKIT_API_KEY
// (a ck_live_… key from the dashboard) — there are no anonymous cloud renders.
//
// The route is ASYNC (the render runs in a background Cloud Run Job), so this is
// enqueue → poll: POST /api/v1/renders returns a job id immediately; we then
// poll GET /api/v1/renders/:id until status is `done` (→ signed output_url) or
// `failed`. credits are reserved at enqueue; durationMs is wall-clock here.
async function renderSource(
  source: unknown,
  opts: { resolution?: string } = {},
): Promise<{ url: string; credits: number; durationMs: number } | { error: string }> {
  const base = (process.env.CLIPKIT_API_URL ?? 'https://clipkit.dev').replace(/\/$/, '');
  const apiKey = process.env.CLIPKIT_API_KEY;
  if (!apiKey) {
    return {
      error:
        'Cloud render requires CLIPKIT_API_KEY (a ck_live_… key from Settings → API keys). ' +
        'Set it in the MCP server env. To preview without rendering, use open_in_editor or preview_still.',
    };
  }
  const auth = { authorization: `Bearer ${apiKey}` };
  const startedAt = Date.now();

  // ── Enqueue.
  let id: string;
  let credits = 0;
  try {
    const res = await fetch(`${base}/api/v1/renders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ source, ...(opts.resolution ? { resolution: opts.resolution } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      credits_reserved?: number;
      error?: string;
      message?: string;
    };
    if (res.status === 401) return { error: 'Unauthorized — CLIPKIT_API_KEY was rejected.' };
    if (res.status === 402) return { error: data.message ?? 'Quota exceeded — upgrade your plan.' };
    if (res.status === 413) return { error: 'Source too large (2 MB max).' };
    if (!res.ok || !data.id) return { error: data.error ?? `render API returned ${res.status}` };
    id = data.id;
    credits = data.credits_reserved ?? 0;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  // ── Poll until done/failed (10-minute cap).
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    if (Date.now() > deadline) return { error: 'Render timed out after 10 minutes.' };
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(`${base}/api/v1/renders/${id}`, { headers: auth });
      if (!res.ok) continue; // transient — keep polling
      const s = (await res.json()) as {
        status: string;
        output_url?: string | null;
        error?: string | null;
      };
      if (s.status === 'done') {
        return s.output_url
          ? { url: s.output_url, credits, durationMs: Date.now() - startedAt }
          : { error: 'Render finished but returned no download URL.' };
      }
      if (s.status === 'failed') return { error: s.error ?? 'Render failed.' };
    } catch {
      continue; // transient network blip — keep polling until the deadline
    }
  }
}

// Format an "unrecognized keys" note for an authoring tool's result, so the
// agent learns the schema when it guesses a wrong field name. Two distinct
// failure modes — and they debug differently, so label them: `kept` keys
// (passthrough objects) survive into the saved project but the runtime ignores
// them; `stripped` keys (closed objects) are removed during validation and are
// gone from the project you get back.
function unknownNote(kept: string[], stripped: string[]): string {
  const total = kept.length + stripped.length;
  if (!total) return '';
  const cap = (xs: string[]) =>
    xs.slice(0, 10).join(', ') + (xs.length > 10 ? `, +${xs.length - 10} more` : '');
  const lines = [
    `\n⚠ ${total} key${total === 1 ? '' : 's'} not in the schema (check spelling/nesting, or call ` +
      `get_schema for the exact fields):`,
  ];
  if (kept.length) lines.push(`  • kept but ignored by the runtime: ${cap(kept)}`);
  if (stripped.length) lines.push(`  • stripped on save (not in the saved project): ${cap(stripped)}`);
  return lines.join('\n');
}

// An editor link for a project. If the store is itself the editor's database (a
// hosted store that exposes editorUrl), link straight to the existing row — no
// snapshot copy. Otherwise (local stdio / in-memory) persist a share via the API.
async function editorLinkFor(
  store: ProjectStore,
  projectId: string,
  source: unknown,
): Promise<{ url: string } | { error: string }> {
  if (store.editorUrl) {
    const url = await store.editorUrl(projectId);
    if (url) return { url };
  }
  return shareSource(source);
}

// Optional project handle shared by every stateful tool. Omitted → the store's
// "current" project (the single local project on stdio); on a hosted,
// sessionless server it must be supplied so each call names the project it
// acts on (the returned id comes from create_project / set_project / etc.).
const projectIdField = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Which project to act on — the id returned by create_project / set_project / ' +
    'create_promo / load_project. Omit when working on a single local project.',
  );

/**
 * Register the Clipkit tools on `server`.
 *
 * `options.localTranscription` (default true) gates `transcribe_to_captions`,
 * which runs Whisper in a child process and needs ffmpeg + a writable FS. Hosts
 * that can't provide those — the hosted /mcp route on serverless — pass `false`
 * so the tool isn't advertised where it would always fail. (A hosted STT path,
 * via render-service or a hosted endpoint, is a TODO — figure out later.)
 */
export function registerTools(
  server: McpServer,
  store: ProjectStore,
  options: { localTranscription?: boolean } = {},
): void {
  const { localTranscription = true } = options;
  // ─── read_docs ────────────────────────────────────────────────────────────

  server.registerTool(
    'read_docs',
    {
      title: 'Read the Clipkit authoring docs',
      annotations: { readOnlyHint: true },
      description:
        'Return a canonical Clipkit doc as text. topic "agents" = the authoring guide (schema cheat ' +
        'sheet, pattern catalog, recipes, guidance — read this BEFORE composing); "protocol" = the ' +
        'formal field spec; "brand" = brand reference. (Same docs offered as MCP resources, exposed ' +
        'as a tool so you can read them directly — resources are not always model-readable.)',
      inputSchema: {
        topic: z.enum(['agents', 'protocol', 'brand']).optional().describe('Which doc. Default "agents".'),
      },
    },
    async ({ topic }) => {
      const t = topic ?? 'agents';
      const doc = t === 'protocol' ? PROTOCOL_MD : t === 'brand' ? BRAND_MD : AGENTS_MD;
      return { content: [{ type: 'text', text: doc }] };
    },
  );

  // ─── get_schema ───────────────────────────────────────────────────────────

  server.registerTool(
    'get_schema',
    {
      title: 'Get the Clipkit JSON Schema (exact fields)',
      annotations: { readOnlyHint: true },
      description:
        'Return the authoritative JSON Schema for a Clipkit Source — exact field names, types, and ' +
        'enums, generated from the protocol. Call with no argument for the full Source schema, or ' +
        'with element_type (e.g. "text", "shape", "particles") for just that element\'s fields (much ' +
        'smaller). Use this when authoring with set_project / add_element so you never guess a field.',
      inputSchema: {
        element_type: z
          .enum(ELEMENT_TYPES)
          .optional()
          .describe('Limit to one element type\'s fields (e.g. "text"). Omit for the full Source schema (large).'),
      },
    },
    async ({ element_type }) => {
      if (element_type) {
        const js = elementSchemaJson(element_type);
        return {
          content: [{ type: 'text', text: js ?? `No schema found for element type "${element_type}".` }],
        };
      }
      return { content: [{ type: 'text', text: SOURCE_SCHEMA_JSON }] };
    },
  );

  // ─── create_project ─────────────────────────────────────────────────────

  server.registerTool(
    'create_project',
    {
      title: 'Create a new Clipkit project',
      outputSchema: {
        project_id: z.string().describe('Id of the created project — pass to subsequent tools.'),
        width: z.number().optional(),
        height: z.number().optional(),
        duration: z.number().optional(),
        frame_rate: z.number().optional(),
        output_format: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        'Create a new, blank Clipkit project with the given dimensions and duration, and return its ' +
        'project_id. Defaults: 1920×1080, 10 seconds, 30 fps, output_format "mp4". ' +
        'Call this first when starting a new video. Pass an existing project_id to reset that project ' +
        'to blank; omit it to start a fresh project (note the returned id for subsequent tools).',
      inputSchema: {
        width: z.number().int().positive().optional().describe('Composition width in pixels. Default 1920.'),
        height: z.number().int().positive().optional().describe('Composition height in pixels. Default 1080.'),
        duration: z.number().positive().optional().describe('Composition duration in seconds. Default 10.'),
        frame_rate: z.number().positive().optional().describe('Frame rate. Default 30.'),
        output_format: z
          .enum(OUTPUT_FORMATS)
          .optional()
          .describe('Output container/codec. Default "mp4".'),
        background_color: z.string().optional().describe('Hex color, e.g. "#000000".'),
        project_id: projectIdField,
      },
    },
    async (args) => {
      const next = blankSource();
      if (args.width !== undefined) next.width = args.width;
      if (args.height !== undefined) next.height = args.height;
      if (args.duration !== undefined) next.duration = args.duration;
      if (args.frame_rate !== undefined) next.frame_rate = args.frame_rate;
      if (args.output_format !== undefined) next.output_format = args.output_format;
      if (args.background_color !== undefined) next.background_color = args.background_color;
      const id = await store.put(args.project_id, next);
      return {
        content: [
          {
            type: 'text',
            text: `Created new project (project_id: ${id}): ${next.width}×${next.height}, ${next.duration}s, ${next.frame_rate}fps, ${next.output_format}.`,
          },
        ],
        structuredContent: {
          project_id: id,
          width: next.width,
          height: next.height,
          duration: next.duration,
          frame_rate: next.frame_rate,
          output_format: next.output_format,
        },
      };
    },
  );

  // ─── get_project ────────────────────────────────────────────────────────

  server.registerTool(
    'get_project',
    {
      title: 'Get the current Clipkit project JSON',
      annotations: { readOnlyHint: true },
      description:
        'Return the full current Clipkit source as JSON. Use this to inspect the project, ' +
        'pass it to a render pipeline, or compose follow-up edits.',
      inputSchema: {
        project_id: projectIdField,
      },
    },
    async (args) => {
      const p = await openProject(store, args.project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(p.project.source, null, 2) }],
      };
    },
  );

  // ─── describe_project ─────────────────────────────────────────────────────

  server.registerTool(
    'describe_project',
    {
      title: 'Describe the current project in plain language',
      annotations: { readOnlyHint: true },
      description:
        'Return a compact, human-readable summary of the current project — dimensions, fps, ' +
        'duration, an element breakdown by type, a per-track timeline (paint order low→high), and ' +
        "render-time warnings. Much cheaper to read than get_project's full JSON; use it to orient " +
        'yourself or sanity-check structure without dumping the whole source.',
      inputSchema: {
        project_id: projectIdField,
      },
    },
    async (args) => {
      const p = await openProject(store, args.project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const result = validate(p.project.source);
      if (!result.valid) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: "The project doesn't validate, so it can't be summarized. Run validate_project to see the errors.",
            },
          ],
        };
      }
      return { content: [{ type: 'text', text: describe(result.data) }] };
    },
  );

  // ─── set_project ────────────────────────────────────────────────────────

  server.registerTool(
    'set_project',
    {
      title: 'Replace the entire Clipkit project',
      outputSchema: {
        project_id: z.string(),
        element_count: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        duration: z.number().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      description:
        'Replace the entire project with the given source JSON, returning its project_id. This is the ' +
        'PRIMARY way to build: use it to create a composition or to add/change many elements at once. ' +
        '(To tweak a single element in an existing project, use edit_element / add_element / ' +
        'delete_element instead.) Pass an existing project_id to replace that project; omit it to ' +
        'create a new one (note the returned id). ' +
        'The input is validated against the @clipkit/protocol before being accepted; invalid inputs ' +
        'return an error. Shape: { width, height, duration, frame_rate, output_format, ' +
        'background_color?, fonts?, camera?, lights?, elements:[…] }; every element has a `type` plus ' +
        'base fields (id, x, y, width, height, time, duration, track, opacity, rotation, animations, ' +
        'keyframe_animations) and type-specific fields. For exact field names + types call get_schema ' +
        '(optionally with an element_type) — the runtime ignores unrecognized keys, and this tool ' +
        'flags any it does not recognize.',
      inputSchema: {
        source: z.unknown().describe('A full Clipkit source object (or JSON string).'),
        project_id: projectIdField,
      },
    },
    async (args) => {
      const result = validate(args.source);
      if (!result.valid) {
        const summary = result.errors
          .slice(0, 5)
          .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('; ');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Validation failed: ${summary}${result.errors.length > 5 ? ` (+${result.errors.length - 5} more)` : ''}`,
            },
          ],
        };
      }
      const id = await store.put(args.project_id, result.data);
      let parsedInput: unknown = args.source;
      if (typeof args.source === 'string') {
        try {
          parsedInput = JSON.parse(args.source);
        } catch {
          parsedInput = {};
        }
      }
      const note = unknownNote(unknownKeys(parsedInput), droppedKeys(parsedInput, result.data));
      return {
        content: [
          {
            type: 'text',
            text: `Project replaced (project_id: ${id}). ${result.data.elements.length} elements, ${result.data.duration ?? '?'}s, ${result.data.width ?? '?'}×${result.data.height ?? '?'}.${note}`,
          },
        ],
        structuredContent: {
          project_id: id,
          element_count: result.data.elements.length,
          width: result.data.width,
          height: result.data.height,
          duration: result.data.duration,
        },
      };
    },
  );

  // ─── add_element ────────────────────────────────────────────────────────

  server.registerTool(
    'add_element',
    {
      title: 'Add an element to the current project',
      outputSchema: {
        added_element_id: z.string().optional(),
        element_type: z.string().optional(),
        parent_id: z.string().optional(),
        top_level_element_count: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        'Append a single element to an existing project — a TWEAK, e.g. dropping in one more caption ' +
        'or shape. By default it is added at the top level; pass parent_id to add it INTO a group ' +
        '(nested). The element is any valid schema element: video, image, text, shape, audio, group, ' +
        'caption, or particles. To create a composition or add several elements at once, build the ' +
        'JSON and use set_project instead. The new element is validated as part of the project as a ' +
        'whole before being added. Call get_schema(element_type) for the exact per-type fields; ' +
        'unrecognized keys are flagged.',
      inputSchema: {
        element: z.unknown().describe('A Clipkit element object. Must include `type`.'),
        parent_id: z
          .string()
          .min(1)
          .optional()
          .describe('Optional id of a group to add this element INTO (nested). Omit to add at the top level.'),
        project_id: projectIdField,
      },
    },
    async (args) => {
      // Validate by adding to a copy of the source and running full validation.
      // With parent_id, add INTO that group's children; otherwise at the top level.
      const p = await openProject(store, args.project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const trial = cloneSource(p.project.source);
      let where = 'the project';
      if (args.parent_id) {
        const loc = locateElement(trial.elements, args.parent_id);
        if (!loc) {
          return {
            isError: true,
            content: [{ type: 'text', text: `No element with id "${args.parent_id}" to add into.` }],
          };
        }
        if (!Array.isArray(loc.element.elements)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Element "${args.parent_id}" is not a group, so it has no children to add into.` }],
          };
        }
        (loc.element.elements as unknown[]).push(args.element);
        where = `group "${args.parent_id}"`;
      } else {
        trial.elements.push(args.element as never);
      }
      const result = validate(trial);
      if (!result.valid) {
        const summary = result.errors
          .slice(0, 5)
          .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('; ');
        return {
          isError: true,
          content: [
            { type: 'text', text: `Element rejected by schema: ${summary}` },
          ],
        };
      }
      await p.project.save(result.data);
      const elObj = args.element as Record<string, unknown> | undefined;
      const addedId = elObj && typeof elObj.id === 'string' ? elObj.id : undefined;
      const after = addedId
        ? locateElement(result.data.elements as unknown[], addedId)?.element
        : args.parent_id
          ? undefined
          : (result.data.elements[result.data.elements.length - 1] as unknown as Record<string, unknown>);
      const note = unknownNote(unknownElementKeys(args.element), after ? droppedKeys(args.element, after) : []);
      return {
        content: [
          {
            type: 'text',
            text: `Added ${String(elObj?.type ?? 'element')} element${addedId ? ` (id: ${addedId})` : ''} to ${where}. Project now has ${result.data.elements.length} top-level elements.${note}`,
          },
        ],
        structuredContent: {
          added_element_id: addedId,
          element_type: typeof elObj?.type === 'string' ? elObj.type : undefined,
          parent_id: args.parent_id,
          top_level_element_count: result.data.elements.length,
        },
      };
    },
  );

  // ─── edit_element ─────────────────────────────────────────────────────────

  server.registerTool(
    'edit_element',
    {
      title: 'Tweak one existing element (merge changed fields)',
      outputSchema: {
        element_id: z.string(),
        changed_keys: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        'Change fields on the element with the given id by merging in a partial element — only the ' +
        'keys you include change. The id may be any element ANYWHERE in the tree, including one nested ' +
        'inside a group (or its mask). Pass a whole nested value (e.g. a new `keyframe_animations` array) ' +
        'to replace that key; set a key to null to remove it. This is for TWEAKING an existing ' +
        'composition. To create a composition or change many elements at once, edit the JSON and ' +
        'call set_project instead. The result is re-validated before being accepted.',
      inputSchema: {
        id: z.string().min(1).describe('The id of the element to edit.'),
        patch: z
          .record(z.unknown())
          .describe('Partial element: the fields to change. Omitted keys are left as-is; a key set to null is removed.'),
        project_id: projectIdField,
      },
    },
    async (args) => {
      // Merge the patch onto a snapshot, validate, then commit. The element may be
      // anywhere in the tree — top-level, a group's children, or a mask's.
      const p = await openProject(store, args.project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const trial = cloneSource(p.project.source);
      const loc = locateElement(trial.elements, args.id);
      if (!loc) {
        return {
          isError: true,
          content: [{ type: 'text', text: `No element with id "${args.id}".` }],
        };
      }
      const el = loc.element;
      for (const [k, v] of Object.entries(args.patch as Record<string, unknown>)) {
        if (v === null) delete el[k];
        else el[k] = v;
      }
      const result = validate(trial);
      if (!result.valid) {
        const summary = result.errors
          .slice(0, 5)
          .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('; ');
        return {
          isError: true,
          content: [{ type: 'text', text: `Edit rejected by schema: ${summary}` }],
        };
      }
      await p.project.save(result.data);
      const keys = Object.keys(args.patch as Record<string, unknown>);
      const after = locateElement(result.data.elements as unknown[], args.id)?.element ?? el;
      const note = unknownNote(unknownElementKeys(el), droppedKeys(el, after));
      return {
        content: [
          { type: 'text', text: `Edited ${args.id} (${keys.join(', ') || 'no changes'}).${note}` },
        ],
        structuredContent: { element_id: args.id, changed_keys: keys },
      };
    },
  );

  // ─── delete_element ───────────────────────────────────────────────────────

  server.registerTool(
    'delete_element',
    {
      title: 'Delete one element by id',
      outputSchema: {
        deleted_element_id: z.string(),
        top_level_element_count: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      description:
        'Delete the element with the given id, anywhere in the tree (including one nested inside a ' +
        'group or its mask) — a tweak to an existing composition. (The project must keep at least ' +
        'one top-level element.)',
      inputSchema: {
        id: z.string().min(1).describe('The id of the element to delete.'),
        project_id: projectIdField,
      },
    },
    async (args) => {
      const p = await openProject(store, args.project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const trial = cloneSource(p.project.source);
      const loc = locateElement(trial.elements, args.id);
      if (!loc) {
        return {
          isError: true,
          content: [{ type: 'text', text: `No element with id "${args.id}".` }],
        };
      }
      loc.container.splice(loc.index, 1);
      // Deleting an element should never break the schema (the only "minimum" is
      // elements.length >= 1), but re-validate to catch that case.
      const result = validate(trial);
      if (!result.valid) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Deleting "${args.id}" would leave the project invalid: ${result.errors[0]?.message ?? ''}. The project must keep at least one element.`,
            },
          ],
        };
      }
      await p.project.save(result.data);
      return {
        content: [{ type: 'text', text: `Deleted element ${args.id}.` }],
        structuredContent: {
          deleted_element_id: args.id,
          top_level_element_count: result.data.elements.length,
        },
      };
    },
  );

  // ─── validate_project ─────────────────────────────────────────────────────

  server.registerTool(
    'validate_project',
    {
      title: 'Validate the current project (schema + render-time warnings)',
      outputSchema: {
        valid: z.boolean(),
        error_count: z.number(),
        errors: z.array(z.string()).optional(),
        warnings: z.array(z.string()).optional(),
        unknown_keys: z.array(z.string()).optional(),
        element_count: z.number().optional(),
        duration: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      },
      annotations: { readOnlyHint: true },
      description:
        'Run the @clipkit/protocol validator against the current project AND surface render-time ' +
        'warnings even when the JSON is valid — things that pass the schema but the runtime will ' +
        'silently drop or clip: emoji / non-ASCII text (the runtime font atlas is ASCII-only), ' +
        'elements that run past the composition end, a missing top-level duration. Run it before ' +
        'you share or render the project. For a fuller timeline read-back, use describe_project.',
      inputSchema: {
        project_id: projectIdField,
      },
    },
    async (args) => {
      const p = await openProject(store, args.project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const result = validate(p.project.source);
      if (!result.valid) {
        const details = result.errors
          .map((e) => `  • ${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('\n');
        return {
          isError: true,
          content: [
            { type: 'text', text: `Invalid. ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}:\n${details}` },
          ],
          structuredContent: {
            valid: false,
            error_count: result.errors.length,
            errors: result.errors.map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`),
          },
        };
      }
      const s = result.data;
      const head = `Valid. ${s.elements.length} elements, ${s.duration ?? '?'}s, ${s.width ?? '?'}×${s.height ?? '?'}.`;
      const warnings = lintSource(s);
      // Unrecognized keys still sitting in the saved project — the kept/passthrough
      // kind (stripped keys are already gone, so only these are observable here).
      // Surfaces junk introduced earlier or via load_project that the write-time
      // check on set_project wouldn't catch on a re-run.
      const keyNote = unknownNote(unknownKeys(s), []);
      if (warnings.length === 0 && !keyNote) {
        return {
          content: [{ type: 'text', text: `${head}\n✓ No warnings.` }],
          structuredContent: {
            valid: true,
            error_count: 0,
            warnings: [],
            unknown_keys: [],
            element_count: s.elements.length,
            duration: s.duration,
            width: s.width,
            height: s.height,
          },
        };
      }
      const warnText = warnings.length
        ? `\n\nRender-time warnings (valid, but will look wrong):\n${warnings.map((w) => `  ⚠ ${w.where}: ${w.message}`).join('\n')}`
        : '';
      return {
        content: [{ type: 'text', text: `${head}${warnText}${keyNote}` }],
        structuredContent: {
          valid: true,
          error_count: 0,
          warnings: warnings.map((w) => `${w.where}: ${w.message}`),
          unknown_keys: unknownKeys(s),
          element_count: s.elements.length,
          duration: s.duration,
          width: s.width,
          height: s.height,
        },
      };
    },
  );

  // ─── preview_still ────────────────────────────────────────────────────────

  server.registerTool(
    'preview_still',
    {
      title: 'Render one frame of the current project so you can SEE it',
      outputSchema: {
        time: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        mime_type: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        'Render a single frame of the current project to a PNG and return it as an image you can ' +
        'look at. This is how you check your work — in chat there is no other way to see what a ' +
        'composition actually looks like. Use it liberally: after composing, after edits, and at ' +
        'different times to inspect motion. Stills are FREE (credits are only spent by ' +
        'render_video). Pass `time` (seconds) to choose the frame; defaults to 0.',
      inputSchema: {
        time: z
          .number()
          .min(0)
          .optional()
          .describe('Composition time in seconds to capture. Default 0 (first frame).'),
        project_id: projectIdField,
      },
    },
    async ({ time, project_id }) => {
      const p = await openProject(store, project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const src = p.project.source;
      const result = validate(src);
      if (!result.valid) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Cannot preview: the project is invalid. Run validate_project to see the errors.' },
          ],
        };
      }
      const t = time ?? 0;
      const still = await stillSource(src, t);
      if ('error' in still) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Could not render a preview frame: ${still.error}` }],
        };
      }
      return {
        content: [
          { type: 'text', text: `Frame at ${t}s (${still.width}×${still.height}):` },
          { type: 'image', data: still.data, mimeType: still.mimeType },
        ],
        structuredContent: {
          time: t,
          width: still.width,
          height: still.height,
          mime_type: still.mimeType,
        },
      };
    },
  );

  // ─── transcribe_to_captions ───────────────────────────────────────────────

  // Gated: Whisper runs in a child process and needs ffmpeg + a writable FS, so
  // hosts that can't run it (the serverless /mcp route) pass
  // localTranscription:false and this tool isn't advertised there — see registerTools.
  if (localTranscription) {
    server.registerTool(
      'transcribe_to_captions',
      {
        title: 'Transcribe speech into a word-timestamped caption element',
        outputSchema: {
          word_count: z.number(),
          duration_seconds: z.number(),
          text: z.string(),
          added: z.boolean(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        description:
          'Transcribe an audio or video file into a word-timestamped `caption` element (the protocol ' +
          'renders these). Captions need real per-word timings, which can only come from actual ' +
          'speech-to-text — this runs Whisper in the server process (no API key, no third-party ' +
          'upload). Provide a `url` (fetched server-side — use this in chat-mode, where there is no ' +
          'local file) OR a local `path`. Requires ffmpeg on the host. By default the caption is added ' +
          'to the current project; set add:false to only return it.',
        inputSchema: {
          url: z.string().url().optional().describe('Public URL of an audio/video file to fetch and transcribe. Use this OR path.'),
          path: z.string().optional().describe('Local path to an audio/video file (Claude Desktop / local servers). Use this OR url.'),
          model: z.string().optional().describe("Whisper model id. Default 'Xenova/whisper-base'. Use '…-tiny.en' for speed, '…-small' for accuracy."),
          language: z.string().optional().describe('Force a language code (e.g. "en"); omit to auto-detect.'),
          layer: z.number().int().optional().describe('Layer for the caption element (lower = nearer front, layer 1 on top). Default 3.'),
          add: z.boolean().optional().describe('Add the caption to the current project. Default true.'),
          project_id: projectIdField,
        },
      },
      async (args) => {
        // Resolve the media to a local path: download a url to a temp file, or use
        // the given local path. (Whisper reads from the filesystem.)
        let mediaPath = args.path;
        let tempPath: string | null = null;
        if (!mediaPath && args.url) {
          try {
            tempPath = await fetchToTemp(args.url);
            mediaPath = tempPath;
          } catch (e) {
            return { isError: true, content: [{ type: 'text', text: `Could not download ${args.url}: ${e instanceof Error ? e.message : String(e)}` }] };
          }
        }
        if (!mediaPath) {
          return { isError: true, content: [{ type: 'text', text: 'Provide either `url` (remote file) or `path` (local file) to transcribe.' }] };
        }

        let result;
        try {
          const { transcribeFile } = await import('@clipkit/speech-to-text/node');
          result = await transcribeFile(mediaPath, { model: args.model, language: args.language });
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: `Transcription failed: ${e instanceof Error ? e.message : String(e)}` }] };
        } finally {
          if (tempPath) await unlink(tempPath).catch(() => {});
        }

        const words = toCaptionWords(result);
        if (words.length === 0) {
          return { isError: true, content: [{ type: 'text', text: 'No speech detected in the file.' }] };
        }
        const element = { type: 'caption', time: 0, layer: args.layer ?? 3, words };

        let note = '';
        if (args.add !== false) {
          const p = await openProject(store, args.project_id);
          if (!p.ok) {
            return { isError: true, content: [{ type: 'text', text: p.error }] };
          }
          const trial = cloneSource(p.project.source);
          trial.elements.push(element as never);
          const v = validate(trial);
          if (!v.valid) {
            return { isError: true, content: [{ type: 'text', text: `Caption rejected by schema: ${v.errors.slice(0, 3).map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`).join('; ')}` }] };
          }
          await p.project.save(v.data);
          note = ' (added to the project)';
        }

        const preview = result.text.length > 80 ? result.text.slice(0, 80) + '…' : result.text;
        return {
          content: [
            { type: 'text', text: `Transcribed ${result.duration.toFixed(1)}s into ${words.length} words${note}: "${preview}"` },
            { type: 'text', text: JSON.stringify(element) },
          ],
          structuredContent: {
            word_count: words.length,
            duration_seconds: result.duration,
            text: result.text,
            added: args.add !== false,
          },
        };
      },
    );
  }

  // ─── create_promo ─────────────────────────────────────────────────────────

  server.registerTool(
    'create_promo',
    {
      title: 'Compose a designed promo from prebuilt scenes (one fast option)',
      outputSchema: {
        project_id: z.string(),
        scene_count: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        duration: z.number().optional(),
        editor_url: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Assemble a designed-looking promo/intro/product/data video from the Clipkit pattern ' +
        'library: give an ordered list of SCENES and the words, and it bakes in the camera, glass, ' +
        'lighting, motion blur, timing, and layout, then returns an editor link. This is a FAST ' +
        'option when a conventional promo structure fits — it is NOT the only way to make a video ' +
        'and NOT a default; for anything specific or original, author the JSON yourself and call ' +
        'set_project (the full creative range). When you do use this, MIX scene types to fit the ' +
        'brief and vary the structure — a video can be a single kinetic headline, three title ' +
        'cards, a showcase montage, or a data explainer; you do NOT need a hero or a cta. ' +
        'Scene types: ' +
        'hero (glass-orb logo reveal: wordmark, tagline?), ' +
        'kinetic (letter-fly headline: text, subtitle?), ' +
        'showcase (a screenshot tilted in 3D: screenshot URL), ' +
        'title (full-frame title card: headline, kicker?, subtitle?), ' +
        'cta (closing card with a glass button: wordmark, tagline?, cta), ' +
        'stats (hero numbers: stats[{label,current,previous?}], title?), ' +
        'bars (bar chart: bars[{label,value,previous?}], title?), ' +
        'ranking (top-N list: items[{label,value}], title?), ' +
        'pie (pie cards: cards[{label,value,total,previous?}], title?). ' +
        'The data scenes (stats/bars/ranking/pie) look best with theme "mux".',
      inputSchema: {
        scenes: z
          .array(sceneSchema)
          .min(1)
          .describe('Ordered scenes; mix types to fit the brief — you do NOT need hero/cta. e.g. a single [{type:"kinetic",text:"…"}], a sequence [{type:"title",headline:"…"},{type:"showcase",screenshot:"…"},{type:"title",headline:"…"}], or a data piece [{type:"ranking",title:"…",items:[…]}]'),
        theme: z.enum(['cinematic', 'mux', 'minimal']).optional().describe('Visual theme. Default "cinematic" (dark, serif, premium).'),
        motion_blur: z.number().int().min(0).max(32).optional().describe('Supersampled motion-blur samples (≥2 enables it — nicer but slower to render). Default off.'),
        width: z.number().int().positive().optional().describe('Default 1920.'),
        height: z.number().int().positive().optional().describe('Default 1080.'),
        project_id: projectIdField,
      },
    },
    async (args) => {
      const scenes = (args.scenes as SceneSpec[]).map((s) => ({
        duration: s.duration ?? DEFAULT_DURATION[s.type],
        build: (ctx: SceneCtx) => buildSceneElement(s, ctx),
      }));
      const source = promo({
        theme: args.theme ?? 'cinematic',
        scenes,
        width: args.width ?? 1920,
        height: args.height ?? 1080,
        ...(args.motion_blur !== undefined ? { motionBlur: args.motion_blur } : {}),
      });
      const id = await store.put(args.project_id, source);
      const dims = `${source.width}×${source.height}, ${source.duration}s, project_id: ${id}`;
      const shared = await editorLinkFor(store, id, source);
      if ('error' in shared) {
        return {
          content: [{ type: 'text', text: `Composed a ${scenes.length}-scene promo (${dims}). Could not create a share link (${shared.error}). The full source is available via get_project.` }],
          structuredContent: {
            project_id: id,
            scene_count: scenes.length,
            width: source.width,
            height: source.height,
            duration: source.duration,
          },
        };
      }
      return {
        content: [{ type: 'text', text: `Composed a ${scenes.length}-scene promo (${dims}).\n\nOpen it in the editor:\n${shared.url}` }],
        structuredContent: {
          project_id: id,
          scene_count: scenes.length,
          width: source.width,
          height: source.height,
          duration: source.duration,
          editor_url: shared.url,
        },
      };
    },
  );

  // ─── open_in_editor ───────────────────────────────────────────────────────

  server.registerTool(
    'open_in_editor',
    {
      title: 'Create a shareable link that opens the current project in the editor',
      outputSchema: {
        editor_url: z.string(),
        project_id: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      description:
        'Validate the current project and create a link that opens it in the Clipkit web editor, ' +
        'where the user can preview and refine it. This shares the PROJECT (nothing is rendered — ' +
        "that's render_video). Use after composing or editing. Returns a URL.",
      inputSchema: {
        project_id: projectIdField,
      },
    },
    async (args) => {
      const p = await openProject(store, args.project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const src = p.project.source;
      const result = validate(src);
      if (!result.valid) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Cannot open in the editor: the project is invalid. Run validate_project to see the errors.' }],
        };
      }
      const link = await editorLinkFor(store, p.project.id, src);
      if ('error' in link) {
        return { isError: true, content: [{ type: 'text', text: `Could not create an editor link: ${link.error}` }] };
      }
      return {
        content: [{ type: 'text', text: `Open in the editor:\n${link.url}` }],
        structuredContent: { editor_url: link.url, project_id: p.project.id },
      };
    },
  );

  // ─── load_project ─────────────────────────────────────────────────────────

  server.registerTool(
    'load_project',
    {
      title: 'Load a shared project back into the session',
      outputSchema: {
        project_id: z.string(),
        element_count: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        duration: z.number().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Import a previously shared project as the current project, by its share id or its editor ' +
        'URL (e.g. https://clipkit.dev/editor?id=…), returning its project_id. Use this to continue ' +
        'working on a project the user opened in the editor or shared earlier — the round-trip for ' +
        'open_in_editor. Pass an existing project_id to load into that project; omit it to load into ' +
        'a new one.',
      inputSchema: {
        id_or_url: z.string().min(1).describe('A share id, or a clipkit.dev/editor?id=… URL.'),
        project_id: projectIdField,
      },
    },
    async (args) => {
      const loaded = await loadShare(args.id_or_url);
      if ('error' in loaded) {
        return { isError: true, content: [{ type: 'text', text: `Could not load project: ${loaded.error}` }] };
      }
      const result = validate(loaded.source);
      if (!result.valid) {
        const summary = result.errors
          .slice(0, 3)
          .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('; ');
        return { isError: true, content: [{ type: 'text', text: `The loaded project did not validate: ${summary}` }] };
      }
      const id = await store.put(args.project_id, result.data);
      const note = unknownNote(unknownKeys(result.data), []);
      return {
        content: [
          {
            type: 'text',
            text: `Loaded project (project_id: ${id}). ${result.data.elements.length} elements, ${result.data.duration ?? '?'}s, ${result.data.width ?? '?'}×${result.data.height ?? '?'}.${note}`,
          },
        ],
        structuredContent: {
          project_id: id,
          element_count: result.data.elements.length,
          width: result.data.width,
          height: result.data.height,
          duration: result.data.duration,
        },
      };
    },
  );

  // ─── render_video ─────────────────────────────────────────────────────────

  server.registerTool(
    'render_video',
    {
      title: 'Render the current project to an MP4 in the cloud',
      outputSchema: {
        download_url: z.string(),
        credits: z.number(),
        duration_seconds: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      description:
        'Validate the current Clipkit project and render it to a finished MP4 on Clipkit\'s servers, ' +
        'returning a downloadable URL. This is the paid path — it consumes render credits and requires ' +
        'CLIPKIT_API_KEY to be configured. Use open_in_editor instead to just open the project in the editor ' +
        'for free. Rendering is synchronous and may take a while for long or high-resolution videos.',
      inputSchema: {
        resolution: z
          .enum(['source', '720p', '1080p', '1440p', '4k'])
          .optional()
          .describe('Output resolution. Defaults to the source dimensions. Higher resolutions cost more credits.'),
        project_id: projectIdField,
      },
    },
    async ({ resolution, project_id }) => {
      const p = await openProject(store, project_id);
      if (!p.ok) {
        return { isError: true, content: [{ type: 'text', text: p.error }] };
      }
      const src = p.project.source;
      const result = validate(src);
      if (!result.valid) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Cannot render: the project is invalid. Run validate_project to see the errors.' }],
        };
      }
      const rendered = await renderSource(src, resolution ? { resolution } : {});
      if ('error' in rendered) {
        return { isError: true, content: [{ type: 'text', text: `Render failed: ${rendered.error}` }] };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Rendered in ${(rendered.durationMs / 1000).toFixed(1)}s for ${rendered.credits} credit${rendered.credits === 1 ? '' : 's'}.\n\nDownload (link valid ~1 hour):\n${rendered.url}`,
          },
        ],
        structuredContent: {
          download_url: rendered.url,
          credits: rendered.credits,
          duration_seconds: rendered.durationMs / 1000,
        },
      };
    },
  );
}
