import type {
  Actor,
  GraphLayout,
  MigrationPlan,
  MigrationResult,
  Schema,
  SchemaEdit,
  SearchHit,
  Snapshot,
} from './types';

export class HostError extends Error {
  constructor(
    message: string,
    public kind: string,
    public code?: string,
    public declared?: string,
    public supported?: string,
  ) {
    super(message);
    this.name = 'HostError';
  }
}

/**
 * Everything the UI can do to a project. The Tauri implementation talks to
 * the core host process; tests substitute a fake. All mutations resolve to
 * a fresh snapshot so the UI can never drift from the files.
 */
export interface InstallClaudeResult {
  written: string[];
  manual: string[];
}

export interface ClaudeInstallStatus {
  /** True when all three core pieces are present: mcp, hooks, commands. */
  installed: boolean;
  /** `.lovelace/AGENTS.md` exists with the Lovelace section. */
  agentsMd: boolean;
  /** `CLAUDE.md` contains the Lovelace section marker. */
  claudeMd: boolean;
  /** `.mcp.json` exists with an `mcpServers.lovelace` entry. */
  mcp: boolean;
  /** `.claude/settings.json` exists with Lovelace hook commands. */
  hooks: boolean;
  /** `.claude/commands/ticket.md` exists. */
  commands: boolean;
  /** `.git/hooks/prepare-commit-msg` exists and references Lovelace. */
  gitHook: boolean;
}

export interface OpenCodeInstallStatus {
  /** True when all three core pieces are present: mcp, hooks, commands. */
  installed: boolean;
  /** `opencode.json` exists with an `mcp.lovelace` entry (strict JSON only). */
  mcp: boolean;
  /** `.opencode/plugins/lovelace.js` exists and carries the Lovelace marker. */
  hooks: boolean;
  /** `.opencode/commands/ticket.md` exists. */
  commands: boolean;
  /** Root `AGENTS.md` contains the Lovelace section marker. */
  agentsMd: boolean;
  /** `.lovelace/AGENTS.md` contains the Lovelace section marker. */
  lovelaceAgentsMd: boolean;
  /** `.git/hooks/prepare-commit-msg` exists and references Lovelace. */
  gitHook: boolean;
}

/** The result of reading a file for preview, dispatched on `kind`. */
export interface SourceFile {
  kind: 'text' | 'image' | 'pdf' | 'binary' | 'missing';
  size?: number;
  /** UTF-8 text (kind: 'text'). */
  content?: string;
  /** Base64 bytes (kind: 'image' | 'pdf'). */
  base64?: string;
  /** MIME type (kind: 'image' | 'pdf'). */
  mime?: string;
  /** Too large to preview inline. */
  truncated?: boolean;
}

export interface HostClient {
  detect(root: string): Promise<boolean>;
  init(root: string, name: string, userName?: string, schema?: Schema): Promise<Snapshot>;
  /** The default schema, used to seed the init wizard. */
  defaultSchema(): Promise<Schema>;
  installClaude(root: string, gitHook: boolean): Promise<InstallClaudeResult>;
  /** Detect whether the Claude Code integration assets are present in the project. */
  claudeStatus(root: string): Promise<ClaudeInstallStatus>;
  installOpenCode(root: string, gitHook: boolean): Promise<InstallClaudeResult>;
  /** Detect whether the OpenCode integration assets are present in the project. */
  openCodeStatus(root: string): Promise<OpenCodeInstallStatus>;
  snapshot(root: string): Promise<Snapshot>;
  /** The migration plan for a project declaring an older spec major (ADR-0011); a dry run, no files change. */
  migrationPlan(root: string): Promise<MigrationPlan>;
  /** Runs the migration chain; the project reloads through the normal snapshot path afterwards. */
  migrateProject(root: string): Promise<MigrationResult>;
  createTicket(root: string, type: string, fields: Record<string, unknown>, status?: string): Promise<Snapshot>;
  updateTicket(
    root: string,
    id: string,
    fields: Record<string, unknown>,
    options?: { actor?: string },
  ): Promise<Snapshot>;
  deleteTicket(root: string, id: string): Promise<Snapshot>;
  setColumnOrder(root: string, status: string, ids: string[]): Promise<Snapshot>;
  /** Persist manual graph node positions (machine-local; not indexed). */
  setGraphLayout(root: string, layout: GraphLayout): Promise<Snapshot>;
  /**
   * Persist a schema-editor save: statuses, types (with their fields) and
   * priorities, with renames that cascade to existing tickets (validated by
   * core, which blocks removals that would strand tickets).
   */
  writeSchema(root: string, edit: SchemaEdit): Promise<Snapshot>;
  /** Edit the manifest's user-editable fields (the project name). */
  writeManifest(
    root: string,
    changes: { name?: string; presence_timeout_minutes?: number | null },
  ): Promise<Snapshot>;
  /**
   * Replace the project's actors (validated by core: one human, unique ids,
   * and no removal of an actor still referenced by a ticket, session or comment).
   */
  writeActors(root: string, actors: Actor[]): Promise<Snapshot>;
  readFile(root: string, path: string): Promise<string>;
  /** List repo files for the reference picker (tracked + untracked, non-ignored, excluding .lovelace/). */
  listFiles(root: string): Promise<string[]>;
  /** Read a repo-relative source file for preview (traversal-guarded; size/binary capped). */
  readSourceFile(root: string, path: string): Promise<SourceFile>;
  writeDocument(
    root: string,
    path: string,
    changes: { body?: string; summary?: string; review_by?: string | null },
  ): Promise<Snapshot>;
  addComment(root: string, ticket: string, actor: string, body: string): Promise<Snapshot>;
  writeTicketBody(root: string, id: string, body: string): Promise<Snapshot>;
  createDocument(root: string, dir: string, name: string, summary: string): Promise<Snapshot>;
  /** Create a folder under the documentation root (with a starter index.md), child of `dir`. */
  createFolder(root: string, dir: string, name: string): Promise<Snapshot>;
  /** Rename a document file (its directory and frontmatter stay put). */
  renameDocument(root: string, path: string, name: string): Promise<Snapshot>;
  /** Delete a document file under the documentation root. */
  deleteDocument(root: string, path: string): Promise<Snapshot>;
  /** Delete a folder under the documentation root, including everything in it. */
  deleteFolder(root: string, path: string): Promise<Snapshot>;
  /** Rewrite a corrupt documentation file into valid format, preserving its content. */
  fixDocument(root: string, path: string): Promise<Snapshot>;
  commitsForTicket(root: string, id: string): Promise<Array<{ sha: string; subject: string }>>;
  search(root: string, query: string): Promise<SearchHit[]>;
  pickDirectory(): Promise<string | null>;
  /** Open the project folder in the operating system's file manager. */
  revealProject(root: string): Promise<void>;
  /** Watch for external changes; returns an unsubscribe function. */
  watch(root: string, onChange: (change: { presenceOnly: boolean }) => void): Promise<() => void>;
}

