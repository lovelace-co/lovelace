import { describe, expect, it, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { setColumnOrder, readBoardOrder, loadProject } from '../src/index.js';
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

describe('board order', () => {
  it('persists a column order and reads it back', async () => {
    const root = fixture();
    const project = loadProject(root);
    const ids = project.tickets.map((t) => t.id);
    await setColumnOrder(root, 'todo', [ids[1]!, ids[0]!]);
    expect(readBoardOrder(project.dir).todo).toEqual([ids[1], ids[0]]);
  });

  it('drops ids that are not real tickets', async () => {
    const root = fixture();
    const project = loadProject(root);
    const ids = project.tickets.map((t) => t.id);
    await setColumnOrder(root, 'todo', [ids[0]!, 'T-9999']);
    expect(readBoardOrder(project.dir).todo).toEqual([ids[0]]);
  });

  it('moving a card into another column removes it from its old one', async () => {
    const root = fixture();
    const project = loadProject(root);
    const ids = project.tickets.map((t) => t.id);
    await setColumnOrder(root, 'todo', [ids[0]!, ids[1]!]);
    await setColumnOrder(root, 'done', [ids[0]!]);
    const order = readBoardOrder(project.dir);
    expect(order.todo).toEqual([ids[1]]);
    expect(order.done).toEqual([ids[0]]);
  });

  it('rejects an unknown status', async () => {
    const root = fixture();
    await expect(setColumnOrder(root, 'nonsense', [])).rejects.toThrow();
  });

  it('returns an empty map when no order file exists', () => {
    const root = fixture();
    const project = loadProject(root);
    // The demo fixture ships its own board-order.yaml (added alongside
    // T-0005); remove it here to exercise the true no-file fallback.
    rmSync(join(project.dir, 'board-order.yaml'), { force: true });
    expect(readBoardOrder(project.dir)).toEqual({});
  });
});
