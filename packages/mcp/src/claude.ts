/**
 * Writes the Claude Code assets into a user's project: the CLAUDE.md
 * section, .mcp.json, hooks in .claude/settings.json, slash commands, and
 * the opt-in prepare-commit-msg Git hook. Everything is additive: existing
 * files are appended to or merged, never overwritten.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AssetResult,
  detectGitHook,
  hookCommandPrefix,
  isStaleHelperCommand,
  KNOWN_HELPER_SUFFIXES,
  mergeJsonFile,
  parseCommand,
  refreshLovelaceAgentsMd,
  SECTION_END,
  SECTION_START,
  writeGitHook,
  writeMarkerSection,
} from './assets.js';

export interface ClaudeAssetOptions {
  /** Command (absolute path or name on PATH) for the MCP server binary. */
  mcpCommand: string;
  /** Command for the agent helper binary. */
  helperCommand: string;
  /** Install the prepare-commit-msg Git hook (opt-in). */
  gitHook?: boolean;
}

export type ClaudeAssetResult = AssetResult;

/**
 * The CLAUDE.md block is a pointer, not a manual: it sends the agent to the
 * Lovelace instruction file and imports it (Claude Code expands `@path`), so
 * all direction lives in one Lovelace-owned file.
 */
export function claudeMdSection(): string {
  return `${SECTION_START}
## Lovelace

This project uses Lovelace; its tickets, documents and session history live in \`.lovelace/\`. Before any work, read and follow \`.lovelace/AGENTS.md\`.

@.lovelace/AGENTS.md
${SECTION_END}
`;
}

function writeClaudeMd(root: string, result: ClaudeAssetResult): void {
  writeMarkerSection(join(root, 'CLAUDE.md'), claudeMdSection(), result, 'CLAUDE.md', '# CLAUDE.md\n\n');
}

function writeMcpJson(root: string, options: ClaudeAssetOptions, result: ClaudeAssetResult): void {
  const path = join(root, '.mcp.json');
  const { command, args } = parseCommand(options.mcpCommand);
  const entry = {
    command,
    args,
    env: { LOVELACE_ROOT: '.' },
  };
  mergeJsonFile<{ mcpServers?: Record<string, unknown> }>(
    path,
    (config) => ({ ...config, mcpServers: { ...config.mcpServers, lovelace: entry } }),
    result,
    '.mcp.json',
    `.mcp.json exists but is not valid JSON; add a "lovelace" entry yourself: ${JSON.stringify({ lovelace: entry })}`,
  );
}

function writeHooks(root: string, options: ClaudeAssetOptions, result: ClaudeAssetResult): void {
  const dir = join(root, '.claude');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      result.manual.push('.claude/settings.json exists but is not valid JSON; add the Lovelace hooks by hand (see docs).');
      return;
    }
  }
  const helper = hookCommandPrefix(options.helperCommand);
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const commands = {
    digest: `${helper} digest`,
    sessionCheck: `${helper} session-check`,
    guard: `${helper} guard`,
    presenceStart: `${helper} presence-start`,
    presenceClear: `${helper} presence-clear`,
    trackActive: `${helper} track-active`,
    presenceBeat: `${helper} presence-beat`,
  };
  const expected = new Set(Object.values(commands));
  // Migration: an older install (in particular a pre-fix Windows install,
  // whose backslash path bash strips into "command not found") wrote a
  // stale-format Lovelace hook command; drop it so this install's ensure()
  // below replaces it instead of leaving both side by side. A hook is only
  // ever judged stale by isStaleHelperCommand, so a user-authored hook is
  // left untouched.
  for (const event of Object.keys(hooks)) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;
    hooks[event] = (list as Array<{ matcher?: string; hooks: Array<{ command: string }> }>).filter(
      (entry) => !entry.hooks?.every((h) => isStaleHelperCommand(h.command, expected)),
    );
  }
  const ensure = (event: string, matcher: string | undefined, command: string) => {
    const list = (hooks[event] ?? []) as Array<{ matcher?: string; hooks: Array<{ command: string }> }>;
    const exists = list.some((h) => h.hooks?.some((x) => x.command === command));
    if (!exists) {
      const entry: { matcher?: string; hooks: Array<{ type: string; command: string }> } = {
        hooks: [{ type: 'command', command }],
      };
      if (matcher !== undefined) entry.matcher = matcher;
      list.push(entry);
    }
    hooks[event] = list;
  };
  // Migration (ADR-0012): older installs also fired presence-clear on Stop.
  // session-check now folds that clear in when a stop passes, so a
  // leftover Stop entry is stale; strip it, leaving any other Stop hook
  // (including one a user added by hand) untouched. SessionEnd keeps its
  // own presence-clear entry below. Idempotent: nothing to strip once
  // removed.
  if (Array.isArray(hooks.Stop)) {
    hooks.Stop = (hooks.Stop as Array<{ matcher?: string; hooks: Array<{ command: string }> }>).filter(
      (entry) => !entry.hooks?.every((h) => h.command?.endsWith(' presence-clear')),
    );
  }
  ensure('SessionStart', undefined, commands.digest);
  ensure('Stop', undefined, commands.sessionCheck);
  ensure('PreToolUse', 'Edit|Write', commands.guard);
  // The live-agent marker: written at turn start, cleared when a passing
  // stop lets the turn end or the session ends outright (ADR-0012).
  ensure('UserPromptSubmit', undefined, commands.presenceStart);
  ensure('SessionEnd', undefined, commands.presenceClear);
  // Per-session active-ticket marker, so concurrent sessions do not share
  // the singleton slot that session-check enforces on Stop.
  ensure('PostToolUse', 'mcp__lovelace__set_active_ticket', commands.trackActive);
  // The heartbeat: refreshes every session's presence entry on every tool
  // call, so the ring survives between prompts without relying on a
  // started_at that never moves.
  ensure('PostToolUse', undefined, commands.presenceBeat);
  settings.hooks = hooks;
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  result.written.push('.claude/settings.json');
}

