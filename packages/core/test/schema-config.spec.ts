import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSchema,
  serializeSchema,
  loadSchema,
  validateSchema,
  writeSchema,
  initProject,
  loadProject,
  validateProject,
} from '../src/index.js';
import { compactField } from '../src/schema-config.js';
import { FIXED_NOW, tempFixture, corrupt } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'lovelace-schema-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

describe('schema serialization', () => {
  it('the default schema round-trips through loadSchema and validates clean', () => {
    const dir = tmp();
    const yaml = serializeSchema(defaultSchema());
    // Scalar arrays render in flow style.
    expect(yaml).toContain('priorities: [urgent, high, medium, low]');

    writeFileSync(join(dir, 'schema.yaml'), yaml);
    const parsed = loadSchema(dir);
    expect(validateSchema(parsed, 'schema.yaml')).toEqual([]);
    expect(parsed.statuses.map((s) => s.name)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'cancelled',
    ]);
    expect(parsed.statuses.find((s) => s.name === 'todo')?.agent).toBe('ready');
    expect(parsed.statuses.find((s) => s.name === 'in_progress')?.agent).toBe('in_progress');
    expect(parsed.statuses.find((s) => s.name === 'in_review')?.agent).toBe('complete');
    expect(parsed.statuses.find((s) => s.name === 'done')?.agent).toBeUndefined();
    expect(parsed.priorities).toEqual(['urgent', 'high', 'medium', 'low']);
    const task = parsed.types.find((t) => t.name === 'task');
    expect(task?.fields.find((f) => f.name === 'title')?.required).toBe(true);

    // Re-serialising the parsed form is stable.
    writeFileSync(join(dir, 'schema.yaml'), serializeSchema(parsed));
    expect(serializeSchema(loadSchema(dir))).toBe(serializeSchema(parsed));
  });

  it('round-trips human-readable labels on statuses, types and fields', () => {
    const dir = tmp();
    const s = defaultSchema();
    s.statuses[0]!.label = 'Icebox';
    s.types[1]!.label = 'Task';
    s.types[1]!.plural = 'Tasks';
    s.types[1]!.fields.push({ name: 'qa_owner', type: 'string', label: 'QA Owner' });
    writeFileSync(join(dir, 'schema.yaml'), serializeSchema(s));
    const parsed = loadSchema(dir);
    expect(parsed.statuses[0]!.label).toBe('Icebox');
    expect(parsed.types[1]!.label).toBe('Task');
    expect(parsed.types[1]!.plural).toBe('Tasks');
    expect(parsed.types[1]!.fields.find((f) => f.name === 'qa_owner')?.label).toBe('QA Owner');
    expect(validateSchema(parsed, 'schema.yaml')).toEqual([]);
  });

  it('the serialised default carries no labels and no active/complete flags', () => {
    const yaml = serializeSchema(defaultSchema());
    expect(yaml).not.toContain('label:');
    expect(yaml).not.toContain('plural:');
    expect(yaml).not.toContain('active:');
    expect(yaml).not.toContain('complete: true');
    expect(yaml).toContain('agent: ready');
    expect(yaml).toContain('agent: in_progress');
    expect(yaml).toContain('agent: complete');
  });
});

