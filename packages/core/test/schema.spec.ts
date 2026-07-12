import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  writeSchema,
  loadProject,
  readBoardOrder,
  validateProject,
  MutationError,
} from '../src/index.js';
import { tempFixture, unknownKeysFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

function errors(root: string) {
  return validateProject(loadProject(root)).filter((i) => i.severity === 'error');
}

describe('writeSchema', () => {
  it('adds a custom field to a type that reloads and validates', async () => {
    const root = fixture();
    const before = loadProject(root).schema;
    const types = before.types.map((t) =>
      t.name === 'bug'
        ? { ...t, fields: [...t.fields, { name: 'severity', type: 'enum' as const, values: ['sev1', 'sev2'] }] }
        : t,
    );
    await writeSchema(root, { types });
    const after = loadProject(root).schema;
    const bug = after.types.find((t) => t.name === 'bug');
    expect(bug?.fields.find((f) => f.name === 'severity')).toMatchObject({
      type: 'enum',
      values: ['sev1', 'sev2'],
    });
    expect(errors(root)).toHaveLength(0);
  });

  it('leaves the sections it was not given untouched', async () => {
    const root = fixture();
    const before = loadProject(root).schema;
    await writeSchema(root, { priorities: [...before.priorities, 'trivial'] });
    const after = loadProject(root).schema;
    expect(after.priorities).toEqual([...before.priorities, 'trivial']);
    expect(after.statuses).toEqual(before.statuses);
    expect(after.types).toEqual(before.types);
  });

  it('rejects a structurally invalid schema without writing', async () => {
    const root = fixture();
    const before = loadProject(root).schema;
    const types = before.types.map((t) =>
      t.name === 'bug' ? { ...t, fields: [...t.fields, { name: 'x', type: 'enum' as const }] } : t,
    );
    await expect(writeSchema(root, { types })).rejects.toBeInstanceOf(MutationError);
    // Unchanged on disk.
    expect(
      loadProject(root).schema.types.find((t) => t.name === 'bug')?.fields.some((f) => f.name === 'x'),
    ).toBe(false);
  });

  describe('status rename', () => {
    it('cascades to tickets and the board order', async () => {
      const root = fixture();
      writeFileSync(join(root, '.lovelace/board-order.yaml'), 'columns:\n  in_review: [T-0004]\n');
      const before = loadProject(root).schema;
      const statuses = before.statuses.map((s) => (s.name === 'in_review' ? { ...s, name: 'review' } : s));
      await writeSchema(root, {
        statuses,
        renames: { statuses: { in_review: 'review' } },
      });

      const after = loadProject(root);
      expect(after.schema.statuses.map((s) => s.name)).toContain('review');
      expect(after.schema.statuses.map((s) => s.name)).not.toContain('in_review');
      expect(after.tickets.find((t) => t.id === 'T-0004')?.status).toBe('review');
      expect(readBoardOrder(join(root, '.lovelace'))).toMatchObject({ review: ['T-0004'] });
      expect(errors(root)).toHaveLength(0);
    });

    it('blocks removing a status that tickets still use', async () => {
      const root = fixture();
      const before = loadProject(root).schema;
      // T-0004 is in_review, so dropping the column must be refused.
      await expect(
        writeSchema(root, {
          statuses: before.statuses.filter((s) => s.name !== 'in_review'),
        }),
      ).rejects.toThrow(/cannot remove status "in_review": 1 ticket/);
    });
  });

  describe('type rename', () => {
    it('cascades to ticket types', async () => {
      const root = fixture();
      const before = loadProject(root).schema;
      const types = before.types.map((t) => (t.name === 'task' ? { ...t, name: 'story' } : t));
      await writeSchema(root, { types, renames: { types: { task: 'story' } } });

      const after = loadProject(root);
      expect(after.tickets.find((t) => t.id === 'T-0002')?.type).toBe('story');
      expect(errors(root)).toHaveLength(0);
    });

    it('remaps refers_to targets across types when a type is renamed', async () => {
      const root = fixture();
      const before = loadProject(root).schema;
      const types = before.types.map((t) => (t.name === 'epic' ? { ...t, name: 'saga' } : t));
      await writeSchema(root, { types, renames: { types: { epic: 'saga' } } });

      const after = loadProject(root).schema;
      const task = after.types.find((t) => t.name === 'task');
      expect(task?.fields.find((f) => f.name === 'parent')?.refers_to).toEqual(['saga']);
      expect(errors(root)).toHaveLength(0);
    });

    it('blocks removing a type that tickets still use', async () => {
      const root = fixture();
      const before = loadProject(root).schema;
      await expect(
        writeSchema(root, { types: before.types.filter((t) => t.name !== 'epic') }),
      ).rejects.toThrow(/cannot remove type "epic"/);
    });

    it('rejects a rename that collides with an existing type, without writing', async () => {
      const root = fixture();
      const before = loadProject(root).schema;
      // task -> bug while bug already exists: two types would share one name.
      const types = before.types.map((t) => (t.name === 'task' ? { ...t, name: 'bug' } : t));
      await expect(
        writeSchema(root, { types, renames: { types: { task: 'bug' } } }),
      ).rejects.toBeInstanceOf(MutationError);
      // Unchanged on disk.
      expect(loadProject(root).schema.types.filter((t) => t.name === 'bug')).toHaveLength(1);
      expect(loadProject(root).schema.types.some((t) => t.name === 'task')).toBe(true);
    });
  });

  it('cascades a priority rename to ticket values', async () => {
    const root = fixture();
    const before = loadProject(root).schema;
    await writeSchema(root, {
      priorities: before.priorities.map((p) => (p === 'high' ? 'important' : p)),
      renames: { priorities: { high: 'important' } },
    });
    const after = loadProject(root);
    expect(after.tickets.find((t) => t.id === 'T-0002')?.fields.priority).toBe('important');
    expect(errors(root)).toHaveLength(0);
  });
});

// ADR-0011: non-destructive writes. writeSchema must carry unknown keys
// forward rather than destroying them, since compact* rebuilds every node
// from known keys only.
describe('writeSchema preserves unknown keys', () => {
  function unknownKeysRoot() {
    const f = unknownKeysFixture();
    cleanups.push(f.cleanup);
    return f.root;
  }

  it('a benign edit (adding a priority) leaves unknown keys at every level untouched', async () => {
    const root = unknownKeysRoot();
    const before = loadProject(root).schema;
    await writeSchema(root, { priorities: [...before.priorities, 'trivial'] });

    const text = readFileSync(join(root, '.lovelace/schema.yaml'), 'utf8');
    expect(text).toContain('board_layout: kanban');
    expect(text).toContain('colour: blue');
    expect(text).toContain('icon: check');
    expect(text).toContain('weighting: high');
    // The top-level key was never touched by writeSchema (it only sets
    // types/statuses/priorities), so it stays exactly where it was written.
    expect(text.startsWith('board_layout: kanban\n')).toBe(true);
    expect(errors(root)).toHaveLength(0);
  });

  it('a chained rename in one save follows identity, not names: the vacated name does not steal keys', async () => {
    const root = unknownKeysRoot();
    const abs = join(root, '.lovelace/schema.yaml');
    writeFileSync(
      abs,
      readFileSync(abs, 'utf8').replace('  - name: in_review\n', '  - name: in_review\n    marker: crosscheck\n'),
    );
    const before = loadProject(root).schema;
    // todo becomes in_review while in_review becomes review, in the same save.
    const statuses = before.statuses.map((s) =>
      s.name === 'todo' ? { ...s, name: 'in_review' } : s.name === 'in_review' ? { ...s, name: 'review' } : s,
    );
    await writeSchema(root, {
      statuses,
      renames: { statuses: { todo: 'in_review', in_review: 'review' } },
    });

    const after = loadProject(root).schema;
    const exTodo = after.statuses.find((s) => s.name === 'in_review') as unknown as Record<string, unknown>;
    const exInReview = after.statuses.find((s) => s.name === 'review') as unknown as Record<string, unknown>;
    expect(exTodo?.icon).toBe('check');
    expect(exTodo?.marker).toBeUndefined();
    expect(exInReview?.marker).toBe('crosscheck');
    expect(exInReview?.icon).toBeUndefined();
    expect(errors(root)).toHaveLength(0);
  });

  it('a status rename and a type rename carry their unknown keys to the renamed nodes', async () => {
    const root = unknownKeysRoot();
    const before = loadProject(root).schema;
    const statuses = before.statuses.map((s) => (s.name === 'todo' ? { ...s, name: 'doing' } : s));
    const types = before.types.map((t) => (t.name === 'bug' ? { ...t, name: 'defect' } : t));
    await writeSchema(root, {
      statuses,
      types,
      renames: { statuses: { todo: 'doing' }, types: { bug: 'defect' } },
    });

    const text = readFileSync(join(root, '.lovelace/schema.yaml'), 'utf8');
    expect(text).toContain('- name: doing');
    expect(text).toContain('- name: defect');
    expect(text).toContain('colour: blue');
    expect(text).toContain('icon: check');
    expect(text).toContain('weighting: high');
    expect(errors(root)).toHaveLength(0);

    // The unknown keys followed the renamed nodes, not just the file text.
    const after = loadProject(root).schema;
    const doing = after.statuses.find((s) => s.name === 'doing') as unknown as Record<string, unknown>;
    expect(doing?.icon).toBe('check');
    expect(after.statuses.some((s) => s.name === 'todo')).toBe(false);
    const defect = after.types.find((t) => t.name === 'defect') as unknown as
      | (Record<string, unknown> & { fields: Array<Record<string, unknown>> })
      | undefined;
    expect(defect?.colour).toBe('blue');
    expect(after.types.some((t) => t.name === 'bug')).toBe(false);
    const environment = defect?.fields.find((f) => f.name === 'environment');
    expect(environment?.weighting).toBe('high');
  });
});