interface HostResponse {
  ok: boolean;
  data?: unknown;
  error?: { kind: string; message: string; code?: string; declared?: string; supported?: string };
}

function assertShell(): void {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new HostError(
      'This page is running in a browser, outside the Lovelace app shell, so it cannot reach your files. Use the app window that `pnpm app:dev` opens, not the localhost URL.',
      'shell',
    );
  }
}

async function tauriRequest(payload: Record<string, unknown>): Promise<unknown> {
  assertShell();
  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke<string>('core_request', { request: JSON.stringify(payload) });
  const response = JSON.parse(raw) as HostResponse;
  if (!response.ok) {
    throw new HostError(
      response.error?.message ?? 'unknown host error',
      response.error?.kind ?? 'internal',
      response.error?.code,
      response.error?.declared,
      response.error?.supported,
    );
  }
  return response.data;
}

export class TauriHost implements HostClient {
  async detect(root: string): Promise<boolean> {
    const data = (await tauriRequest({ op: 'detect', root })) as { hasLovelace: boolean };
    return data.hasLovelace;
  }

  init(root: string, name: string, userName?: string, schema?: Schema): Promise<Snapshot> {
    return tauriRequest({
      op: 'init',
      root,
      name,
      userName,
      ...(schema !== undefined ? { schema } : {}),
    }) as Promise<Snapshot>;
  }

  async defaultSchema(): Promise<Schema> {
    const data = (await tauriRequest({ op: 'default_schema' })) as { schema: Schema };
    return data.schema;
  }

  async installClaude(root: string, gitHook: boolean): Promise<InstallClaudeResult> {
    // The host process knows where its sibling sidecar binaries live and
    // fills in the command paths itself.
    return (await tauriRequest({ op: 'install_claude', root, gitHook })) as InstallClaudeResult;
  }

  async claudeStatus(root: string): Promise<ClaudeInstallStatus> {
    return (await tauriRequest({ op: 'detect_claude', root })) as ClaudeInstallStatus;
  }

  async installOpenCode(root: string, gitHook: boolean): Promise<InstallClaudeResult> {
    // The host process knows where its sibling sidecar binaries live and
    // fills in the command paths itself.
    return (await tauriRequest({ op: 'install_opencode', root, gitHook })) as InstallClaudeResult;
  }

  async openCodeStatus(root: string): Promise<OpenCodeInstallStatus> {
    return (await tauriRequest({ op: 'detect_opencode', root })) as OpenCodeInstallStatus;
  }

  snapshot(root: string): Promise<Snapshot> {
    return tauriRequest({ op: 'snapshot', root }) as Promise<Snapshot>;
  }

  async migrationPlan(root: string): Promise<MigrationPlan> {
    const data = (await tauriRequest({ op: 'migration_plan', root })) as { plan: MigrationPlan };
    return data.plan;
  }

  migrateProject(root: string): Promise<MigrationResult> {
    return tauriRequest({ op: 'migrate_project', root }) as Promise<MigrationResult>;
  }

  createTicket(root: string, type: string, fields: Record<string, unknown>, status?: string): Promise<Snapshot> {
    return tauriRequest({
      op: 'create_ticket',
      root,
      type,
      fields,
      ...(status !== undefined ? { status } : {}),
    }) as Promise<Snapshot>;
  }

