import { describe, expect, it, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { tempFixture } from './helpers.js';

const run = promisify(execFile);
const HELPER = resolve(__dirname, '../dist/helper.js');

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

async function helper(
  root: string,
  args: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = execFile(
      'node',
      [HELPER, ...args],
      { env: { ...process.env, LOVELACE_ROOT: root } },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === 'number'
          ? ((error as { code?: number }).code ?? 1)
          : 0;
        resolvePromise({ code, stdout, stderr });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();
  });
}

describe('lovelace-agent digest', () => {
  it('prints the orientation digest to stdout', async () => {
    const result = await helper(fixture(), ['digest']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Orbit Weather Service');
    expect(result.stdout).toContain('T-0002');
    expect(result.stdout.length).toBeLessThan(6000);
  });

  it('includes the active ticket', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0002\n');
    const result = await helper(root, ['digest']);
    expect(result.stdout).toContain('Active ticket: T-0002');
  });
});

describe('lovelace-agent session-check', () => {
  it('passes when there is no active ticket', async () => {
    const result = await helper(fixture(), ['session-check']);
    expect(result.code).toBe(0);
  });

  it('blocks with a prompt when the active ticket has no session record', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');
    const result = await helper(root, ['session-check']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('log_session');
    expect(result.stderr).toContain('T-0003');
  });

  it('passes when a session record exists for the active ticket', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0002\n');
    const result = await helper(root, ['session-check']);
    expect(result.code).toBe(0);
  });

  it('blocks when the work is marked complete but the ticket was never moved on', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0002\n');
    // T-0002 is still In Progress; record completed work without moving it.
    writeFileSync(
      join(root, '.lovelace/sessions/S-0003.md'),
      '---\nid: S-0003\nticket: T-0002\nactor: claude\nstarted: 2030-01-01T09:00:00Z\nended: 2030-01-01T10:00:00Z\ncommits: []\noutcome: completed\n---\n\n## Approach\n\nFinished.\n\n## What happened\n\nDone.\n\n## Open questions\n\nNone.\n',
    );
    const result = await helper(root, ['session-check']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('update_ticket');
    expect(result.stderr).toContain('T-0002');
  });
});

describe('lovelace-agent session-check with a per-session marker', () => {
  it('scopes enforcement to the calling session: one passes, the other blocks', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    // T-0002 has a session record in the fixture; T-0003 does not.
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    writeFileSync(join(root, '.lovelace/state/active/session-b'), 'T-0003\n');

    const a = await helper(root, ['session-check'], JSON.stringify({ session_id: 'session-a' }));
    expect(a.code).toBe(0);

    const b = await helper(root, ['session-check'], JSON.stringify({ session_id: 'session-b' }));
    expect(b.code).toBe(2);
    expect(b.stderr).toContain('log_session');
    expect(b.stderr).toContain('T-0003');
  });

  it('passes when this session never claimed a ticket, even if the singleton points at an unrecorded one', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');
    const result = await helper(root, ['session-check'], JSON.stringify({ session_id: 'session-c' }));
    expect(result.code).toBe(0);
  });

  it('falls back to the singleton when the payload has no session_id', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');
    const result = await helper(root, ['session-check'], JSON.stringify({ hook_event_name: 'Stop' }));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('T-0003');
  });
});

describe('lovelace-agent guard', () => {
  it('blocks Edit and Write calls targeting .lovelace/tickets/', async () => {
    const root = fixture();
    const result = await helper(root, ['guard'], JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: `${root}/.lovelace/tickets/T-0002.md` },
    }));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('MCP tools');
  });

  it('allows edits to documents and ordinary files', async () => {
    const root = fixture();
    for (const path of [`${root}/.lovelace/documentation/domain/OVERVIEW.md`, `${root}/src/cache.ts`]) {
      const result = await helper(root, ['guard'], JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: path },
      }));
      expect(result.code).toBe(0);
    }
  });
});

