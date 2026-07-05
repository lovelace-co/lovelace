import type { AgentPresence } from './types';

/**
 * Agent presence, read straight from the hooks. The integration writes
 * state/presence.json when a turn begins processing and removes it when
 * the turn or session ends, so liveness is a fact on disk, not an
 * inference: the marker exists and is younger than the stale cap, or the
 * project is still. The cap guards against sessions that died without
 * their end hook firing, and is configurable per project for
 * long-running work.
 */

export interface LivePresence {
  /** An agent is processing right now. */
  awake: boolean;
  /** The ticket the work centres on, when the marker names one. */
  focus: string | null;
  /** Whole seconds since the current turn began, when awake. */
  elapsedSeconds: number | null;
}

export const STILL: LivePresence = { awake: false, focus: null, elapsedSeconds: null };

/** Elapsed working time the way agents show it: 42s, then 1m 23s. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The default stale cap when the manifest does not set one, in minutes. */
export const DEFAULT_PRESENCE_TIMEOUT_MINUTES = 120;

export function derivePresence(
  marker: AgentPresence | null | undefined,
  timeoutMinutes: number | undefined,
  now: number,
): LivePresence {
  if (!marker) return STILL;
  const started = Date.parse(marker.started_at);
  if (Number.isNaN(started)) return STILL;
  const age = now - started;
  const cap = (timeoutMinutes ?? DEFAULT_PRESENCE_TIMEOUT_MINUTES) * 60_000;
  if (age > cap) return STILL;
  // A marker from the future (clock skew) still counts as just started.
  return {
    awake: true,
    focus: marker.ticket,
    elapsedSeconds: Math.max(0, Math.floor(age / 1000)),
  };
}
