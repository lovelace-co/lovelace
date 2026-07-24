import { describe, expect, it, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installClaudeAssets } from '../src/claude.js';
import { detectOpenCodeAssets, installOpenCodeAssets, OPENCODE_PLUGIN_MARKER } from '../src/opencode.js';
import { tempFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function emptyDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lovelace-opencode-detect-test-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

const OPTS = { mcpCommand: '/opt/lovelace/bin/lovelace-mcp', helperCommand: '/opt/lovelace/bin/lovelace-agent' };

describe('installOpenCodeAssets', () => {
  it('writes opencode.json, AGENTS.md, the plugin, and slash commands on a clean project', () => {
    const root = fixture();
    const result = installOpenCodeAssets(root, OPTS);
    expect(result.manual).toEqual([]);

    const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('lovelace:start');
    expect(agentsMd).toContain('.lovelace/AGENTS.md');
    // No Claude-only @include syntax: OpenCode has no @path include.
    expect(agentsMd).not.toContain('@.lovelace/AGENTS.md');

    const lovelaceAgents = readFileSync(join(root, '.lovelace/AGENTS.md'), 'utf8');
    expect(lovelaceAgents).toContain('.lovelace/documentation/index.md');
    expect(lovelaceAgents).toContain('log_session');
    expect(lovelaceAgents).toContain('update_ticket');

    const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
    expect(config.mcp.lovelace).toEqual({
      type: 'local',
      command: [OPTS.mcpCommand],
      enabled: true,
      environment: { LOVELACE_ROOT: '.' },
    });
    expect(config.instructions).toEqual(['.lovelace/AGENTS.md']);

    const plugin = readFileSync(join(root, '.opencode/plugins/lovelace.js'), 'utf8');
    expect(plugin).toContain(OPENCODE_PLUGIN_MARKER);
    expect(plugin).toContain('export const LovelacePlugin');
    expect(plugin).toContain("'chat.message'");
    expect(plugin).toContain("'tool.execute.before'");
    expect(plugin).toContain("'tool.execute.after'");
    expect(plugin).toContain(JSON.stringify([OPTS.helperCommand]));

    expect(readFileSync(join(root, '.opencode/commands/ticket.md'), 'utf8')).toContain('active_ticket');
    expect(readFileSync(join(root, '.opencode/commands/done.md'), 'utf8')).toContain('acceptance criteria');

    const status = detectOpenCodeAssets(root);
    expect(status.installed).toBe(true);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(true);
    expect(status.commands).toBe(true);
    expect(status.agentsMd).toBe(true);
    expect(status.lovelaceAgentsMd).toBe(true);
    expect(status.gitHook).toBe(false);
  });

  it('is idempotent: installing twice produces byte-identical files', () => {
    const root = fixture();
    installOpenCodeAssets(root, OPTS);
    const files = [
      'AGENTS.md',
      '.lovelace/AGENTS.md',
      'opencode.json',
      '.opencode/plugins/lovelace.js',
      '.opencode/commands/ticket.md',
      '.opencode/commands/done.md',
    ];
    const before = files.map((f) => readFileSync(join(root, f), 'utf8'));
    installOpenCodeAssets(root, OPTS);
    const after = files.map((f) => readFileSync(join(root, f), 'utf8'));
    expect(after).toEqual(before);
  });

  it('merges into an existing opencode.json, preserving another mcp server, unrelated keys, and existing instructions', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'opencode.json'),
      JSON.stringify({
        theme: 'dark',
        mcp: { other: { type: 'local', command: ['x'], enabled: true } },
        instructions: ['README.md'],
      }),
    );
    const result = installOpenCodeAssets(root, OPTS);
    const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
    expect(config.theme).toBe('dark');
    expect(config.mcp.other).toEqual({ type: 'local', command: ['x'], enabled: true });
    expect(config.mcp.lovelace).toBeDefined();
    expect(config.instructions).toEqual(['README.md', '.lovelace/AGENTS.md']);
    expect(result.manual).toEqual([]);

    // Reinstall does not duplicate the instructions entry or reorder it.
    installOpenCodeAssets(root, OPTS);
    const again = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
    expect(again.instructions).toEqual(['README.md', '.lovelace/AGENTS.md']);
  });

  it('normalises a Windows backslash command path to forward slashes in opencode.json and the plugin file', () => {
    const root = fixture();
    const opts = {
      mcpCommand: 'C:\\Users\\Fredy Lievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\Fredy Lievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    installOpenCodeAssets(root, opts);
    const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
    expect(config.mcp.lovelace.command).toEqual(['C:/Users/Fredy Lievano/AppData/Local/Lovelace/lovelace-mcp.exe']);
    const plugin = readFileSync(join(root, '.opencode/plugins/lovelace.js'), 'utf8');
    expect(plugin).toContain('C:/Users/Fredy Lievano/AppData/Local/Lovelace/lovelace-agent.exe');
    expect(plugin).not.toContain('\\\\');
  });

  it('splits the dev node command form into a two-element argv both in opencode.json and the plugin file', () => {
    const root = fixture();
    const opts = { mcpCommand: 'node /dev path/server.js', helperCommand: 'node /dev path/helper.js' };
    installOpenCodeAssets(root, opts);
    const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
    expect(config.mcp.lovelace.command).toEqual(['node', '/dev path/server.js']);
    const plugin = readFileSync(join(root, '.opencode/plugins/lovelace.js'), 'utf8');
    expect(plugin).toContain(JSON.stringify(['node', '/dev path/helper.js']));
  });

  it('reports a manual step instead of failing on unparseable opencode.json, and leaves the file untouched', () => {
    const root = fixture();
    const original = '{not json';
    writeFileSync(join(root, 'opencode.json'), original);
    const result = installOpenCodeAssets(root, OPTS);
    expect(result.manual.some((m) => m.includes('opencode.json'))).toBe(true);
    expect(readFileSync(join(root, 'opencode.json'), 'utf8')).toBe(original);
    expect(detectOpenCodeAssets(root).mcp).toBe(false);
  });

  it('keeps existing content outside the markers in a pre-existing root AGENTS.md, on install and reinstall', () => {
    const root = fixture();
    writeFileSync(join(root, 'AGENTS.md'), '# My project\n\nDo not touch this line.\n');
    installOpenCodeAssets(root, OPTS);
    const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(content).toContain('Do not touch this line.');
    expect(content).toContain('lovelace:start');
    installOpenCodeAssets(root, OPTS);
    const again = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(again).toContain('Do not touch this line.');
    expect(again.match(/lovelace:start/g)).toHaveLength(1);
  });

  it('installs the opt-in Git hook when the project is a repository', () => {
    const root = fixture();
    execSync('git init -q', { cwd: root });
    const result = installOpenCodeAssets(root, { ...OPTS, gitHook: true });
    const hook = join(root, '.git/hooks/prepare-commit-msg');
    expect(result.written).toContain('.git/hooks/prepare-commit-msg');
    expect(existsSync(hook)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(hook).mode & 0o111).toBeTruthy();
    }
    expect(readFileSync(hook, 'utf8')).toContain('active_ticket');
  });

  it('asks for manual action on a non-Git directory instead of failing', () => {
    const root = fixture();
    const result = installOpenCodeAssets(root, { ...OPTS, gitHook: true });
    expect(result.manual.some((m) => m.includes('Git'))).toBe(true);
  });

  it('does not touch any Claude-owned file, and keeps .lovelace/AGENTS.md single-sectioned, when OpenCode is installed alongside an existing Claude install', () => {
    const root = fixture();
    installClaudeAssets(root, OPTS);
    const before = {
      mcpJson: readFileSync(join(root, '.mcp.json'), 'utf8'),
      settings: readFileSync(join(root, '.claude/settings.json'), 'utf8'),
      ticket: readFileSync(join(root, '.claude/commands/ticket.md'), 'utf8'),
      done: readFileSync(join(root, '.claude/commands/done.md'), 'utf8'),
      claudeMd: readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
    };
    installOpenCodeAssets(root, OPTS);
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(before.mcpJson);
    expect(readFileSync(join(root, '.claude/settings.json'), 'utf8')).toBe(before.settings);
    expect(readFileSync(join(root, '.claude/commands/ticket.md'), 'utf8')).toBe(before.ticket);
    expect(readFileSync(join(root, '.claude/commands/done.md'), 'utf8')).toBe(before.done);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(before.claudeMd);

    const lovelaceAgents = readFileSync(join(root, '.lovelace/AGENTS.md'), 'utf8');
    expect(lovelaceAgents.match(/lovelace:start/g)).toHaveLength(1);

    // Neither install requested the opt-in Git hook.
    expect(detectOpenCodeAssets(root).gitHook).toBe(false);
  });
});

