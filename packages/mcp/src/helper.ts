#!/usr/bin/env node
/**
 * The headless agent helper that Claude Code hooks invoke. Not a
 * user-facing CLI: it exposes exactly what the hooks need.
 *
 *   lovelace-agent digest          SessionStart: print the orientation digest.
 *   lovelace-agent session-check   Stop: exit 2 with a prompt on stderr when
 *                                  the active ticket is unresolved, no session
 *                                  record exists, or the work is marked
 *                                  complete but the ticket was never moved on.
 *                                  Scoped to the calling session's marker
 *                                  when the stdin payload carries a
 *                                  session_id; falls back to the singleton
 *                                  active_ticket otherwise. Clears this
 *                                  session's presence entry when the stop
 *                                  passes; leaves it when the stop blocks, so
 *                                  the next beat sustains the ring.
 *   lovelace-agent guard           PreToolUse: read the tool call JSON from
 *                                  stdin; exit 2 when it edits files under
 *                                  .lovelace/tickets/.
 *   lovelace-agent presence-start  UserPromptSubmit: write this session's
 *                                  live marker (state/presence/<session-id>.json).
 *   lovelace-agent presence-beat   PostToolUse, every tool: refresh this
 *                                  session's marker so a working agent stays
 *                                  live between prompts.
 *   lovelace-agent presence-clear  SessionEnd: remove this session's marker
 *                                  and its active-ticket marker.
 *   lovelace-agent track-active    PostToolUse (set_active_ticket): record
 *                                  the calling session's active ticket in
 *                                  state/active/<session-id>.
 *
 * Every presence command falls back to a shared 'local' session id when the
 * hook payload carries no session_id (a TTY, or a manual run).
 *
 * Errors to stderr, data to stdout. The repo root comes from LOVELACE_ROOT
 * or the working directory.
 */
import {
  beatPresence,
  buildDigest,
  clearPresence,
  getActiveTicket,
  loadProject,
  readSessionActiveTicket,
  writePresence,
  writeSessionActiveTicket,
} from '@lovelace/core';

function root(): string {
  return process.env.LOVELACE_ROOT ?? process.cwd();
}

/** The JSON payload Claude Code delivers on stdin to every hook command. */
interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { id?: string | null; [key: string]: unknown };
}

function digest(): number {
  const project = loadProject(root());
  let out = buildDigest(project);
  const active = getActiveTicket(root());
  if (active) {
    out += `\nActive ticket: ${active}\n`;
  }
  process.stdout.write(out);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Reads and parses the hook payload Claude Code delivers on stdin. Never
 * throws or blocks waiting on a terminal: a TTY, empty input or unparseable
 * JSON all resolve to null.
 */
async function readHookPayload(): Promise<HookPayload | null> {
  if (process.stdin.isTTY) return null;
  let raw: string;
  try {
    // A harness that pipes stdin but never closes it must not hang the
    // hook; after the timeout the payload is treated as absent.
    raw = await Promise.race([
      readStdin(),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000).unref()),
    ]);
  } catch {
    return null;
  }
  if (raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return null;
  }
}

