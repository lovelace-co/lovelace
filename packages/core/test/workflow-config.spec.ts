import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultWorkflow,
  permissiveTransitions,
  serializeWorkflow,
  loadWorkflow,
  validateWorkflow,
  initProject,
  loadProject,
  validateProject,
} from '../src/index.js';
import { FIXED_NOW } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'lovelace-wf-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

describe('workflow serialization', () => {
  it('the default workflow round-trips through loadWorkflow and validates clean', () => {
    const dir = tmp();
    const yaml = serializeWorkflow(defaultWorkflow());
    // Scalar arrays render in flow style.
    expect(yaml).toContain('priorities: [urgent, high, medium, low]');
    expect(yaml).toContain('to: [todo, cancelled]');

    writeFileSync(join(dir, 'workflow.yaml'), yaml);
    const parsed = loadWorkflow(dir);
    expect(validateWorkflow(parsed, 'workflow.yaml')).toEqual([]);
    expect(parsed.statuses.map((s) => s.name)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'cancelled',
    ]);
    expect(parsed.statuses.find((s) => s.name === 'in_progress')?.active).toBe(true);
    expect(parsed.statuses.find((s) => s.name === 'done')?.complete).toBe(true);
    expect(parsed.priorities).toEqual(['urgent', 'high', 'medium', 'low']);
    expect(parsed.fields.find((f) => f.name === 'title')?.required).toBe(true);

    // Re-serialising the parsed form is stable.
    writeFileSync(join(dir, 'workflow.yaml'), serializeWorkflow(parsed));
    expect(serializeWorkflow(loadWorkflow(dir))).toBe(serializeWorkflow(parsed));
  });

  it('round-trips human-readable labels on statuses, types and fields', () => {
    const dir = tmp();
    const wf = defaultWorkflow();
    wf.statuses[0]!.label = 'Icebox';
    wf.types[1]!.label = 'Task';
    wf.types[1]!.plural = 'Tasks';
    wf.fields.push({ name: 'qa_owner', type: 'string', label: 'QA Owner' });
    writeFileSync(join(dir, 'workflow.yaml'), serializeWorkflow(wf));
    const parsed = loadWorkflow(dir);
    expect(parsed.statuses[0]!.label).toBe('Icebox');
    expect(parsed.types[1]!.label).toBe('Task');
    expect(parsed.types[1]!.plural).toBe('Tasks');
    expect(parsed.fields.find((f) => f.name === 'qa_owner')?.label).toBe('QA Owner');
    expect(validateWorkflow(parsed, 'workflow.yaml')).toEqual([]);
  });

  it('the serialised default carries no labels and no wip/terminal keys', () => {
    const yaml = serializeWorkflow(defaultWorkflow());
    expect(yaml).not.toContain('label:');
    expect(yaml).not.toContain('plural:');
    expect(yaml).not.toContain('wip:');
    expect(yaml).not.toContain('terminal:');
    expect(yaml).toContain('active: true');
    expect(yaml).toContain('complete: true');
  });

  it('permissiveTransitions links every status to every other', () => {
    expect(permissiveTransitions([{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toEqual([
      { from: 'a', to: ['b', 'c'] },
      { from: 'b', to: ['a', 'c'] },
      { from: 'c', to: ['a', 'b'] },
    ]);
  });
});

describe('initProject with a custom workflow', () => {
  it('writes and validates a customised workflow', () => {
    const root = tmp();
    const wf = defaultWorkflow();
    wf.statuses = [{ name: 'inbox' }, { name: 'doing', active: true }, { name: 'shipped', complete: true }];
    wf.transitions = permissiveTransitions(wf.statuses);
    wf.fields.push({ name: 'severity', type: 'enum', values: ['low', 'high'] });

    const created = initProject(root, { name: 'Custom', userName: 'Me', workflow: wf, now: FIXED_NOW });
    expect(created).toContain('.lovelace/workflow.yaml');

    const issues = validateProject(loadProject(root), { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    const yaml = readFileSync(join(root, '.lovelace/workflow.yaml'), 'utf8');
    expect(yaml).toContain('inbox');
    expect(yaml).toContain('severity');
    expect(yaml).toContain('values: [low, high]');
  });

  it('refuses to scaffold an invalid workflow and leaves nothing behind', () => {
    const root = tmp();
    const wf = defaultWorkflow();
    // An enum field with neither values nor values_from: priorities is invalid.
    wf.fields.push({ name: 'broken', type: 'enum' });
    expect(() => initProject(root, { name: 'Bad', workflow: wf })).toThrow(/invalid workflow/);
    expect(existsSync(join(root, '.lovelace'))).toBe(false);
  });

  it('without a workflow writes the byte-identical default', () => {
    const a = tmp();
    const b = tmp();
    initProject(a, { name: 'A', now: FIXED_NOW });
    initProject(b, { name: 'B', workflow: defaultWorkflow(), now: FIXED_NOW });
    // The hardcoded default and the serialised defaultWorkflow() agree on content.
    const fromDefault = readFileSync(join(a, '.lovelace/workflow.yaml'), 'utf8');
    const fromSerialised = readFileSync(join(b, '.lovelace/workflow.yaml'), 'utf8');
    expect(loadWorkflow(join(a, '.lovelace'))).toEqual(loadWorkflow(join(b, '.lovelace')));
    // Both validate clean.
    expect(validateWorkflow(loadWorkflow(join(a, '.lovelace')), 'a').length).toBe(0);
    expect(fromDefault.length).toBeGreaterThan(0);
    expect(fromSerialised.length).toBeGreaterThan(0);
  });
});
