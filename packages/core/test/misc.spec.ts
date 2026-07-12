import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject, loadProject, validateProject, search, watchProject, extractSection } from '../src/index.js';
import { tempFixture, FIXED_NOW, corrupt } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

describe('initProject', () => {
  it('scaffolds a project that validates cleanly', () => {
    const root = mkdtempSync(join(tmpdir(), 'lovelace-init-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const created = initProject(root, { name: 'Fresh Start', userName: 'Lambros', now: FIXED_NOW });
    expect(created).toContain('.lovelace/manifest.yaml');
    expect(created).toContain('.gitignore');
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.lovelace/index/index.json');
    const issues = validateProject(loadProject(root), { now: FIXED_NOW });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(() => initProject(root, { name: 'Again' })).toThrow(/already exists/);
  });
});

describe('search', () => {
  it('finds substring matches across kinds, ranking titles above bodies', () => {
    const project = loadProject(fixture());
    const hits = search(project, 'forecast');
    expect(hits.length).toBeGreaterThan(2);
    expect(hits[0]?.kind).toBe('ticket');
    expect(hits[0]?.id).toBe('T-0002');
    const kinds = new Set(hits.map((h) => h.kind));
    expect(kinds.has('document')).toBe(true);
    expect(search(project, '')).toEqual([]);
    expect(search(project, 'zzz-no-such-text')).toEqual([]);
  });

  it('returns a snippet showing the matching line', () => {
    const project = loadProject(fixture());
    const hit = search(project, 'gusts')[0];
    expect(hit?.snippet.toLowerCase()).toContain('gusts');
  });

  it('matches a ticket by a partial ticket ID', () => {
    const project = loadProject(fixture());
    const hits = search(project, '0004');
    const ticketHit = hits.find((h) => h.kind === 'ticket');
    expect(ticketHit?.id).toBe('T-0004');
    expect(ticketHit?.score).toBe(3);
  });

  it('ranks a lowercase full ID query first, above a partial ID match', () => {
    const project = loadProject(fixture());
    const exactHits = search(project, 't-0002');
    expect(exactHits[0]?.kind).toBe('ticket');
    expect(exactHits[0]?.id).toBe('T-0002');
    expect(exactHits[0]?.score).toBe(5);

    const partialHits = search(project, '0004');
    const partialTicketHit = partialHits.find((h) => h.kind === 'ticket' && h.id === 'T-0004');
    expect(partialTicketHit?.score).toBe(3);
    expect(exactHits[0]!.score).toBeGreaterThan(partialTicketHit!.score);
  });

  it('falls back to the ticket title as the snippet for an ID-only match', () => {
    const project = loadProject(fixture());
    const hit = search(project, 't-0002')[0];
    expect(hit?.id).toBe('T-0002');
    expect(hit?.snippet).toBe('Forecast endpoint');
  });

  it('finds a session by its lowercase ID', () => {
    const project = loadProject(fixture());
    const hits = search(project, 's-0002');
    const sessionHit = hits.find((h) => h.kind === 'session');
    expect(sessionHit?.id).toBe('S-0002');
    expect(sessionHit?.score).toBe(5);
  });

  it('produces one hit, at the higher score, for a session matching on both ID and body', () => {
    const root = fixture();
    corrupt(root, '.lovelace/sessions/S-0002.md', (t) => `${t}\nFollow-up: revisit s-0002 once the flaky test is fixed.\n`);
    const project = loadProject(root);
    const hits = search(project, 's-0002');
    const sessionHits = hits.filter((h) => h.kind === 'session' && h.id === 'S-0002');
    expect(sessionHits).toHaveLength(1);
    expect(sessionHits[0]?.score).toBe(6);
  });

  it('still matches a session on body text alone', () => {
    const project = loadProject(fixture());
    const hits = search(project, 'atomic on the same filesystem');
    const sessionHit = hits.find((h) => h.kind === 'session');
    expect(sessionHit?.id).toBe('S-0001');
    expect(sessionHit?.score).toBe(1);
  });
});

describe('extractSection', () => {
  it('pulls a heading section out of a body', () => {
    const body = '## Approach\n\nDo it.\n\n## What happened\n\nDone.\n';
    expect(extractSection(body, 'Approach')).toBe('Do it.');
    expect(extractSection(body, 'What happened')).toBe('Done.');
    expect(extractSection(body, 'Missing')).toBeUndefined();
  });
});

describe('watchProject', () => {
  it('re-validates and re-indexes on change, debounced, ignoring its own writes', async () => {
    const root = fixture();
    const results: string[][] = [];
    const watcher = watchProject(
      root,
      (r) => results.push(r.changedPaths),
      { debounceMs: 100 },
    );
    cleanups.push(() => void watcher.close());
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(
      join(root, '.lovelace/tickets/T-0003.md'),
      readFileSync(join(root, '.lovelace/tickets/T-0003.md'), 'utf8').replace(
        'priority: medium',
        'priority: low',
      ),
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(results.length).toBe(1);
    expect(results[0]?.some((p) => p.endsWith('T-0003.md'))).toBe(true);
    expect(existsSync(join(root, '.lovelace/index/index.json'))).toBe(true);
    const index = readFileSync(join(root, '.lovelace/index/index.json'), 'utf8');
    expect(index).toContain('"low"');
    // The index write itself must not retrigger the watcher.
    await new Promise((r) => setTimeout(r, 400));
    expect(results.length).toBe(1);
  await watcher.close();
  }, 20000);

  it('reacts to presence writes under state/ but ignores other state/ files', async () => {
    const root = fixture();
    const results: string[][] = [];
    const watcher = watchProject(
      root,
      (r) => results.push(r.changedPaths),
      { debounceMs: 100 },
    );
    cleanups.push(() => void watcher.close());
    await new Promise((r) => setTimeout(r, 300));

    // (a) a per-session presence entry fires a change event.
    mkdirSync(join(root, '.lovelace/state/presence'), { recursive: true });
    writeFileSync(
      join(root, '.lovelace/state/presence/session-a.json'),
      `${JSON.stringify({ ticket: 'T-0002', actor: 'claude', started_at: new Date().toISOString() })}\n`,
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(results.length).toBe(1);
    expect(results[0]?.some((p) => p.endsWith('session-a.json'))).toBe(true);

    // (b) a non-presence state/ file stays ignored; give the debounce a beat
    // and confirm no further flush happened.
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0002\n');
    await new Promise((r) => setTimeout(r, 400));
    expect(results.length).toBe(1);

    // (c) the legacy singleton state/presence.json still fires too.
    writeFileSync(
      join(root, '.lovelace/state/presence.json'),
      `${JSON.stringify({ ticket: 'T-0002', actor: 'claude', started_at: new Date().toISOString() })}\n`,
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(results.length).toBe(2);
    expect(results[1]?.some((p) => p.endsWith('presence.json'))).toBe(true);

    await watcher.close();
  }, 20000);
});
