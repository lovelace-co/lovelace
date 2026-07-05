import type { Actor, AutomationRule, GraphLayout, SearchHit, Snapshot, Workflow, WorkflowEdit } from './types';

export class HostError extends Error {
  constructor(
    message: string,
    public kind: string,
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
  init(root: string, name: string, userName?: string, workflow?: Workflow): Promise<Snapshot>;
  /** The default workflow, used to seed the init wizard. */
  defaultWorkflow(): Promise<Workflow>;
  installClaude(root: string, gitHook: boolean): Promise<InstallClaudeResult>;
  snapshot(root: string): Promise<Snapshot>;
  createTicket(root: string, type: string, fields: Record<string, unknown>, status?: string): Promise<Snapshot>;
  updateTicket(
    root: string,
    id: string,
    fields: Record<string, unknown>,
    options?: { actor?: string; force?: boolean },
  ): Promise<Snapshot>;
  deleteTicket(root: string, id: string): Promise<Snapshot>;
  setColumnOrder(root: string, status: string, ids: string[]): Promise<Snapshot>;
  /** Persist manual graph node positions (machine-local; not indexed). */
  setGraphLayout(root: string, layout: GraphLayout): Promise<Snapshot>;
  testTransition(root: string, id: string, to: string): Promise<AutomationRule[]>;
  /** Replace the project's on_transition automation rules (validated by core). */
  setAutomations(root: string, rules: AutomationRule[]): Promise<Snapshot>;
  /**
   * Persist a workflow-editor save: statuses, types, transitions, priorities
   * and fields, with renames that cascade to existing tickets (validated by
   * core, which blocks removals that would strand tickets).
   */
  writeWorkflow(root: string, edit: WorkflowEdit): Promise<Snapshot>;
  /** Edit the manifest's user-editable fields (the project name). */
  writeManifest(root: string, changes: { name: string }): Promise<Snapshot>;
  /**
   * Replace the project's actors (validated by core: one human, unique ids,
   * and no removal of an actor still referenced by a ticket, session or comment).
   */
  writeActors(root: string, actors: Actor[]): Promise<Snapshot>;
  /** The automation run history (actions.log). */
  actionLog(root: string): Promise<string>;
  readFile(root: string, path: string): Promise<string>;
  /** List repo files for the reference picker (tracked + untracked, non-ignored, excluding .lovelace/). */
  listFiles(root: string): Promise<string[]>;
  /** Read a repo-relative source file for preview (traversal-guarded; size/binary capped). */
  readSourceFile(root: string, path: string): Promise<SourceFile>;
  writeBrief(
    root: string,
    path: string,
    changes: { body?: string; summary?: string; review_by?: string | null },
  ): Promise<Snapshot>;
  addComment(root: string, ticket: string, actor: string, body: string): Promise<Snapshot>;
  writeTicketBody(root: string, id: string, body: string): Promise<Snapshot>;
  createBrief(
    root: string,
    dir: string,
    name: string,
    summary: string,
    createOverview: boolean,
  ): Promise<Snapshot>;
  /** Create a folder under briefs (its OVERVIEW.md), child of `dir`. */
  createFolder(root: string, dir: string, name: string): Promise<Snapshot>;
  /** Rename a brief file (its directory and frontmatter stay put). */
  renameBrief(root: string, path: string, name: string): Promise<Snapshot>;
  commitsForTicket(root: string, id: string): Promise<Array<{ sha: string; subject: string }>>;
  search(root: string, query: string): Promise<SearchHit[]>;
  pickDirectory(): Promise<string | null>;
  /** Watch for external changes; returns an unsubscribe function. */
  watch(root: string, onChange: () => void): Promise<() => void>;
}

interface HostResponse {
  ok: boolean;
  data?: unknown;
  error?: { kind: string; message: string };
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
    throw new HostError(response.error?.message ?? 'unknown host error', response.error?.kind ?? 'internal');
  }
  return response.data;
}

export class TauriHost implements HostClient {
  async detect(root: string): Promise<boolean> {
    const data = (await tauriRequest({ op: 'detect', root })) as { hasLovelace: boolean };
    return data.hasLovelace;
  }

