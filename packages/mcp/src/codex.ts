/**
 * Writes the OpenAI Codex CLI integration assets into a user's project: the
 * MCP server entry in a marker-delimited section of .codex/config.toml, a
 * marker-delimited section in the root AGENTS.md, the shared
 * `.lovelace/AGENTS.md` refresh, hooks in .codex/hooks.json, the
 * `ticket`/`done` skills under .agents/skills, and the opt-in
 * prepare-commit-msg Git hook. Mirrors claude.ts and opencode.ts (see
 * ADR-0015); everything is additive, existing files are merged into or
 * appended to, never overwritten outside their Lovelace-owned sections.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AssetResult,
  containsMarker,
  detectGitHook,
  hookCommandPrefix,
  isStaleHelperCommand,
  KNOWN_HELPER_SUFFIXES,
  parseCommand,
  refreshLovelaceAgentsMd,
  SECTION_END,
  SECTION_START,
  TOML_SECTION_END,
  TOML_SECTION_START,
  writeGitHook,
  writeMarkerSection,
} from './assets.js';

export interface CodexAssetOptions {
  /** Command (absolute path or name on PATH) for the MCP server binary. */
  mcpCommand: string;
  /** Command for the agent helper binary. */
  helperCommand: string;
  /** Install the prepare-commit-msg Git hook (opt-in). */
  gitHook?: boolean;
}

export type CodexAssetResult = AssetResult;

/**
 * The root AGENTS.md block is a pointer, not a manual: Codex reads AGENTS.md
 * natively but has no `@path` include mechanism, so this section only
 * directs the agent to the Lovelace instruction file.
 */
export function codexAgentsMdSection(): string {
  return `${SECTION_START}
## Lovelace

This project uses Lovelace; its tickets, documents and session history live in \`.lovelace/\`. Before any work, read and follow \`.lovelace/AGENTS.md\`.
${SECTION_END}
`;
}

function writeRootAgentsMd(root: string, result: CodexAssetResult): void {
  writeMarkerSection(join(root, 'AGENTS.md'), codexAgentsMdSection(), result, 'AGENTS.md', '# AGENTS.md\n\n');
}

/**
 * Builds the `[mcp_servers.lovelace]` TOML table, comment-marker delimited.
 * Every string is serialised with JSON.stringify: a JSON basic string is
 * also a valid TOML basic string, so this needs no TOML dependency. `args`
 * always renders, even when empty, so the table shape never depends on the
 * command form.
 */
export function codexConfigSection(mcpCommand: string): string {
  const { command, args } = parseCommand(mcpCommand);
  const argsLiteral = args.map((a) => JSON.stringify(a)).join(', ');
  return `${TOML_SECTION_START}
[mcp_servers.lovelace]
command = ${JSON.stringify(command)}
args = [${argsLiteral}]

[mcp_servers.lovelace.env]
LOVELACE_ROOT = "."
${TOML_SECTION_END}
`;
}

/**
 * Writes the Lovelace section into .codex/config.toml. The file is never
 * parsed or re-serialised as TOML: user content outside the markers is
 * preserved byte for byte. A pre-existing `[mcp_servers.lovelace]` table
 * outside the Lovelace markers would become a duplicate table if appended
 * to, which is invalid TOML, so that case reports a manual step with the
 * exact section instead of writing.
 */
function writeCodexConfig(root: string, options: CodexAssetOptions, result: CodexAssetResult): void {
  const dir = join(root, '.codex');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'config.toml');
  const section = codexConfigSection(options.mcpCommand);
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8');
    if (!existing.includes(TOML_SECTION_START) && existing.includes('[mcp_servers.lovelace]')) {
      result.manual.push(
        `.codex/config.toml already defines [mcp_servers.lovelace]; replace it with this Lovelace-managed section yourself:\n${section}`,
      );
      return;
    }
  }
  writeMarkerSection(path, section, result, '.codex/config.toml', '', { start: TOML_SECTION_START, end: TOML_SECTION_END });
}

