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

  it('includes the active ticket and drains approved agent instructions', async () => {
    const root = fixture();
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0002\n');
    writeFileSync(
      join(root, '.lovelace/state/agent_instructions.json'),
      JSON.stringify(['[T-0002] Deploy to staging.']),
    );
    const first = await helper(root, ['digest']);
    expect(first.stdout).toContain('Active ticket: T-0002');
    expect(first.stdout).toContain('Deploy to staging.');
    const second = await helper(root, ['digest']);
    expect(second.stdout).not.toContain('Deploy to staging.');
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
  it('presence-start writes the live marker with the agent actor and active ticket', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    mkdirSync(join(root, '.lovelace/state'), { recursive: true });
    writeFileSync(join(root, '.lovelace/state/active_ticket'), 'T-0002\n');

    const started = await helper(root, ['presence-start']);
    expect(started.code).toBe(0);
    expect(started.stdout).toBe('');

    const marker = JSON.parse(readFileSync(join(root, '.lovelace/state/presence.json'), 'utf8'));
    expect(marker.ticket).toBe('T-0002');
    expect(marker.actor).toBe('claude');
    expect(typeof marker.started_at).toBe('string');
  });

  it('presence-clear removes the marker and is quiet when there is none', async () => {
    const { root, cleanup } = tempFixture();
    cleanups.push(cleanup);
    await helper(root, ['presence-start']);
    expect(existsSync(join(root, '.lovelace/state/presence.json'))).toBe(true);

    const cleared = await helper(root, ['presence-clear']);
    expect(cleared.code).toBe(0);
    expect(existsSync(join(root, '.lovelace/state/presence.json'))).toBe(false);

    const again = await helper(root, ['presence-clear']);
    expect(again.code).toBe(0);
  });
});