  init(root: string, name: string, userName?: string, workflow?: Workflow): Promise<Snapshot> {
    return tauriRequest({
      op: 'init',
      root,
      name,
      userName,
      ...(workflow !== undefined ? { workflow } : {}),
    }) as Promise<Snapshot>;
  }

  async defaultWorkflow(): Promise<Workflow> {
    const data = (await tauriRequest({ op: 'default_workflow' })) as { workflow: Workflow };
    return data.workflow;
  }

  async installClaude(root: string, gitHook: boolean): Promise<InstallClaudeResult> {
    // The host process knows where its sibling sidecar binaries live and
    // fills in the command paths itself.
    return (await tauriRequest({ op: 'install_claude', root, gitHook })) as InstallClaudeResult;
  }

  snapshot(root: string): Promise<Snapshot> {
    return tauriRequest({ op: 'snapshot', root }) as Promise<Snapshot>;
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
    options?: { actor?: string; force?: boolean },
  ): Promise<Snapshot> {
    return tauriRequest({
      op: 'update_ticket',
      root,
      id,
      fields,
      ...(options?.actor !== undefined ? { actor: options.actor } : {}),
      ...(options?.force === true ? { force: true } : {}),
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

  async testTransition(root: string, id: string, to: string): Promise<AutomationRule[]> {
    const data = (await tauriRequest({ op: 'test_transition', root, id, to })) as {
      rules: AutomationRule[];
    };
    return data.rules;
  }

  setAutomations(root: string, rules: AutomationRule[]): Promise<Snapshot> {
    return tauriRequest({ op: 'set_automations', root, rules }) as Promise<Snapshot>;
  }

  writeWorkflow(root: string, edit: WorkflowEdit): Promise<Snapshot> {
    return tauriRequest({ op: 'write_workflow', root, edit }) as Promise<Snapshot>;
  }

  writeManifest(root: string, changes: { name: string }): Promise<Snapshot> {
    return tauriRequest({ op: 'write_manifest', root, changes }) as Promise<Snapshot>;
  }

  writeActors(root: string, actors: Actor[]): Promise<Snapshot> {
    return tauriRequest({ op: 'write_actors', root, actors }) as Promise<Snapshot>;
  }

  async actionLog(root: string): Promise<string> {
    const data = (await tauriRequest({ op: 'action_log', root })) as { log: string };
    return data.log;
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

  writeBrief(
    root: string,
    path: string,
    changes: { body?: string; summary?: string; review_by?: string | null },
  ): Promise<Snapshot> {
    return tauriRequest({ op: 'write_brief', root, path, ...changes }) as Promise<Snapshot>;
  }

  addComment(root: string, ticket: string, actor: string, body: string): Promise<Snapshot> {
    return tauriRequest({ op: 'add_comment', root, ticket, actor, body }) as Promise<Snapshot>;
  }

  writeTicketBody(root: string, id: string, body: string): Promise<Snapshot> {
    return tauriRequest({ op: 'write_ticket_body', root, id, body }) as Promise<Snapshot>;
  }

  createBrief(
    root: string,
    dir: string,
    name: string,
    summary: string,
    createOverview: boolean,
  ): Promise<Snapshot> {
    return tauriRequest({ op: 'create_brief', root, dir, name, summary, createOverview }) as Promise<Snapshot>;
  }

  createFolder(root: string, dir: string, name: string): Promise<Snapshot> {
    return tauriRequest({ op: 'create_folder', root, dir, name }) as Promise<Snapshot>;
  }

  renameBrief(root: string, path: string, name: string): Promise<Snapshot> {
    return tauriRequest({ op: 'rename_brief', root, path, name }) as Promise<Snapshot>;
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

  async pickDirectory(): Promise<string | null> {
    assertShell();
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === 'string' ? picked : null;
  }

  async watch(root: string, onChange: () => void): Promise<() => void> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    await invoke('watch_project', { root });
    const unlisten = await listen<{ root: string }>('lovelace://changed', (event) => {
      if (event.payload.root === root) onChange();
    });
    return () => {
      void unlisten();
      void invoke('unwatch_project', { root });
    };
  }
}
