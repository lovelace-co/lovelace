import { describe, expect, it, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installClaudeAssets } from '../src/claude.js';
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

const OPTS = { mcpCommand: '/opt/lovelace/bin/lovelace-mcp', helperCommand: '/opt/lovelace/bin/lovelace-agent' };

describe('installClaudeAssets', () => {
  it('writes CLAUDE.md, .mcp.json, hooks and slash commands on a clean project', () => {
    const root = fixture();
    const result = installClaudeAssets(root, OPTS);
    expect(result.manual).toEqual([]);

    // CLAUDE.md is a pointer to the Lovelace instruction file, not a manual.
    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('lovelace:start');
    expect(claudeMd).toContain('.lovelace/AGENTS.md');

    // The direction lives in AGENTS.md: how to mutate, resolve and finish.
    const agents = readFileSync(join(root, '.lovelace/AGENTS.md'), 'utf8');
    expect(agents).toContain('.lovelace/documentation/index.md');
    expect(agents).toContain('log_session');
    expect(agents).toContain('update_ticket'); // the move-by-outcome guidance

    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.lovelace.command).toBe(OPTS.mcpCommand);

    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    const flat = JSON.stringify(settings.hooks);
    expect(flat).toContain('digest');
    expect(flat).toContain('session-check');
    expect(flat).toContain('guard');
    expect(flat).toContain('presence-start');
    expect(flat).toContain('presence-beat');
    expect(flat).toContain('presence-clear');
    expect(flat).toContain('track-active');
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    expect(settings.hooks.SessionEnd).toBeDefined();
    expect(JSON.stringify(settings.hooks.SessionEnd)).toContain('presence-clear');
    // presence-clear no longer fires on Stop: session-check folds that clear
    // in itself when a stop passes (ADR-0012).
    expect(JSON.stringify(settings.hooks.Stop)).not.toContain('presence-clear');
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write');
    expect(settings.hooks.PostToolUse[0].matcher).toBe('mcp__lovelace__set_active_ticket');
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('track-active');
    // The heartbeat runs on every tool call, so it carries no matcher.
    expect(settings.hooks.PostToolUse[1].matcher).toBeUndefined();
    expect(settings.hooks.PostToolUse[1].hooks[0].command).toContain('presence-beat');

    expect(readFileSync(join(root, '.claude/commands/ticket.md'), 'utf8')).toContain('active_ticket');
    expect(readFileSync(join(root, '.claude/commands/done.md'), 'utf8')).toContain('acceptance criteria');
  });

  it('is idempotent: writing the hooks twice does not duplicate any entry', () => {
    const root = fixture();
    installClaudeAssets(root, OPTS);
    installClaudeAssets(root, OPTS);
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(settings.hooks.SessionEnd).toHaveLength(1);
  });

  it('drops a Stop presence-clear entry left by an older install, keeping SessionEnd\'s and any other Stop hook', () => {
    const root = fixture();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: `${OPTS.helperCommand} session-check` }] },
            { hooks: [{ type: 'command', command: `${OPTS.helperCommand} presence-clear` }] },
            { hooks: [{ type: 'command', command: 'my-own-hook' }] },
          ],
          SessionEnd: [{ hooks: [{ type: 'command', command: `${OPTS.helperCommand} presence-clear` }] }],
        },
      }),
    );
    installClaudeAssets(root, OPTS);
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    const stopCommands = settings.hooks.Stop.flatMap((e: { hooks: Array<{ command: string }> }) =>
      e.hooks.map((h) => h.command),
    );
    expect(stopCommands).toContain(`${OPTS.helperCommand} session-check`);
    expect(stopCommands).toContain('my-own-hook');
    expect(stopCommands).not.toContain(`${OPTS.helperCommand} presence-clear`);
    expect(JSON.stringify(settings.hooks.SessionEnd)).toContain('presence-clear');

    // Idempotent: running again over the already-migrated file changes nothing more.
    installClaudeAssets(root, OPTS);
    const again = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    expect(again.hooks.Stop).toHaveLength(2);
  });

  it('appends a delimited section to an existing CLAUDE.md without overwriting', () => {
    const root = fixture();
    writeFileSync(join(root, 'CLAUDE.md'), '# My project\n\nDo not touch this line.\n');
    installClaudeAssets(root, OPTS);
    const content = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('Do not touch this line.');
    expect(content).toContain('lovelace:start');
    // Idempotent: running again does not duplicate the section.
    installClaudeAssets(root, OPTS);
    const again = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    expect(again.match(/lovelace:start/g)).toHaveLength(1);
  });

  it('merges into an existing .mcp.json and .claude/settings.json', () => {
    const root = fixture();
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
    const result = installClaudeAssets(root, OPTS);
    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.other.command).toBe('x');
    expect(mcp.mcpServers.lovelace).toBeDefined();
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('Bash(ls)');
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(result.manual).toEqual([]);
  });

  it('reports manual steps instead of failing on unparseable files', () => {
    const root = fixture();
    writeFileSync(join(root, '.mcp.json'), '{not json');
    const result = installClaudeAssets(root, OPTS);
    expect(result.manual.some((m) => m.includes('.mcp.json'))).toBe(true);
  });

  it('installs the opt-in Git hook when the project is a repository', () => {
    const root = fixture();
    execSync('git init -q', { cwd: root });
    const result = installClaudeAssets(root, { ...OPTS, gitHook: true });
    const hook = join(root, '.git/hooks/prepare-commit-msg');
    expect(result.written).toContain('.git/hooks/prepare-commit-msg');
    expect(existsSync(hook)).toBe(true);
    // Windows has no executable bit (and Git for Windows runs hooks
    // regardless); the chmod matters only on POSIX platforms.
    if (process.platform !== 'win32') {
      expect(statSync(hook).mode & 0o111).toBeTruthy();
    }
    expect(readFileSync(hook, 'utf8')).toContain('active_ticket');
  });

  it('asks for manual action on a non-Git directory instead of failing', () => {
    const root = fixture();
    const result = installClaudeAssets(root, { ...OPTS, gitHook: true });
    expect(result.manual.some((m) => m.includes('Git'))).toBe(true);
  });
});
