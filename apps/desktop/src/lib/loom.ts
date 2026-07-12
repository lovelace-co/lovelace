import type { Schema, Snapshot } from './types';

/**
 * The loom's discrete vocabulary, derived from schema.yaml so any
 * user-defined schema weaves itself.
 *
 * Status hues: one hue per status, learned once, reused identically in
 * every view. Pre-work statuses are slate, the working statuses carry the
 * signal or the periwinkle "in review" family, terminals are sage.
 * Urgency pills: the priorities list maps front-to-back into the
 * high / medium / low token families.
 */

export type StatusHue = 'pre' | 'current' | 'review' | 'done';

/**
 * Statuses no longer carry a free active/complete flag; each carries at most
 * one agent role (`ready` | `in_progress` | `complete`). The hue mapping
 * reconstructs the old visual intent from that single tag and each status's
 * position in the list:
 *   - `agent: 'complete'`   -> done (sage), regardless of position.
 *   - `agent: 'in_progress'` -> current (the signal), the one working status.
 *   - anything strictly between the in-progress status and the complete
 *     status (by list position) -> review (the "in review" family): these
 *     are the untagged working statuses the old model marked active but not
 *     first.
 *   - everything else (before in-progress, or after the complete status,
 *     such as a cancelled status with no role) -> pre (neutral slate).
 */
export function statusHue(schema: Schema, status: string): StatusHue {
  const def = schema.statuses.find((s) => s.name === status);
  if (!def) return 'pre';
  if (def.agent === 'complete') return 'done';
  if (def.agent === 'in_progress') return 'current';
  const inProgressIndex = schema.statuses.findIndex((s) => s.agent === 'in_progress');
  if (inProgressIndex === -1) return 'pre';
  const completeIndex = schema.statuses.findIndex((s) => s.agent === 'complete');
  const index = schema.statuses.indexOf(def);
  const afterInProgress = index > inProgressIndex;
  const beforeComplete = completeIndex === -1 || index < completeIndex;
  return afterInProgress && beforeComplete ? 'review' : 'pre';
}

export const STATUS_HUE_CSS: Record<StatusHue, string> = {
  pre: 'var(--dot-pre)',
  current: 'var(--current)',
  review: 'var(--dot-review)',
  done: 'var(--dot-done)',
};

export type PillFamily = 'high' | 'med' | 'low';

/** Maps a priority value to a pill family by its position in the list. */
export function priorityFamily(schema: Schema, priority: string): PillFamily | null {
  const index = schema.priorities.indexOf(priority);
  if (index === -1) return null;
  const n = schema.priorities.length;
  if (n === 1) return 'high';
  const t = index / (n - 1);
  if (t <= 1 / 3) return 'high';
  if (t <= 2 / 3) return 'med';
  return 'low';
}

export interface EpicProgress {
  id: string;
  title: string;
  done: number;
  total: number;
  /** One entry per child, in ID order: 'punched' | 'reading' | 'open'. */
  holes: Array<'punched' | 'reading' | 'open'>;
}

/**
 * Epic progress as punchcards: one hole per child task, punched when the
 * child sits in the `agent: 'complete'` status, the reading hole at the
 * first child in the `agent: 'in_progress'` status.
 */
export function epicProgress(snapshot: Snapshot): EpicProgress[] {
  const { schema, index } = snapshot;
  const complete = new Set(schema.statuses.filter((s) => s.agent === 'complete').map((s) => s.name));
  const inProgress = new Set(schema.statuses.filter((s) => s.agent === 'in_progress').map((s) => s.name));

  const childrenByParent = new Map<string, typeof index.tickets>();
  for (const ticket of index.tickets) {
    const parent = typeof ticket.fields.parent === 'string' ? ticket.fields.parent : undefined;
    if (!parent) continue;
    const list = childrenByParent.get(parent) ?? [];
    list.push(ticket);
    childrenByParent.set(parent, list);
  }

  const out: EpicProgress[] = [];
  for (const ticket of index.tickets) {
    const children = childrenByParent.get(ticket.id);
    if (!children || children.length === 0) continue;
    const sorted = [...children].sort((a, b) => a.id.localeCompare(b.id));
    let readingPlaced = false;
    const holes = sorted.map((child): 'punched' | 'reading' | 'open' => {
      if (complete.has(child.status)) return 'punched';
      if (!readingPlaced && inProgress.has(child.status)) {
        readingPlaced = true;
        return 'reading';
      }
      return 'open';
    });
    out.push({
      id: ticket.id,
      title: ticket.title,
      done: holes.filter((h) => h === 'punched').length,
      total: holes.length,
      holes,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
