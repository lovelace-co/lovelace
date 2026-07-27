import { describe, expect, it } from 'vitest';
import { createChangeGate } from '../src/state/change-gate';

describe('the change gate', () => {
  it('reloads immediately outside a mutation', () => {
    const gate = createChangeGate();
    expect(gate.onEvent()).toBe(true);
    expect(gate.onEvent()).toBe(true);
  });

  it('defers an event that arrives inside a mutation', () => {
    const gate = createChangeGate();
    gate.beginMutation();
    expect(gate.onEvent()).toBe(false);
  });

  it('collapses several deferred events into a single replay', () => {
    const gate = createChangeGate();
    gate.beginMutation();
    gate.onEvent();
    gate.onEvent();
    gate.onEvent();
    expect(gate.endMutation()).toBe(true);
    // Nothing left over: the same window does not replay twice.
    expect(gate.endMutation()).toBe(false);
  });

  it('does not reopen the gate until the outermost of two overlapping mutations ends', () => {
    const gate = createChangeGate();
    gate.beginMutation();
    gate.beginMutation();
    // The inner end does not report a replay: one window is still open.
    expect(gate.endMutation()).toBe(false);
    // Still gated: an echo mid-second-mutation must not reload immediately
    // and overwrite its optimistic snapshot.
    expect(gate.onEvent()).toBe(false);
    // The outer end fully closes the window and replays what was deferred.
    expect(gate.endMutation()).toBe(true);
  });

  it('carries a pending event across a back-to-back second mutation', () => {
    const gate = createChangeGate();
    gate.beginMutation();
    expect(gate.onEvent()).toBe(false);
    // A second mutation starts before the first's deferred event has been
    // replayed; it must not wipe the pending state.
    gate.beginMutation();
    expect(gate.endMutation()).toBe(false);
    expect(gate.endMutation()).toBe(true);
  });

  it('has nothing to replay when no events arrived', () => {
    const gate = createChangeGate();
    gate.beginMutation();
    expect(gate.endMutation()).toBe(false);
  });
});