/**
 * Writes the seven hook commands into .codex/hooks.json, mirroring
 * writeHooks in claude.ts exactly (same ensure/dedupe-by-command-string
 * logic, the same stale-helper migration via isStaleHelperCommand). The
 * file's top-level shape is `{ hooks: { <event>: [...] } }`, with no other
 * Lovelace-owned key, so every unrelated top-level key and every user hook
 * entry survives the merge. SessionEnd's entry carries `timeout: 3` (Codex
 * caps SessionEnd hooks at three seconds); no other entry does.
 */
function writeHooks(root: string, options: CodexAssetOptions, result: CodexAssetResult): void {
  const dir = join(root, '.codex');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'hooks.json');
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      result.manual.push('.codex/hooks.json exists but is not valid JSON; add the Lovelace hooks by hand (see docs).');
      return;
    }
  }
  const helper = hookCommandPrefix(options.helperCommand);
  const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
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
  // Same migration as claude.ts: drop a stale-format Lovelace hook (for
  // example a pre-fix Windows backslash path) so this install's ensure()
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
  const ensure = (event: string, matcher: string | undefined, command: string, timeout?: number) => {
    const list = (hooks[event] ?? []) as Array<{ matcher?: string; hooks: Array<{ command: string }> }>;
    const exists = list.some((h) => h.hooks?.some((x) => x.command === command));
    if (!exists) {
      const hook: { type: string; command: string; timeout?: number } = { type: 'command', command };
      if (timeout !== undefined) hook.timeout = timeout;
      const entry: { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> } = {
        hooks: [hook],
      };
      if (matcher !== undefined) entry.matcher = matcher;
      list.push(entry);
    }
    hooks[event] = list;
  };
  ensure('SessionStart', undefined, commands.digest);
  ensure('Stop', undefined, commands.sessionCheck);
  ensure('PreToolUse', 'Edit|Write', commands.guard);
  // The live-agent marker: written at turn start, cleared when a passing
  // stop lets the turn end or the session ends outright (ADR-0012).
  ensure('UserPromptSubmit', undefined, commands.presenceStart);
  // Codex caps SessionEnd hooks at three seconds, so this is the one entry
  // that carries an explicit timeout.
  ensure('SessionEnd', undefined, commands.presenceClear, 3);
  // Per-session active-ticket marker, so concurrent sessions do not share
  // the singleton slot that session-check enforces on Stop.
  ensure('PostToolUse', 'mcp__lovelace__set_active_ticket', commands.trackActive);
  // The heartbeat: refreshes every session's presence entry on every tool
  // call, so the ring survives between prompts without relying on a
  // started_at that never moves.
  ensure('PostToolUse', undefined, commands.presenceBeat);
  config.hooks = hooks;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  result.written.push('.codex/hooks.json');
}

/**
 * Writes the `ticket` and `done` skills: Codex's repo-shareable replacement
 * for slash commands (custom prompts are deprecated and user-level only).
 * Same steps as claude.ts's commands, reworded only where `$ARGUMENTS` has
 * no skill equivalent.
 */
