import { describe, expect, it, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClaudeAssets, installClaudeAssets } from '../src/claude.js';
import { detectCodexAssets, installCodexAssets } from '../src/codex.js';
import { detectOpenCodeAssets, installOpenCodeAssets } from '../src/opencode.js';
import { tempFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function emptyDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lovelace-codex-detect-test-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

const OPTS = { mcpCommand: '/opt/lovelace/bin/lovelace-mcp', helperCommand: '/opt/lovelace/bin/lovelace-agent' };

const WRITTEN_FILES = [
  'AGENTS.md',
  '.lovelace/AGENTS.md',
  '.codex/config.toml',
  '.codex/hooks.json',
  '.agents/skills/ticket/SKILL.md',
  '.agents/skills/done/SKILL.md',
];

describe('installCodexAssets', () => {
  it('writes .codex/config.toml, .codex/hooks.json, AGENTS.md, and the skills on a clean project', () => {
    const root = fixture();
    const result = installCodexAssets(root, OPTS);
    expect(result.manual).toEqual([]);

    const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('lovelace:start');
    expect(agentsMd).toContain('.lovelace/AGENTS.md');

    const lovelaceAgents = readFileSync(join(root, '.lovelace/AGENTS.md'), 'utf8');
    expect(lovelaceAgents).toContain('.lovelace/documentation/index.md');
    expect(lovelaceAgents).toContain('log_session');
    expect(lovelaceAgents).toContain('update_ticket');

    const config = readFileSync(join(root, '.codex/config.toml'), 'utf8');
    expect(config).toContain('# lovelace:start');
    expect(config).toContain('[mcp_servers.lovelace]');
    expect(config).toContain(`command = ${JSON.stringify(OPTS.mcpCommand)}`);
    expect(config).toContain('args = []');
    expect(config).toContain('[mcp_servers.lovelace.env]');
    expect(config).toContain('LOVELACE_ROOT = "."');
    expect(config).toContain('# lovelace:end');

    const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    const flat = JSON.stringify(hooks.hooks);
    expect(flat).toContain('digest');
    expect(flat).toContain('session-check');
    expect(flat).toContain('guard');
    expect(flat).toContain('presence-start');
    expect(flat).toContain('presence-beat');
    expect(flat).toContain('presence-clear');
    expect(flat).toContain('track-active');
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('Edit|Write');
    expect(hooks.hooks.PostToolUse[0].matcher).toBe('mcp__lovelace__set_active_ticket');
    expect(hooks.hooks.PostToolUse[1].matcher).toBeUndefined();

    const ticketSkill = readFileSync(join(root, '.agents/skills/ticket/SKILL.md'), 'utf8');
    expect(ticketSkill).toContain('name: ticket');
    expect(ticketSkill).toContain('active_ticket');
    const doneSkill = readFileSync(join(root, '.agents/skills/done/SKILL.md'), 'utf8');
    expect(doneSkill).toContain('name: done');
    expect(doneSkill).toContain('acceptance criteria');

    const status = detectCodexAssets(root);
    expect(status.installed).toBe(true);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(true);
    expect(status.commands).toBe(true);
    expect(status.agentsMd).toBe(true);
    expect(status.lovelaceAgentsMd).toBe(true);
    expect(status.gitHook).toBe(false);
  });

  it('is idempotent: installing twice is byte-identical for every written file', () => {
    const root = fixture();
    installCodexAssets(root, OPTS);
    const before = WRITTEN_FILES.map((f) => readFileSync(join(root, f)));
    installCodexAssets(root, OPTS);
    const after = WRITTEN_FILES.map((f) => readFileSync(join(root, f)));
    before.forEach((buf, i) => expect(after[i].equals(buf)).toBe(true));
  });

  it('keeps existing content outside the markers in a pre-existing .codex/config.toml, on install and reinstall', () => {
    const root = fixture();
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(join(root, '.codex/config.toml'), '# My config\napproval_policy = "untrusted"\n');
    installCodexAssets(root, OPTS);
    const content = readFileSync(join(root, '.codex/config.toml'), 'utf8');
    expect(content).toContain('approval_policy = "untrusted"');
    expect(content).toContain('lovelace:start');

    // Reinstall replaces the section in place, still preserving user content.
    const opts2 = { ...OPTS, mcpCommand: '/opt/lovelace2/bin/lovelace-mcp' };
    installCodexAssets(root, opts2);
    const again = readFileSync(join(root, '.codex/config.toml'), 'utf8');
    expect(again).toContain('approval_policy = "untrusted"');
    expect(again.match(/lovelace:start/g)).toHaveLength(1);
    expect(again).toContain(JSON.stringify(opts2.mcpCommand));
  });

  it('reports a manual step instead of writing when [mcp_servers.lovelace] already exists outside the Lovelace markers', () => {
    const root = fixture();
    mkdirSync(join(root, '.codex'), { recursive: true });
    const original = '[mcp_servers.lovelace]\ncommand = "/hand/written"\n';
    writeFileSync(join(root, '.codex/config.toml'), original);
    const result = installCodexAssets(root, OPTS);
    expect(result.manual.some((m) => m.includes('.codex/config.toml') && m.includes('[mcp_servers.lovelace]'))).toBe(true);
    expect(readFileSync(join(root, '.codex/config.toml'), 'utf8')).toBe(original);
  });

  it('preserves unrelated top-level keys and user hook entries in .codex/hooks.json, without duplicating on reinstall', () => {
    const root = fixture();
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(
      join(root, '.codex/hooks.json'),
      JSON.stringify({
        someOtherKey: 'kept',
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'my-own-hook' }] }],
        },
      }),
    );
    installCodexAssets(root, OPTS);
    const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    expect(hooks.someOtherKey).toBe('kept');
    const sessionStartCommands = hooks.hooks.SessionStart.flatMap((e: { hooks: Array<{ command: string }> }) =>
      e.hooks.map((h) => h.command),
    );
    expect(sessionStartCommands).toContain('my-own-hook');
    expect(sessionStartCommands).toContain(`${OPTS.helperCommand} digest`);
    expect(hooks.hooks.SessionStart).toHaveLength(2);

    // Reinstall does not duplicate the Lovelace entries.
    installCodexAssets(root, OPTS);
    const again = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    expect(again.hooks.SessionStart).toHaveLength(2);
    expect(again.hooks.PostToolUse).toHaveLength(2);
  });

  it('reports a manual step instead of failing on unparseable .codex/hooks.json, and detection reports hooks false', () => {
    const root = fixture();
    mkdirSync(join(root, '.codex'), { recursive: true });
    const original = '{not json';
    writeFileSync(join(root, '.codex/hooks.json'), original);
    const result = installCodexAssets(root, OPTS);
    expect(result.manual.some((m) => m.includes('.codex/hooks.json'))).toBe(true);
    expect(readFileSync(join(root, '.codex/hooks.json'), 'utf8')).toBe(original);
    expect(detectCodexAssets(root).hooks).toBe(false);
  });

  it('replaces a stale helper hook command on reinstall, keeping a user hook that merely mentions lovelace-agent intact', () => {
    const root = fixture();
    const winOpts = {
      mcpCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(
      join(root, '.codex/hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe digest' }] },
            { hooks: [{ type: 'command', command: 'echo lovelace-agent is nice' }] },
          ],
        },
      }),
    );
    installCodexAssets(root, winOpts);
    const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    const sessionStartCommands = hooks.hooks.SessionStart.flatMap((e: { hooks: Array<{ command: string }> }) =>
      e.hooks.map((h) => h.command),
    );
    expect(sessionStartCommands).toContain('C:/Users/FredyLievano/AppData/Local/Lovelace/lovelace-agent.exe digest');
    expect(sessionStartCommands).toContain('echo lovelace-agent is nice');
    expect(sessionStartCommands).not.toContain('C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe digest');
    expect(hooks.hooks.SessionStart).toHaveLength(2);
  });

  it('normalises a Windows backslash command path to forward slashes in config.toml and hooks.json, quoting hook commands only when spaced', () => {
    const root = fixture();
    const opts = {
      mcpCommand: 'C:\\Users\\Fredy Lievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\Fredy Lievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    installCodexAssets(root, opts);

    const config = readFileSync(join(root, '.codex/config.toml'), 'utf8');
    expect(config).toContain('C:/Users/Fredy Lievano/AppData/Local/Lovelace/lovelace-mcp.exe');
    expect(config).not.toContain('\\\\');

    const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    const expected = '"C:/Users/Fredy Lievano/AppData/Local/Lovelace/lovelace-agent.exe"';
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe(`${expected} digest`);
    expect(hooks.hooks.UserPromptSubmit[0].hooks[0].command).toBe(`${expected} presence-start`);
  });

  it('leaves hook commands unquoted for a Windows path with no space', () => {
    const root = fixture();
    const opts = {
      mcpCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-mcp.exe',
      helperCommand: 'C:\\Users\\FredyLievano\\AppData\\Local\\Lovelace\\lovelace-agent.exe',
    };
    installCodexAssets(root, opts);
    const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe(
      'C:/Users/FredyLievano/AppData/Local/Lovelace/lovelace-agent.exe digest',
    );
  });

  it('splits the dev node command form into command/args in config.toml', () => {
    const root = fixture();
    const opts = { mcpCommand: 'node /dev path/server.js', helperCommand: 'node /dev path/helper.js' };
    installCodexAssets(root, opts);
    const config = readFileSync(join(root, '.codex/config.toml'), 'utf8');
    expect(config).toContain('command = "node"');
    expect(config).toContain('args = ["/dev path/server.js"]');
    const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe('node "/dev path/helper.js" digest');
  });

  it('installs the opt-in Git hook when the project is a repository', () => {
    const root = fixture();
    execSync('git init -q', { cwd: root });
    const result = installCodexAssets(root, { ...OPTS, gitHook: true });
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
    const result = installCodexAssets(root, { ...OPTS, gitHook: true });
    expect(result.manual.some((m) => m.includes('Git'))).toBe(true);
  });

  it('detects an existing Lovelace Git hook (installed by another integration) without duplicating it, and reports a manual step over a foreign hook', () => {
    const root = fixture();
    execSync('git init -q', { cwd: root });
    installClaudeAssets(root, { ...OPTS, gitHook: true });
    const before = readFileSync(join(root, '.git/hooks/prepare-commit-msg'), 'utf8');
    installCodexAssets(root, { ...OPTS, gitHook: true });
    // Rewriting the shared script over its own Lovelace-owned content is a
    // no-op in substance: byte-identical, not a second competing hook.
    expect(readFileSync(join(root, '.git/hooks/prepare-commit-msg'), 'utf8')).toBe(before);
    expect(detectCodexAssets(root).gitHook).toBe(true);

    // A foreign (non-Lovelace) hook is left alone; a manual step is reported instead.
    const root2 = fixture();
    execSync('git init -q', { cwd: root2 });
    mkdirSync(join(root2, '.git/hooks'), { recursive: true });
    writeFileSync(join(root2, '.git/hooks/prepare-commit-msg'), '#!/bin/sh\necho foreign\n');
    const result2 = installCodexAssets(root2, { ...OPTS, gitHook: true });
    expect(result2.manual.some((m) => m.includes('prepare-commit-msg'))).toBe(true);
    expect(readFileSync(join(root2, '.git/hooks/prepare-commit-msg'), 'utf8')).toBe('#!/bin/sh\necho foreign\n');
  });

  it('does not touch any Claude- or OpenCode-owned file when Codex is installed alongside existing Claude and OpenCode installs, and all three detectors report installed', () => {
    const root = fixture();
    installClaudeAssets(root, OPTS);
    installOpenCodeAssets(root, OPTS);
    const before = {
      mcpJson: readFileSync(join(root, '.mcp.json'), 'utf8'),
      settings: readFileSync(join(root, '.claude/settings.json'), 'utf8'),
      claudeTicket: readFileSync(join(root, '.claude/commands/ticket.md'), 'utf8'),
      claudeDone: readFileSync(join(root, '.claude/commands/done.md'), 'utf8'),
      claudeMd: readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
      opencodeJson: readFileSync(join(root, 'opencode.json'), 'utf8'),
      plugin: readFileSync(join(root, '.opencode/plugins/lovelace.js'), 'utf8'),
      opencodeTicket: readFileSync(join(root, '.opencode/commands/ticket.md'), 'utf8'),
      opencodeDone: readFileSync(join(root, '.opencode/commands/done.md'), 'utf8'),
    };
    installCodexAssets(root, OPTS);
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(before.mcpJson);
    expect(readFileSync(join(root, '.claude/settings.json'), 'utf8')).toBe(before.settings);
    expect(readFileSync(join(root, '.claude/commands/ticket.md'), 'utf8')).toBe(before.claudeTicket);
    expect(readFileSync(join(root, '.claude/commands/done.md'), 'utf8')).toBe(before.claudeDone);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(before.claudeMd);
    expect(readFileSync(join(root, 'opencode.json'), 'utf8')).toBe(before.opencodeJson);
    expect(readFileSync(join(root, '.opencode/plugins/lovelace.js'), 'utf8')).toBe(before.plugin);
    expect(readFileSync(join(root, '.opencode/commands/ticket.md'), 'utf8')).toBe(before.opencodeTicket);
    expect(readFileSync(join(root, '.opencode/commands/done.md'), 'utf8')).toBe(before.opencodeDone);

    const lovelaceAgents = readFileSync(join(root, '.lovelace/AGENTS.md'), 'utf8');
    expect(lovelaceAgents.match(/lovelace:start/g)).toHaveLength(1);
    const rootAgents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(rootAgents.match(/lovelace:start/g)).toHaveLength(1);

    expect(detectClaudeAssets(root).installed).toBe(true);
    expect(detectOpenCodeAssets(root).installed).toBe(true);
    expect(detectCodexAssets(root).installed).toBe(true);
  });

  it('carries timeout 3 only on the SessionEnd hook entry', () => {
    const root = fixture();
    installCodexAssets(root, OPTS);
    const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
    const allEntries = Object.values(hooks.hooks as Record<string, Array<{ hooks: Array<{ command: string; timeout?: number }> }>>).flatMap(
      (list) => list.flatMap((entry) => entry.hooks),
    );
    const withTimeout = allEntries.filter((h) => h.timeout !== undefined);
    expect(withTimeout).toHaveLength(1);
    expect(withTimeout[0].timeout).toBe(3);
    expect(withTimeout[0].command).toContain('presence-clear');
    expect(hooks.hooks.SessionEnd[0].hooks[0].timeout).toBe(3);
  });
});

