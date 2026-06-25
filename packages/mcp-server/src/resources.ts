// MCP resources exposed by the Clipkit server.
//
// These are read-only docs the client can list and fetch on demand. They
// give an AI agent (Claude Desktop, Cursor in MCP mode, etc.) the same
// authoring context a human would get by browsing the repo:
//
//   clipkit://docs/agents.md     — AGENTS.md (authoring guide)
//   clipkit://docs/protocol.md   — PROTOCOL.md (CKP/1.0 spec)
//   clipkit://docs/brand.md      — BRAND.md (brand reference)
//
// Contents are embedded at build time (see scripts/embed-docs.mjs) so
// the server is self-contained — no FS access required at runtime.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AGENTS_MD, PROTOCOL_MD, BRAND_MD } from './embedded-docs.js';
import { SOURCE_SCHEMA_JSON } from './schema-json.js';

interface DocResource {
  /** Stable identifier used inside the server. */
  name: string;
  /** URI clients see when listing/reading. */
  uri: string;
  /** Human-readable title shown in client UIs. */
  title: string;
  /** Short description; this is what most clients display in pickers. */
  description: string;
  /** The embedded content. */
  content: string;
}

const DOCS: DocResource[] = [
  {
    name: 'clipkit-agents',
    uri: 'clipkit://docs/agents.md',
    title: 'Clipkit — Authoring guide (AGENTS.md)',
    description:
      'AI authoring reference for Clipkit videos. Schema cheat sheet, ' +
      'pattern catalog (HeaderBar / StatBlock / BarChartRow / RankedList / ' +
      'PieCard), recipe gallery pointing at the working example videos, ' +
      'and authoring guidance (pacing, count-ups, staggers). Read this ' +
      'before composing a video.',
    content: AGENTS_MD,
  },
  {
    name: 'clipkit-protocol',
    uri: 'clipkit://docs/protocol.md',
    title: 'Clipkit Protocol v1.0 (PROTOCOL.md)',
    description:
      'Normative specification for the Clipkit Protocol (CKP/1.0). RFC ' +
      '2119 voice — defines Source structure, every element type, the ' +
      'animation model, easing functions, conformance levels (validate / ' +
      'render / export), versioning, and the extension namespace. Source ' +
      'of truth for implementers.',
    content: PROTOCOL_MD,
  },
  {
    name: 'clipkit-brand',
    uri: 'clipkit://docs/brand.md',
    title: 'Clipkit Brand reference (BRAND.md)',
    description:
      'Brand identity: dark surface system (#0A0A0A), two accents only ' +
      '(red #EF4444 + yellow #FFB800), Geist + Geist Mono typography, the ' +
      'three-bar logo construction, voice & tone (direct / concrete / ' +
      'honest / no hype). Use when producing Clipkit-branded assets.',
    content: BRAND_MD,
  },
];

export function registerResources(server: McpServer): void {
  for (const doc of DOCS) {
    server.registerResource(
      doc.name,
      doc.uri,
      {
        title: doc.title,
        description: doc.description,
        mimeType: 'text/markdown',
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: doc.content,
          },
        ],
      }),
    );
  }

  server.registerResource(
    'clipkit-schema',
    'clipkit://schema/source.json',
    {
      title: 'Clipkit Source — JSON Schema',
      description:
        'Machine-readable JSON Schema for a Clipkit Source, generated from the protocol Zod source ' +
        'of truth. The EXACT shape for set_project / add_element — every field, every element type, ' +
        'with types and enums. Read it to author correct JSON instead of guessing field names. ' +
        '(Agents that cannot read resources: use the get_schema tool instead.)',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: SOURCE_SCHEMA_JSON }],
    }),
  );
}
