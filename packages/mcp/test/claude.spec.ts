import { describe, expect, it, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClaudeAssets, installClaudeAssets } from '../src/claude.js';
import { tempFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function emptyDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lovelace-detect-test-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

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

  it('normalises a Windows path with a space, quoting hook commands but leaving .mcp.json unquoted', () => {
    const root = fixture();
    const opts = {
      mcpCommand: 'C:\\Users\\Fredy Lievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\Fredy Lievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    installClaudeAssets(root, opts);
    const expected = '"C:/Users/Fredy Lievano/AppData/Local/Lovelace/lovelace-agent.exe"';
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(`${expected} digest`);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(`${expected} session-check`);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe(`${expected} presence-start`);

    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.lovelace.command).toBe('C:/Users/Fredy Lievano/AppData/Local/Lovelace/lovelace-mcp.exe');
    expect(mcp.mcpServers.lovelace.args).toEqual([]);
  });

  it('normalises a Windows path without a space, leaving hook commands unquoted', () => {
    const root = fixture();
    const opts = {
      mcpCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    installClaudeAssets(root, opts);
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
      'C:/Users/FredyLievano/AppData/Local/Lovelace/lovelace-agent.exe digest',
    );
  });

  it('quotes only the script path for the dev node command shape, and splits it as one arg in .mcp.json', () => {
    const root = fixture();
    const opts = { mcpCommand: 'node /dev path/server.js', helperCommand: 'node /dev path/helper.js' };
    installClaudeAssets(root, opts);
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('node "/dev path/helper.js" digest');
    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.lovelace.command).toBe('node');
    expect(mcp.mcpServers.lovelace.args).toEqual(['/dev path/server.js']);
  });

  it('migrates stale backslash-format Lovelace hooks on reinstall, keeping a user hook intact', () => {
    const root = fixture();
    const winOpts = {
      mcpCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe digest' }] },
            { hooks: [{ type: 'command', command: 'echo hi' }] },
          ],
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe session-check' },
              ],
            },
          ],
        },
      }),
    );
    installClaudeAssets(root, winOpts);
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));

    const sessionStartCommands = settings.hooks.SessionStart.flatMap((e: { hooks: Array<{ command: string }> }) =>
      e.hooks.map((h) => h.command),
    );
    expect(sessionStartCommands).toContain('C:/Users/FredyLievano/AppData/Local/Lovelace/lovelace-agent.exe digest');
    expect(sessionStartCommands).toContain('echo hi');
    expect(sessionStartCommands).not.toContain(
      'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe digest',
    );
    expect(settings.hooks.SessionStart).toHaveLength(2);

    const stopCommands = settings.hooks.Stop.flatMap((e: { hooks: Array<{ command: string }> }) => e.hooks.map((h) => h.command));
    expect(stopCommands).toContain('C:/Users/FredyLievano/AppData/Local/Lovelace/lovelace-agent.exe session-check');
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('is idempotent with Windows paths: installing twice does not duplicate any entry', () => {
    const root = fixture();
    const winOpts = {
      mcpCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    installClaudeAssets(root, winOpts);
    const first = readFileSync(join(root, '.claude/settings.json'), 'utf8');
    installClaudeAssets(root, winOpts);
    const second = readFileSync(join(root, '.claude/settings.json'), 'utf8');
    expect(second).toBe(first);
    const settings = JSON.parse(second);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(settings.hooks.SessionEnd).toHaveLength(1);
  });
});

describe('detectClaudeAssets', () => {
  it('returns all false on a clean empty directory', () => {
    const root = emptyDir();
    const status = detectClaudeAssets(root);
    expect(status.installed).toBe(false);
    expect(status.mcp).toBe(false);
    expect(status.hooks).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.agentsMd).toBe(false);
    expect(status.claudeMd).toBe(false);
    expect(status.gitHook).toBe(false);
  });

  it('returns installed: true after a full install', () => {
    const root = emptyDir();
    installClaudeAssets(root, OPTS);
    const status = detectClaudeAssets(root);
    expect(status.installed).toBe(true);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(true);
    expect(status.commands).toBe(true);
    expect(status.agentsMd).toBe(true);
    expect(status.claudeMd).toBe(true);
    expect(status.gitHook).toBe(false);
  });

  it('reports gitHook: true after an install with the git hook', () => {
    const root = emptyDir();
    execSync('git init -q', { cwd: root });
    installClaudeAssets(root, { ...OPTS, gitHook: true });
    const status = detectClaudeAssets(root);
    expect(status.installed).toBe(true);
    expect(status.gitHook).toBe(true);
  });

  it('partial: only .mcp.json present gives mcp: true and installed: false', () => {
    const root = emptyDir();
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { lovelace: { command: '/x' } } }));
    const status = detectClaudeAssets(root);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('partial: only hooks present gives hooks: true and installed: false', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${OPTS.helperCommand} digest` }] }] } }),
    );
    const status = detectClaudeAssets(root);
    expect(status.hooks).toBe(true);
    expect(status.mcp).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('partial: only commands present gives commands: true and installed: false', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(root, '.claude', 'commands', 'ticket.md'), '# ticket\n');
    const status = detectClaudeAssets(root);
    expect(status.commands).toBe(true);
    expect(status.mcp).toBe(false);
    expect(status.hooks).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('treats malformed .mcp.json as not present rather than throwing', () => {
    const root = emptyDir();
    writeFileSync(join(root, '.mcp.json'), '{not valid json');
    expect(() => detectClaudeAssets(root)).not.toThrow();
    expect(detectClaudeAssets(root).mcp).toBe(false);
  });

  it('treats malformed .claude/settings.json as not present rather than throwing', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), '{bad json');
    expect(() => detectClaudeAssets(root)).not.toThrow();
    expect(detectClaudeAssets(root).hooks).toBe(false);
  });

  it('detects claudeMd only when the section marker is present, not just any CLAUDE.md', () => {
    const root = emptyDir();
    writeFileSync(join(root, 'CLAUDE.md'), '# My project\n\nNo lovelace section here.\n');
    expect(detectClaudeAssets(root).claudeMd).toBe(false);
    writeFileSync(join(root, 'CLAUDE.md'), '# My project\n\n<!-- lovelace:start -->\n<!-- lovelace:end -->\n');
    expect(detectClaudeAssets(root).claudeMd).toBe(true);
  });

  it('detects agentsMd only when the section marker is present', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.lovelace'), { recursive: true });
    writeFileSync(join(root, '.lovelace', 'AGENTS.md'), '# No marker\n');
    expect(detectClaudeAssets(root).agentsMd).toBe(false);
    writeFileSync(join(root, '.lovelace', 'AGENTS.md'), '<!-- lovelace:start -->\n# instructions\n<!-- lovelace:end -->\n');
    expect(detectClaudeAssets(root).agentsMd).toBe(true);
  });
});
