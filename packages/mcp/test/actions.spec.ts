import { describe, expect, it, afterEach } from 'vitest';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { updateTicket } from '@lovelace/core';
import {
  drainAgentInstructions,
  readActionLog,
  recordTransitionOutcome,
  testTransition,
} from '../src/actions.js';
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

/** Adds a run rule that writes a marker file, so execution is observable. */
function addRunRule(root: string, to: string, command: string) {
  const wf = join(root, '.lovelace/workflow.yaml');
  const text = readFileSync(wf, 'utf8').replace(
    'on_transition:',
    `on_transition:\n  - when: { to: ${to} }\n    run: ${command}`,
  );
  writeFileSync(wf, text);
}

describe('transition automation', () => {
  it('an agent move returns the agent instruction inline and logs it', async () => {
    const root = fixture();
    await updateTicket(root, 'T-0002', { status: 'in_review' });
    const result = await updateTicket(root, 'T-0002', { status: 'staging' });
    const outcome = recordTransitionOutcome(root, result, 'claude');
    expect(outcome.instructions).toEqual([result.firedRules[0]?.rule.agent]);
    expect(outcome.queued).toHaveLength(0);
    expect(readActionLog(root)).toContain('agent in_review->staging');
  });

  it('a human move queues the agent instruction for the next session, drained once', async () => {
    const root = fixture();
    await updateTicket(root, 'T-0002', { status: 'in_review' });
    const result = await updateTicket(root, 'T-0002', { status: 'staging' });
    const outcome = recordTransitionOutcome(root, result, 'ada');
    expect(outcome.instructions).toHaveLength(0);
    expect(outcome.queued).toHaveLength(1);
    const drained = drainAgentInstructions(root);
    expect(drained).toHaveLength(1);
    expect(drained[0]).toContain('Deploy');
    expect(drainAgentInstructions(root)).toHaveLength(0);
    expect(readActionLog(root)).toContain('agent-queued');
  });

  it('run actions execute from the repo root with LOVELACE_* env and log output', async () => {
    const root = fixture();
    addRunRule(root, 'todo', './emit.sh');
    writeFileSync(join(root, 'emit.sh'), '#!/bin/sh\necho "ticket=$LOVELACE_ID title=$LOVELACE_TITLE" > marker.txt\n');
    chmodSync(join(root, 'emit.sh'), 0o755);
    await updateTicket(root, 'T-0003', { status: 'in_progress' });
    const back = await updateTicket(root, 'T-0003', { status: 'todo' });
    const outcome = recordTransitionOutcome(root, back, 'ada');
    expect(outcome.executed).toHaveLength(1);
    expect(outcome.executed[0]?.exitCode).toBe(0);
    expect(readFileSync(join(root, 'marker.txt'), 'utf8')).toContain('ticket=T-0003');
    expect(readFileSync(join(root, 'marker.txt'), 'utf8')).toContain('title=Location search endpoint');
    expect(readActionLog(root)).toContain('./emit.sh');
  });

  it('failed run actions never roll back the transition and report exit code with log tail', async () => {
    const root = fixture();
    addRunRule(root, 'in_progress', './explode.sh');
    writeFileSync(join(root, 'explode.sh'), '#!/bin/sh\necho boom >&2\nexit 7\n');
    chmodSync(join(root, 'explode.sh'), 0o755);
    const result = await updateTicket(root, 'T-0003', { status: 'in_progress' });
    const outcome = recordTransitionOutcome(root, result, 'ada');
    expect(outcome.executed[0]?.exitCode).toBe(7);
    expect(outcome.executed[0]?.logTail).toContain('boom');
    // Transition is fact: the ticket stays in in_progress.
    expect(result.ticket.status).toBe('in_progress');
    expect(readActionLog(root)).toContain('exit=7');
  });

  it('dry run reports which rules would fire without executing anything', () => {
    const root = fixture();
    const rules = testTransition(root, 'T-0002', 'staging');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.agent).toContain('Deploy');
    expect(readActionLog(root)).toBe('');
    expect(testTransition(root, 'T-0004', 'staging')).toHaveLength(0); // bug, rule matches tasks
  });
});
