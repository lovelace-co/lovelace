import { describe, expect, it, afterEach } from 'vitest';
import { rmSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject, validateProject, hasErrors, formatIssues } from '../src/index.js';
import { tempFixture, corrupt, FIXED_NOW } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

function validate(root: string) {
  return validateProject(loadProject(root), { now: FIXED_NOW });
}

describe('the pristine fixture', () => {
  it('has no errors', () => {
    const issues = validate(fixture());
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags the stale conventions brief as a warning, not an error', () => {
    const issues = validate(fixture());
    const stale = issues.filter((i) => i.rule === 'briefs/stale');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.file).toContain('conventions/OVERVIEW.md');
    expect(hasErrors(stale)).toBe(false);
  });
});

describe('corrupted tickets', () => {
  it('reports unparseable YAML with file and line, never crashing', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) => t.replace('title:', 'title: [unclosed'));
    const issues = validate(root);
    const parse = issues.find((i) => i.rule === 'parse');
    expect(parse).toBeDefined();
    expect(parse?.file).toBe('.lovelace/tickets/T-0002.md');
    expect(parse?.line).toBeGreaterThan(1);
  });

  it('reports a file without frontmatter', () => {
    const root = fixture();
    writeFileSync(join(root, '.lovelace/tickets/T-0099.md'), '# no frontmatter here\n');
    const issues = validate(root);
    expect(issues.some((i) => i.rule === 'parse' && i.file.endsWith('T-0099.md') && i.line === 1)).toBe(true);
  });

  it('reports id and filename mismatch', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0003.md', (t) => t.replace('id: T-0003', 'id: T-0030'));
    const issues = validate(root);
    expect(issues.some((i) => i.rule === 'ids/filename' && i.file.endsWith('T-0003.md'))).toBe(true);
  });

  it('reports duplicate IDs across files', () => {
    const root = fixture();
    cpSync(join(root, '.lovelace/tickets/T-0003.md'), join(root, '.lovelace/tickets/T-0050.md'));
    const issues = validate(root);
    expect(issues.some((i) => i.rule === 'ids/duplicate')).toBe(true);
  });

  it('reports an unknown status with the offending line', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) =>
      t.replace('status: in_progress', 'status: shipping'),
    );
    const issues = validate(root);
    const issue = issues.find((i) => i.rule === 'tickets/unknown-status');
    expect(issue?.message).toContain('shipping');
    expect(issue?.line).toBe(4);
  });

  it('reports an unknown type', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) => t.replace('type: task', 'type: story'));
    expect(validate(root).some((i) => i.rule === 'tickets/unknown-type')).toBe(true);
  });

  it('reports a field value violating its definition', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) => t.replace('estimate: 3', 'estimate: large'));
    const issue = validate(root).find((i) => i.rule === 'fields/type');
    expect(issue?.message).toContain('estimate');
  });

  it('reports an enum value outside the allowed set', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0004.md', (t) =>
      t.replace('environment: staging', 'environment: moon'),
    );
    const issue = validate(root).find((i) => i.rule === 'fields/type');
    expect(issue?.message).toContain('must be one of');
  });

  it('reports a missing required field', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0004.md', (t) => t.replace(/environment: staging\n/, ''));
    expect(validate(root).some((i) => i.rule === 'fields/required' && i.message.includes('environment'))).toBe(true);
  });

  it('reports a field applied to the wrong type as an error', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0004.md', (t) =>
      t.replace('environment: staging', 'environment: staging\nestimate: 2'),
    );
    expect(validate(root).some((i) => i.rule === 'fields/not-applicable')).toBe(true);
  });

  it('treats unknown frontmatter keys as warnings, not errors', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) =>
      t.replace('estimate: 3', 'estimate: 3\nmood: optimistic'),
    );
    const issue = validate(root).find((i) => i.rule === 'fields/unknown');
    expect(issue?.severity).toBe('warning');
  });

  it('reports broken references for parent and depends_on', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) =>
      t
        .replace('parent: E-0001', 'parent: E-9999')
        .replace('depends_on: [T-0001]', 'depends_on: [T-9999]'),
    );
    const broken = validate(root).filter((i) => i.rule === 'links/broken');
    expect(broken.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a parent reference that resolves to a non-epic', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) => t.replace('parent: E-0001', 'parent: T-0001'));
    expect(validate(root).some((i) => i.rule === 'links/broken' && i.message.includes('parent'))).toBe(true);
  });

  it('reports a bad datetime in created', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) =>
      t.replace('created: 2026-05-29T10:00:00Z', 'created: yesterday'),
    );
    expect(validate(root).some((i) => i.rule === 'tickets/datetime')).toBe(true);
  });
});

