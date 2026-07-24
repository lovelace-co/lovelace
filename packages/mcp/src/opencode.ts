/**
 * Writes the OpenCode integration assets into a user's project: the
 * opencode.json merge (the MCP entry and the instructions array), a
 * marker-delimited section in the root AGENTS.md, the shared
 * `.lovelace/AGENTS.md` refresh, slash commands, the Lovelace-managed
 * `.opencode/plugins/lovelace.js` launcher plugin, and the opt-in
 * prepare-commit-msg Git hook. Mirrors claude.ts (see ADR-0014); everything
 * is additive, existing files are merged into or appended to, never
 * overwritten outside their Lovelace-owned sections.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AssetResult,
  containsMarker,
  detectGitHook,
  mergeJsonFile,
  parseCommand,
  refreshLovelaceAgentsMd,
  SECTION_END,
  SECTION_START,
  writeGitHook,
  writeMarkerSection,
} from './assets.js';

export interface OpenCodeAssetOptions {
  /** Command (absolute path or name on PATH) for the MCP server binary. */
  mcpCommand: string;
  /** Command for the agent helper binary. */
  helperCommand: string;
  /** Install the prepare-commit-msg Git hook (opt-in). */
  gitHook?: boolean;
}

export type OpenCodeAssetResult = AssetResult;

/** The Lovelace marker OpenCode's launcher plugin carries, so a reinstall (and detection) recognise it as Lovelace-owned. */
export const OPENCODE_PLUGIN_MARKER = '// Lovelace launcher plugin (managed by Lovelace; do not edit)';

/**
 * The root AGENTS.md block is a pointer, not a manual: OpenCode reads
 * AGENTS.md natively but has no `@path` include syntax, so this section
 * only points at the Lovelace instruction file; `.lovelace/AGENTS.md`
 * itself also rides into context through the `instructions` entry in
 * opencode.json.
 */
export function openCodeAgentsMdSection(): string {
  return `${SECTION_START}
## Lovelace

This project uses Lovelace; its tickets, documents and session history live in \`.lovelace/\`. Before any work, read and follow \`.lovelace/AGENTS.md\` (also loaded automatically through the \`instructions\` entry in \`opencode.json\`).
${SECTION_END}
`;
}

function writeRootAgentsMd(root: string, result: OpenCodeAssetResult): void {
  writeMarkerSection(join(root, 'AGENTS.md'), openCodeAgentsMdSection(), result, 'AGENTS.md', '# AGENTS.md\n\n');
}

/**
 * Builds the OpenCode `mcp.lovelace` entry: `command` is an argv array, the
 * same split `parseCommand` gives Claude's `.mcp.json` (a bare path becomes
 * a single-element array, the dev `node script.js` form becomes two).
 */
function buildMcpEntry(mcpCommand: string): { type: 'local'; command: string[]; enabled: true; environment: { LOVELACE_ROOT: string } } {
  const { command, args } = parseCommand(mcpCommand);
  return { type: 'local', command: [command, ...args], enabled: true, environment: { LOVELACE_ROOT: '.' } };
}

/**
 * Merges the Lovelace MCP entry and the `.lovelace/AGENTS.md` instructions
 * entry into opencode.json. OpenCode allows JSONC, but this merge only ever
 * reads and edits a file that parses as strict JSON; a file using JSONC
 * comments or trailing commas is treated the same as malformed JSON, and
 * the manual step is offered instead of risking a rewrite that drops the
 * user's comments.
 */
function writeOpenCodeJson(root: string, options: OpenCodeAssetOptions, result: OpenCodeAssetResult): void {
  const path = join(root, 'opencode.json');
  const entry = buildMcpEntry(options.mcpCommand);
  mergeJsonFile<{ mcp?: Record<string, unknown>; instructions?: unknown[] }>(
    path,
    (config) => {
      const instructions = Array.isArray(config.instructions) ? [...config.instructions] : [];
      if (!instructions.includes('.lovelace/AGENTS.md')) instructions.push('.lovelace/AGENTS.md');
      return { ...config, mcp: { ...config.mcp, lovelace: entry }, instructions };
    },
    result,
    'opencode.json',
    `opencode.json exists but is not valid JSON (or uses JSONC); add a "lovelace" entry yourself: ${JSON.stringify({ mcp: { lovelace: entry }, instructions: ['.lovelace/AGENTS.md'] })}`,
  );
}

