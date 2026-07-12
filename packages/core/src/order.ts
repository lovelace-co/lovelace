import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Document, parseDocument } from 'yaml';
import { loadProject } from './project.js';
import { writeIndex } from './index-gen.js';
import { MutationError } from './mutate.js';
import type { MutationContext } from './mutate.js';

/**
 * Manual board ordering. The board lets a human arrange cards within a
 * column; that arrangement is persisted, per status, in board-order.yaml so
 * it survives reloads and is shared through version control. The file is the
 * source of truth (like everything else); the index stays derived and the
 * board reads this order from the snapshot. A column absent from the file, or
 * a ticket absent from its column's list, falls back to the indexer's order.
 */

const ORDER_FILE = 'board-order.yaml';

function orderPath(lovelaceDir: string): string {
  return join(lovelaceDir, ORDER_FILE);
}

/** Reads board-order.yaml into a plain map; tolerant of a missing or malformed file. */
export function readBoardOrder(lovelaceDir: string): Record<string, string[]> {
  const path = orderPath(lovelaceDir);
  if (!existsSync(path)) return {};
  try {
    const data = parseDocument(readFileSync(path, 'utf8')).toJS() as {
      columns?: Record<string, unknown>;
    } | null;
    const columns = data?.columns;
    if (!columns || typeof columns !== 'object') return {};
    const out: Record<string, string[]> = {};
    for (const [status, ids] of Object.entries(columns)) {
      if (Array.isArray(ids)) {
        out[status] = ids.filter((x): x is string => typeof x === 'string');
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Serialises the order map deterministically: sorted keys, compact flow lists. */
function writeBoardOrder(lovelaceDir: string, order: Record<string, string[]>): void {
  const columns: Record<string, string[]> = {};
  for (const status of Object.keys(order).sort()) {
    const ids = order[status];
    if (ids && ids.length > 0) columns[status] = ids;
  }
  const doc = new Document({ columns });
  // Render the id lists in flow style ([A, B]) to match the project's house style.
  const columnsNode = (doc.contents as { items?: Array<{ value?: unknown }> }).items?.[0]?.value as
    | { items?: Array<{ value?: { flow?: boolean } }> }
    | undefined;
  for (const item of columnsNode?.items ?? []) {
    if (item.value && typeof item.value === 'object' && 'flow' in item.value) {
      (item.value as { flow?: boolean }).flow = true;
    }
  }
  writeFileSync(orderPath(lovelaceDir), doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
}

/**
 * Renames column keys when statuses are renamed, so a column's manual order
 * follows its status instead of being silently dropped. `renames` maps old
 * status name to new; entries whose old key is absent are ignored.
 */
export function renameBoardOrderColumns(lovelaceDir: string, renames: Record<string, string>): void {
  const entries = Object.entries(renames).filter(([from, to]) => from !== to);
  if (entries.length === 0) return;
  const order = readBoardOrder(lovelaceDir);
  let changed = false;
  for (const [from, to] of entries) {
    if (from in order) {
      order[to] = order[from]!;
      delete order[from];
      changed = true;
    }
  }
  if (changed) writeBoardOrder(lovelaceDir, order);
}

/** Removes ticket ids from every column (used when tickets are deleted or moved). */
export function pruneFromBoardOrder(lovelaceDir: string, ids: string[]): void {
  if (ids.length === 0) return;
  const order = readBoardOrder(lovelaceDir);
  const remove = new Set(ids);
  let changed = false;
  for (const status of Object.keys(order)) {
    const next = order[status]!.filter((id) => !remove.has(id));
    if (next.length !== order[status]!.length) {
      order[status] = next;
      changed = true;
    }
  }
  if (changed) writeBoardOrder(lovelaceDir, order);
}

/**
 * Sets the exact card order for one status column. The given ids are the
 * full, ordered contents of that column; any of them are removed from other
 * columns (a card belongs to exactly one column, by its status). Unknown ids
 * are dropped. Reindexes unless skipped.
 */
export async function setColumnOrder(
  root: string,
  status: string,
  ids: string[],
  ctx: MutationContext = {},
): Promise<void> {
  const project = loadProject(root);
  if (!project.schema.statuses.some((s) => s.name === status)) {
    throw new MutationError(`unknown status "${status}"`);
  }
  const known = new Set(project.tickets.map((t) => t.id));
  const ordered = ids.filter((id) => known.has(id));
  const order = readBoardOrder(project.dir);
  const moved = new Set(ordered);
  for (const other of Object.keys(order)) {
    if (other !== status) order[other] = order[other]!.filter((id) => !moved.has(id));
  }
  order[status] = ordered;
  writeBoardOrder(project.dir, order);
  if (!ctx.skipReindex) writeIndex(project);
}
