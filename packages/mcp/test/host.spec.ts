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

describe('host ops: rename_brief', () => {
  it('renames a brief file in place and reindexes', async () => {
    const root = fixture();
    const res = await handle({ op: 'create_brief', root, dir: '.lovelace/briefs/domain', name: 'pricing' });
    expect((res.created as string[])[0]).toBe('.lovelace/briefs/domain/pricing.md');
    const renamed = await handle({
      op: 'rename_brief',
      root,
      path: '.lovelace/briefs/domain/pricing.md',
      name: 'pricing-model',
    });
    expect(renamed.renamed).toBe('.lovelace/briefs/domain/pricing-model.md');
    expect(existsSync(join(root, '.lovelace/briefs/domain/pricing.md'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/briefs/domain/pricing-model.md'))).toBe(true);
    const briefs = (renamed.index as { briefs: Array<{ path: string }> }).briefs;
    expect(briefs.some((b) => b.path === '.lovelace/briefs/domain/pricing-model.md')).toBe(true);
  });

  it('refuses fixed names, bad names and collisions', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'rename_brief', root, path: '.lovelace/CONTEXT.md', name: 'other' }),
    ).rejects.toThrow(/only renames files under briefs/);
    await expect(
      handle({ op: 'rename_brief', root, path: '.lovelace/briefs/domain/OVERVIEW.md', name: 'other' }),
    ).rejects.toThrow(/fixed name/);
    await expect(
      handle({
        op: 'rename_brief',
        root,
        path: '.lovelace/briefs/architecture/decisions/ADR-0001.md',
        name: 'other',
      }),
    ).rejects.toThrow(/ADR filenames/);
    await handle({ op: 'create_brief', root, dir: '.lovelace/briefs/domain', name: 'pricing' });
    await expect(
      handle({ op: 'rename_brief', root, path: '.lovelace/briefs/domain/pricing.md', name: 'bad name!' }),
    ).rejects.toThrow(/letters, digits and hyphens/);
    await expect(
      handle({ op: 'rename_brief', root, path: '.lovelace/briefs/domain/pricing.md', name: 'OVERVIEW' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('host op: create_folder', () => {
  it('creates a folder as its OVERVIEW.md with a unique id', async () => {
    const root = fixture();
    const res = await handle({ op: 'create_folder', root, dir: '.lovelace/briefs', name: 'operations' });
    expect((res.created as string[])[0]).toBe('.lovelace/briefs/operations/OVERVIEW.md');
    expect(existsSync(join(root, '.lovelace/briefs/operations/OVERVIEW.md'))).toBe(true);
    const briefs = (res.index as { briefs: Array<{ id: string; path: string }> }).briefs;
    const overview = briefs.find((b) => b.path === '.lovelace/briefs/operations/OVERVIEW.md');
    expect(overview?.id).toBe('operations-overview');
  });

  it('refuses bad names, paths outside briefs, and existing folders', async () => {
    const root = fixture();
    await expect(
      handle({ op: 'create_folder', root, dir: '.lovelace/briefs', name: 'bad name!' }),
    ).rejects.toThrow(/letters, digits and hyphens/);
    await expect(
      handle({ op: 'create_folder', root, dir: '.lovelace/tickets', name: 'x' }),
    ).rejects.toThrow(/only creates folders under briefs/);
    await expect(
      handle({ op: 'create_folder', root, dir: '.lovelace/briefs', name: 'architecture' }),
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
