import { describe, expect, it, afterEach } from 'vitest';
import { writeAutomations, loadProject, MutationError } from '../src/index.js';
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

describe('writeAutomations', () => {
  it('replaces the on_transition rules, and they reload from workflow.yaml', async () => {
    const root = fixture();
    await writeAutomations(root, [
      { when: { to: 'in_review' }, agent: 'Review it.' },
      { when: { to: 'done', type: 'task' }, run: './scripts/archive.sh' },
    ]);
    const project = loadProject(root);
    expect(project.workflow.on_transition).toHaveLength(2);
    expect(project.workflow.on_transition[0]).toMatchObject({
      when: { to: 'in_review' },
      agent: 'Review it.',
    });
    expect(project.workflow.on_transition[1]).toMatchObject({
      when: { to: 'done', type: 'task' },
      run: './scripts/archive.sh',
    });
  });

  it('preserves the rest of workflow.yaml (statuses, types, fields)', async () => {
    const root = fixture();
    const before = loadProject(root).workflow;
    await writeAutomations(root, []);
    const after = loadProject(root).workflow;
    expect(after.on_transition).toHaveLength(0);
    expect(after.statuses).toEqual(before.statuses);
    expect(after.transitions).toEqual(before.transitions);
    expect(after.fields).toEqual(before.fields);
  });

  it('rejects a rule targeting an unknown status', async () => {
    const root = fixture();
    await expect(
      writeAutomations(root, [{ when: { to: 'nope' }, run: './x.sh' }]),
    ).rejects.toBeInstanceOf(MutationError);
  });

  it('rejects a rule with both run and agent', async () => {
    const root = fixture();
    await expect(
      writeAutomations(root, [{ when: { to: 'done' }, run: './x.sh', agent: 'do it' }]),
    ).rejects.toBeInstanceOf(MutationError);
  });

  it('rejects a field condition on an unknown field', async () => {
    const root = fixture();
    await expect(
      writeAutomations(root, [{ when: { to: 'done', nonexistent: 'x' }, run: './x.sh' }]),
    ).rejects.toBeInstanceOf(MutationError);
  });
});
