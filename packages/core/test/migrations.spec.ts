import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadProject,
  validateProject,
  writeIndex,
  migrationPath,
  planProjectMigration,
  migrateProject,
  MutationError,
} from '../src/index.js';
import { tempFixture, v2Fixture, corrupt } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function v2Root() {
  const f = v2Fixture();
  cleanups.push(f.cleanup);
  return f.root;
}

function fixtureRoot() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

describe('migrationPath', () => {
  it('chains from a declared major up to the supported major', () => {
    const steps = migrationPath(2);
    expect(steps.map((s) => `${s.from}->${s.to}`)).toEqual(['2->3']);
  });

  it('refuses a major below the migration floor', () => {
    expect(() => migrationPath(1)).toThrow(/predates supported migrations/);
  });

  it('refuses an already-current major', () => {
    expect(() => migrationPath(3)).toThrow(/already declares spec version 3/);
  });

  it('refuses a major newer than supported', () => {
    expect(() => migrationPath(4)).toThrow(/newer than the supported/);
  });
});

describe('planProjectMigration', () => {
  it('lists the expected step and change lines without touching files', () => {
    const root = v2Root();
    const workflowBefore = readFileSync(join(root, '.lovelace/workflow.yaml'), 'utf8');
    const manifestBefore = readFileSync(join(root, '.lovelace/manifest.yaml'), 'utf8');

    const result = planProjectMigration(root);

    expect(result.declared).toBe('2.0.0');
    // The target is the chain's final floor (what the last step actually
    // stamps), not this tooling's full SPEC_VERSION.
    expect(result.target).toBe('3.0.0');
    expect(result.steps).toHaveLength(1);
    const [step] = result.steps;
    expect(step.summary).toMatch(/2\.x workflow format to 3\.0/);
    expect(step.changes).toEqual([
      'nest 7 fields under their types; estimate applies to task only; environment applies to bug only',
      'status "in_progress" becomes the in progress role',
      'status "done" becomes the complete role',
      'status "in_review", "staging" lose their active flag (no 3.0 equivalent)',
      'status "cancelled" loses its complete flag (no 3.0 equivalent)',
      'no status carries a ready role; assign one in settings if you want agents to pick up work automatically',
      'remove transitions and 2 automation rules',
      'rename workflow.yaml to schema.yaml',
    ]);

    // A dry run touches nothing.
    expect(existsSync(join(root, '.lovelace/workflow.yaml'))).toBe(true);
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(false);
    expect(readFileSync(join(root, '.lovelace/workflow.yaml'), 'utf8')).toBe(workflowBefore);
    expect(readFileSync(join(root, '.lovelace/manifest.yaml'), 'utf8')).toBe(manifestBefore);
  });

  it('includes release notes from the changelog, declared exclusive and target inclusive', () => {
    const root = v2Root();
    const result = planProjectMigration(root);

    // Declared is 2.0.0, target is 3.0.0: every changelog entry strictly
    // above 2.0.0 up to and including 3.0.0, ascending, and nothing above.
    expect(result.releaseNotes.map((n) => n.version)).toEqual(['2.1.0', '3.0.0']);
    expect(result.releaseNotes[0]!.description).toMatch(/presence_timeout_minutes/);
    expect(result.releaseNotes[1]!.description).toMatch(/renames `workflow\.yaml` to `schema\.yaml`/);
  });

  it('reports removal of state/agent_instructions.json and index/actions.log when present', () => {
    const root = v2Root();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/agent_instructions.json'), '{}');
    writeFileSync(join(root, '.lovelace/index/actions.log'), 'noop\n');

    const result = planProjectMigration(root);
    expect(result.steps[0]!.changes).toContain('remove state/agent_instructions.json');
    expect(result.steps[0]!.changes).toContain('remove index/actions.log');
  });
});

