#!/usr/bin/env node
/**
 * The headless agent helper that Claude Code hooks invoke. Not a
 * user-facing CLI: it exposes exactly what the hooks need.
 *
 *   lovelace-agent digest          SessionStart: print the orientation digest
 *                                  plus any queued automation instructions.
 *   lovelace-agent session-check   Stop: exit 2 with a prompt on stderr when
 *                                  the active ticket is unresolved, no session
 *                                  record exists, or the work is marked
 *                                  complete but the ticket was never moved on.
 *   lovelace-agent guard           PreToolUse: read the tool call JSON from
 *                                  stdin; exit 2 when it edits files under
 *                                  .lovelace/tickets/.
 *   lovelace-agent presence-start  UserPromptSubmit: mark the agent as
 *                                  processing (state/presence.json).
 *   lovelace-agent presence-clear  Stop and SessionEnd: remove the marker.
 *
 * Errors to stderr, data to stdout. The repo root comes from LOVELACE_ROOT
 * or the working directory.
 */
import { buildDigest, clearPresence, getActiveTicket, loadProject, writePresence } from '@lovelace/core';
import { drainAgentInstructions } from './actions.js';

function root(): string {
  return process.env.LOVELACE_ROOT ?? process.cwd();
}

function digest(): number {
  const project = loadProject(root());
  let out = buildDigest(project);
  const instructions = drainAgentInstructions(root());
  if (instructions.length > 0) {
    out += `\nAutomation instructions (act on these):\n${instructions.map((i) => `  - ${i}`).join('\n')}\n`;
  }
  const active = getActiveTicket(root());
  if (active) {
    out += `\nActive ticket: ${active}\n`;
  }
  process.stdout.write(out);
  return 0;
}

function sessionCheck(): number {
  const r = root();
  const active = getActiveTicket(r);
  if (!active) return 0;
  const project = loadProject(r);
  const ticket = project.tickets.find((t) => t.id === active);
  if (!ticket) return 0;
  const status = project.workflow.statuses.find((s) => s.name === ticket.status);
  const stillOpen = status !== undefined && status.complete !== true;
  if (!stillOpen) return 0; // already in a terminal status: nothing to resolve

  const records = project.sessions.filter((s) => s.ticket === active);
  // The first active status is "in progress": work that has not been moved on.
  const firstActive = project.workflow.statuses.find((s) => s.active)?.name;
  const stillInProgress = ticket.status === firstActive;

  if (records.length === 0) {
    process.stderr.write(
      `No session record exists for the active ticket ${active}. Before finishing, call the Lovelace log_session tool with your approach, what happened, the outcome, commit SHAs and any open questions` +
        (stillInProgress
          ? `, and move ${active} with update_ticket to the status that matches the outcome (a review status if the work is done, an earlier status with a comment if you need human input).`
          : `.`) +
        `\n`,
    );
    return 2;
  }

  // A record exists, but the ticket is still in progress while the latest
  // session says the work is done: the agent forgot to move it on.
  const latest = [...records].sort((a, b) => b.ended.localeCompare(a.ended))[0];
  if (stillInProgress && latest?.outcome === 'completed') {
    process.stderr.write(
      `The active ticket ${active} is still in progress, but your latest session record marks the work completed. Move ${active} with update_ticket to a review status (or the status that matches the outcome) before finishing.\n`,
    );
    return 2;
  }
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function guard(): Promise<number> {
  const raw = await readStdin();
  let input: { tool_name?: string; tool_input?: { file_path?: string } };
  try {
    input = JSON.parse(raw) as typeof input;
  } catch {
    return 0;
  }
  const path = input.tool_input?.file_path ?? '';
  if (/\.lovelace\/tickets\//.test(path)) {
    process.stderr.write(
      'Ticket files are managed through the Lovelace MCP tools (create_ticket, update_ticket), not direct edits. Use those tools instead; documents under .lovelace/documentation/ remain directly editable.\n',
    );
    return 2;
  }
  return 0;
}

/**
 * The turn has begun processing: write the live marker. Quiet on every
 * failure path; presence is a display signal, never worth blocking a turn.
 */
function presenceStart(): number {
  try {
    const r = root();
    const project = loadProject(r);
    const actor = project.actors.find((a) => a.kind === 'agent')?.id ?? null;
    writePresence(r, {
      ticket: getActiveTicket(r),
      actor,
      started_at: `${new Date().toISOString().slice(0, 19)}Z`,
    });
  } catch {
    // Not a Lovelace project, or unreadable: nothing to mark.
  }
  return 0;
}

/** The turn or session has ended: remove the live marker. */
function presenceClear(): number {
  try {
    clearPresence(root());
  } catch {
    // Same stance as presence-start: never block an ending turn.
  }
  return 0;
}

const command = process.argv[2];
(async () => {
  switch (command) {
    case 'digest':
      process.exitCode = digest();
      break;
    case 'session-check':
      process.exitCode = sessionCheck();
      break;
    case 'guard':
      process.exitCode = await guard();
      break;
    case 'presence-start':
      process.exitCode = presenceStart();
      break;
    case 'presence-clear':
      process.exitCode = presenceClear();
      break;
    default:
      process.stderr.write('usage: lovelace-agent <digest|session-check|guard|presence-start|presence-clear>\n');
      process.exitCode = 64;
  }
})();
