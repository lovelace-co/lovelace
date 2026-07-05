import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initProject,
  loadProject,
  validateProject,
  search,
  matchRules,
  watchProject,
  extractSection,
} from '../src/index.js';
import { tempFixture, FIXED_NOW } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

describe('initProject', () => {
  it('scaffolds a project that validates cleanly', () => {
    const root = mkdtempSync(join(tmpdir(), 'lovelace-init-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const created = initProject(root, { name: 'Fresh Start', userName: 'Lambros', now: FIXED_NOW });
    expect(created).toContain('.lovelace/manifest.yaml');
    expect(created).toContain('.gitignore');
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.lovelace/index/index.json');
    const issues = validateProject(loadProject(root), { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(() => initProject(root, { name: 'Again' })).toThrow(/already exists/);
  });
});

describe('search', () => {
  it('finds substring matches across kinds, ranking titles above bodies', () => {
    const project = loadProject(fixture());
    const hits = search(project, 'forecast');
    expect(hits.length).toBeGreaterThan(2);
    expect(hits[0]?.kind).toBe('ticket');
    expect(hits[0]?.id).toBe('T-0002');
    const kinds = new Set(hits.map((h) => h.kind));
    expect(kinds.has('document')).toBe(true);
    expect(search(project, '')).toEqual([]);
    expect(search(project, 'zzz-no-such-text')).toEqual([]);
  });

  it('returns a snippet showing the matching line', () => {
    const project = loadProject(fixture());
    const hit = search(project, 'gusts')[0];
    expect(hit?.snippet.toLowerCase()).toContain('gusts');
  });
});

describe('matchRules', () => {
  it('matches on to, type and field values', () => {
    const project = loadProject(fixture());
    const task = project.tickets.find((t) => t.id === 'T-0002');
    const bug = project.tickets.find((t) => t.id === 'T-0004');
    expect(matchRules(project.workflow, task!, 'in_review', 'staging')).toHaveLength(1);
    expect(matchRules(project.workflow, bug!, 'in_review', 'staging')).toHaveLength(0);
    expect(matchRules(project.workflow, task!, 'staging', 'done')).toHaveLength(1);
  });
});

describe('extractSection', () => {
  it('pulls a heading section out of a body', () => {
    const body = '## Approach\n\nDo it.\n\n## What happened\n\nDone.\n';
    expect(extractSection(body, 'Approach')).toBe('Do it.');
    expect(extractSection(body, 'What happened')).toBe('Done.');
    expect(extractSection(body, 'Missing')).toBeUndefined();
  });
});

describe('watchProject', () => {
  it('re-validates and re-indexes on change, debounced, ignoring its own writes', async () => {
    const root = fixture();
    const results: string[][] = [];
    const watcher = watchProject(
      root,
      (r) => results.push(r.changedPaths),
      { debounceMs: 100 },
    );
    cleanups.push(() => void watcher.close());
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(
      join(root, '.lovelace/tickets/T-0003.md'),
      readFileSync(join(root, '.lovelace/tickets/T-0003.md'), 'utf8').replace(
        'priority: medium',
        'priority: low',
      ),
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(results.length).toBe(1);
    expect(results[0]?.some((p) => p.endsWith('T-0003.md'))).toBe(true);
    expect(existsSync(join(root, '.lovelace/index/index.json'))).toBe(true);
    const index = readFileSync(join(root, '.lovelace/index/index.json'), 'utf8');
    expect(index).toContain('"low"');
    // The index write itself must not retrigger the watcher.
    await new Promise((r) => setTimeout(r, 400));
    expect(results.length).toBe(1);
  await watcher.close();
  }, 20000);
});