function writeCommands(root: string, result: OpenCodeAssetResult): void {
  const dir = join(root, '.opencode', 'commands');
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
  result.written.push('.opencode/commands/ticket.md', '.opencode/commands/done.md');
}

/**
 * Renders the Lovelace-managed OpenCode plugin, wholly regenerated on every
 * install. Plain JavaScript (it runs under Bun, not through tsc): the
 * helper argv is embedded at install time (forward slashes, no shell), and
 * every hook adapts OpenCode's payload shape to the same subcommands and
 * stdin JSON the Claude Code hooks send, so the helper binary itself never
 * changes. Hook parameter shapes for `tool.execute.before/after` and
 * `chat.message` vary across OpenCode's plugin documentation snapshots
 * (`args` on the input object versus the output object, `sessionID` versus
 * `session_id`); the template reads defensively from either side rather
 * than assuming one exact shape, so a minor OpenCode payload change degrades
 * to a no-op instead of a thrown error.
 */
export function lovelacePluginSource(helperArgv: string[]): string {
  const argvLiteral = JSON.stringify(helperArgv);
  return `${OPENCODE_PLUGIN_MARKER}
// Regenerated in full on every OpenCode integration reinstall; do not hand-edit.

import { spawn } from 'node:child_process';

// The Lovelace agent helper's argv, embedded at install time. Forward
// slashes only, so the same file works unmodified on Windows.
const HELPER_ARGV = ${argvLiteral};

const HELPER_TIMEOUT_MS = 10000;

class GuardBlocked extends Error {}

export const LovelacePlugin = async ({ directory }) => {
  const seenSessions = new Set();
  const pendingReminders = new Map();

  // Spawns the helper with \`argv\` appended to HELPER_ARGV, writes \`payload\`
  // as JSON on stdin, and collects stdout/stderr/exit code. Never throws: a
  // missing helper binary or a spawn failure resolves with exit code -1, so
  // a broken install never breaks the user's OpenCode session.
  function runHelper(argv, payload) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      let child;
      try {
        child = spawn(HELPER_ARGV[0], [...HELPER_ARGV.slice(1), ...argv], {
          cwd: directory,
          env: { ...process.env, LOVELACE_ROOT: directory },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        finish({ code: -1, stdout: '', stderr: '' });
        return;
      }
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
        finish({ code: -1, stdout, stderr });
      }, HELPER_TIMEOUT_MS);
      child.on('error', () => {
        clearTimeout(timer);
        finish({ code: -1, stdout, stderr });
      });
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish({ code: code ?? -1, stdout, stderr });
      });
      try {
        child.stdin?.write(JSON.stringify(payload ?? {}));
        child.stdin?.end();
      } catch {
        // Ignore write failures; the close/error handlers still resolve.
      }
    });
  }

  function sessionIdOf(input, output) {
    return input?.sessionID ?? input?.session_id ?? output?.sessionID ?? output?.session_id;
  }

  return {
    'chat.message': async (input, output) => {
      try {
        const sessionID = sessionIdOf(input, output);
        if (!sessionID) return;
        void runHelper(['presence-start'], { session_id: sessionID });
        const parts = output?.parts;
        if (!Array.isArray(parts)) return;
        if (!seenSessions.has(sessionID)) {
          seenSessions.add(sessionID);
          const digest = await runHelper(['digest'], {});
          if (digest.stdout) {
            parts.push({ type: 'text', text: \`Lovelace project digest:\\n\${digest.stdout}\` });
          }
        }
        const reminder = pendingReminders.get(sessionID);
        if (reminder) {
          pendingReminders.delete(sessionID);
          parts.unshift({ type: 'text', text: reminder });
        }
      } catch {
        // A broken digest or presence marker must never break a chat turn.
      }
    },
    'tool.execute.before': async (input, output) => {
      try {
        const tool = String(input?.tool ?? '').toLowerCase();
        if (tool !== 'edit' && tool !== 'write') return;
        const args = output?.args ?? input?.args ?? {};
        const path = args.filePath ?? args.file_path;
        if (!path) return;
        const result = await runHelper(['guard'], { tool_input: { file_path: path } });
        if (result.code === 2) {
          throw new GuardBlocked(result.stderr || 'Blocked by the Lovelace guard.');
        }
      } catch (err) {
        if (err instanceof GuardBlocked) throw new Error(err.message);
        // Any other failure (a missing helper, a malformed payload) must
        // never block an edit the guard itself would have allowed.
      }
    },
    'tool.execute.after': async (input, output) => {
      try {
        const sessionID = sessionIdOf(input, output);
        if (sessionID) void runHelper(['presence-beat'], { session_id: sessionID });
        const tool = String(input?.tool ?? '');
        if (tool.includes('set_active_ticket')) {
          const args = output?.args ?? input?.args ?? {};
          void runHelper(['track-active'], {
            session_id: sessionID,
            tool_name: 'mcp__lovelace__set_active_ticket',
            tool_input: { id: args.id ?? null },
          });
        }
      } catch {
        // Presence and active-ticket tracking are best-effort.
      }
    },
    event: async ({ event }) => {
      try {
        const sessionID = event?.properties?.sessionID ?? event?.properties?.info?.id;
        if (!sessionID) return;
        if (event?.type === 'session.idle') {
          const result = await runHelper(['session-check'], { session_id: sessionID });
          if (result.code === 2) {
            pendingReminders.set(sessionID, result.stderr);
          }
        } else if (event?.type === 'session.deleted') {
          void runHelper(['presence-clear'], { session_id: sessionID, hook_event_name: 'SessionEnd' });
        }
      } catch {
        // OpenCode has no session-end guarantee; best effort only.
      }
    },
  };
};
`;
}

