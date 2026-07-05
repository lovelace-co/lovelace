import type { HostClient, SourceFile } from '../src/lib/host';
import type { AutomationRule, SearchHit, Snapshot, WorkflowEdit } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

/**
 * A HostClient backed by the demo project's snapshot fixture. Mutations
 * record their arguments and return the same snapshot, which is enough for
 * deterministic component tests.
 */
export class FakeHost implements HostClient {
  snapshotData: Snapshot = fixture as unknown as Snapshot;
  calls: Array<{ method: string; args: unknown[] }> = [];
  files = new Map<string, string>();
  sourceFiles = new Map<string, SourceFile>();
  fileList: string[] = [];
  transitionRules: AutomationRule[] = [];
  log = '';

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
  }

  async detect(root: string): Promise<boolean> {
    this.record('detect', [root]);
    return true;
  }

  async init(root: string, name: string, userName?: string, workflow?: unknown): Promise<Snapshot> {
    this.record('init', [root, name, userName, workflow]);
    return this.snapshotData;
  }

  async defaultWorkflow() {
    this.record('defaultWorkflow', []);
    return this.snapshotData.workflow;
  }

  async installClaude(root: string, gitHook: boolean): Promise<{ written: string[]; manual: string[] }> {
    this.record('installClaude', [root, gitHook]);
    return { written: ['CLAUDE.md'], manual: [] };
  }

  async snapshot(root: string): Promise<Snapshot> {
    this.record('snapshot', [root]);
    return this.snapshotData;
  }

  async createTicket(
    root: string,
    type: string,
    fields: Record<string, unknown>,
    status?: string,
  ): Promise<Snapshot> {
    this.record('createTicket', [root, type, fields, status]);
    return this.snapshotData;
  }

  async updateTicket(
    root: string,
    id: string,
    fields: Record<string, unknown>,
    options?: { actor?: string; force?: boolean },
  ): Promise<Snapshot> {
    this.record('updateTicket', [root, id, fields, options]);
    return this.snapshotData;
  }

  async testTransition(root: string, id: string, to: string): Promise<AutomationRule[]> {
    this.record('testTransition', [root, id, to]);
    return this.transitionRules;
  }

  async deleteTicket(root: string, id: string): Promise<Snapshot> {
    this.record('deleteTicket', [root, id]);
    return this.snapshotData;
  }

  async setAutomations(root: string, rules: AutomationRule[]): Promise<Snapshot> {
    this.record('setAutomations', [root, rules]);
    return this.snapshotData;
  }

  async writeWorkflow(root: string, edit: WorkflowEdit): Promise<Snapshot> {
    this.record('writeWorkflow', [root, edit]);
    return this.snapshotData;
  }

  async writeManifest(root: string, changes: { name: string }): Promise<Snapshot> {
    this.record('writeManifest', [root, changes]);
    return this.snapshotData;
  }

  async writeActors(root: string, actors: unknown): Promise<Snapshot> {
    this.record('writeActors', [root, actors]);
    return this.snapshotData;
  }

  async setColumnOrder(root: string, status: string, ids: string[]): Promise<Snapshot> {
    this.record('setColumnOrder', [root, status, ids]);
    return this.snapshotData;
  }

  async setGraphLayout(root: string, layout: Record<string, { x: number; y: number }>): Promise<Snapshot> {
    this.record('setGraphLayout', [root, layout]);
    return this.snapshotData;
  }

  async actionLog(): Promise<string> {
    return this.log;
  }

  async readFile(_root: string, path: string): Promise<string> {
    this.record('readFile', [path]);
    return this.files.get(path) ?? '---\nid: x\n---\n\n## Description\n\nFixture body.\n';
  }

  async listFiles(_root: string): Promise<string[]> {
    this.record('listFiles', [_root]);
    return this.fileList;
  }

  async readSourceFile(_root: string, path: string): Promise<SourceFile> {
    this.record('readSourceFile', [path]);
    return (
      this.sourceFiles.get(path) ?? { kind: 'text', content: this.files.get(path) ?? `// ${path}\n`, size: 0 }
    );
  }

  async writeDocument(
    root: string,
    path: string,
    changes: { body?: string; summary?: string; review_by?: string | null },
  ): Promise<Snapshot> {
    this.record('writeDocument', [root, path, changes]);
    return this.snapshotData;
  }

  async addComment(root: string, ticket: string, actor: string, body: string): Promise<Snapshot> {
    this.record('addComment', [root, ticket, actor, body]);
    return this.snapshotData;
  }

  async writeTicketBody(root: string, id: string, body: string): Promise<Snapshot> {
    this.record('writeTicketBody', [root, id, body]);
    return this.snapshotData;
  }

  async createDocument(root: string, dir: string, name: string, summary: string): Promise<Snapshot> {
    this.record('createDocument', [root, dir, name, summary]);
    return this.snapshotData;
  }

  async createFolder(root: string, dir: string, name: string): Promise<Snapshot> {
    this.record('createFolder', [root, dir, name]);
    return this.snapshotData;
  }

  async renameDocument(root: string, path: string, name: string): Promise<Snapshot> {
    this.record('renameDocument', [root, path, name]);
    return this.snapshotData;
  }

  async commitsForTicket(_root: string, _id: string): Promise<Array<{ sha: string; subject: string }>> {
    return [{ sha: '4e7aa10', subject: 'feat: forecast endpoint (T-0002)' }];
  }

  async search(_root: string, _query: string): Promise<SearchHit[]> {
    return [];
  }

  async pickDirectory(): Promise<string | null> {
    return null;
  }

  async watch(): Promise<() => void> {
    return () => undefined;
  }
}
