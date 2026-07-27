import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSchema, parseFrontmatter, SPEC_VERSION, updateTicket } from '@lovelace/core';
import { errorEnvelope, handle } from '../src/host.js';
import { tempFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

interface IndexTicket {
  id: string;
  status: string;
}

describe('host ops: delete and board order', () => {
  it('delete_ticket removes the ticket and returns a fresh snapshot', async () => {
    const root = fixture();
    const res = await handle({ op: 'delete_ticket', root, id: 'T-0002' });
    expect((res.deleted as { id: string }).id).toBe('T-0002');
    const tickets = (res.index as { tickets: IndexTicket[] }).tickets;
    expect(tickets.some((t) => t.id === 'T-0002')).toBe(false);
    expect(existsSync(join(root, '.lovelace/tickets/T-0002.md'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/comments/T-0002'))).toBe(false);
  });

  it('set_column_order persists order and surfaces it as boardOrder', async () => {
    const root = fixture();
    // The demo fixture ships its own board-order.yaml (added alongside
    // T-0005); remove it so "before" reflects a project with no manual order yet.
    rmSync(join(root, '.lovelace/board-order.yaml'), { force: true });
    const before = await handle({ op: 'snapshot', root });
    expect(before.boardOrder).toEqual({});
    const todo = (before.index as { tickets: IndexTicket[] }).tickets
      .filter((t) => t.status === 'todo')
      .map((t) => t.id);
    const reversed = [...todo].reverse();
    const res = await handle({ op: 'set_column_order', root, status: 'todo', ids: reversed });
    expect((res.boardOrder as Record<string, string[]>).todo).toEqual(reversed);
  });
});

/** The `updated` stamp is wall-clock and the two writers under comparison run moments apart; blank it before a byte comparison. */
function normalizeUpdated(text: string): string {
  return text.replace(/^updated: .*$/m, 'updated: NORMALIZED');
}

describe('host op: write_ticket_body', () => {
  it('clearing the body to "" matches the shape updateTicket produces for an empty body', async () => {
    const root = fixture();
    await handle({ op: 'write_ticket_body', root, id: 'T-0002', body: '' });
    const viaOp = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');

    const other = fixture();
    await updateTicket(other, 'T-0002', { body: '' });
    const viaCore = readFileSync(join(other, '.lovelace/tickets/T-0002.md'), 'utf8');

    expect(normalizeUpdated(viaOp)).toBe(normalizeUpdated(viaCore));
    expect(viaOp.endsWith('---\n')).toBe(true);
    expect(viaOp).not.toContain('---\n\n');
  });

  it('a non-empty body matches the file updateTicket writes for the same body', async () => {
    const root = fixture();
    await handle({ op: 'write_ticket_body', root, id: 'T-0002', body: 'Replaced by the op.\n' });
    const viaOp = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');

    const other = fixture();
    await updateTicket(other, 'T-0002', { body: 'Replaced by the op.\n' });
    const viaCore = readFileSync(join(other, '.lovelace/tickets/T-0002.md'), 'utf8');

    expect(normalizeUpdated(viaOp)).toBe(normalizeUpdated(viaCore));
  });

  it('round trip: a body written by the op then a core fields-only update produces no body diff', async () => {
    const root = fixture();
    await handle({ op: 'write_ticket_body', root, id: 'T-0002', body: 'App-written body.\n' });
    const afterOp = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');

    await updateTicket(root, 'T-0002', { fields: { priority: 'low' } });
    const afterFieldsEdit = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');

    expect(parseFrontmatter(afterFieldsEdit).body).toBe(parseFrontmatter(afterOp).body);
  });

  it('stamps updated on a body edit, unlike the old hand-splice', async () => {
    const root = fixture();
    const before = parseFrontmatter(readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8')).data.updated;
    await handle({ op: 'write_ticket_body', root, id: 'T-0002', body: 'New body.\n' });
    const after = parseFrontmatter(readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8')).data.updated;
    expect(after).not.toBe(before);
  });

  it('errors when the ticket does not exist', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'write_ticket_body', root, id: 'T-9999', body: 'x' }),
    ).rejects.toThrow(/ticket "T-9999" does not exist/);
  });
});

describe('host op: error envelope', () => {
  it('carries code, declared, supported and file for a spec-mismatched project', async () => {
    const root = fixture();
    const manifestPath = join(root, '.lovelace/manifest.yaml');
    // The too-new branch is the reachable spec mismatch while the supported
    // major is 0 (T-0109); nothing can classify needs-migration below it.
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('0.1.0', '4.0.0'));

    try {
      await handle({ op: 'snapshot', root });
      expect.unreachable('should have thrown');
    } catch (e) {
      const envelope = errorEnvelope(e);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('project');
      expect(envelope.error.code).toBe('spec-too-new');
      expect(envelope.error.declared).toBe('4.0.0');
      expect(envelope.error.supported).toBe(SPEC_VERSION);
      expect(envelope.error.file).toContain('manifest.yaml');
    }
  });
});

// The real 2.x workflow.yaml shape (ADR-0011's migration source), matching
// the fixture packages/core/test/helpers.ts builds for its own migration
// tests.
const V2_WORKFLOW_YAML = `types:
  - name: epic
    id_prefix: E
  - name: task
    id_prefix: T
  - name: bug
    id_prefix: T

statuses:
  - name: backlog
  - name: todo
  - name: in_progress
    active: true
  - name: done
    complete: true
  - name: cancelled
    complete: true

transitions:
  - from: backlog
    to: [todo, cancelled]

priorities: [urgent, high, medium, low]

fields:
  - name: title
    type: string
    required: true
  - name: assignee
    type: reference
    refers_to: [actor]
  - name: priority
    type: enum
    values_from: priorities
  - name: estimate
    type: number
    applies_to: [task]

on_transition:
  - when: { to: done }
    run: ./scripts/archive-artifacts.sh
`;

/** Turns a copy of the demo fixture into a 2.x-shaped project in place. */
function toV2Fixture(root: string): void {
  rmSync(join(root, '.lovelace/schema.yaml'));
  writeFileSync(join(root, '.lovelace/workflow.yaml'), V2_WORKFLOW_YAML);
  const manifestPath = join(root, '.lovelace/manifest.yaml');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('spec_version: 0.1.0', 'spec_version: 2.0.0'));
}

