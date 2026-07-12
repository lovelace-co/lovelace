import type { AgentPresence } from './types';

/**
 * Agent presence, read straight from the hooks: one entry per live Claude
 * Code session under state/presence/<session-id>.json, refreshed by a
 * heartbeat on every tool call, so liveness is a fact on disk, not an
 * inference. An entry is fresh when its last heartbeat (or its start, when
 * no heartbeat has landed yet) is younger than the stale cap. The cap
 * guards against sessions that died without their end hook firing, and is
 * configurable per project for long-running work.
 */

export interface LivePresence {
  /** Any session is processing right now. */
  awake: boolean;
  /** Elapsed whole seconds per lit ticket, keyed by ticket id. */
  tickets: Map<string, number>;
}

export const STILL: LivePresence = { awake: false, tickets: new Map() };

/** Elapsed working time the way agents show it: 42s, then 1m 23s. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The default stale cap when the manifest does not set one, in minutes;
    mirrors core's DEFAULT_PRESENCE_TIMEOUT_MINUTES and SPEC.md section 12. */
export const DEFAULT_PRESENCE_TIMEOUT_MINUTES = 15;

export function derivePresence(
  markers: AgentPresence[] | null | undefined,
  timeoutMinutes: number | undefined,
  now: number,
): LivePresence {
  if (!markers || markers.length === 0) return STILL;
  const cap = (timeoutMinutes ?? DEFAULT_PRESENCE_TIMEOUT_MINUTES) * 60_000;
  let awake = false;
  const tickets = new Map<string, number>();
  for (const marker of markers) {
    const started = Date.parse(marker.started_at);
    if (Number.isNaN(started)) continue;
    const beat = Date.parse(marker.beat_at ?? marker.started_at);
    if (Number.isNaN(beat)) continue;
    // A marker from the future (clock skew) still counts as just started.
    if (now - beat > cap) continue;
    awake = true;
    if (!marker.ticket) continue;
    const elapsed = Math.max(0, Math.floor((now - started) / 1000));
    // Two sessions sharing a ticket: the earliest start wins, which is
    // always the larger elapsed value, so a plain max needs no extra state.
    const existing = tickets.get(marker.ticket);
    if (existing === undefined || elapsed > existing) tickets.set(marker.ticket, elapsed);
  }
  return { awake, tickets };
}