function writePlugin(root: string, options: OpenCodeAssetOptions, result: OpenCodeAssetResult): void {
  const dir = join(root, '.opencode', 'plugins');
  mkdirSync(dir, { recursive: true });
  const { command, args } = parseCommand(options.helperCommand);
  writeFileSync(join(dir, 'lovelace.js'), lovelacePluginSource([command, ...args]));
  result.written.push('.opencode/plugins/lovelace.js');
}

export interface OpenCodeInstallStatus {
  /** True when all three core pieces are present: mcp, hooks, commands. */
  installed: boolean;
  /** `opencode.json` exists with an `mcp.lovelace` entry (strict JSON only). */
  mcp: boolean;
  /** `.opencode/plugins/lovelace.js` exists and carries the Lovelace marker. */
  hooks: boolean;
  /** `.opencode/commands/ticket.md` exists. */
  commands: boolean;
  /** Root `AGENTS.md` contains the Lovelace section marker. */
  agentsMd: boolean;
  /** `.lovelace/AGENTS.md` contains the Lovelace section marker. */
  lovelaceAgentsMd: boolean;
  /** `.git/hooks/prepare-commit-msg` exists and references Lovelace. */
  gitHook: boolean;
}

/**
 * Inspects on-disk assets to determine whether the OpenCode integration has
 * been installed for the given project root. Read-only and resilient to
 * malformed or JSONC opencode.json (treats as not present rather than
 * throwing), mirroring detectClaudeAssets.
 */
export function detectOpenCodeAssets(root: string): OpenCodeInstallStatus {
  let mcp = false;
  const mcpPath = join(root, 'opencode.json');
  if (existsSync(mcpPath)) {
    try {
      const raw = JSON.parse(readFileSync(mcpPath, 'utf8')) as { mcp?: Record<string, unknown> };
      mcp = typeof raw.mcp === 'object' && raw.mcp !== null && 'lovelace' in raw.mcp;
    } catch {
      // malformed (or JSONC) JSON: treat as not present
    }
  }

  const hooks = containsMarker(join(root, '.opencode', 'plugins', 'lovelace.js'), OPENCODE_PLUGIN_MARKER);
  const commands = existsSync(join(root, '.opencode', 'commands', 'ticket.md'));
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

export function installOpenCodeAssets(root: string, options: OpenCodeAssetOptions): OpenCodeAssetResult {
  // Mirrors installClaudeAssets: forward slashes only, since the plugin
  // spawns the helper directly (no shell), opencode.json's command array
  // needs no shell quoting either way, and POSIX sidecar paths never
  // contain a backslash, so this is a no-op on macOS/Linux.
  const normalised: OpenCodeAssetOptions = {
    ...options,
    mcpCommand: options.mcpCommand.replace(/\\/g, '/'),
    helperCommand: options.helperCommand.replace(/\\/g, '/'),
  };
  const result: OpenCodeAssetResult = { written: [], manual: [] };
  refreshLovelaceAgentsMd(root, result);
  writeRootAgentsMd(root, result);
  writeOpenCodeJson(root, normalised, result);
  writePlugin(root, normalised, result);
  writeCommands(root, result);
  if (normalised.gitHook) writeGitHook(root, result);
  return result;
}
