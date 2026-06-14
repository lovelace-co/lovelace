/**
 * Transition automation execution. Rules are matched by core; this module
 * decides what happens to each fired rule and records every run in
 * .lovelace/index/actions.log so each instance can be traced:
 *
 * - "run" rules execute a shell command from the repo root with the ticket's
 *   frontmatter exposed as LOVELACE_* environment variables.
 * - "agent" rules produce an instruction: returned inline when the agent made
 *   the move (it acts in the same session), or queued in
 *   .lovelace/state/agent_instructions.json when a human made it (delivered at
 *   the next session start by the digest hook).
 *
 * Failed actions never roll back the transition; output and exit codes are
 * appended to actions.log.
 */
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadProject,
  matchRules,
  type AutomationRule,
  type Ticket,
  type UpdateResult,
} from '@lovelace/core';

export interface ActionRunResult {
  kind: 'run';
  command: string;
  exitCode: number;
  logTail: string;
}

export interface TransitionOutcome {
  /** Agent instructions to act on now (the agent made the move). */
  instructions: string[];
  /** Agent instructions queued for the next session (a human made the move). */
  queued: string[];
  /** Shell commands executed, with their results. */
  executed: ActionRunResult[];
}

function logFile(root: string): string {
  return join(root, '.lovelace', 'index', 'actions.log');
}

function instructionQueue(root: string): string {
  return join(root, '.lovelace', 'state', 'agent_instructions.json');
}

function stamp(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

function appendLog(root: string, lines: string[]): void {
  mkdirSync(join(root, '.lovelace', 'index'), { recursive: true });
  appendFileSync(logFile(root), `${lines.join('\n')}\n`);
}

export function readActionLog(root: string, maxChars = 20000): string {
  const file = logFile(root);
  if (!existsSync(file)) return '';
  const text = readFileSync(file, 'utf8');
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function ticketEnv(ticket: Ticket): Record<string, string> {
  const env: Record<string, string> = {
    LOVELACE_ID: ticket.id,
    LOVELACE_TYPE: ticket.type,
    LOVELACE_STATUS: ticket.status,
  };
  for (const [key, value] of Object.entries(ticket.fields)) {
    env[`LOVELACE_${key.toUpperCase()}`] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return env;
}

export function executeRunAction(
  root: string,
  ticket: Ticket,
  command: string,
  context: string,
): ActionRunResult {
  let exitCode = 0;
  let output = '';
  try {
    output = execSync(command, {
      cwd: root,
      env: { ...process.env, ...ticketEnv(ticket) },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    exitCode = err.status ?? 1;
    output = `${err.stdout ?? ''}${err.stderr ?? ''}${err.status === undefined ? (err.message ?? '') : ''}`;
  }
  appendLog(root, [`--- ${stamp()} run ${context} ${ticket.id} exit=${exitCode}`, `$ ${command}`, output.trimEnd()]);
  const logTail = output.split('\n').slice(-10).join('\n').trim();
  return { kind: 'run', command, exitCode, logTail };
}

function actorKind(root: string, actor: string | undefined): 'human' | 'agent' {
  if (!actor) return 'human';
  const project = loadProject(root);
  return project.actors.find((a) => a.id === actor)?.kind ?? 'human';
}

/** Queues an agent instruction for the next session start, and logs the instance. */
function enqueueAgentInstruction(root: string, ticketId: string, instruction: string, context: string): void {
  mkdirSync(join(root, '.lovelace', 'state'), { recursive: true });
  const queue = instructionQueue(root);
  const existing = existsSync(queue) ? (JSON.parse(readFileSync(queue, 'utf8')) as string[]) : [];
  writeFileSync(queue, `${JSON.stringify([...existing, `[${ticketId}] ${instruction}`], null, 2)}\n`);
  appendLog(root, [`--- ${stamp()} agent-queued ${context} ${ticketId}`, instruction]);
}

/**
 * Applies automation to the rules a transition fired, recording each instance
 * in actions.log. Run actions execute now; agent instructions are returned to
 * an agent actor to act on immediately, or queued for a human's next session.
 */
export function recordTransitionOutcome(
  root: string,
  result: UpdateResult,
  actor: string | undefined,
): TransitionOutcome {
  const outcome: TransitionOutcome = { instructions: [], queued: [], executed: [] };
  if (result.firedRules.length === 0) return outcome;
  const isAgent = actorKind(root, actor) === 'agent';

  for (const fired of result.firedRules) {
    const rule = fired.rule;
    const context = `${fired.from}->${fired.to}`;
    if (rule.run !== undefined) {
      outcome.executed.push(executeRunAction(root, result.ticket, rule.run, context));
    } else if (rule.agent !== undefined) {
      if (isAgent) {
        outcome.instructions.push(rule.agent);
        appendLog(root, [`--- ${stamp()} agent ${context} ${result.ticket.id}`, rule.agent]);
      } else {
        enqueueAgentInstruction(root, result.ticket.id, rule.agent, context);
        outcome.queued.push(rule.agent);
      }
    }
  }
  return outcome;
}

/** Instructions queued for the agent, consumed at session start by the digest hook. */
export function drainAgentInstructions(root: string): string[] {
  const queue = instructionQueue(root);
  if (!existsSync(queue)) return [];
  try {
    const items = JSON.parse(readFileSync(queue, 'utf8')) as string[];
    writeFileSync(queue, '[]\n');
    return items;
  } catch {
    return [];
  }
}

/** Dry run: which rules would fire if the ticket moved to the given status. */
export function testTransition(root: string, ticketId: string, to: string): AutomationRule[] {
  const project = loadProject(root);
  const ticket = project.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket "${ticketId}" does not exist`);
  const simulated: Ticket = { ...ticket, status: to };
  return matchRules(project.workflow, simulated, ticket.status, to);
}
