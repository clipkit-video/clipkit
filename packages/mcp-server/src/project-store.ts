// ProjectStore — the persistence seam for MCP project state.
//
// Tools don't hold a Source; they ask the store to load/save one by id. That
// indirection is what lets the same tool code run two very different ways:
//
//   • local stdio — one in-memory project per process (InMemoryProjectStore).
//     project_id is optional and defaults to the single "current" project, so
//     the local UX is unchanged: create_project / set_project then edit.
//
//   • hosted HTTP — many concurrent projects in a shared DB, the server fully
//     SESSIONLESS. Each tool call carries an explicit project_id; the Supabase
//     adapter (in apps/web) returns null from currentId(), so a missing id is a
//     clear error rather than a cross-tenant guess.
//
// Going sessionless (no Mcp-Session-Id) and keying on a client-supplied
// project_id is both the most portable choice across MCP clients (Codex,
// Gemini CLI, Cursor, Cline, …) and the direction the spec is moving — the
// 2026-07-28 release candidate drops protocol sessions entirely so "any MCP
// request can land on any server instance" without a shared session store.

import type { Source } from '@clipkit/protocol';
import { blankSource, cloneSource } from './state.js';

export interface ProjectStore {
  /**
   * Create or replace a project's source.
   *  - `id` given   → replace that project's source.
   *  - `id` omitted → create a new project. Single-tenant stores MAY reuse a
   *    "current" slot; multi-tenant stores mint a fresh id.
   * Returns the project's id.
   */
  put(id: string | undefined, source: Source): Promise<string>;

  /** Load a project's source by id, or null if it is absent/expired. */
  get(id: string): Promise<Source | null>;

  /**
   * The id a tool should act on when the caller omitted project_id.
   * Single-tenant in-memory → the current project; multi-tenant → null
   * (callers must pass an explicit project_id).
   */
  currentId(): Promise<string | null>;

  /**
   * Optional. If this store's rows ARE the editor's source of truth (a hosted DB
   * store), return the editor URL for an existing project id, so open_in_editor /
   * create_promo can link straight to it — no snapshot copy. Return null when the
   * store can't surface a link itself (the in-memory stdio store), in which case
   * the caller persists a share via the API instead.
   */
  editorUrl?(projectId: string): Promise<string | null>;
}

/** A loaded project plus a save() already bound to its id. */
export interface OpenProject {
  id: string;
  source: Source;
  save: (next: Source) => Promise<void>;
}

/**
 * Resolve project_id (or the store's current project), load it, and hand back a
 * bound save(). Returns an error string for the tool to surface if there is no
 * such project — this is the single place the "missing/expired id" guidance
 * lives, so every tool reports it consistently.
 */
export async function openProject(
  store: ProjectStore,
  projectId: string | undefined,
): Promise<{ ok: true; project: OpenProject } | { ok: false; error: string }> {
  const id = projectId ?? (await store.currentId());
  if (!id) {
    return {
      ok: false,
      error:
        'No active project. Create one with create_project or set_project, then pass the ' +
        'returned project_id to subsequent tools.',
    };
  }
  const source = await store.get(id);
  if (!source) {
    return {
      ok: false,
      error: `No project "${id}" (it may have expired). Pass a valid project_id, or create a new project.`,
    };
  }
  return {
    ok: true,
    project: {
      id,
      source,
      save: async (next: Source) => {
        await store.put(id, next);
      },
    },
  };
}

/**
 * In-memory store: one process, projects held in a Map. The default for local
 * stdio. Seeds a blank "current" project so a fresh session can get_project /
 * edit immediately and project_id stays optional locally.
 */
export class InMemoryProjectStore implements ProjectStore {
  private projects = new Map<string, Source>();
  private current: string | null = null;
  private seq = 0;

  constructor(seedBlank = true) {
    if (seedBlank) {
      const id = this.mint();
      this.projects.set(id, blankSource());
      this.current = id;
    }
  }

  async put(id: string | undefined, source: Source): Promise<string> {
    const pid = id ?? this.current ?? this.mint();
    // Store an isolated copy so the caller's object can't mutate saved state.
    this.projects.set(pid, cloneSource(source));
    this.current = pid;
    return pid;
  }

  async get(id: string): Promise<Source | null> {
    const src = this.projects.get(id);
    return src ? cloneSource(src) : null;
  }

  async currentId(): Promise<string | null> {
    return this.current;
  }

  private mint(): string {
    this.seq += 1;
    return `proj_${this.seq}`;
  }
}