describe('detectCodexAssets', () => {
  it('returns all false on a clean empty directory', () => {
    const root = emptyDir();
    const status = detectCodexAssets(root);
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
    installCodexAssets(root, { ...OPTS, gitHook: true });
    const status = detectCodexAssets(root);
    expect(status.installed).toBe(true);
    expect(status.gitHook).toBe(true);
  });

  it('partial: only .codex/config.toml present gives mcp: true and installed: false', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(join(root, '.codex/config.toml'), '[mcp_servers.lovelace]\ncommand = "/x"\n');
    const status = detectCodexAssets(root);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('partial: only .codex/hooks.json present gives hooks: true and installed: false', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(
      join(root, '.codex/hooks.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${OPTS.helperCommand} digest` }] }] } }),
    );
    const status = detectCodexAssets(root);
    expect(status.hooks).toBe(true);
    expect(status.mcp).toBe(false);
    expect(status.commands).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('partial: only the ticket skill present gives commands: true and installed: false', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.agents/skills/ticket'), { recursive: true });
    writeFileSync(join(root, '.agents/skills/ticket/SKILL.md'), '---\nname: ticket\n---\n');
    const status = detectCodexAssets(root);
    expect(status.commands).toBe(true);
    expect(status.mcp).toBe(false);
    expect(status.hooks).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('deletes one written piece at a time and reports the booleans correctly at each step', () => {
    const root = emptyDir();
    installCodexAssets(root, OPTS);
    expect(detectCodexAssets(root).installed).toBe(true);

    rmSync(join(root, '.codex/config.toml'));
    let status = detectCodexAssets(root);
    expect(status.mcp).toBe(false);
    expect(status.hooks).toBe(true);
    expect(status.commands).toBe(true);
    expect(status.installed).toBe(false);

    installCodexAssets(root, OPTS);
    rmSync(join(root, '.codex/hooks.json'));
    status = detectCodexAssets(root);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(false);
    expect(status.commands).toBe(true);
    expect(status.installed).toBe(false);

    installCodexAssets(root, OPTS);
    rmSync(join(root, '.agents/skills/ticket/SKILL.md'));
    status = detectCodexAssets(root);
    expect(status.mcp).toBe(true);
    expect(status.hooks).toBe(true);
    expect(status.commands).toBe(false);
    expect(status.installed).toBe(false);
  });

  it('treats malformed .codex/hooks.json as not present rather than throwing', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(join(root, '.codex/hooks.json'), '{not valid json');
    expect(() => detectCodexAssets(root)).not.toThrow();
    expect(detectCodexAssets(root).hooks).toBe(false);
  });

  it('detects agentsMd only when the section marker is present, not just any AGENTS.md', () => {
    const root = emptyDir();
    writeFileSync(join(root, 'AGENTS.md'), '# My project\n\nNo lovelace section here.\n');
    expect(detectCodexAssets(root).agentsMd).toBe(false);
    writeFileSync(join(root, 'AGENTS.md'), '# My project\n\n<!-- lovelace:start -->\n<!-- lovelace:end -->\n');
    expect(detectCodexAssets(root).agentsMd).toBe(true);
  });

  it('detects lovelaceAgentsMd only when the section marker is present', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.lovelace'), { recursive: true });
    writeFileSync(join(root, '.lovelace', 'AGENTS.md'), '# No marker\n');
    expect(detectCodexAssets(root).lovelaceAgentsMd).toBe(false);
    writeFileSync(join(root, '.lovelace', 'AGENTS.md'), '<!-- lovelace:start -->\n# instructions\n<!-- lovelace:end -->\n');
    expect(detectCodexAssets(root).lovelaceAgentsMd).toBe(true);
  });

  it('requires the [mcp_servers.lovelace] table, not just the file existing', () => {
    const root = emptyDir();
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(join(root, '.codex/config.toml'), 'approval_policy = "untrusted"\n');
    expect(detectCodexAssets(root).mcp).toBe(false);
  });
});
