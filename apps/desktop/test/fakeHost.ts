import {
  HostError,
  type ClaudeInstallStatus,
  type HostClient,
  type OpenCodeInstallStatus,
  type SourceFile,
} from '../src/lib/host';
import type { MigrationPlan, MigrationResult, SchemaEdit, SearchHit, Snapshot } from '../src/lib/types';
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
  /** Set to make `snapshot` throw a HostError, for spec-gate tests. */
  snapshotError: { message: string; kind?: string; code?: string; declared?: string; supported?: string } | null =
    null;
  migrationPlanData: MigrationPlan = {
    declared: '2.1.0',
    target: '3.0.0',
    steps: [
      {
        summary: 'upgrades the 2.x workflow format to 3.0',
        changes: ['nest 4 fields under their types', 'rename workflow.yaml to schema.yaml'],
      },
    ],
    releaseNotes: [{ version: '3.0.0', description: 'renames workflow.yaml to schema.yaml.' }],
  };
  migrationResultData: MigrationResult = {
    declared: '2.1.0',
    finalVersion: '3.0.0',
    steps: ['upgrades the 2.x workflow format to 3.0'],
    issues: [],
  };

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
  }

  async detect(root: string): Promise<boolean> {
    this.record('detect', [root]);
    return true;
  }

  async init(root: string, name: string, userName?: string, schema?: unknown): Promise<Snapshot> {
    this.record('init', [root, name, userName, schema]);
    return this.snapshotData;
  }

  async defaultSchema() {
    this.record('defaultSchema', []);
    return this.snapshotData.schema;
  }

  async installClaude(root: string, gitHook: boolean): Promise<{ written: string[]; manual: string[] }> {
    this.record('installClaude', [root, gitHook]);
    return { written: ['CLAUDE.md'], manual: [] };
  }

  async claudeStatus(root: string): Promise<ClaudeInstallStatus> {
    this.record('claudeStatus', [root]);
    return { installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false };
  }

  async installOpenCode(root: string, gitHook: boolean): Promise<{ written: string[]; manual: string[] }> {
    this.record('installOpenCode', [root, gitHook]);
    return { written: ['opencode.json'], manual: [] };
  }

  async openCodeStatus(root: string): Promise<OpenCodeInstallStatus> {
    this.record('openCodeStatus', [root]);
    return {
      installed: false,
      mcp: false,
      hooks: false,
      commands: false,
      agentsMd: false,
      lovelaceAgentsMd: false,
      gitHook: false,
    };
  }

  async snapshot(root: string): Promise<Snapshot> {
    this.record('snapshot', [root]);
    if (this.snapshotError) {
      const e = this.snapshotError;
      throw new HostError(e.message, e.kind ?? 'project', e.code, e.declared, e.supported);
    }
    return this.snapshotData;
  }

  async migrationPlan(root: string): Promise<MigrationPlan> {
    this.record('migrationPlan', [root]);
    return this.migrationPlanData;
  }

  async migrateProject(root: string): Promise<MigrationResult> {
    this.record('migrateProject', [root]);
    // A real migration patches the manifest so the next snapshot loads.
    this.snapshotError = null;
    return this.migrationResultData;
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
    options?: { actor?: string },
  ): Promise<Snapshot> {
    this.record('updateTicket', [root, id, fields, options]);
    return this.snapshotData;
  }

  async deleteTicket(root: string, id: string): Promise<Snapshot> {
    this.record('deleteTicket', [root, id]);
    return this.snapshotData;
  }

  async writeSchema(root: string, edit: SchemaEdit): Promise<Snapshot> {
    this.record('writeSchema', [root, edit]);
    return this.snapshotData;
  }

  async writeManifest(
    root: string,
    changes: { name?: string; presence_timeout_minutes?: number | null },
  ): Promise<Snapshot> {
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

  async deleteDocument(root: string, path: string): Promise<Snapshot> {
    this.record('deleteDocument', [root, path]);
    return this.snapshotData;
  }

  async deleteFolder(root: string, path: string): Promise<Snapshot> {
    this.record('deleteFolder', [root, path]);
    return this.snapshotData;
  }

  async fixDocument(root: string, path: string): Promise<Snapshot> {
    this.record('fixDocument', [root, path]);
    return this.snapshotData;
  }

  async commitsForTicket(_root: string, _id: string): Promise<Array<{ sha: string; subject: string }>> {
    return [{ sha: '4e7aa10', subject: 'feat: forecast endpoint (T-0002)' }];
  }

  async search(_root: string, _query: string): Promise<SearchHit[]> {
    return [];
  }

  async revealProject(root: string): Promise<void> {
    this.record('revealProject', [root]);
  }

  async pickDirectory(): Promise<string | null> {
    return null;
  }

  async watch(_root: string, _onChange: (change: { presenceOnly: boolean }) => void): Promise<() => void> {
    return () => undefined;
  }
}