describe('initProject with a custom schema', () => {
  it('writes and validates a customised schema', () => {
    const root = tmp();
    const s = defaultSchema();
    s.statuses = [
      { name: 'inbox' },
      { name: 'doing', agent: 'in_progress' },
      { name: 'shipped', agent: 'complete' },
    ];
    s.types[2]!.fields.push({ name: 'severity', type: 'enum', values: ['low', 'high'] }); // bug type

    const created = initProject(root, { name: 'Custom', userName: 'Me', schema: s, now: FIXED_NOW });
    expect(created).toContain('.lovelace/schema.yaml');

    const issues = validateProject(loadProject(root), { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    const yaml = readFileSync(join(root, '.lovelace/schema.yaml'), 'utf8');
    expect(yaml).toContain('inbox');
    expect(yaml).toContain('severity');
    expect(yaml).toContain('values: [low, high]');
  });

  it('refuses to scaffold an invalid schema and leaves nothing behind', () => {
    const root = tmp();
    const s = defaultSchema();
    // An enum field with neither values nor values_from: priorities is invalid.
    s.types[0]!.fields.push({ name: 'broken', type: 'enum' }); // epic type
    expect(() => initProject(root, { name: 'Bad', schema: s })).toThrow(/invalid schema/);
    expect(existsSync(join(root, '.lovelace'))).toBe(false);
  });

  it('without a schema writes the byte-identical default', () => {
    const a = tmp();
    const b = tmp();
    initProject(a, { name: 'A', now: FIXED_NOW });
    initProject(b, { name: 'B', schema: defaultSchema(), now: FIXED_NOW });
    // The hardcoded default and the serialised defaultSchema() agree on content.
    const fromDefault = readFileSync(join(a, '.lovelace/schema.yaml'), 'utf8');
    const fromSerialised = readFileSync(join(b, '.lovelace/schema.yaml'), 'utf8');
    expect(loadSchema(join(a, '.lovelace'))).toEqual(loadSchema(join(b, '.lovelace')));
    // Both validate clean.
    expect(validateSchema(loadSchema(join(a, '.lovelace')), 'a').length).toBe(0);
    expect(fromDefault.length).toBeGreaterThan(0);
    expect(fromSerialised.length).toBeGreaterThan(0);
    expect(fromDefault).toBe(fromSerialised);
  });
});

describe('schema round-trip fidelity (the acceptance bar)', () => {
  it('reserialises the demo schema.yaml byte-for-byte', () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    const dir = join(root, '.lovelace');
    const disk = readFileSync(join(dir, 'schema.yaml'), 'utf8');
    // compactField key order and applySchemaFlow must reproduce the file exactly.
    expect(serializeSchema(loadSchema(dir))).toBe(disk);
  });

  it('writeSchema renames a status with a minimal diff, keeping flow-style arrays', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    const abs = join(root, '.lovelace/schema.yaml');
    const before = readFileSync(abs, 'utf8');
    const statuses = loadSchema(join(root, '.lovelace')).statuses.map((s) =>
      s.name === 'in_review' ? { ...s, name: 'review' } : s,
    );
    await writeSchema(root, { statuses, renames: { statuses: { in_review: 'review' } } }, { skipReindex: true });
    const after = readFileSync(abs, 'utf8');
    // Scalar arrays keep their compact flow style; a naive doc.set reflows them to block.
    expect(after).toContain('priorities: [urgent, high, medium, low]');
    expect(after).toContain('refers_to: [actor]');
    expect(after).toContain('values: [local, dev, staging, production]');
    // Only the renamed status line differs from the original file.
    const beforeLines = before.split('\n');
    const changed = after.split('\n').filter((l) => !beforeLines.includes(l));
    expect(changed).toEqual(['  - name: review']);
  });

  it('compactField keeps an explicit required: false, not just required: true', () => {
    expect(compactField({ name: 'x', type: 'string', required: false })).toMatchObject({ required: false });
    expect(compactField({ name: 'x', type: 'string', required: true })).toMatchObject({ required: true });
    expect(compactField({ name: 'x', type: 'string' })).not.toHaveProperty('required');
  });

  it('reserialises an authored required: false, a redundant label and a non-enum default byte-for-byte', () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    const dir = join(root, '.lovelace');
    corrupt(root, '.lovelace/schema.yaml', (t) =>
      t.replace(
        '      - name: estimate\n        type: number\n',
        '      - name: estimate\n        type: number\n        label: Estimate\n        required: false\n        default: 3\n',
      ),
    );
    const disk = readFileSync(join(dir, 'schema.yaml'), 'utf8');
    const parsed = loadSchema(dir);
    const estimate = parsed.types.find((t) => t.name === 'task')!.fields.find((f) => f.name === 'estimate')!;
    expect(estimate.label).toBe('Estimate');
    expect(estimate.required).toBe(false);
    expect(estimate.default).toBe(3);
    // compactField must not collapse the explicit required: false, drop the
    // redundant label (Title Case of "estimate" is already "Estimate"), or
    // drop the non-enum default.
    expect(serializeSchema(parsed)).toBe(disk);
  });

  it('writeSchema keeps required: false, a redundant label and a non-enum default across a no-op save and an unrelated edit', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    corrupt(root, '.lovelace/schema.yaml', (t) =>
      t.replace(
        '      - name: estimate\n        type: number\n',
        '      - name: estimate\n        type: number\n        label: Estimate\n        required: false\n        default: 3\n',
      ),
    );
    const abs = join(root, '.lovelace/schema.yaml');
    const before = readFileSync(abs, 'utf8');

    // A no-op-equivalent save: an empty edit keeps every section as loaded.
    await writeSchema(root, {}, { skipReindex: true });
    expect(readFileSync(abs, 'utf8')).toBe(before);

    // An unrelated edit (a new priority) leaves the three authored forms untouched.
    const current = loadSchema(join(root, '.lovelace'));
    await writeSchema(root, { priorities: [...current.priorities, 'blocked'] }, { skipReindex: true });
    const after = readFileSync(abs, 'utf8');
    expect(after).toContain('label: Estimate');
    expect(after).toContain('required: false');
    expect(after).toContain('default: 3');
    const beforeLines = before.split('\n');
    const changed = after.split('\n').filter((l) => !beforeLines.includes(l));
    expect(changed).toEqual(['priorities: [urgent, high, medium, low, blocked]']);
  });
});
