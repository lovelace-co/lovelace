import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultWorkflow } from '@lovelace/core';
import { handle } from '../src/host.js';
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

describe('host ops: init configuration', () => {
  it('default_workflow returns the built-in default', async () => {
    const res = await handle({ op: 'default_workflow' });
    const wf = res.workflow as { statuses: Array<{ name: string }>; priorities: string[] };
    expect(wf.statuses.map((s) => s.name)).toContain('backlog');
    expect(wf.priorities).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('init scaffolds a project from a custom workflow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lovelace-init-host-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const wf = defaultWorkflow();
    wf.statuses = [{ name: 'inbox' }, { name: 'shipped', terminal: true }];
    wf.transitions = [{ from: 'inbox', to: ['shipped'] }];
    const res = await handle({ op: 'init', root, name: 'Custom', userName: 'Me', workflow: wf });
    expect(existsSync(join(root, '.lovelace/workflow.yaml'))).toBe(true);
    const statuses = (res.workflow as { statuses: Array<{ name: string }> }).statuses;
    expect(statuses.map((s) => s.name)).toEqual(['inbox', 'shipped']);
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