describe('corrupted sessions and comments', () => {
  it('reports a session pointing at a missing ticket and bad outcome', () => {
    const root = fixture();
    corrupt(root, '.lovelace/sessions/S-0002.md', (t) =>
      t.replace('ticket: T-0002', 'ticket: T-9999').replace('outcome: partial', 'outcome: maybe'),
    );
    const issues = validate(root);
    expect(issues.some((i) => i.rule === 'links/broken' && i.file.endsWith('S-0002.md'))).toBe(true);
    expect(issues.some((i) => i.rule === 'sessions/outcome')).toBe(true);
  });

  it('reports a malformed commit SHA', () => {
    const root = fixture();
    corrupt(root, '.lovelace/sessions/S-0001.md', (t) => t.replace('9c41f2a', 'not-a-sha!'));
    expect(validate(root).some((i) => i.rule === 'sessions/commits')).toBe(true);
  });

  it('reports a missing required session section', () => {
    const root = fixture();
    corrupt(root, '.lovelace/sessions/S-0001.md', (t) => t.replace('## Open questions', '## Questions'));
    expect(validate(root).some((i) => i.rule === 'sessions/sections')).toBe(true);
  });

  it('reports a comment whose directory disagrees with its frontmatter', () => {
    const root = fixture();
    corrupt(root, '.lovelace/comments/T-0002/2026-06-08T1430-ada.md', (t) =>
      t.replace('ticket: T-0002', 'ticket: T-0001'),
    );
    expect(validate(root).some((i) => i.rule === 'comments/directory')).toBe(true);
  });

  it('warns on a comment filename outside the convention', () => {
    const root = fixture();
    writeFileSync(
      join(root, '.lovelace/comments/T-0002/note.md'),
      '---\nticket: T-0002\nactor: ada\ncreated: 2026-06-09T09:15:00Z\n---\n\nA note.\n',
    );
    const issue = validate(root).find((i) => i.rule === 'comments/filename');
    expect(issue?.severity).toBe('warning');
  });
});

describe('briefs and workflow rules', () => {
  it('reports a brief without a summary', () => {
    const root = fixture();
    corrupt(root, '.lovelace/briefs/domain/OVERVIEW.md', (t) =>
      t.replace(/summary: .*\n/, 'summary: ""\n'),
    );
    expect(validate(root).some((i) => i.rule === 'briefs/summary')).toBe(true);
  });

  it('warns on a briefs directory without OVERVIEW.md', () => {
    const root = fixture();
    rmSync(join(root, '.lovelace/briefs/domain/OVERVIEW.md'));
    const issue = validate(root).find((i) => i.rule === 'briefs/overview');
    expect(issue?.severity).toBe('warning');
    expect(issue?.file).toContain('briefs/domain');
  });

  it('reports duplicate brief ids', () => {
    const root = fixture();
    corrupt(root, '.lovelace/briefs/domain/OVERVIEW.md', (t) =>
      t.replace('id: domain-overview', 'id: architecture-overview'),
    );
    expect(validate(root).some((i) => i.rule === 'ids/duplicate')).toBe(true);
  });

  it('reports on_transition rules referencing unknown statuses, types and fields', () => {
    const root = fixture();
    corrupt(root, '.lovelace/workflow.yaml', (t) =>
      t
        .replace('when: { to: staging, type: task }', 'when: { to: shipping, type: story, urgency: high }')
        .replace('when: { to: done }', 'when: { to: done, from: nowhere }'),
    );
    const issues = validate(root);
    expect(issues.some((i) => i.rule === 'automation/unknown-status' && i.message.includes('shipping'))).toBe(true);
    expect(issues.some((i) => i.rule === 'automation/unknown-status' && i.message.includes('nowhere'))).toBe(true);
    expect(issues.some((i) => i.rule === 'automation/unknown-type')).toBe(true);
    expect(issues.some((i) => i.rule === 'automation/unknown-field')).toBe(true);
  });

  it('formats issues as file:line lines', () => {
    const root = fixture();
    corrupt(root, '.lovelace/tickets/T-0002.md', (t) =>
      t.replace('status: in_progress', 'status: shipping'),
    );
    const text = formatIssues(validate(root));
    expect(text).toMatch(/tickets\/T-0002\.md:4 error/);
  });
});