describe('presence marker commands', () => {
  it('presence-start writes state/presence/<session-id>.json with the agent actor and this session\'s active ticket', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    // The singleton points elsewhere; the session's own marker must win.
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');

    const started = await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-a' }));
    expect(started.code).toBe(0);
    expect(started.stdout).toBe('');

    const marker = JSON.parse(readFileSync(join(root, '.lovelace/state/presence/session-a.json'), 'utf8'));
    expect(marker.ticket).toBe('T-0002');
    expect(marker.actor).toBe('claude');
    expect(typeof marker.started_at).toBe('string');
    expect(marker.beat_at).toBe(marker.started_at);
  });

  it('presence-start falls back to the singleton active ticket when this session never claimed one', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0003\n');

    const started = await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-a' }));
    expect(started.code).toBe(0);
    const marker = JSON.parse(readFileSync(join(root, '.lovelace/state/presence/session-a.json'), 'utf8'));
    expect(marker.ticket).toBe('T-0003');
  });

  it('presence-start falls back to a shared "local" entry when the payload has no session_id', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    const started = await helper(root, ['presence-start']);
    expect(started.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/presence/local.json'))).toBe(true);
  });

  it('presence-beat refreshes beat_at and the ticket while preserving started_at and actor', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-a' }));
    const first = JSON.parse(readFileSync(join(root, '.lovelace/state/presence/session-a.json'), 'utf8'));

    // Move the session's focus, then beat: the ticket must re-resolve.
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0003\n');
    await new Promise((r) => setTimeout(r, 1100)); // the timestamp has one-second resolution
    const beat = await helper(root, ['presence-beat'], JSON.stringify({ session_id: 'session-a' }));
    expect(beat.code).toBe(0);

    const second = JSON.parse(readFileSync(join(root, '.lovelace/state/presence/session-a.json'), 'utf8'));
    expect(second.started_at).toBe(first.started_at);
    expect(second.actor).toBe(first.actor);
    expect(second.ticket).toBe('T-0003');
    expect(second.beat_at).not.toBe(first.beat_at);
  });

  it('presence-beat creates a missing entry rather than doing nothing', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    const beat = await helper(root, ['presence-beat'], JSON.stringify({ session_id: 'session-a' }));
    expect(beat.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/presence/session-a.json'))).toBe(true);
  });

  it('presence-clear on SessionEnd removes this session\'s entry and its active-ticket marker', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-a' }));
    expect(existsSync(join(root, '.lovelace/state/presence/session-a.json'))).toBe(true);

    const onEnd = await helper(root, ['presence-clear'], JSON.stringify({
      session_id: 'session-a',
      hook_event_name: 'SessionEnd',
    }));
    expect(onEnd.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/presence/session-a.json'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/state/active/session-a'))).toBe(false);
  });

  it('presence-clear is quiet when invoked manually with no marker to clear', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    const cleared = await helper(root, ['presence-clear']);
    expect(cleared.code).toBe(0);
    const again = await helper(root, ['presence-clear']);
    expect(again.code).toBe(0);
  });
});

describe('lovelace-agent session-check clears presence on a passing stop', () => {
  it('clears the calling session\'s entry when the stop passes, and leaves it when the stop blocks', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    // T-0002 has a session record in the fixture (passes); T-0003 does not (blocks).
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    writeFileSync(join(root, '.lovelace/state/active/session-b'), 'T-0003\n');
    await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-a' }));
    await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-b' }));

    const a = await helper(root, ['session-check'], JSON.stringify({ session_id: 'session-a' }));
    expect(a.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/presence/session-a.json'))).toBe(false);

    const b = await helper(root, ['session-check'], JSON.stringify({ session_id: 'session-b' }));
    expect(b.code).toBe(2);
    expect(existsSync(join(root, '.lovelace/state/presence/session-b.json'))).toBe(true);
  });

  it('does not touch another session\'s entry', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-a' }));
    await helper(root, ['presence-start'], JSON.stringify({ session_id: 'session-b' }));

    const result = await helper(root, ['session-check'], JSON.stringify({ session_id: 'session-a' }));
    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/presence/session-a.json'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/state/presence/session-b.json'))).toBe(true);
  });
});

describe('lovelace-agent track-active', () => {
  it('writes the session marker from a matching PostToolUse payload', async () => {
    const root = fixture();
    const result = await helper(root, ['track-active'], JSON.stringify({
      session_id: 'session-a',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__lovelace__set_active_ticket',
      tool_input: { id: 'T-0002' },
    }));
    expect(result.code).toBe(0);
    expect(readFileSync(join(root, '.lovelace/state/active/session-a'), 'utf8').trim()).toBe('T-0002');
  });

  it('removes the marker when tool_input.id is null', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    const result = await helper(root, ['track-active'], JSON.stringify({
      session_id: 'session-a',
      tool_name: 'mcp__lovelace__set_active_ticket',
      tool_input: { id: null },
    }));
    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/active/session-a'))).toBe(false);
  });

  it('does nothing for a mismatched tool_name', async () => {
    const root = fixture();
    const result = await helper(root, ['track-active'], JSON.stringify({
      session_id: 'session-a',
      tool_name: 'mcp__lovelace__update_ticket',
      tool_input: { id: 'T-0002' },
    }));
    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/active'))).toBe(false);
  });

  it('writes nothing anywhere for a path-traversal session_id', async () => {
    const root = fixture();
    const result = await helper(root, ['track-active'], JSON.stringify({
      session_id: '../evil',
      tool_name: 'mcp__lovelace__set_active_ticket',
      tool_input: { id: 'T-0002' },
    }));
    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/active'))).toBe(false);
    expect(existsSync(join(root, '.lovelace/evil'))).toBe(false);
    expect(existsSync(join(root, 'evil'))).toBe(false);
  });

  it('ignores a non-string id: no garbage marker, and an existing marker is not cleared', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active/session-a'), 'T-0002\n');
    for (const id of [42, { x: 1 }, true]) {
      const result = await helper(root, ['track-active'], JSON.stringify({
        session_id: 'session-a',
        tool_name: 'mcp__lovelace__set_active_ticket',
        tool_input: { id },
      }));
      expect(result.code).toBe(0);
    }
    expect(readFileSync(join(root, '.lovelace/state/active/session-a'), 'utf8').trim()).toBe('T-0002');
  });
});

describe('lovelace-agent session-check hostile payloads', () => {
  it('a dot-only session_id fails open instead of crashing', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state/active'), { recursive: true });
    const result = await helper(root, ['session-check'], JSON.stringify({ session_id: '..' }));
    expect(result.code).toBe(0);
  });
});
