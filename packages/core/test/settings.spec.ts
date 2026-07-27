import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beatPresence,
  clearPresence,
  DEFAULT_PRESENCE_TIMEOUT_MINUTES,
  loadProject,
  MutationError,
  readPresences,
  writeActors,
  writeManifest,
  writePresence,
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

describe('writeManifest', () => {
  it('renames the project and preserves the other manifest fields', async () => {
    const root = fixture();
    const before = loadProject(root).manifest;
    await writeManifest(root, { name: 'Renamed Project' });
    const after = loadProject(root).manifest;
    expect(after.name).toBe('Renamed Project');
    expect(after.project_id).toBe(before.project_id);
    expect(after.spec_version).toBe(before.spec_version);
    // The id survives in the file, so nothing else was clobbered.
    expect(readFileSync(join(root, '.lovelace/manifest.yaml'), 'utf8')).toContain(before.project_id);
  });

  it('rejects an empty name', async () => {
    const root = fixture();
    await expect(writeManifest(root, { name: '   ' })).rejects.toBeInstanceOf(MutationError);
  });
});

describe('writeActors', () => {
  const ada = { id: 'ada', name: 'Ada Lovelace', kind: 'human' as const };
  const claude = { id: 'claude', name: 'Claude Code', kind: 'agent' as const };

  it('adds an agent and reloads', async () => {
    const root = fixture();
    await writeActors(root, [ada, claude, { id: 'bot', name: 'Botty', kind: 'agent' }]);
    expect(loadProject(root).actors.map((a) => a.id)).toEqual(['ada', 'claude', 'bot']);
  });

  it('renames an actor display name while keeping its id', async () => {
    const root = fixture();
    await writeActors(root, [ada, { ...claude, name: 'Claude 5' }]);
    const after = loadProject(root).actors.find((a) => a.id === 'claude');
    expect(after?.name).toBe('Claude 5');
  });

  it('removes an unreferenced actor', async () => {
    const root = fixture();
    await writeActors(root, [ada, claude, { id: 'bot', name: 'Botty', kind: 'agent' }]);
    await writeActors(root, [ada, claude]); // bot has no references
    expect(loadProject(root).actors.map((a) => a.id)).toEqual(['ada', 'claude']);
  });

  it('rejects a second human', async () => {
    const root = fixture();
    await expect(
      writeActors(root, [ada, { id: 'bob', name: 'Bob', kind: 'human' }]),
    ).rejects.toThrow(/exactly one actor must have kind: human/);
  });

  it('rejects a duplicate id', async () => {
    const root = fixture();
    await expect(
      writeActors(root, [ada, { id: 'ada', name: 'Other', kind: 'agent' }]),
    ).rejects.toThrow(/duplicate actor id/);
  });

  it('rejects a non-slug id', async () => {
    const root = fixture();
    await expect(
      writeActors(root, [{ id: 'Ada', name: 'Ada', kind: 'human' }, claude]),
    ).rejects.toThrow(/lowercase/);
  });

  it('blocks removing an actor still referenced by tickets, sessions or comments', async () => {
    const root = fixture();
    // claude is the actor on sessions and comments and an assignee in the demo.
    await expect(writeActors(root, [ada])).rejects.toThrow(/cannot remove actor "claude"/);
  });
});

describe('presence timeout in the manifest', () => {
  it('persists a positive whole number of minutes and clears back to default', async () => {
    const root = fixture();
    await writeManifest(root, { presence_timeout_minutes: 480 });
    expect(loadProject(root).manifest.presence_timeout_minutes).toBe(480);
    expect(readFileSync(join(root, '.lovelace/manifest.yaml'), 'utf8')).toContain('presence_timeout_minutes: 480');

    await writeManifest(root, { presence_timeout_minutes: null });
    expect(loadProject(root).manifest.presence_timeout_minutes).toBeUndefined();
    expect(readFileSync(join(root, '.lovelace/manifest.yaml'), 'utf8')).not.toContain('presence_timeout_minutes');
  });

  it('refuses zero, negatives and fractions', async () => {
    const root = fixture();
    await expect(writeManifest(root, { presence_timeout_minutes: 0 })).rejects.toBeInstanceOf(MutationError);
    await expect(writeManifest(root, { presence_timeout_minutes: -5 })).rejects.toBeInstanceOf(MutationError);
    await expect(writeManifest(root, { presence_timeout_minutes: 1.5 })).rejects.toBeInstanceOf(MutationError);
  });
});

