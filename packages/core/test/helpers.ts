import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FIXTURE_ROOT = resolve(__dirname, '../../../examples/demo-project');

/** Copies the demo project into a temp dir so tests can corrupt it freely. */
export function tempFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'lovelace-test-'));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function corrupt(root: string, rel: string, fn: (text: string) => string): void {
  const abs = join(root, rel);
  // Normalise to LF before applying fn: fn's patterns are written as LF
  // literals, and a CRLF-checked-out fixture (Windows, or a local clone
  // that predates .gitattributes) would otherwise make an exact-string
  // match silently miss, leaving the intended corruption unapplied.
  const text = readFileSync(abs, 'utf8').replace(/\r\n|\r/g, '\n');
  writeFileSync(abs, fn(text));
}

export const FIXED_NOW = () => new Date('2026-06-10T12:00:00Z');

/**
 * A copy of the demo fixture with a construct this tooling does not model
 * injected at each of the four config levels ADR-0011's tolerant reads must
 * survive: a top-level manifest key, a top-level schema.yaml key, a type, a
 * status and a field. Used to test that unknown keys parse, warn rather than
 * error, and survive a writeSchema save untouched.
 */
export function unknownKeysFixture(): { root: string; cleanup: () => void } {
  const f = tempFixture();
  corrupt(f.root, '.lovelace/manifest.yaml', (t) =>
    t.replace('created: 2026-05-28\n', 'created: 2026-05-28\ntheme: dark\n'),
  );
  corrupt(f.root, '.lovelace/schema.yaml', (t) => `board_layout: kanban\n${t}`);
  corrupt(f.root, '.lovelace/schema.yaml', (t) =>
    t.replace('  - name: bug\n    id_prefix: T\n', '  - name: bug\n    id_prefix: T\n    colour: blue\n'),
  );
  corrupt(f.root, '.lovelace/schema.yaml', (t) =>
    t.replace('  - name: todo\n    agent: ready\n', '  - name: todo\n    agent: ready\n    icon: check\n'),
  );
  corrupt(f.root, '.lovelace/schema.yaml', (t) =>
    t.replace(
      '        values: [local, dev, staging, production]\n        required: true\n',
      '        values: [local, dev, staging, production]\n        required: true\n        weighting: high\n',
    ),
  );
  return f;
}

/**
 * The real 2.x workflow.yaml shape (ADR-0011's migration source), with a
 * comment so comment survival through the 2-to-3 step is testable.
 */
export const V2_WORKFLOW_YAML = `# orbit weather service workflow definition
types:
  - name: epic
    id_prefix: E
  - name: task
    id_prefix: T
  - name: bug
    id_prefix: T

statuses:
  - name: backlog
  - name: todo
  - name: in_progress
    active: true
  - name: in_review
    active: true
  - name: staging
    active: true
  - name: done
    complete: true
  - name: cancelled
    complete: true

transitions:
  - from: backlog
    to: [todo, cancelled]
  - from: todo
    to: [in_progress, backlog, cancelled]

priorities: [urgent, high, medium, low]

fields:
  - name: title
    type: string
    required: true
  - name: parent
    type: reference
    refers_to: [epic]
  - name: depends_on
    type: list
    item_type: reference
  - name: assignee
    type: reference
    refers_to: [actor]
  - name: priority
    type: enum
    values_from: priorities
  - name: estimate
    type: number
    applies_to: [task]
  - name: environment
    type: enum
    values: [local, dev, staging, production]
    applies_to: [bug]
    required: true

on_transition:
  - when: { to: staging, type: task }
    agent: Deploy the current branch using scripts/deploy-staging.sh.
    confirm: true
  - when: { to: done }
    run: ./scripts/archive-artifacts.sh
`;

/**
 * A 2.x-shaped project: the demo fixture's tickets and documents with
 * workflow.yaml (2.x) in place of schema.yaml (3.x), and a 2.0.0 manifest.
 * Used to test the migration framework's plan/apply.
 */
export function v2Fixture(): { root: string; cleanup: () => void } {
  const f = tempFixture();
  rmSync(join(f.root, '.lovelace/schema.yaml'));
  writeFileSync(join(f.root, '.lovelace/workflow.yaml'), V2_WORKFLOW_YAML);
  corrupt(f.root, '.lovelace/manifest.yaml', (t) => t.replace(/^spec_version: .*$/m, 'spec_version: 2.0.0'));
  return f;
}
