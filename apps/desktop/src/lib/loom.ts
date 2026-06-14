import type { Snapshot, Workflow } from './types';

/**
 * The loom's discrete vocabulary, derived from workflow.yaml so any
 * user-defined workflow weaves itself.
 *
 * Status hues: one hue per status, learned once, reused identically in
 * every view. Pre-work statuses are slate, the working statuses carry the
 * signal or the periwinkle "in review" family, terminals are sage.
 * Urgency pills: the priorities list maps front-to-back into the
 * high / medium / low token families.
 */

export type StatusHue = 'pre' | 'current' | 'review' | 'done';

export function statusHue(workflow: Workflow, status: string): StatusHue {
  const def = workflow.statuses.find((s) => s.name === status);
  if (!def) return 'pre';
  if (def.complete) return 'done';
  if (!def.active) return 'pre';
  const wipStatuses = workflow.statuses.filter((s) => s.active);
  return wipStatuses[0]?.name === status ? 'current' : 'review';
}

export const STATUS_HUE_CSS: Record<StatusHue, string> = {
  pre: 'var(--dot-pre)',
  current: 'var(--current)',
  review: 'var(--dot-review)',
  done: 'var(--dot-done)',
};

export type PillFamily = 'high' | 'med' | 'low';

/** Maps a priority value to a pill family by its position in the list. */
export function priorityFamily(workflow: Workflow, priority: string): PillFamily | null {
  const index = workflow.priorities.indexOf(priority);
  if (index === -1) return null;
  const n = workflow.priorities.length;
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
 * child is complete, the reading hole where work sits now.
 */
export function epicProgress(snapshot: Snapshot): EpicProgress[] {
  const { workflow, index } = snapshot;
  const complete = new Set(workflow.statuses.filter((s) => s.complete).map((s) => s.name));
  const active = new Set(workflow.statuses.filter((s) => s.active).map((s) => s.name));

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
      if (!readingPlaced && active.has(child.status)) {
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