function writeCommands(root: string, result: ClaudeAssetResult): void {
  const dir = join(root, '.claude', 'commands');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'ticket.md'),
    `---
description: Load a Lovelace ticket into context and start working it
---

Work Lovelace ticket $ARGUMENTS:

1. Use the Lovelace query_tickets tool to load the ticket, then read its parent and every ticket in depends_on.
2. Use read_document on .lovelace/documentation/index.md and any documents the ticket references.
3. Use search to find the last two session records referencing this ticket and read their open questions.
4. Call set_active_ticket with the ticket ID.
5. If the ticket is not already in progress, move it with update_ticket to the status tagged \`agent: in_progress\`.
6. Summarise the ticket, its acceptance criteria and any open questions, then begin.
`,
  );
  writeFileSync(
    join(dir, 'done.md'),
    `---
description: Close out the active Lovelace ticket
---

Finish the active Lovelace ticket:

1. Read .lovelace/state/active_ticket for the active ticket ID; if empty, ask which ticket to close.
2. Re-read the ticket's acceptance criteria and check each one against what you actually did.
3. Move the ticket with update_ticket to the status tagged \`agent: complete\` if the work is done, or another status defined in schema.yaml that reflects the outcome. If you are handing it back, add a comment explaining what you need.
4. Write the session record with log_session: approach, what happened, outcome, commit SHAs, open questions.
5. Call set_active_ticket with null to clear it.
`,
  );
  result.written.push('.claude/commands/ticket.md', '.claude/commands/done.md');
}

export interface ClaudeInstallStatus {
  /** True when all three core pieces are present: mcp, hooks, commands. */
  installed: boolean;
  /** `.lovelace/AGENTS.md` exists with the Lovelace section. */
  agentsMd: boolean;
  /** `CLAUDE.md` contains the Lovelace section marker. */
  claudeMd: boolean;
  /** `.mcp.json` exists with an `mcpServers.lovelace` entry. */
  mcp: boolean;
  /** `.claude/settings.json` exists with Lovelace hook commands. */
  hooks: boolean;
  /** `.claude/commands/ticket.md` exists. */
  commands: boolean;
  /** `.git/hooks/prepare-commit-msg` exists and references Lovelace. */
  gitHook: boolean;
}

/**
 * Inspects on-disk assets to determine whether the Claude Code integration
 * has been installed for the given project root. Read-only and resilient to
 * malformed JSON (treats as not present rather than throwing).
 */
export function detectClaudeAssets(root: string): ClaudeInstallStatus {
  let mcp = false;
  const mcpPath = join(root, '.mcp.json');
  if (existsSync(mcpPath)) {
    try {
      const raw = JSON.parse(readFileSync(mcpPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
      mcp = typeof raw.mcpServers === 'object' && raw.mcpServers !== null && 'lovelace' in raw.mcpServers;
    } catch {
      // malformed JSON: treat as not present
    }
  }

  let hooks = false;
  const settingsPath = join(root, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as { hooks?: unknown };
      if (raw.hooks) {
        const flat = JSON.stringify(raw.hooks);
        hooks = KNOWN_HELPER_SUFFIXES.some((suffix) => flat.includes(suffix));
      }
    } catch {
      // malformed JSON: treat as not present
    }
  }

  const commands = existsSync(join(root, '.claude', 'commands', 'ticket.md'));

  let agentsMd = false;
  const agentsPath = join(root, '.lovelace', 'AGENTS.md');
  if (existsSync(agentsPath)) {
    try {
      agentsMd = readFileSync(agentsPath, 'utf8').includes(SECTION_START);
    } catch {
      agentsMd = true;
    }
  }

  let claudeMd = false;
  const claudeMdPath = join(root, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    try {
      claudeMd = readFileSync(claudeMdPath, 'utf8').includes(SECTION_START);
    } catch {
      // treat as not present
    }
  }

  return {
    installed: mcp && hooks && commands,
    agentsMd,
    claudeMd,
    mcp,
    hooks,
    commands,
    gitHook: detectGitHook(root),
  };
}

export function installClaudeAssets(root: string, options: ClaudeAssetOptions): ClaudeAssetResult {
  // Claude Code runs hook commands through bash, which strips unquoted
  // backslashes, so a raw Windows path (from process.execPath) breaks every
  // hook with "command not found". Forward slashes work in bash, in Claude
  // Code and in the Windows file APIs, and POSIX sidecar paths never
  // contain a backslash, so this is a no-op on macOS/Linux.
  const normalised: ClaudeAssetOptions = {
    ...options,
    mcpCommand: options.mcpCommand.replace(/\\/g, '/'),
    helperCommand: options.helperCommand.replace(/\\/g, '/'),
  };
  const result: ClaudeAssetResult = { written: [], manual: [] };
  refreshLovelaceAgentsMd(root, result);
  writeClaudeMd(root, result);
  writeMcpJson(root, normalised, result);
  writeHooks(root, normalised, result);
  writeCommands(root, result);
  if (normalised.gitHook) writeGitHook(root, result);
  return result;
}
