import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGraphLayout, writeGraphLayout } from '../src/index.js';
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

describe('graph layout state', () => {
  it('is empty when no file exists', () => {
    const root = fixture();
    expect(readGraphLayout(join(root, '.lovelace'), 'state')).toEqual({});
  });

  it('round-trips positions, rounded and sorted, in state/graph-layout.json', () => {
    const root = fixture();
    writeGraphLayout(root, { 'domain-overview': { x: 120.7, y: 40.2 }, context: { x: 5, y: 9 } });
    const path = join(root, '.lovelace/state/graph-layout.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version: number; nodes: Record<string, unknown> };
    expect(parsed.version).toBe(1);
    // Keys sorted; coordinates rounded to whole pixels.
    expect(Object.keys(parsed.nodes)).toEqual(['context', 'domain-overview']);
    expect(parsed.nodes['domain-overview']).toEqual({ x: 121, y: 40 });
    expect(readGraphLayout(join(root, '.lovelace'), 'state')).toEqual({
      context: { x: 5, y: 9 },
      'domain-overview': { x: 121, y: 40 },
    });
  });

  it('ignores malformed entries without throwing', () => {
    const root = fixture();
    writeGraphLayout(root, {
      good: { x: 1, y: 2 },
      bad: { x: Number.NaN, y: 3 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrong: 'nope' as any,
    });
    expect(readGraphLayout(join(root, '.lovelace'), 'state')).toEqual({ good: { x: 1, y: 2 } });
  });
});
