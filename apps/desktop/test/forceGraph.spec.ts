import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../src/lib/forceGraph';

describe('force layout', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ];

  it('is deterministic: identical inputs give identical positions', () => {
    const first = layoutGraph(ids, edges);
    const second = layoutGraph(ids, edges);
    for (const id of ids) expect(second.get(id)).toEqual(first.get(id));
  });

  it('does not depend on the order ids are passed in', () => {
    const forward = layoutGraph(ids, edges);
    const reversed = layoutGraph([...ids].reverse(), edges);
    for (const id of ids) expect(reversed.get(id)).toEqual(forward.get(id));
  });

  it('produces finite positions for every node', () => {
    const pos = layoutGraph(ids, edges);
    expect(pos.size).toBe(4);
    for (const id of ids) {
      const p = pos.get(id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('handles a single node with no edges by centring it', () => {
    const pos = layoutGraph(['solo'], [], { width: 1000, height: 620 });
    expect(pos.size).toBe(1);
    expect(pos.get('solo')).toEqual({ x: 500, y: 310 });
  });

  it('holds pinned nodes at exactly their given position', () => {
    const pin = { x: 240, y: 180 };
    const pos = layoutGraph(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], {
      width: 1000,
      height: 620,
      fixed: { a: pin },
    });
    expect(pos.get('a')).toEqual(pin);
    // The others are still placed (and not stacked on the anchor).
    expect(pos.get('b')).not.toEqual(pin);
    expect(pos.get('c')).not.toEqual(pin);
  });

  it('keeps unpinned nodes inside the box when some nodes are pinned', () => {
    const width = 1000;
    const height = 700;
    const free = ['c', 'd', 'e', 'f', 'g', 'h'];
    const pos = layoutGraph(['a', 'b', ...free], [{ source: 'a', target: 'b' }], {
      width,
      height,
      fixed: { a: { x: 250, y: 520 }, b: { x: 560, y: 300 } },
    });
    // Pins stay exact; every free node stays on screen (no runaway drift).
    expect(pos.get('a')).toEqual({ x: 250, y: 520 });
    for (const id of free) {
      const p = pos.get(id)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
    }
  });

  it('fits every node inside the box, even a sparse disconnected graph', () => {
    // Ten mostly-unlinked nodes are the worst case for repulsion drift.
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const width = 1000;
    const height = 620;
    const pos = layoutGraph(many, [{ source: 'a', target: 'b' }], { width, height });
    for (const id of many) {
      const p = pos.get(id)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
    }
  });
});