describe('migrateProject', () => {
  it('rewrites workflow.yaml into schema.yaml, patches the manifest, and leaves a clean, reindexable project', () => {
    const root = v2Root();
    const dir = join(root, '.lovelace');

    const result = migrateProject(root);

    expect(result.declared).toBe('2.0.0');
    expect(result.finalVersion).toBe('3.0.0');
    expect(result.steps).toHaveLength(1);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);

    // workflow.yaml is gone, schema.yaml exists.
    expect(existsSync(join(dir, 'workflow.yaml'))).toBe(false);
    expect(existsSync(join(dir, 'schema.yaml'))).toBe(true);
    const schemaText = readFileSync(join(dir, 'schema.yaml'), 'utf8');

    // The hand-authored comment survived the transform.
    expect(schemaText).toContain('# orbit weather service workflow definition');

    // Fields nest under their types; estimate/environment stay scoped.
    const epic = schemaText.split('- name: epic')[1]!.split('- name: task')[0]!;
    expect(epic).toContain('name: title');
    expect(epic).toContain('name: parent');
    expect(epic).toContain('name: depends_on');
    expect(epic).toContain('name: assignee');
    expect(epic).toContain('name: priority');
    expect(epic).not.toContain('name: estimate');
    expect(epic).not.toContain('name: environment');

    const task = schemaText.split('- name: task')[1]!.split('- name: bug')[0]!;
    expect(task).toContain('name: estimate');
    expect(task).not.toContain('name: environment');

    const bug = schemaText.split('- name: bug')[1]!.split('statuses:')[0]!;
    expect(bug).toContain('name: environment');
    expect(bug).not.toContain('name: estimate');

    // No applies_to survives anywhere.
    expect(schemaText).not.toContain('applies_to');

    // Statuses: first active -> in_progress role, first complete -> complete
    // role, later duplicates lose the flag with no agent line.
    expect(schemaText).toMatch(/- name: in_progress\s*\n\s*agent: in_progress/);
    expect(schemaText).toMatch(/- name: done\s*\n\s*agent: complete/);
    expect(schemaText).not.toMatch(/in_review\s*\n\s*agent/);
    expect(schemaText).not.toMatch(/staging\s*\n\s*agent/);
    expect(schemaText).not.toMatch(/cancelled\s*\n\s*agent/);
    expect(schemaText).not.toContain('active:');
    expect(schemaText).not.toContain('complete:');

    // transitions and on_transition are gone.
    expect(schemaText).not.toContain('transitions:');
    expect(schemaText).not.toContain('on_transition:');

    // The manifest declares 3.0.0 with every other key byte-preserved.
    const manifestText = readFileSync(join(dir, 'manifest.yaml'), 'utf8');
    expect(manifestText).toContain('spec_version: 3.0.0');
    expect(manifestText).toContain('project_id: demo4f2a');
    expect(manifestText).toContain('name: Orbit Weather Service');
    expect(manifestText).toContain('created: 2026-05-28');

    // loadProject is clean and validation reports zero errors.
    const project = loadProject(root);
    expect(project.manifest.spec_version).toBe('3.0.0');
    const issues = validateProject(project);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    // Reindexing twice is byte-identical (index.json, BOARD.md already
    // written once by migrateProject itself).
    const indexPath = join(dir, 'index/index.json');
    const boardPath = join(dir, 'index/BOARD.md');
    const indexBefore = readFileSync(indexPath, 'utf8');
    const boardBefore = readFileSync(boardPath, 'utf8');
    writeIndex(loadProject(root));
    expect(readFileSync(indexPath, 'utf8')).toBe(indexBefore);
    expect(readFileSync(boardPath, 'utf8')).toBe(boardBefore);
  });

  it('removes state/agent_instructions.json and index/actions.log when present', () => {
    const root = v2Root();
    const dir = join(root, '.lovelace');
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(join(dir, 'state/agent_instructions.json'), '{}');
    writeFileSync(join(dir, 'index/actions.log'), 'noop\n');

    migrateProject(root);

    expect(existsSync(join(dir, 'state/agent_instructions.json'))).toBe(false);
    expect(existsSync(join(dir, 'index/actions.log'))).toBe(false);
  });

  it('throws the already-current error on an already-3.x project and touches nothing', () => {
    const root = fixtureRoot();
    const before = readFileSync(join(root, '.lovelace/schema.yaml'), 'utf8');
    expect(() => migrateProject(root)).toThrow(MutationError);
    expect(() => migrateProject(root)).toThrow(/already declares spec version 3/);
    expect(readFileSync(join(root, '.lovelace/schema.yaml'), 'utf8')).toBe(before);
  });

  it('throws the floor error on a 1.x manifest', () => {
    const root = v2Root();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('spec_version: 2.0.0', 'spec_version: 1.0.0'));
    expect(() => migrateProject(root)).toThrow(/predates supported migrations/);
  });

  it('refuses a 4.x manifest', () => {
    const root = fixtureRoot();
    corrupt(root, '.lovelace/manifest.yaml', (t) => t.replace('spec_version: 3.0.0', 'spec_version: 4.0.0'));
    expect(() => migrateProject(root)).toThrow(/newer than the supported/);
  });
});