describe('detectOpenCodeAssets', () => {
  it('returns all false on a clean empty directory', () => {
    const root = emptyDir();
    const status = detectOpenCodeAssets(root);
    expect(status.installed).toBe(false);
    expect(status.mcp).toBe(false);
    expect(status.hooks).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.agentsMd).toBe(false);
    expect(status.lovelaceAgentsMd).toBe(false);
    expect(status.gitHook).toBe(false);
  });

  it('reports gitHook: true after an install with the git hook', () => {
    const root = emptyDir();
    execSync('git init -q', { cwd: root });
    installOpenCodeAssets(root, { ...OPTS, gitHook: true });
    const status = detectOpenCodeAssets(root);
    expect(status.installed).toBe(true);
    expect(status.gitHook).toBe(true);
  });

  it('reports gitHook: true when Claude already installed the shared Git hook', () => {
    const root = emptyDir();
    execSync('git init -q', { cwd: root });
    installClaudeAssets(root, { ...OPTS, gitHook: true });
    const status = detectOpenCodeAssets(root);
    expect(status.gitHook).toBe(true);
  });

  it('partial: only opencode.json present gives mcp: true and installed: false', () => {
    const root = emptyDir();
    writeFileSync(
      join(root, 'opencode.json'),
      JSON.stringify({ mcp: { lovelace: { type: 'local', command: ['/x'], enabled: true } } }),
    );
    const status = detectOpenCodeAssets(root);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('partial: only the plugin file present gives hooks: true and installed: false', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.opencode/plugins'), { recursive: true });
    writeFileSync(join(root, '.opencode/plugins/lovelace.js'), `${OPENCODE_PLUGIN_MARKER}\nexport const LovelacePlugin = async () => ({});\n`);
    const status = detectOpenCodeAssets(root);
    expect(status.hooks).toBe(true);
    expect(status.mcp).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('partial: only commands present gives commands: true and installed: false', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.opencode/commands'), { recursive: true });
    writeFileSync(join(root, '.opencode/commands/ticket.md'), '# ticket\n');
    const status = detectOpenCodeAssets(root);
    expect(status.commands).toBe(true);
    expect(status.mcp).toBe(false);
    expect(status.hooks).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('treats malformed opencode.json as not present rather than throwing', () => {
    const root = emptyDir();
    writeFileSync(join(root, 'opencode.json'), '{not valid json');
    expect(() => detectOpenCodeAssets(root)).not.toThrow();
    expect(detectOpenCodeAssets(root).mcp).toBe(false);
  });

  it('treats JSONC (comments) opencode.json as not present rather than throwing, since strict JSON is required for a safe merge', () => {
    const root = emptyDir();
    writeFileSync(join(root, 'opencode.json'), '{\n  // a comment\n  "mcp": { "lovelace": { "type": "local" } }\n}\n');
    expect(() => detectOpenCodeAssets(root)).not.toThrow();
    expect(detectOpenCodeAssets(root).mcp).toBe(false);
  });

  it('detects agentsMd only when the section marker is present, not just any AGENTS.md', () => {
    const root = emptyDir();
    writeFileSync(join(root, 'AGENTS.md'), '# My project\n\nNo lovelace section here.\n');
    expect(detectOpenCodeAssets(root).agentsMd).toBe(false);
    writeFileSync(join(root, 'AGENTS.md'), '# My project\n\n<!-- lovelace:start -->\n<!-- lovelace:end -->\n');
    expect(detectOpenCodeAssets(root).agentsMd).toBe(true);
  });

  it('detects lovelaceAgentsMd only when the section marker is present', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.lovelace'), { recursive: true });
    writeFileSync(join(root, '.lovelace', 'AGENTS.md'), '# No marker\n');
    expect(detectOpenCodeAssets(root).lovelaceAgentsMd).toBe(false);
    writeFileSync(join(root, '.lovelace', 'AGENTS.md'), '<!-- lovelace:start -->\n# instructions\n<!-- lovelace:end -->\n');
    expect(detectOpenCodeAssets(root).lovelaceAgentsMd).toBe(true);
  });

  it('requires the marker comment in the plugin file, not just its existence', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.opencode/plugins'), { recursive: true });
    writeFileSync(join(root, '.opencode/plugins/lovelace.js'), 'export const LovelacePlugin = async () => ({});\n');
    expect(detectOpenCodeAssets(root).hooks).toBe(false);
  });
});