describe('per-session live agent markers', () => {
  // writePresence garbage-collects on every call (against real wall-clock
  // time, see below), so entries meant to survive a write use a
  // near-now started_at here rather than a fixed historical one.
  const now = () => new Date().toISOString();

  it('round-trips through state/presence/<session-id>.json and clears cleanly', () => {
    const root = fixture();
    expect(readPresences(root)).toEqual([]);

    const started = now();
    writePresence(root, 'session-a', { ticket: 'T-0002', actor: 'claude', started_at: started });
    expect(readPresences(root)).toEqual([{ ticket: 'T-0002', actor: 'claude', started_at: started }]);

    clearPresence(root, 'session-a');
    expect(readPresences(root)).toEqual([]);
    // Clearing twice is quiet: an ending turn never fails on a missing marker.
    clearPresence(root, 'session-a');
    expect(readPresences(root)).toEqual([]);
  });

  it('missing state/presence/ reads as no markers', () => {
    const root = fixture();
    expect(existsSync(join(root, '.lovelace/state/presence'))).toBe(false);
    expect(readPresences(root)).toEqual([]);
  });

  it('sorts deterministically by started_at, then filename, regardless of write order', () => {
    const root = fixture();
    const earlier = new Date(Date.now() - 5_000).toISOString();
    const later = now();
    writePresence(root, 'zzz', { ticket: 'T-0003', actor: 'claude', started_at: later });
    writePresence(root, 'aaa', { ticket: 'T-0002', actor: 'claude', started_at: earlier });
    expect(readPresences(root).map((p) => p.ticket)).toEqual(['T-0002', 'T-0003']);
  });

  it('treats a torn or foreign entry as skipped rather than an error', () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/presence'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/presence/session-a.json'), '{ half a wri');
    const started = now();
    writePresence(root, 'session-b', { ticket: 'T-0002', actor: 'claude', started_at: started });
    expect(readPresences(root)).toEqual([{ ticket: 'T-0002', actor: 'claude', started_at: started }]);
  });

  it('refuses a session id outside the safe pattern, writing no file anywhere', () => {
    const root = fixture();
    const presence = { ticket: 'T-0002', actor: 'claude', started_at: now() };
    writePresence(root, '..', presence);
    writePresence(root, '../evil', presence);
    expect(existsSync(join(root, '.lovelace/state/presence'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/evil.json'))).toBe(false);
    expect(existsSync(join(root, 'evil.json'))).toBe(false);
    clearPresence(root, '..'); // quiet, does not throw
    beatPresence(root, '..'); // quiet, does not throw
    expect(existsSync(join(root, '.lovelace/state/presence'))).toBe(false);
  });

  it('reads the legacy singleton state/presence.json as one more entry, and a write cleans it up', () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    const legacyStarted = now();
    writeFileSync(
      join(root, '.lovelace/state/presence.json'),
      `${JSON.stringify({ ticket: 'T-0002', actor: 'claude', started_at: legacyStarted })}\n`,
    );
    expect(readPresences(root)).toEqual([{ ticket: 'T-0002', actor: 'claude', started_at: legacyStarted }]);

    const started = now();
    writePresence(root, 'session-a', { ticket: 'T-0003', actor: 'claude', started_at: started });
    expect(existsSync(join(root, '.lovelace/state/presence.json'))).toBe(false);
    expect(readPresences(root)).toEqual([{ ticket: 'T-0003', actor: 'claude', started_at: started }]);
  });

  it('garbage-collects only entries older than the cap, on a write', async () => {
    const root = fixture();
    await writeManifest(root, { presence_timeout_minutes: 10 });
    mkdirSync(join(root, '.lovelace/state/presence'), { recursive: true });
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    const recent = new Date(Date.now() - 2 * 60_000).toISOString();
    writeFileSync(
      join(root, '.lovelace/state/presence/session-old.json'),
      `${JSON.stringify({ ticket: 'T-0002', actor: 'claude', started_at: old, beat_at: old })}\n`,
    );
    writeFileSync(
      join(root, '.lovelace/state/presence/session-recent.json'),
      `${JSON.stringify({ ticket: 'T-0003', actor: 'claude', started_at: recent, beat_at: recent })}\n`,
    );

    // Any write runs the sweep, not just the entry being written.
    writePresence(root, 'session-new', { ticket: 'T-0004', actor: 'claude', started_at: new Date().toISOString() });

    const ids = readdirSync(join(root, '.lovelace/state/presence')).sort();
    expect(ids).toEqual(['session-new.json', 'session-recent.json']);
  });

  it('exports the 15 minute default', () => {
    expect(DEFAULT_PRESENCE_TIMEOUT_MINUTES).toBe(15);
  });

  it('treats state/presence as unlistable junk, not a crash, when it is a plain file', () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/presence'), 'not a directory');
    expect(() => readPresences(root)).not.toThrow();
    expect(readPresences(root)).toEqual([]);

    // The legacy singleton still reads fine alongside the foreign file.
    const legacyStarted = now();
    writeFileSync(
      join(root, '.lovelace/state/presence.json'),
      `${JSON.stringify({ ticket: 'T-0002', actor: 'claude', started_at: legacyStarted })}\n`,
    );
    expect(readPresences(root)).toEqual([{ ticket: 'T-0002', actor: 'claude', started_at: legacyStarted }]);
  });
});

