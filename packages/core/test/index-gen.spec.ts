import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadProject, buildIndex, stringifyIndex, buildBoard, writeIndex } from '../src/index.js';
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

describe('index.json', () => {
  it('is byte-identical across two runs on unchanged input', () => {
    const root = fixture();
    const first = stringifyIndex(buildIndex(loadProject(root)));
    const second = stringifyIndex(buildIndex(loadProject(root)));
    expect(second).toBe(first);
    const { indexPath } = writeIndex(loadProject(root));
    writeIndex(loadProject(root));
    expect(readFileSync(indexPath, 'utf8')).toBe(first);
  });

  it('contains every entity with frontmatter and summary, sorted', () => {
    const root = fixture();
    const index = buildIndex(loadProject(root)) as Record<string, unknown[]>;
    expect((index.tickets as Array<{ id: string }>).map((t) => t.id)).toEqual([
      'E-0001',
      'T-0001',
      'T-0002',
      'T-0003',
      'T-0004',
    ]);
    const briefs = index.briefs as Array<{ id: string; summary: string }>;
    expect(briefs.length).toBe(6);
    for (const b of briefs) expect(b.summary.length).toBeGreaterThan(0);
    expect((index.sessions as Array<{ id: string }>).map((s) => s.id)).toEqual(['S-0001', 'S-0002']);
    expect(index.comments).toHaveLength(2);
  });

  it('contains no generated timestamps', () => {
    const root = fixture();
    const text = stringifyIndex(buildIndex(loadProject(root)));
    expect(text).not.toContain('generated');
    expect(text).not.toContain('indexed_at');
  });

  it('exposes custom field values on tickets', () => {
    const root = fixture();
    const index = buildIndex(loadProject(root)) as { tickets: Array<{ id: string; fields: Record<string, unknown> }> };
    const bug = index.tickets.find((t) => t.id === 'T-0004');
    expect(bug?.fields.environment).toBe('staging');
  });
});

describe('BOARD.md', () => {
  it('groups tickets by status in workflow column order', () => {
    const root = fixture();
    const board = buildBoard(loadProject(root));
    const headings = [...board.matchAll(/^## (\w+)/gm)].map((m) => m[1]);
    expect(headings).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'staging', 'done', 'cancelled']);
    expect(board).toContain('| T-0002 | Forecast endpoint | task | claude |');
    expect(board.indexOf('## todo')).toBeLessThan(board.indexOf('## done'));
  });

  it('is stable across runs', () => {
    const root = fixture();
    expect(buildBoard(loadProject(root))).toBe(buildBoard(loadProject(root)));
  });
});
