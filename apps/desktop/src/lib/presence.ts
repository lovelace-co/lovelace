import type { Snapshot } from './types';

/**
 * The presence engine. Every external change to the project (an agent
 * mutating tickets, writing sessions, editing briefs) raises the project's
 * energy; stillness lets it decay back to zero. Nothing here is simulated:
 * presence is derived entirely from real file-watcher events, so the app
 * only ever looks alive when something is actually happening.
 */

export interface PresenceState {
  /** 0 (still) to 1 (fully awake). Drives the atmosphere. */
  energy: number;
  /** The ticket the activity centres on, when one can be named. */
  focus: string | null;
  /** Recently changed ticket IDs and when they changed (epoch ms). */
  recent: Record<string, number>;
}

export const STILL: PresenceState = { energy: 0, focus: null, recent: {} };

/** Energy half-life while idle, in milliseconds. */
const HALF_LIFE_MS = 14000;
/** How long a changed ticket keeps its glow. */
const GLOW_WINDOW_MS = 60000;
/** Below this the project is considered still again. */
const STILL_THRESHOLD = 0.04;

/** Ticket IDs whose `updated` stamp moved between two snapshots. */
export function changedTicketIds(prev: Snapshot, next: Snapshot): string[] {
  const before = new Map(prev.index.tickets.map((t) => [t.id, t.updated]));
  const out: string[] = [];
  for (const ticket of next.index.tickets) {
    const was = before.get(ticket.id);
    if (was === undefined || was !== ticket.updated) out.push(ticket.id);
  }
  return out;
}

/** Folds one observed external change into the state. */
export function observeChange(
  state: PresenceState,
  changed: string[],
  next: Snapshot,
  prev: Snapshot,
  now: number,
): PresenceState {
  const sessionsGrew = next.index.sessions.length > prev.index.sessions.length;
  const commentsGrew = next.index.comments.length > prev.index.comments.length;
  const briefsTouched = next.index.briefs.some((b) => {
    const old = prev.index.briefs.find((p) => p.path === b.path);
    return old === undefined || old.updated !== b.updated;
  });
  const anything = changed.length > 0 || sessionsGrew || commentsGrew || briefsTouched;
  if (!anything) return state;

  const recent = { ...state.recent };
  for (const id of changed) recent[id] = now;
  // A session record names its ticket; that is the strongest focus signal.
  const newestSession = sessionsGrew ? next.index.sessions[next.index.sessions.length - 1] : undefined;
  const focus =
    next.activeTicket ??
    newestSession?.ticket ??
    changed[changed.length - 1] ??
    state.focus;
  return {
    energy: Math.min(1, state.energy + 0.55),
    focus,
    recent,
  };
}

/** Advances time: energy decays, old glows fall away. */
export function decay(state: PresenceState, elapsedMs: number, now: number): PresenceState {
  if (state.energy === 0 && Object.keys(state.recent).length === 0) return state;
  const energy = state.energy * Math.pow(0.5, elapsedMs / HALF_LIFE_MS);
  const still = energy < STILL_THRESHOLD;
  const recent: Record<string, number> = {};
  for (const [id, ts] of Object.entries(state.recent)) {
    if (now - ts < GLOW_WINDOW_MS) recent[id] = ts;
  }
  return {
    energy: still ? 0 : energy,
    focus: still ? null : state.focus,
    recent,
  };
}

/** Glow strength for one ticket, 0 to 1: recency shaped by overall energy. */
export function glowFor(state: PresenceState, id: string, now: number): number {
  const ts = state.recent[id];
  if (ts === undefined) return 0;
  const recency = Math.max(0, 1 - (now - ts) / GLOW_WINDOW_MS);
  return recency * (0.35 + 0.65 * state.energy);
}

export function isAwake(state: PresenceState): boolean {
  return state.energy >= STILL_THRESHOLD;
}