function writeSkills(root: string, result: CodexAssetResult): void {
  const ticketDir = join(root, '.agents', 'skills', 'ticket');
  const doneDir = join(root, '.agents', 'skills', 'done');
  mkdirSync(ticketDir, { recursive: true });
  mkdirSync(doneDir, { recursive: true });
  writeFileSync(
    join(ticketDir, 'SKILL.md'),
    `---
name: ticket
description: Load a Lovelace ticket into context and start working it
---

Work the Lovelace ticket named in the invocation (for example \`$ticket T-0042\`):

1. Use the Lovelace query_tickets tool to load the ticket, then read its parent and every ticket in depends_on.
2. Use read_document on .lovelace/documentation/index.md and any documents the ticket references.
3. Use search to find the last two session records referencing this ticket and read their open questions.
4. Call set_active_ticket with the ticket ID.
5. If the ticket is not already in progress, move it with update_ticket to the status tagged \`agent: in_progress\`.
6. Summarise the ticket, its acceptance criteria and any open questions, then begin.
`,
  );
  writeFileSync(
    join(doneDir, 'SKILL.md'),
    `---
name: done
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
  result.written.push('.agents/skills/ticket/SKILL.md', '.agents/skills/done/SKILL.md');
}

export interface CodexInstallStatus {
  /** True when all three core pieces are present: mcp, hooks, commands. */
  installed: boolean;
  /** `.codex/config.toml` exists with an `[mcp_servers.lovelace]` table. */
  mcp: boolean;
  /** `.codex/hooks.json` exists with Lovelace hook commands. */
  hooks: boolean;
  /** `.agents/skills/ticket/SKILL.md` exists. */
  commands: boolean;
  /** Root `AGENTS.md` contains the Lovelace section marker. */
  agentsMd: boolean;
  /** `.lovelace/AGENTS.md` contains the Lovelace section marker. */
  lovelaceAgentsMd: boolean;
  /** `.git/hooks/prepare-commit-msg` exists and references Lovelace. */
  gitHook: boolean;
}

/**
 * Inspects on-disk assets to determine whether the Codex integration has
 * been installed for the given project root. Read-only and resilient to
 * malformed JSON or an unreadable .codex/config.toml (treats as not present
 * rather than throwing), mirroring detectClaudeAssets/detectOpenCodeAssets.
 */
export function detectCodexAssets(root: string): CodexInstallStatus {
  let mcp = false;
  const configPath = join(root, '.codex', 'config.toml');
  if (existsSync(configPath)) {
    try {
      mcp = readFileSync(configPath, 'utf8').includes('[mcp_servers.lovelace]');
    } catch {
      // unreadable file: treat as not present
    }
  }

  let hooks = false;
  const hooksPath = join(root, '.codex', 'hooks.json');
  if (existsSync(hooksPath)) {
    try {
      const raw = JSON.parse(readFileSync(hooksPath, 'utf8')) as { hooks?: unknown };
      if (raw.hooks) {
        const flat = JSON.stringify(raw.hooks);
        hooks = KNOWN_HELPER_SUFFIXES.some((suffix) => flat.includes(suffix));
      }
    } catch {
      // malformed JSON: treat as not present
    }
  }

  const commands = existsSync(join(root, '.agents', 'skills', 'ticket', 'SKILL.md'));
  const agentsMd = containsMarker(join(root, 'AGENTS.md'));
  const lovelaceAgentsMd = containsMarker(join(root, '.lovelace', 'AGENTS.md'));

  return {
    installed: mcp && hooks && commands,
    mcp,
    hooks,
    commands,
    agentsMd,
    lovelaceAgentsMd,
    gitHook: detectGitHook(root),
  };
}

export function installCodexAssets(root: string, options: CodexAssetOptions): CodexAssetResult {
  // Mirrors installClaudeAssets/installOpenCodeAssets: forward slashes only,
  // since a spaced Windows install path only needs quoting in hooks.json
  // (which runs through bash), never in config.toml or the skills, and
  // POSIX sidecar paths never contain a backslash, so this is a no-op on
  // macOS/Linux.
  const normalised: CodexAssetOptions = {
    ...options,
    mcpCommand: options.mcpCommand.replace(/\\/g, '/'),
    helperCommand: options.helperCommand.replace(/\\/g, '/'),
  };
  const result: CodexAssetResult = { written: [], manual: [] };
  refreshLovelaceAgentsMd(root, result);
  writeRootAgentsMd(root, result);
  writeCodexConfig(root, normalised, result);
  writeHooks(root, normalised, result);
  writeSkills(root, result);
  if (normalised.gitHook) writeGitHook(root, result);
  return result;
}
