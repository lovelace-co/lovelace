import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject } from './project.js';

/**
 * Manual graph node positions. The documentation graph lets a human drag nodes
 * to arrange them; that arrangement is persisted, per node id, in
 * state/graph-layout.json so it survives reloads. Unlike board-order.yaml this
 * is machine-local (gitignored) view state: it never affects the index, is
 * safe to lose, and degrades to the deterministic force layout when absent. A
 * node without a saved position falls back to the auto-layout.
 */

export interface NodePosition {
  x: number;
  y: number;
}

export type GraphLayout = Record<string, NodePosition>;

const LAYOUT_FILE = 'graph-layout.json';

function isPos(value: unknown): value is NodePosition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NodePosition).x === 'number' &&
    typeof (value as NodePosition).y === 'number' &&
    Number.isFinite((value as NodePosition).x) &&
    Number.isFinite((value as NodePosition).y)
  );
}

/** Reads graph node positions into a plain map; tolerant of a missing or malformed file. */
export function readGraphLayout(lovelaceDir: string, stateDir: string): GraphLayout {
  const path = join(lovelaceDir, stateDir, LAYOUT_FILE);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { nodes?: Record<string, unknown> } | null;
    const nodes = data?.nodes;
    if (!nodes || typeof nodes !== 'object') return {};
    const out: GraphLayout = {};
    for (const [id, pos] of Object.entries(nodes)) {
      if (isPos(pos)) out[id] = { x: pos.x, y: pos.y };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Persists graph node positions to state/graph-layout.json. Deterministic:
 * keys sorted, positions rounded to whole pixels so the file stays quiet.
 * The caller sends the full set of positions to keep (pruning is its job);
 * this is a dumb store and never touches the index.
 */
export function writeGraphLayout(root: string, layout: GraphLayout): void {
  const project = loadProject(root);
  const stateDir = join(project.dir, project.manifest.paths.state);
  mkdirSync(stateDir, { recursive: true });
  const nodes: Record<string, NodePosition> = {};
  for (const id of Object.keys(layout).sort()) {
    const pos = layout[id];
    if (isPos(pos)) nodes[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  }
  writeFileSync(join(stateDir, LAYOUT_FILE), `${JSON.stringify({ version: 1, nodes }, null, 2)}\n`);
}
