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
    expect(flat).toContain('presence-clear');
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    expect(settings.hooks.SessionEnd).toBeDefined();
    expect(JSON.stringify(settings.hooks.Stop)).toContain('presence-clear');
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write');

    expect(readFileSync(join(root, '.claude/commands/ticket.md'), 'utf8')).toContain('active_ticket');
    expect(readFileSync(join(root, '.claude/commands/done.md'), 'utf8')).toContain('acceptance criteria');
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
    expect(statSync(hook).mode & 0o111).toBeTruthy();
    expect(readFileSync(hook, 'utf8')).toContain('active_ticket');
  });

  it('asks for manual action on a non-Git directory instead of failing', () => {
    const root = fixture();
    const result = installClaudeAssets(root, { ...OPTS, gitHook: true });
    expect(result.manual.some((m) => m.includes('Git'))).toBe(true);
  });
});