describe('beatPresence', () => {
  it('creates a missing entry with actor null and started_at now', () => {
    const root = fixture();
    beatPresence(root, 'session-a');
    const [entry] = readPresences(root);
    expect(entry?.actor).toBeNull();
    expect(typeof entry?.started_at).toBe('string');
    expect(entry?.beat_at).toBe(entry?.started_at);
  });

  it('preserves started_at and actor, refreshes beat_at', () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/presence'), { recursive: true });
    writeFileSync(
      join(root, '.lovelace/state/presence/session-a.json'),
      `${JSON.stringify({
        ticket: 'T-0002',
        actor: 'claude',
        started_at: '2026-07-05T09:00:00Z',
        beat_at: '2026-07-05T09:00:00Z',
      })}\n`,
    );
    beatPresence(root, 'session-a');
    const [entry] = readPresences(root);
    expect(entry?.started_at).toBe('2026-07-05T09:00:00Z');
    expect(entry?.actor).toBe('claude');
    expect(entry?.beat_at).not.toBe('2026-07-05T09:00:00Z');
  });

  it("re-resolves the ticket from the session's own active marker", () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    beatPresence(root, 'session-a');
    expect(readPresences(root)[0]?.ticket).toBe('T-0002');

    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0003\n');
    beatPresence(root, 'session-a');
    expect(readPresences(root)[0]?.ticket).toBe('T-0003');
  });

  it('never picks up the singleton active ticket when this session never claimed one', () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');
    beatPresence(root, 'session-a');
    // No per-session marker and no existing entry: the singleton must never
    // leak in, or a session that never claimed a ticket would light up with
    // whichever ticket some other session or tool call last set.
    expect(readPresences(root)[0]?.ticket).toBeNull();
  });

  it("preserves the entry's existing ticket when the per-session marker is absent", () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/presence'), { recursive: true });
    writeFileSync(
      join(root, '.lovelace/state/presence/session-a.json'),
      `${JSON.stringify({
        ticket: 'T-0002',
        actor: 'claude',
        started_at: '2026-07-05T09:00:00Z',
        beat_at: '2026-07-05T09:00:00Z',
      })}\n`,
    );
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');
    beatPresence(root, 'session-a');
    // The singleton points elsewhere; with no per-session marker, the
    // entry's own existing ticket carries forward instead of the singleton.
    expect(readPresences(root)[0]?.ticket).toBe('T-0002');
  });
});
