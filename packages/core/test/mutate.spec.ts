import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTicket,
  updateTicket,
  deleteTicket,
  logSession,
  addComment,
  setActiveTicket,
  getActiveTicket,
  loadProject,
  validateProject,
  nextId,
  MutationError,
} from '../src/index.js';
import { tempFixture, FIXED_NOW } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

const ctx = { now: FIXED_NOW };

describe('ID assignment', () => {
  it('continues from the highest existing ID by scanning', async () => {
    const root = fixture();
    const project = loadProject(root);
    const id = await nextId(project.dir, project.manifest, 'T');
    expect(id).toBe('T-0005');
  });

  it('assigns unique IDs under concurrency', async () => {
    const root = fixture();
    const project = loadProject(root);
    const ids = await Promise.all(
      Array.from({ length: 12 }, () => nextId(project.dir, project.manifest, 'T')),
    );
    expect(new Set(ids).size).toBe(12);
  });
});

describe('createTicket', () => {
  it('creates a valid ticket with defaults and assigned ID', async () => {
    const root = fixture();
    const ticket = await createTicket(
      root,
      { type: 'task', fields: { title: 'Current conditions endpoint', estimate: 2 } },
      ctx,
    );
    expect(ticket.id).toBe('T-0005');
    expect(ticket.status).toBe('backlog');
    expect(ticket.fields.title).toBe('Current conditions endpoint');
    const issues = validateProject(loadProject(root), { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('epics get the E prefix', async () => {
    const root = fixture();
    const epic = await createTicket(root, { type: 'epic', fields: { title: 'Mobile clients' } }, ctx);
    expect(epic.id).toBe('E-0002');
  });

  it('rejects unknown types, locked core fields, and invalid fields', async () => {
    const root = fixture();
    await expect(createTicket(root, { type: 'story', fields: { title: 'x' } }, ctx)).rejects.toThrow(
      /unknown ticket type/,
    );
    await expect(
      createTicket(root, { type: 'task', fields: { title: 'x', status: 'done' } }, ctx),
    ).rejects.toThrow(/locked core field/);
    await expect(
      createTicket(root, { type: 'bug', fields: { title: 'x' } }, ctx),
    ).rejects.toThrow(/environment/);
  });

  it('refreshes the index after writing', async () => {
    const root = fixture();
    await createTicket(root, { type: 'task', fields: { title: 'Indexed straight away' } }, ctx);
    const index = readFileSync(join(root, '.lovelace/index/index.json'), 'utf8');
    expect(index).toContain('Indexed straight away');
  });
});

describe('updateTicket', () => {
  it('performs a legal transition and returns fired automation rules', async () => {
    const root = fixture();
    const result = await updateTicket(root, 'T-0004', { status: 'staging' }, ctx);
    expect(result.ticket.status).toBe('staging');
    // The staging rule matches type: task only; T-0004 is a bug.
    expect(result.firedRules).toHaveLength(0);

    const t2 = await updateTicket(root, 'T-0002', { status: 'in_review' }, ctx);
    expect(t2.firedRules).toHaveLength(0);
    const t2b = await updateTicket(root, 'T-0002', { status: 'staging' }, ctx);
    expect(t2b.firedRules).toHaveLength(1);
    expect(t2b.firedRules[0]?.rule.agent).toContain('Deploy');
  });

  it('rejects illegal transitions naming the legal targets', async () => {
    const root = fixture();
    await expect(updateTicket(root, 'T-0003', { status: 'done' }, ctx)).rejects.toThrow(
      /illegal transition todo -> done/,
    );
  });

  it('forceTransition permits moves outside the workflow, but never unknown statuses', async () => {
    const root = fixture();
    const result = await updateTicket(root, 'T-0003', { status: 'done' }, { ...ctx, forceTransition: true });
    expect(result.ticket.status).toBe('done');
    await expect(
      updateTicket(root, 'T-0003', { status: 'shipping' }, { ...ctx, forceTransition: true }),
    ).rejects.toThrow(/unknown status/);
  });

  it('rejects edits to locked core fields', async () => {
    const root = fixture();
    await expect(updateTicket(root, 'T-0003', { created: '2020-01-01T00:00:00Z' }, ctx)).rejects.toThrow(
      /locked core field/,
    );
  });

  it('updates fields, bumps updated, preserves the body and list formatting', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    const result = await updateTicket(root, 'T-0002', { priority: 'urgent' }, ctx);
    expect(result.ticket.fields.priority).toBe('urgent');
    expect(result.ticket.updated).toBe('2026-06-10T12:00:00Z');
    const after = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    expect(after).toContain('depends_on: [T-0001]'); // flow style untouched
    expect(after.split('---\n')[2]).toBe(before.split('---\n')[2]); // body identical
  });

  it('removes a field when set to null', async () => {
    const root = fixture();
    const result = await updateTicket(root, 'T-0002', { estimate: null }, ctx);
    expect(result.ticket.fields.estimate).toBeUndefined();
    expect(readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8')).not.toContain('estimate');
  });

  it('rejects invalid field values', async () => {
    const root = fixture();
    await expect(updateTicket(root, 'T-0002', { estimate: 'big' }, ctx)).rejects.toThrow(MutationError);
  });
});

describe('logSession and addComment', () => {
  it('writes a session record that validates', async () => {
    const root = fixture();
    const { id, path } = await logSession(
      root,
      {
        ticket: 'T-0002',
        actor: 'claude',
        approach: 'Fix the flaky 503 test with an injectable clock.',
        whatHappened: 'Clock injected; test stable across 50 runs.',
        outcome: 'completed',
        commits: ['abcd1234'],
        openQuestions: [],
      },
      ctx,
    );
    expect(id).toBe('S-0003');
    expect(readFileSync(path, 'utf8')).toContain('## Open questions');
    const issues = validateProject(loadProject(root), { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects sessions for unknown tickets, actors or outcomes', async () => {
    const root = fixture();
    const base = { approach: 'x', outcome: 'completed' };
    await expect(logSession(root, { ...base, ticket: 'T-9999', actor: 'claude' }, ctx)).rejects.toThrow();
    await expect(logSession(root, { ...base, ticket: 'T-0002', actor: 'ghost' }, ctx)).rejects.toThrow();
    await expect(
      logSession(root, { ticket: 'T-0002', actor: 'claude', approach: 'x', outcome: 'sideways' }, ctx),
    ).rejects.toThrow(/outcome/);
  });

  it('writes comments under the ticket directory following the convention', async () => {
    const root = fixture();
    const { path } = await addComment(root, { ticket: 'T-0003', actor: 'ada', body: 'Park this until July.' }, ctx);
    expect(path).toContain('comments/T-0003/');
    expect(path).toContain('2026-06-10T1200-ada.md');
    const issues = validateProject(loadProject(root), { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('active ticket state', () => {
  it('round-trips and validates the ticket exists', () => {
    const root = fixture();
    expect(getActiveTicket(root)).toBeNull();
    setActiveTicket(root, 'T-0002');
    expect(getActiveTicket(root)).toBe('T-0002');
    setActiveTicket(root, null);
    expect(getActiveTicket(root)).toBeNull();
    expect(() => setActiveTicket(root, 'T-9999')).toThrow();
  });

  it('counters survive state deletion by rescanning', async () => {
    const root = fixture();
    await createTicket(root, { type: 'task', fields: { title: 'One' } }, ctx);
    rmSync(join(root, '.lovelace/state'), { recursive: true, force: true });
    const ticket = await createTicket(root, { type: 'task', fields: { title: 'Two' } }, ctx);
    expect(ticket.id).toBe('T-0006');
    expect(existsSync(join(root, '.lovelace/tickets/T-0006.md'))).toBe(true);
  });
});

describe('deleteTicket', () => {
  it('removes the ticket along with its comments and sessions', async () => {
    const root = fixture();
    const before = loadProject(root);
    const target = before.tickets.find((t) => t.id === 'T-0002')!;
    const commentCount = before.comments.filter((c) => c.ticket === 'T-0002').length;
    const sessionPaths = before.sessions
      .filter((s) => s.ticket === 'T-0002')
      .map((s) => join(root, s.path));
    expect(commentCount).toBeGreaterThan(0);
    expect(sessionPaths.length).toBeGreaterThan(0);

    const result = await deleteTicket(root, 'T-0002', ctx);
    expect(result).toMatchObject({ id: 'T-0002', comments: commentCount, sessions: sessionPaths.length });

    expect(existsSync(join(root, target.path))).toBe(false);
    expect(existsSync(join(root, '.lovelace/comments/T-0002'))).toBe(false);
    for (const p of sessionPaths) expect(existsSync(p)).toBe(false);

    const after = loadProject(root);
    expect(after.tickets.some((t) => t.id === 'T-0002')).toBe(false);
    expect(after.comments.some((c) => c.ticket === 'T-0002')).toBe(false);
    expect(after.sessions.some((s) => s.ticket === 'T-0002')).toBe(false);
  });

  it('throws on an unknown ticket', async () => {
    const root = fixture();
    await expect(deleteTicket(root, 'T-9999', ctx)).rejects.toThrow(MutationError);
  });
});
