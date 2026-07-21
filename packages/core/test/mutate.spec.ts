import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import {
  createTicket,
  updateTicket,
  deleteTicket,
  logSession,
  addComment,
  setActiveTicket,
  getActiveTicket,
  writeSessionActiveTicket,
  readSessionActiveTicket,
  loadProject,
  validateProject,
  nextId,
  parseFrontmatter,
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

/**
 * Splits a ticket file's raw text on its frontmatter delimiter. `before` is
 * read straight off disk, unlike `after` (always rebuilt with LF delimiters
 * by updateTicket regardless of what the file started as), so a CRLF-
 * checked-out fixture would otherwise make the literal '---\n' split miss
 * the delimiter entirely. Same class of fix as `corrupt` in helpers.ts.
 */
function splitFrontmatter(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('---\n');
}

describe('ID assignment', () => {
  it('continues from the highest existing ID by scanning', async () => {
    const root = fixture();
    const project = loadProject(root);
    const id = await nextId(project.dir, project.manifest, 'T');
    // Tracks the demo fixture's ticket count: T-0001 through T-0005 already
    // exist, so the next assigned ID is T-0006.
    expect(id).toBe('T-0006');
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
    // Tracks the demo fixture's ticket count: the next assigned ID after
    // T-0001 through T-0005 is T-0006.
    expect(ticket.id).toBe('T-0006');
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

  it('leaves the body empty and writes frontmatter only, with no dangling blank line', async () => {
    const root = fixture();
    const ticket = await createTicket(root, { type: 'task', fields: { title: 'No body ticket' } }, ctx);
    expect(ticket.body).toBe('');
    const content = readFileSync(join(root, ticket.path), 'utf8');
    // Tracks the demo fixture's ticket count: the next assigned ID after
    // T-0001 through T-0005 is T-0006.
    expect(content).toBe(
      '---\nid: T-0006\ntype: task\nstatus: backlog\ncreated: 2026-06-10T12:00:00Z\nupdated: 2026-06-10T12:00:00Z\ntitle: No body ticket\n---\n',
    );
  });

  it('round-trips a body-less ticket: parsing then reassembling produces the same bytes', async () => {
    const root = fixture();
    const ticket = await createTicket(root, { type: 'task', fields: { title: 'No body ticket' } }, ctx);
    const original = readFileSync(join(root, ticket.path), 'utf8');
    const parsed = parseFrontmatter(original);
    expect(parsed.body).toBe('');
    const doc = parseDocument(parsed.raw);
    const reassembled = `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${parsed.body}`;
    expect(reassembled).toBe(original);
  });

  it('still honours an explicit body, unchanged from before', async () => {
    const root = fixture();
    const ticket = await createTicket(
      root,
      { type: 'task', fields: { title: 'Has a body' }, body: '## Description\n\nCustom text.\n' },
      ctx,
    );
    expect(ticket.body.trim()).toBe('## Description\n\nCustom text.');
    const content = readFileSync(join(root, ticket.path), 'utf8');
    // Tracks the demo fixture's ticket count: the next assigned ID after
    // T-0001 through T-0005 is T-0006.
    expect(content).toBe(
      '---\nid: T-0006\ntype: task\nstatus: backlog\ncreated: 2026-06-10T12:00:00Z\nupdated: 2026-06-10T12:00:00Z\ntitle: Has a body\n---\n\n## Description\n\nCustom text.\n',
    );
  });

  it('rejects an unknown field, naming it and the defined fields, without writing a file', async () => {
    const root = fixture();
    await expect(
      createTicket(root, { type: 'task', fields: { title: 'x', prio: 'urgent' } }, ctx),
    ).rejects.toThrow(
      /unknown field "prio" for type "task"; defined fields: title, parent, depends_on, assignee, priority, estimate/,
    );
    // Tracks the demo fixture's ticket count: the rejected create would
    // otherwise have landed at T-0006, the next ID after T-0001 through T-0005.
    expect(existsSync(join(root, '.lovelace/tickets/T-0006.md'))).toBe(false);
  });

  it('redirects a fields.body key to the body parameter', async () => {
    const root = fixture();
    await expect(
      createTicket(root, { type: 'task', fields: { title: 'x', body: 'nope' } }, ctx),
    ).rejects.toThrow('"body" is not a frontmatter field; pass the ticket body with the body parameter');
    // Tracks the demo fixture's ticket count: the rejected create would
    // otherwise have landed at T-0006, the next ID after T-0001 through T-0005.
    expect(existsSync(join(root, '.lovelace/tickets/T-0006.md'))).toBe(false);
  });
});

describe('updateTicket', () => {
  it('allows any status change, since the schema no longer gates moves', async () => {
    const root = fixture();
    // T-0003 is todo; moving straight to done was illegal under the old
    // transition graph, but the schema no longer configures a flow.
    const result = await updateTicket(root, 'T-0003', { fields: { status: 'done' } }, ctx);
    expect(result.ticket.status).toBe('done');
    const back = await updateTicket(root, 'T-0003', { fields: { status: 'backlog' } }, ctx);
    expect(back.ticket.status).toBe('backlog');
  });

  it('rejects a move to an unknown status', async () => {
    const root = fixture();
    await expect(updateTicket(root, 'T-0003', { fields: { status: 'shipping' } }, ctx)).rejects.toThrow(
      /unknown status/,
    );
  });

  it('rejects edits to locked core fields', async () => {
    const root = fixture();
    await expect(
      updateTicket(root, 'T-0003', { fields: { created: '2020-01-01T00:00:00Z' } }, ctx),
    ).rejects.toThrow(/locked core field/);
  });

  it('rejects an unknown field, naming it and the defined fields, leaving the file untouched', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    await expect(updateTicket(root, 'T-0002', { fields: { prio: 'urgent' } }, ctx)).rejects.toThrow(
      /unknown field "prio" for type "task"; defined fields: title, parent, depends_on, assignee, priority, estimate/,
    );
    expect(readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8')).toBe(before);
  });

  it('redirects a fields.body key to the body parameter', async () => {
    const root = fixture();
    await expect(updateTicket(root, 'T-0002', { fields: { body: 'nope' } }, ctx)).rejects.toThrow(
      '"body" is not a frontmatter field; pass the ticket body with the body parameter',
    );
  });

  it('updates fields, bumps updated, preserves the body and list formatting', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    const result = await updateTicket(root, 'T-0002', { fields: { priority: 'urgent' } }, ctx);
    expect(result.ticket.fields.priority).toBe('urgent');
    expect(result.ticket.updated).toBe('2026-06-10T12:00:00Z');
    const after = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    expect(after).toContain('depends_on: [T-0001]'); // flow style untouched
    expect(splitFrontmatter(after)[2]).toBe(splitFrontmatter(before)[2]); // body identical, since input.body was undefined
  });

  it('removes a field when set to null', async () => {
    const root = fixture();
    const result = await updateTicket(root, 'T-0002', { fields: { estimate: null } }, ctx);
    expect(result.ticket.fields.estimate).toBeUndefined();
    expect(readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8')).not.toContain('estimate');
  });

  it('rejects invalid field values', async () => {
    const root = fixture();
    await expect(updateTicket(root, 'T-0002', { fields: { estimate: 'big' } }, ctx)).rejects.toThrow(
      MutationError,
    );
  });

  it('replaces the body, leaving the frontmatter bytes identical apart from updated', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    const result = await updateTicket(
      root,
      'T-0002',
      { fields: {}, body: '## New description\n\nReplaced entirely.\n' },
      ctx,
    );
    expect(result.ticket.body.trim()).toBe('## New description\n\nReplaced entirely.');
    const after = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    const beforeFm = splitFrontmatter(before)[1]!.replace(/updated: .*/, 'updated: STAMP');
    const afterFm = splitFrontmatter(after)[1]!.replace(/updated: .*/, 'updated: STAMP');
    expect(afterFm).toBe(beforeFm); // untouched keys keep their bytes
    expect(after).toBe(`---\n${splitFrontmatter(after)[1]}---\n\n## New description\n\nReplaced entirely.\n`);
  });

  it('leaves fields alone when only the body is set: fields stay byte-identical', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    const beforeFields = splitFrontmatter(before)[1]!.replace(/updated: .*/, 'updated: STAMP');
    await updateTicket(root, 'T-0002', { fields: {}, body: 'Replaced.\n' }, ctx);
    const after = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    const afterFields = splitFrontmatter(after)[1]!.replace(/updated: .*/, 'updated: STAMP');
    expect(afterFields).toBe(beforeFields);
  });

  it('an empty body leaves frontmatter only, with no dangling blank line', async () => {
    const root = fixture();
    const result = await updateTicket(root, 'T-0002', { fields: {}, body: '' }, ctx);
    expect(result.ticket.body).toBe('');
    const content = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    expect(content).toBe(
      '---\nid: T-0002\ntype: task\nstatus: in_progress\ncreated: 2026-05-29T10:00:00Z\nupdated: 2026-06-10T12:00:00Z\ntitle: Forecast endpoint\nparent: E-0001\ndepends_on: [T-0001]\nassignee: claude\npriority: high\nestimate: 3\n---\n',
    );
  });

  it('leaves the body untouched when body is omitted, even alongside field changes', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    await updateTicket(root, 'T-0002', { fields: { priority: 'low' } }, ctx);
    const after = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    expect(splitFrontmatter(after)[2]).toBe(splitFrontmatter(before)[2]);
  });

  it('accepts a body-only update with fields omitted entirely', async () => {
    const root = fixture();
    const result = await updateTicket(root, 'T-0002', { body: 'Only a body.\n' }, ctx);
    expect(result.ticket.body.trim()).toBe('Only a body.');
  });

  it('rejects an update carrying neither field changes nor a body', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    await expect(updateTicket(root, 'T-0002', { fields: {} }, ctx)).rejects.toThrow(
      'nothing to update: pass field changes or a body',
    );
    expect(readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8')).toBe(before);
  });

  it('rejects a non-string status instead of dropping it and rewriting the file', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/tickets/T-0002.md');
    const before = readFileSync(path, 'utf8');
    await expect(updateTicket(root, 'T-0002', { fields: { status: null } }, ctx)).rejects.toThrow(
      'status must be a string naming a status defined in schema.yaml',
    );
    await expect(updateTicket(root, 'T-0002', { fields: { status: 42 } }, ctx)).rejects.toThrow(
      'status must be a string naming a status defined in schema.yaml',
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('names the real cause when editing fields on a hand-edited unknown type, but still allows a status move', async () => {
    const root = fixture();
    const path = join(root, '.lovelace/tickets/T-0002.md');
    const corrupted = readFileSync(path, 'utf8').replace('type: task', 'type: wibble');
    writeFileSync(path, corrupted);
    await expect(updateTicket(root, 'T-0002', { fields: { priority: 'low' } }, ctx)).rejects.toThrow(
      'ticket "T-0002" has unknown type "wibble"; correct the type in the file before editing fields',
    );
    const moved = await updateTicket(root, 'T-0002', { fields: { status: 'done' } }, ctx);
    expect(moved.ticket.status).toBe('done');
  });

  it('round-trips a body containing a --- line through create then update', async () => {
    const root = fixture();
    const body = 'Before the rule.\n\n---\n\nAfter the rule.\n';
    const ticket = await createTicket(root, { type: 'task', fields: { title: 'Has a rule' }, body }, ctx);
    expect(ticket.body.trim()).toBe(body.trim());
    const result = await updateTicket(root, ticket.id, { fields: {}, body }, ctx);
    expect(result.ticket.body.trim()).toBe(body.trim());
    const content = readFileSync(join(root, ticket.path), 'utf8');
    expect(content.endsWith(`---\n\n${body.trim()}\n`)).toBe(true);
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
    // The returned path is native to the platform; normalise the
    // separators so the convention check holds on Windows too.
    expect(path.replaceAll('\\', '/')).toContain('comments/T-0003/');
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
    // Tracks the demo fixture's ticket count: "One" above takes T-0006 (the
    // next ID after T-0001 through T-0005), so "Two" rescans to T-0007.
    expect(ticket.id).toBe('T-0007');
    expect(existsSync(join(root, '.lovelace/tickets/T-0007.md'))).toBe(true);
  });
});

describe('per-session active ticket state', () => {
  it('round-trips independently of the singleton and other sessions', () => {
    const root = fixture();
    expect(readSessionActiveTicket(root, 'session-a')).toBeNull();
    writeSessionActiveTicket(root, 'session-a', 'T-0002');
    writeSessionActiveTicket(root, 'session-b', 'T-0003');
    expect(readSessionActiveTicket(root, 'session-a')).toBe('T-0002');
    expect(readSessionActiveTicket(root, 'session-b')).toBe('T-0003');
    expect(getActiveTicket(root)).toBeNull(); // the singleton is untouched
    writeSessionActiveTicket(root, 'session-a', null);
    expect(readSessionActiveTicket(root, 'session-a')).toBeNull();
    expect(readSessionActiveTicket(root, 'session-b')).toBe('T-0003');
  });

  it('refuses a session ID outside the safe pattern as a silent no-op', () => {
    const root = fixture();
    writeSessionActiveTicket(root, '../evil', 'T-0002');
    expect(existsSync(join(root, '.lovelace/state/active'))).toBe(false);
    expect(readSessionActiveTicket(root, '../evil')).toBeNull();
    expect(readSessionActiveTicket(root, '')).toBeNull();
  });

  it('refuses the dot-only names that would navigate out of the active directory', () => {
    const root = fixture();
    writeSessionActiveTicket(root, 'session-a', 'T-0002');
    for (const sid of ['.', '..', '...']) {
      writeSessionActiveTicket(root, sid, 'T-0003');
      expect(readSessionActiveTicket(root, sid)).toBeNull();
    }
    // Reading ".." must not crash on the directory it would resolve to.
    expect(readSessionActiveTicket(root, '..')).toBeNull();
    expect(readSessionActiveTicket(root, 'session-a')).toBe('T-0002');
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
