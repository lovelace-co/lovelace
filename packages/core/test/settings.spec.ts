import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearPresence, loadProject, MutationError, readPresence, writeActors, writeManifest, writePresence } from '../src/index.js';
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

describe('the live agent marker', () => {
  it('round-trips through state/presence.json and clears cleanly', () => {
    const root = fixture();
    expect(readPresence(root)).toBeNull();

    writePresence(root, { ticket: 'T-0002', actor: 'claude', started_at: '2026-07-05T10:00:00Z' });
    expect(readPresence(root)).toEqual({ ticket: 'T-0002', actor: 'claude', started_at: '2026-07-05T10:00:00Z' });

    clearPresence(root);
    expect(readPresence(root)).toBeNull();
    // Clearing twice is quiet: an ending turn never fails on a missing marker.
    clearPresence(root);
    expect(readPresence(root)).toBeNull();
  });

  it('treats a torn or foreign file as no marker rather than an error', () => {
    const root = fixture();
    const { writeFileSync, mkdirSync } = require('node:fs');
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/presence.json'), '{ half a wri');
    expect(readPresence(root)).toBeNull();
  });
});
