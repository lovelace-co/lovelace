import { describe, expect, it } from 'vitest';
import {
  STILL,
  changedTicketIds,
  decay,
  glowFor,
  isAwake,
  observeChange,
} from '../src/lib/presence';
import type { Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const base = fixture as unknown as Snapshot;

function withTicketUpdated(snap: Snapshot, id: string, updated: string): Snapshot {
  return {
    ...snap,
    index: {
      ...snap.index,
      tickets: snap.index.tickets.map((t) => (t.id === id ? { ...t, updated } : t)),
    },
  };
}

const NOW = 1_000_000;

describe('the presence engine', () => {
  it('detects which tickets changed between snapshots', () => {
    const next = withTicketUpdated(base, 'T-0002', '2099-01-01T00:00:00Z');
    expect(changedTicketIds(base, next)).toEqual(['T-0002']);
    expect(changedTicketIds(base, base)).toEqual([]);
  });

  it('wakes on external change and focuses the changed ticket', () => {
    const next = withTicketUpdated(base, 'T-0002', '2099-01-01T00:00:00Z');
    const state = observeChange(STILL, ['T-0002'], next, base, NOW);
    expect(state.energy).toBeGreaterThan(0.5);
    expect(isAwake(state)).toBe(true);
    expect(state.focus).toBe('T-0002');
    expect(glowFor(state, 'T-0002', NOW)).toBeGreaterThan(0.5);
    expect(glowFor(state, 'T-0003', NOW)).toBe(0);
  });

  it('prefers the active ticket as focus when one is set', () => {
    const next = { ...withTicketUpdated(base, 'T-0003', '2099-01-01T00:00:00Z'), activeTicket: 'T-0002' };
    const state = observeChange(STILL, ['T-0003'], next, base, NOW);
    expect(state.focus).toBe('T-0002');
  });

  it('a new session record wakes presence and names its ticket', () => {
    const next: Snapshot = {
      ...base,
      activeTicket: null,
      index: {
        ...base.index,
        sessions: [
          ...base.index.sessions,
          { id: 'S-0099', ticket: 'T-0004', actor: 'claude', started: '', ended: '', commits: [], outcome: 'completed', path: 'x' },
        ],
      },
    };
    const state = observeChange(STILL, [], next, { ...base, activeTicket: null }, NOW);
    expect(isAwake(state)).toBe(true);
    expect(state.focus).toBe('T-0004');
  });

  it('stays still when nothing actually changed', () => {
    const state = observeChange(STILL, [], base, base, NOW);
    expect(state).toBe(STILL);
  });

  it('energy accumulates across bursts but never exceeds 1', () => {
    const next = withTicketUpdated(base, 'T-0002', '2099-01-01T00:00:00Z');
    let state = observeChange(STILL, ['T-0002'], next, base, NOW);
    state = observeChange(state, ['T-0001'], next, base, NOW + 1000);
    state = observeChange(state, ['T-0003'], next, base, NOW + 2000);
    expect(state.energy).toBe(1);
  });

  it('decays back to stillness and clears focus when the project goes quiet', () => {
    const next = withTicketUpdated(base, 'T-0002', '2099-01-01T00:00:00Z');
    let state = observeChange(STILL, ['T-0002'], next, base, NOW);
    // A minute of silence.
    for (let i = 0; i < 60; i++) {
      state = decay(state, 1000, NOW + (i + 1) * 1000);
    }
    expect(state.energy).toBe(0);
    expect(isAwake(state)).toBe(false);
    expect(state.focus).toBeNull();
    expect(glowFor(state, 'T-0002', NOW + 61000)).toBe(0);
  });

  it('glow fades with recency even while energy stays high', () => {
    const next = withTicketUpdated(base, 'T-0002', '2099-01-01T00:00:00Z');
    const state = observeChange(STILL, ['T-0002'], next, base, NOW);
    const early = glowFor(state, 'T-0002', NOW + 1000);
    const late = glowFor(state, 'T-0002', NOW + 45000);
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });
});