describe('hostile 2.x input', () => {
  it('refuses a missing workflow.yaml, naming the file', () => {
    const root = v2Root();
    rmSync(join(root, '.lovelace/workflow.yaml'));
    expect(() => planProjectMigration(root)).toThrow(MutationError);
    expect(() => planProjectMigration(root)).toThrow(/\.lovelace\/workflow\.yaml is missing/);
  });

  it('refuses unparseable YAML naming the file and line, leaving the tree untouched', () => {
    const root = v2Root();
    const workflowPath = join(root, '.lovelace/workflow.yaml');
    const manifestPath = join(root, '.lovelace/manifest.yaml');
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    // An unterminated flow sequence: a genuine YAML syntax error.
    writeFileSync(workflowPath, 'types: [\n  - name: epic\n');

    let thrown: unknown;
    try {
      planProjectMigration(root);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(MutationError);
    const message = (thrown as Error).message;
    expect(message).toContain('.lovelace/workflow.yaml');
    expect(message).toMatch(/\.lovelace\/workflow\.yaml:\d+:/);

    // apply (migrateProject) refuses the same way and writes nothing.
    expect(() => migrateProject(root)).toThrow(MutationError);
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(false);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
  });

  it('refuses element-level garbage the shape guards cannot see, without half-writing', () => {
    const root = v2Root();
    const workflowPath = join(root, '.lovelace/workflow.yaml');
    const manifestPath = join(root, '.lovelace/manifest.yaml');
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    // Scalar entries where mappings belong: passes the array-level guards,
    // but the generated schema.yaml can never satisfy the 3.0 parser.
    writeFileSync(workflowPath, 'types: [epic, task, bug]\n\nstatuses:\n  - name: todo\n\npriorities: []\n');

    expect(() => migrateProject(root)).toThrow(
      /invalid schema\.yaml.*correct workflow\.yaml and retry/,
    );
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(false);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
  });

  it('refuses types missing or empty before any write', () => {
    const root = v2Root();
    corrupt(root, '.lovelace/workflow.yaml', (t) =>
      t.replace(
        'types:\n  - name: epic\n    id_prefix: E\n  - name: task\n    id_prefix: T\n  - name: bug\n    id_prefix: T\n',
        'types: []\n',
      ),
    );
    expect(() => planProjectMigration(root)).toThrow(/types is missing or empty/);
    expect(() => migrateProject(root)).toThrow(/types is missing or empty/);
    expect(existsSync(join(root, '.lovelace/workflow.yaml'))).toBe(true);
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(false);
  });

  it('refuses statuses missing or empty before any write', () => {
    const root = v2Root();
    corrupt(root, '.lovelace/workflow.yaml', (t) =>
      t.replace(
        'statuses:\n  - name: backlog\n  - name: todo\n  - name: in_progress\n    active: true\n  - name: in_review\n    active: true\n  - name: staging\n    active: true\n  - name: done\n    complete: true\n  - name: cancelled\n    complete: true\n',
        'statuses: []\n',
      ),
    );
    expect(() => migrateProject(root)).toThrow(/statuses is missing or empty/);
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(false);
  });

  it('treats an absent fields list as empty but refuses a non-array fields', () => {
    const root = v2Root();
    corrupt(root, '.lovelace/workflow.yaml', (t) =>
      t.replace(
        'fields:\n  - name: title\n    type: string\n    required: true\n  - name: parent\n    type: reference\n    refers_to: [epic]\n  - name: depends_on\n    type: list\n    item_type: reference\n  - name: assignee\n    type: reference\n    refers_to: [actor]\n  - name: priority\n    type: enum\n    values_from: priorities\n  - name: estimate\n    type: number\n    applies_to: [task]\n  - name: environment\n    type: enum\n    values: [local, dev, staging, production]\n    applies_to: [bug]\n    required: true\n',
        'fields: nope\n',
      ),
    );
    expect(() => migrateProject(root)).toThrow(/fields must be a list/);
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(false);
  });

  it('refuses a field whose applies_to names an unknown type, naming both', () => {
    const root = v2Root();
    corrupt(root, '.lovelace/workflow.yaml', (t) => t.replace('applies_to: [task]', 'applies_to: [ghost]'));

    let thrown: unknown;
    try {
      migrateProject(root);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(MutationError);
    const message = (thrown as Error).message;
    expect(message).toContain('"estimate"');
    expect(message).toContain('"ghost"');
    expect(existsSync(join(root, '.lovelace/schema.yaml'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/workflow.yaml'))).toBe(true);
  });

  it('preserves unknown per-node keys on types, statuses and fields', () => {
    const root = v2Root();
    corrupt(root, '.lovelace/workflow.yaml', (t) =>
      t
        .replace('  - name: bug\n    id_prefix: T\n', '  - name: bug\n    id_prefix: T\n    colour: blue\n')
        .replace('  - name: todo\n', '  - name: todo\n    icon: check\n')
        .replace(
          '  - name: estimate\n    type: number\n    applies_to: [task]\n',
          '  - name: estimate\n    type: number\n    applies_to: [task]\n    weighting: high\n',
        ),
    );

    migrateProject(root);
    const schemaText = readFileSync(join(root, '.lovelace/schema.yaml'), 'utf8');

    // "colour" is an unknown key on the type itself: appended after the
    // type's canonical keys (including its now-nested fields), the same
    // position mergeType uses for a same-major save.
    const bug = schemaText.split('- name: bug')[1]!.split('statuses:')[0]!;
    expect(bug.trim().endsWith('colour: blue')).toBe(true);
    expect(schemaText).toMatch(/- name: todo\s*\n\s*icon: check/);
    expect(schemaText).toMatch(/- name: estimate\s*\n\s*type: number\s*\n\s*weighting: high/);
    // The consumed 2.x key never survives alongside the preserved ones.
    expect(schemaText).not.toContain('applies_to');
  });

  it('gives a both-flags status exactly one role decision, and the complete role still lands', () => {
    const root = v2Root();
    // "in_progress" is the first flagged status in the fixture: give it
    // complete: true too, so it is first-unclaimed for BOTH roles at once.
    // A two-branch decision (complete assigns, then active overwrites) would
    // produce two contradictory lines for it and lose the complete role
    // everywhere, since assignedComplete stays permanently claimed by a
    // status that ends up in_progress instead.
    corrupt(root, '.lovelace/workflow.yaml', (t) =>
      t.replace(
        '  - name: in_progress\n    active: true\n',
        '  - name: in_progress\n    active: true\n    complete: true\n',
      ),
    );

    const plan = planProjectMigration(root);
    const changes = plan.steps[0]!.changes;
    const roleLines = changes.filter((line) => line.startsWith('status "in_progress" becomes'));
    expect(roleLines).toHaveLength(1);
    expect(roleLines[0]).toBe('status "in_progress" becomes the complete role');
    // "in_review" is the next active-flagged status, so it claims the
    // in_progress role in_progress didn't use; in_progress's own active flag
    // (unused, since it won complete instead) is reported lost alongside it.
    expect(changes).toContain('status "in_review" becomes the in progress role');
    expect(changes).toContain('status "in_progress", "staging" lose their active flag (no 3.0 equivalent)');

    migrateProject(root);
    const schemaText = readFileSync(join(root, '.lovelace/schema.yaml'), 'utf8');
    // The complete role landed on "in_progress" (first unclaimed for
    // complete), not lost; "done" (the next complete-flagged status) is now
    // the one without a role, since complete was already claimed.
    expect(schemaText).toMatch(/- name: in_progress\s*\n\s*agent: complete/);
    expect(schemaText).not.toMatch(/- name: done\s*\n\s*agent:/);
    expect(schemaText).toMatch(/- name: in_review\s*\n\s*agent: in_progress/);
  });
});