function evaluateActiveTicket(r: string, active: string | null): number {
  if (!active) return 0;
  const project = loadProject(r);
  const ticket = project.tickets.find((t) => t.id === active);
  if (!ticket) return 0;
  const status = project.schema.statuses.find((s) => s.name === ticket.status);
  const stillOpen = status !== undefined && status.agent !== 'complete';
  if (!stillOpen) return 0; // already marked complete: nothing to resolve

  const records = project.sessions.filter((s) => s.ticket === active);
  // The status tagged agent: in_progress is the one work sits in while active.
  const stillInProgress = status?.agent === 'in_progress';

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

/**
 * Stop: block with a prompt when the active ticket is unresolved. When the
 * stdin payload carries a session_id, enforcement is scoped to that
 * session's own marker (state/active/<session-id>); a missing marker means
 * this session never claimed a ticket, so it passes. With no session_id
 * (manual invocation, or an older harness) the singleton active_ticket
 * applies, unchanged from before. When the stop passes, this session's
 * presence entry is cleared here too, since a session has many stops but
 * only the passing one actually ends the turn; a blocked stop leaves
 * presence alone so the next beat sustains the ring.
 */
async function sessionCheck(): Promise<number> {
  const r = root();
  try {
    const payload = await readHookPayload();
    const active = payload?.session_id ? readSessionActiveTicket(r, payload.session_id) : getActiveTicket(r);
    const result = evaluateActiveTicket(r, active);
    if (result === 0) {
      try {
        clearPresence(r, payload?.session_id ?? 'local');
      } catch {
        // Quiet: never fail an allowed stop over a presence clear.
      }
    }
    return result;
  } catch (e) {
    // The guard fails open: an internal error (an unloadable project, a
    // hostile payload) must never trap a session at its stop.
    process.stderr.write(`session-check skipped: ${e instanceof Error ? e.message : String(e)}\n`);
    return 0;
  }
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
 * PostToolUse on set_active_ticket: records the calling session's active
 * ticket in state/active/<session-id>, so session-check can enforce it
 * without colliding with other concurrent sessions. Quiet on every failure
 * path, like presence-start; a broken tracker must never break a session.
 */
async function trackActive(): Promise<number> {
  try {
    const payload = await readHookPayload();
    if (payload?.session_id && payload.tool_name === 'mcp__lovelace__set_active_ticket' && payload.tool_input) {
      // Only the tool's two legal shapes act: a string sets, null clears.
      // Anything else (absent, a number, an object) is a malformed payload
      // and must neither write a garbage marker nor clear a real one.
      const id = payload.tool_input.id;
      if (id === null || typeof id === 'string') {
        writeSessionActiveTicket(root(), payload.session_id, id);
      }
    }
  } catch {
    // Same stance as presence-start: never block on a broken tracker.
  }
  return 0;
}

/**
 * The turn has begun processing: write this session's live marker. Quiet
 * on every failure path; presence is a display signal, never worth
 * blocking a turn.
 */
async function presenceStart(): Promise<number> {
  try {
    const r = root();
    const payload = await readHookPayload();
    const sessionId = payload?.session_id ?? 'local';
    const project = loadProject(r);
    const actor = project.actors.find((a) => a.kind === 'agent')?.id ?? null;
    const ticket = readSessionActiveTicket(r, sessionId) ?? getActiveTicket(r);
    const now = `${new Date().toISOString().slice(0, 19)}Z`;
    writePresence(r, sessionId, { ticket, actor, started_at: now, beat_at: now });
  } catch {
    // Not a Lovelace project, or unreadable: nothing to mark.
  }
  return 0;
}

/**
 * PostToolUse, every tool: refreshes this session's heartbeat so an agent
 * mid-turn stays live between prompts. Deliberately the lightest presence
 * path (see core's beatPresence, which skips loadProject); quiet on every
 * failure, same stance as presence-start, since this runs on every tool
 * call.
 */
async function presenceBeat(): Promise<number> {
  try {
    const payload = await readHookPayload();
    beatPresence(root(), payload?.session_id ?? 'local');
  } catch {
    // Never block a turn over a heartbeat.
  }
  return 0;
}

/**
 * SessionEnd: remove this session's live marker and its active-ticket
 * marker. Stop no longer calls this (session-check folds the presence
 * clear in when a stop passes); kept safe if invoked manually all the same.
 */
async function presenceClear(): Promise<number> {
  const r = root();
  const payload = await readHookPayload();
  try {
    clearPresence(r, payload?.session_id ?? 'local');
  } catch {
    // Same stance as presence-start: never block an ending turn.
  }
  try {
    if (payload?.hook_event_name === 'SessionEnd' && payload.session_id) {
      writeSessionActiveTicket(r, payload.session_id, null);
    }
  } catch {
    // Same stance: never block an ending turn.
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
      process.exitCode = await sessionCheck();
      break;
    case 'guard':
      process.exitCode = await guard();
      break;
    case 'presence-start':
      process.exitCode = await presenceStart();
      break;
    case 'presence-beat':
      process.exitCode = await presenceBeat();
      break;
    case 'presence-clear':
      process.exitCode = await presenceClear();
      break;
    case 'track-active':
      process.exitCode = await trackActive();
      break;
    default:
      process.stderr.write(
        'usage: lovelace-agent <digest|session-check|guard|presence-start|presence-beat|presence-clear|track-active>\n',
      );
      process.exitCode = 64;
  }
})();
