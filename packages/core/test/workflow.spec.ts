import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  writeWorkflow,
  loadProject,
  readBoardOrder,
  validateProject,
  MutationError,
} from '../src/index.js';
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

function errors(root: string) {
  return validateProject(loadProject(root)).filter((i) => i.severity === 'error');
}

describe('writeWorkflow', () => {
  it('adds a custom field that reloads and validates', async () => {
    const root = fixture();
    const before = loadProject(root).workflow;
    await writeWorkflow(root, {
      fields: [...before.fields, { name: 'severity', type: 'enum', values: ['sev1', 'sev2'], applies_to: ['bug'] }],
    });
    const after = loadProject(root).workflow;
    expect(after.fields.find((f) => f.name === 'severity')).toMatchObject({
      type: 'enum',
      values: ['sev1', 'sev2'],
      applies_to: ['bug'],
    });
    expect(errors(root)).toHaveLength(0);
  });

  it('leaves the sections it was not given untouched', async () => {
    const root = fixture();
    const before = loadProject(root).workflow;
    await writeWorkflow(root, { priorities: [...before.priorities, 'trivial'] });
    const after = loadProject(root).workflow;
    expect(after.priorities).toEqual([...before.priorities, 'trivial']);
    expect(after.statuses).toEqual(before.statuses);
    expect(after.types).toEqual(before.types);
    expect(after.fields).toEqual(before.fields);
  });

  it('rejects a structurally invalid workflow without writing', async () => {
    const root = fixture();
    const before = loadProject(root).workflow;
    await expect(
      writeWorkflow(root, { fields: [...before.fields, { name: 'x', type: 'enum' }] }),
    ).rejects.toBeInstanceOf(MutationError);
    // Unchanged on disk.
    expect(loadProject(root).workflow.fields.some((f) => f.name === 'x')).toBe(false);
  });

  describe('status rename', () => {
    it('cascades to tickets, transitions and the board order', async () => {
      const root = fixture();
      writeFileSync(join(root, '.lovelace/board-order.yaml'), 'columns:\n  in_review: [T-0004]\n');
      const before = loadProject(root).workflow;
      const statuses = before.statuses.map((s) => (s.name === 'in_review' ? { ...s, name: 'review' } : s));
      await writeWorkflow(root, {
        statuses,
        transitions: before.transitions,
        renames: { statuses: { in_review: 'review' } },
      });

      const after = loadProject(root);
      expect(after.workflow.statuses.map((s) => s.name)).toContain('review');
      expect(after.workflow.statuses.map((s) => s.name)).not.toContain('in_review');
      expect(after.tickets.find((t) => t.id === 'T-0004')?.status).toBe('review');
      expect(after.workflow.transitions.some((t) => t.from === 'review')).toBe(true);
      expect(after.workflow.transitions.every((t) => !t.to.includes('in_review'))).toBe(true);
      expect(readBoardOrder(join(root, '.lovelace'))).toMatchObject({ review: ['T-0004'] });
      expect(errors(root)).toHaveLength(0);
    });

    it('blocks removing a status that tickets still use', async () => {
      const root = fixture();
      const before = loadProject(root).workflow;
      // T-0004 is in_review, so dropping the column must be refused.
      await expect(
        writeWorkflow(root, {
          statuses: before.statuses.filter((s) => s.name !== 'in_review'),
          transitions: before.transitions.filter((t) => t.from !== 'in_review'),
        }),
      ).rejects.toThrow(/cannot remove status "in_review": 1 ticket/);
    });
  });

  describe('type rename', () => {
    it('cascades to ticket types, field targets and automations', async () => {
      const root = fixture();
      const before = loadProject(root).workflow;
      const types = before.types.map((t) => (t.name === 'task' ? { ...t, name: 'story' } : t));
      await writeWorkflow(root, { types, renames: { types: { task: 'story' } } });

      const after = loadProject(root);
      expect(after.tickets.find((t) => t.id === 'T-0002')?.type).toBe('story');
      expect(after.workflow.fields.find((f) => f.name === 'estimate')?.applies_to).toContain('story');
      // The staging automation matched on type: task; it must follow the rename.
      const rule = after.workflow.on_transition.find((r) => r.when.to === 'staging');
      expect(rule?.when.type).toBe('story');
      expect(errors(root)).toHaveLength(0);
    });
  });

  it('cascades a priority rename to ticket values', async () => {
    const root = fixture();
    const before = loadProject(root).workflow;
    await writeWorkflow(root, {
      priorities: before.priorities.map((p) => (p === 'high' ? 'important' : p)),
      renames: { priorities: { high: 'important' } },
    });
    const after = loadProject(root);
    expect(after.tickets.find((t) => t.id === 'T-0002')?.fields.priority).toBe('important');
    expect(errors(root)).toHaveLength(0);
  });

  it('preserves automation keys it does not model, such as confirm', async () => {
    const root = fixture();
    const before = loadProject(root).workflow;
    await writeWorkflow(root, { priorities: [...before.priorities] });
    expect(readFileSync(join(root, '.lovelace/workflow.yaml'), 'utf8')).toContain('confirm: true');
  });
});