// Skipped, not deleted (T-0109): the spec is renumbered to 0.1.0, so a 2.x
// declaration classifies as too-new and the migration ops are unreachable
// until a breaking bump raises the spec major.
describe.skip('host ops: migration', () => {
  it('migration_plan returns the plan for a 2.x fixture without touching files', async () => {
    const root = fixture();
    toV2Fixture(root);

    const res = await handle({ op: 'migration_plan', root });
    const plan = res.plan as { declared: string; target: string; steps: Array<{ summary: string; changes: string[] }> };
    expect(plan.declared).toBe('2.0.0');
    // The target is the chain's final floor (what the 2-to-3 step actually
    // stamps), not this tooling's full SPEC_VERSION.
    expect(plan.target).toBe('3.0.0');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.changes).toContain('rename workflow.yaml to schema.yaml');
    expect(existsSync(join(root, '.lovelace/workflow.yaml'))).toBe(true);
  });

  it('migrate_project migrates the project and returns a working snapshot', async () => {
    const root = fixture();
    toV2Fixture(root);

    const res = await handle({ op: 'migrate_project', root });
    expect((res as { declared: string }).declared).toBe('2.0.0');
    expect((res as { finalVersion: string }).finalVersion).toBe('3.0.0');
    expect(existsSync(join(root, '.lovelace/workflow.yaml'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(true);

    // The normal snapshot payload rides along: the project now loads.
    const manifest = res.manifest as { spec_version: string };
    expect(manifest.spec_version).toBe('3.0.0');
    expect(res.index).toBeTruthy();

    // A plain snapshot op now succeeds too.
    const after = await handle({ op: 'snapshot', root });
    expect((after.manifest as { spec_version: string }).spec_version).toBe('3.0.0');
  });
});

describe('host ops: init configuration', () => {
  it('default_schema returns the built-in default', async () => {
    const res = await handle({ op: 'default_schema' });
    const schema = res.schema as { statuses: Array<{ name: string }>; priorities: string[] };
    expect(schema.statuses.map((s) => s.name)).toContain('backlog');
    expect(schema.priorities).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('init scaffolds a project from a custom schema', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lovelace-init-host-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const schema = defaultSchema();
    schema.statuses = [{ name: 'inbox' }, { name: 'shipped', agent: 'complete' }];
    const res = await handle({ op: 'init', root, name: 'Custom', userName: 'Me', schema });
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(true);
    const statuses = (res.schema as { statuses: Array<{ name: string }> }).statuses;
    expect(statuses.map((s) => s.name)).toEqual(['inbox', 'shipped']);
  });

  it('init scaffolds a loadable project when the target folder name is entirely digits', async () => {
    // Regression for a real CI failure: a project name that is a
    // YAML-ambiguous scalar (all digits, "true", "null", "1e3", ...) used to
    // be spliced unquoted into manifest.yaml, so it read back as a number
    // and the project could never load again. The app prefills the project
    // name from the target folder's basename, so a folder like "2048" hits
    // this directly; build the scenario without relying on mkdtempSync's
    // random suffix, which is not guaranteed to contain a letter.
    const parent = mkdtempSync(join(tmpdir(), 'lovelace-init-host-'));
    cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
    const root = join(parent, '2048');
    mkdirSync(root);

    await handle({ op: 'init', root, name: '2048', userName: 'Me' });
    const snapshot = await handle({ op: 'snapshot', root });
    expect((snapshot.manifest as { name: string }).name).toBe('2048');
  });

  it('write_schema saves an edit and returns the updated schema in the snapshot', async () => {
    const root = fixture();
    const before = await handle({ op: 'snapshot', root });
    const statuses = (before.schema as { statuses: Array<{ name: string; agent?: string }> }).statuses;
    const renamed = statuses.map((s) => (s.name === 'in_review' ? { ...s, name: 'review' } : s));
    const res = await handle({
      op: 'write_schema',
      root,
      edit: { statuses: renamed, renames: { statuses: { in_review: 'review' } } },
    });
    const after = (res.schema as { statuses: Array<{ name: string }> }).statuses.map((s) => s.name);
    expect(after).toContain('review');
    expect(after).not.toContain('in_review');
  });
});

describe('host ops: rename_document', () => {
  it('renames a document file in place and reindexes', async () => {
    const root = fixture();
    const res = await handle({ op: 'create_document', root, dir: '.lovelace/documentation/domain', name: 'pricing' });
    expect((res.created as string[])[0]).toBe('.lovelace/documentation/domain/pricing.md');
    const renamed = await handle({
      op: 'rename_document',
      root,
      path: '.lovelace/documentation/domain/pricing.md',
      name: 'pricing-model',
    });
    expect(renamed.renamed).toBe('.lovelace/documentation/domain/pricing-model.md');
    expect(existsSync(join(root, '.lovelace/documentation/domain/pricing.md'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/documentation/domain/pricing-model.md'))).toBe(true);
    const documents = (renamed.index as { documents: Array<{ path: string }> }).documents;
    expect(documents.some((b) => b.path === '.lovelace/documentation/domain/pricing-model.md')).toBe(true);
  });

  it('renames formerly locked names now that filenames are unrestricted', async () => {
    const root = fixture();
    // OVERVIEW.md and ADR files used to be fixed; they are now ordinary documents.
    const renamed = await handle({
      op: 'rename_document',
      root,
      path: '.lovelace/documentation/domain/OVERVIEW.md',
      name: 'domain notes',
    });
    expect(renamed.renamed).toBe('.lovelace/documentation/domain/domain notes.md');
    expect(existsSync(join(root, '.lovelace/documentation/domain/domain notes.md'))).toBe(true);
  });

  it('refuses paths outside documentation, traversal and collisions', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'rename_document', root, path: '.lovelace/tickets/T-0002.md', name: 'other' }),
    ).rejects.toThrow(/only renames files under the documentation root/);
    await handle({ op: 'create_document', root, dir: '.lovelace/documentation/domain', name: 'pricing' });
    await expect(
      handle({ op: 'rename_document', root, path: '.lovelace/documentation/domain/pricing.md', name: '../evil' }),
    ).rejects.toThrow(/path separators/);
    await expect(
      handle({ op: 'rename_document', root, path: '.lovelace/documentation/domain/pricing.md', name: 'OVERVIEW' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('host op: create_folder', () => {
  it('creates a folder with a starter index.md', async () => {
    const root = fixture();
    const res = await handle({ op: 'create_folder', root, dir: '.lovelace/documentation', name: 'operations' });
    expect((res.created as string[])[0]).toBe('.lovelace/documentation/operations/index.md');
    expect(existsSync(join(root, '.lovelace/documentation/operations/index.md'))).toBe(true);
    const documents = (res.index as { documents: Array<{ id: string; path: string }> }).documents;
    const index = documents.find((b) => b.path === '.lovelace/documentation/operations/index.md');
    expect(index?.id).toBe('operations');
  });

  it('refuses traversal, paths outside documentation, and existing folders', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'create_folder', root, dir: '.lovelace/documentation', name: '../evil' }),
    ).rejects.toThrow(/path separators/);
    await expect(
      handle({ op: 'create_folder', root, dir: '.lovelace/tickets', name: 'x' }),
    ).rejects.toThrow(/only creates folders under the documentation root/);
    await expect(
      handle({ op: 'create_folder', root, dir: '.lovelace/documentation', name: 'architecture' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('host op: delete_document', () => {
  it('deletes a document file and reindexes', async () => {
    const root = fixture();
    await handle({ op: 'create_document', root, dir: '.lovelace/documentation/domain', name: 'pricing' });
    const res = await handle({
      op: 'delete_document',
      root,
      path: '.lovelace/documentation/domain/pricing.md',
    });
    expect(res.deleted).toBe('.lovelace/documentation/domain/pricing.md');
    expect(existsSync(join(root, '.lovelace/documentation/domain/pricing.md'))).toBe(false);
    const documents = (res.index as { documents: Array<{ path: string }> }).documents;
    expect(documents.some((b) => b.path === '.lovelace/documentation/domain/pricing.md')).toBe(false);
  });

  it('refuses paths outside documentation, traversal and missing files', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'delete_document', root, path: '.lovelace/tickets/T-0002.md' }),
    ).rejects.toThrow(/only deletes files under the documentation root/);
    await expect(
      handle({ op: 'delete_document', root, path: '.lovelace/documentation/../tickets/T-0002.md' }),
    ).rejects.toThrow(/only deletes files under the documentation root/);
    await expect(
      handle({ op: 'delete_document', root, path: '.lovelace/documentation/domain/missing.md' }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe('host op: delete_folder', () => {
  it('deletes a folder and everything inside it, and reindexes', async () => {
    const root = fixture();
    const res = await handle({ op: 'delete_folder', root, path: '.lovelace/documentation/domain' });
    expect(res.deleted).toBe('.lovelace/documentation/domain');
    expect(existsSync(join(root, '.lovelace/documentation/domain'))).toBe(false);
    const documents = (res.index as { documents: Array<{ path: string }> }).documents;
    expect(documents.some((b) => b.path.startsWith('.lovelace/documentation/domain/'))).toBe(false);
  });

  it('refuses paths outside documentation, traversal and missing folders', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'delete_folder', root, path: '.lovelace/tickets' }),
    ).rejects.toThrow(/only deletes folders under the documentation root/);
    await expect(
      handle({ op: 'delete_folder', root, path: '.lovelace/documentation/../tickets' }),
    ).rejects.toThrow(/only deletes folders under the documentation root/);
    await expect(
      handle({ op: 'delete_folder', root, path: '.lovelace/documentation/missing' }),
    ).rejects.toThrow(/does not exist/);
  });
});

interface IndexDocument {
  id: string;
  path: string;
}

interface Issue {
  file: string;
  rule: string;
}

describe('host op: fix_document', () => {
  it('repairs a frontmatter-less file, preserving its text and reindexing it', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/documentation/domain/notes.md');
    writeFileSync(path, '# Notes\n\nSome text.\n');

    const before = await handle({ op: 'snapshot', root });
    expect(
      (before.issues as Issue[]).some(
        (i) => i.file === '.lovelace/documentation/domain/notes.md' && i.rule === 'parse',
      ),
    ).toBe(true);
    expect(
      (before.index as { documents: IndexDocument[] }).documents.some(
        (d) => d.path === '.lovelace/documentation/domain/notes.md',
      ),
    ).toBe(false);

    const res = await handle({ op: 'fix_document', root, path: '.lovelace/documentation/domain/notes.md' });
    expect(res.fixed).toBe('.lovelace/documentation/domain/notes.md');
    const fixed = readFileSync(path, 'utf8');
    expect(fixed.startsWith('---\n')).toBe(true);
    expect(fixed).toContain('# Notes\n\nSome text.\n');
    const document = (res.index as { documents: IndexDocument[] }).documents.find(
      (d) => d.path === '.lovelace/documentation/domain/notes.md',
    );
    expect(document?.id).toBe('notes');
    expect(
      (res.issues as Issue[]).some(
        (i) => i.file === '.lovelace/documentation/domain/notes.md' && i.rule === 'parse',
      ),
    ).toBe(false);
  });

  it('is lossless on broken frontmatter: the original broken text survives the rewrite', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/documentation/domain/broken.md');
    writeFileSync(path, '---\nid: [broken\n');

    const res = await handle({ op: 'fix_document', root, path: '.lovelace/documentation/domain/broken.md' });
    expect(res.fixed).toBe('.lovelace/documentation/domain/broken.md');
    const fixed = readFileSync(path, 'utf8');
    expect(fixed).toContain('---\nid: [broken\n');
  });

  it('is idempotent on a valid file: it never rewrites it', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/documentation/domain/OVERVIEW.md');
    const before = readFileSync(path);
    await handle({ op: 'fix_document', root, path: '.lovelace/documentation/domain/OVERVIEW.md' });
    const after = readFileSync(path);
    expect(after.equals(before)).toBe(true);
  });

  it('refuses paths outside documentation, traversal and missing files', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'fix_document', root, path: '.lovelace/tickets/T-0002.md' }),
    ).rejects.toThrow(/only fixes files under the documentation root/);
    await expect(
      handle({ op: 'fix_document', root, path: '.lovelace/documentation/../tickets/T-0002.md' }),
    ).rejects.toThrow(/only fixes files under the documentation root/);
    await expect(
      handle({ op: 'fix_document', root, path: '.lovelace/documentation/domain/missing.md' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('quotes a YAML-coercible filename so the id survives as the string "null"', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/documentation/domain/null.md');
    writeFileSync(path, '# Untitled\n');

    const res = await handle({ op: 'fix_document', root, path: '.lovelace/documentation/domain/null.md' });
    const document = (res.index as { documents: IndexDocument[] }).documents.find(
      (d) => d.path === '.lovelace/documentation/domain/null.md',
    );
    expect(document?.id).toBe('null');
    expect((res.issues as Issue[]).some((i) => i.file === '.lovelace/documentation/domain/null.md')).toBe(false);
  });

  it('prefixes a digit-leading filename so the id is a valid slug with no issues', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/documentation/domain/007.md');
    writeFileSync(path, '# Untitled\n');

    const res = await handle({ op: 'fix_document', root, path: '.lovelace/documentation/domain/007.md' });
    const document = (res.index as { documents: IndexDocument[] }).documents.find(
      (d) => d.path === '.lovelace/documentation/domain/007.md',
    );
    expect(document?.id).toBe('doc-007');
    expect((res.issues as Issue[]).some((i) => i.file === '.lovelace/documentation/domain/007.md')).toBe(false);
  });

  it('create_document also prefixes a digit-leading name, guarding the shared slug helper', async () => {
    const root = fixture();
    const res = await handle({
      op: 'create_document',
      root,
      dir: '.lovelace/documentation/domain',
      name: '2024-plan',
    });
    const document = (res.index as { documents: IndexDocument[] }).documents.find(
      (d) => d.path === '.lovelace/documentation/domain/2024-plan.md',
    );
    expect(document?.id).toBe('doc-2024-plan');
    expect((res.issues as Issue[]).some((i) => i.file === '.lovelace/documentation/domain/2024-plan.md')).toBe(false);
  });

  it('rejects a non-UTF-8 file rather than mangling it, leaving the bytes untouched', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/documentation/domain/binary.md');
    writeFileSync(path, Buffer.from([0x23, 0x20, 0xe9, 0x0a]));
    const before = readFileSync(path);

    await expect(
      handle({ op: 'fix_document', root, path: '.lovelace/documentation/domain/binary.md' }),
    ).rejects.toThrow(/not UTF-8 text/);
    const after = readFileSync(path);
    expect(after.equals(before)).toBe(true);
  });

  it('create_document also quotes a YAML-coercible name, guarding the shared helper', async () => {
    const root = fixture();
    const res = await handle({
      op: 'create_document',
      root,
      dir: '.lovelace/documentation/domain',
      name: 'null',
    });
    const document = (res.index as { documents: IndexDocument[] }).documents.find(
      (d) => d.path === '.lovelace/documentation/domain/null.md',
    );
    expect(document?.id).toBe('null');
    expect((res.issues as Issue[]).some((i) => i.file === '.lovelace/documentation/domain/null.md')).toBe(false);
  });
});

describe('host op: list_files', () => {
  it('walks the tree when the project is not a git repo, skipping noise and .lovelace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lovelace-nogit-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '.lovelace'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# hi\n');
    writeFileSync(join(root, 'src', 'index.ts'), 'export {};\n');
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '');
    writeFileSync(join(root, '.lovelace', 'manifest.yaml'), '');

    const res = (await handle({ op: 'list_files', root })) as { files: string[] };
    expect(res.files).toEqual(['README.md', 'src/index.ts']);
  });
});

describe('host ops: codex integration', () => {
  it('install_codex writes the Codex assets and returns a fresh snapshot', async () => {
    const root = fixture();
    const res = await handle({
      op: 'install_codex',
      root,
      mcpCommand: '/opt/lovelace/bin/lovelace-mcp',
      helperCommand: '/opt/lovelace/bin/lovelace-agent',
    });
    expect(res.manual).toEqual([]);
    expect(existsSync(join(root, '.codex/config.toml'))).toBe(true);
    expect(existsSync(join(root, '.codex/hooks.json'))).toBe(true);
    expect(existsSync(join(root, '.agents/skills/ticket/SKILL.md'))).toBe(true);
    // The op returns a fresh project snapshot alongside the install result.
    expect(res.manifest).toBeDefined();
  });

  it('detect_codex reflects on-disk state before and after install_codex', async () => {
    const root = fixture();
    const before = await handle({ op: 'detect_codex', root });
    expect(before.installed).toBe(false);
    await handle({
      op: 'install_codex',
      root,
      mcpCommand: '/opt/lovelace/bin/lovelace-mcp',
      helperCommand: '/opt/lovelace/bin/lovelace-agent',
    });
    const after = await handle({ op: 'detect_codex', root });
    expect(after.installed).toBe(true);
    expect(after.mcp).toBe(true);
    expect(after.hooks).toBe(true);
    expect(after.commands).toBe(true);
  });
});