  updateTicket(
    root: string,
    id: string,
    fields: Record<string, unknown>,
    options?: { actor?: string },
  ): Promise<Snapshot> {
    return tauriRequest({
      op: 'update_ticket',
      root,
      id,
      fields,
      ...(options?.actor !== undefined ? { actor: options.actor } : {}),
    }) as Promise<Snapshot>;
  }

  deleteTicket(root: string, id: string): Promise<Snapshot> {
    return tauriRequest({ op: 'delete_ticket', root, id }) as Promise<Snapshot>;
  }

  setColumnOrder(root: string, status: string, ids: string[]): Promise<Snapshot> {
    return tauriRequest({ op: 'set_column_order', root, status, ids }) as Promise<Snapshot>;
  }

  setGraphLayout(root: string, layout: GraphLayout): Promise<Snapshot> {
    return tauriRequest({ op: 'set_graph_layout', root, layout }) as Promise<Snapshot>;
  }

  writeSchema(root: string, edit: SchemaEdit): Promise<Snapshot> {
    return tauriRequest({ op: 'write_schema', root, edit }) as Promise<Snapshot>;
  }

  writeManifest(
    root: string,
    changes: { name?: string; presence_timeout_minutes?: number | null },
  ): Promise<Snapshot> {
    return tauriRequest({ op: 'write_manifest', root, changes }) as Promise<Snapshot>;
  }

  writeActors(root: string, actors: Actor[]): Promise<Snapshot> {
    return tauriRequest({ op: 'write_actors', root, actors }) as Promise<Snapshot>;
  }

  async readFile(root: string, path: string): Promise<string> {
    const data = (await tauriRequest({ op: 'read_file', root, path })) as { content: string };
    return data.content;
  }

  async listFiles(root: string): Promise<string[]> {
    const data = (await tauriRequest({ op: 'list_files', root })) as { files: string[] };
    return data.files;
  }

  readSourceFile(root: string, path: string): Promise<SourceFile> {
    return tauriRequest({ op: 'read_source_file', root, path }) as Promise<SourceFile>;
  }

  writeDocument(
    root: string,
    path: string,
    changes: { body?: string; summary?: string; review_by?: string | null },
  ): Promise<Snapshot> {
    return tauriRequest({ op: 'write_document', root, path, ...changes }) as Promise<Snapshot>;
  }

  addComment(root: string, ticket: string, actor: string, body: string): Promise<Snapshot> {
    return tauriRequest({ op: 'add_comment', root, ticket, actor, body }) as Promise<Snapshot>;
  }

  writeTicketBody(root: string, id: string, body: string): Promise<Snapshot> {
    return tauriRequest({ op: 'write_ticket_body', root, id, body }) as Promise<Snapshot>;
  }

  createDocument(root: string, dir: string, name: string, summary: string): Promise<Snapshot> {
    return tauriRequest({ op: 'create_document', root, dir, name, summary }) as Promise<Snapshot>;
  }

  createFolder(root: string, dir: string, name: string): Promise<Snapshot> {
    return tauriRequest({ op: 'create_folder', root, dir, name }) as Promise<Snapshot>;
  }

  renameDocument(root: string, path: string, name: string): Promise<Snapshot> {
    return tauriRequest({ op: 'rename_document', root, path, name }) as Promise<Snapshot>;
  }

  deleteDocument(root: string, path: string): Promise<Snapshot> {
    return tauriRequest({ op: 'delete_document', root, path }) as Promise<Snapshot>;
  }

  deleteFolder(root: string, path: string): Promise<Snapshot> {
    return tauriRequest({ op: 'delete_folder', root, path }) as Promise<Snapshot>;
  }

  fixDocument(root: string, path: string): Promise<Snapshot> {
    return tauriRequest({ op: 'fix_document', root, path }) as Promise<Snapshot>;
  }

  async commitsForTicket(root: string, id: string): Promise<Array<{ sha: string; subject: string }>> {
    const data = (await tauriRequest({ op: 'commits_for_ticket', root, id })) as {
      commits: Array<{ sha: string; subject: string }>;
    };
    return data.commits;
  }

  async search(root: string, query: string): Promise<SearchHit[]> {
    const data = (await tauriRequest({ op: 'search', root, query })) as { hits: SearchHit[] };
    return data.hits;
  }

  async revealProject(root: string): Promise<void> {
    assertShell();
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(root);
  }

  async pickDirectory(): Promise<string | null> {
    assertShell();
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === 'string' ? picked : null;
  }

  async watch(root: string, onChange: (change: { presenceOnly: boolean }) => void): Promise<() => void> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    await invoke('watch_project', { root });
    const unlisten = await listen<{ root: string; presenceOnly?: boolean }>('lovelace://changed', (event) => {
      if (event.payload.root === root) onChange({ presenceOnly: event.payload.presenceOnly ?? false });
    });
    return () => {
      void unlisten();
      void invoke('unwatch_project', { root });
    };
  }
}
