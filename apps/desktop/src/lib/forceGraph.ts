export interface Vec {
  x: number;
  y: number;
}

export interface ForceEdge {
  source: string;
  target: string;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  /**
   * Nodes the user has pinned (dragged): these stay at exactly the given
   * position and the rest of the graph relaxes around them. When any pin is
   * present the final fit-to-viewport is skipped so pinned nodes never move.
   */
  fixed?: Record<string, Vec>;
}

/**
 * A tiny self-contained Fruchterman-Reingold layout. Deterministic by design:
 * nodes are seeded on a circle by their sorted index (never Math.random), then
 * relaxed for a fixed number of iterations, so the same graph always lays out
 * the same way and the result is testable. Big graphs are not the target here
 * (a project's briefs number in the tens), so the O(n^2) repulsion is fine.
 * Pinned nodes (options.fixed) are held in place and anchor the rest.
 */
export function layoutGraph(
  nodeIds: string[],
  edges: ForceEdge[],
  options: LayoutOptions = {},
): Map<string, Vec> {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const iterations = options.iterations ?? 320;
  const cx = width / 2;
  const cy = height / 2;

  const ids = [...nodeIds].sort((a, b) => a.localeCompare(b));
  const n = ids.length;
  const fixedSource = options.fixed ?? {};
  const pinned = new Map<string, Vec>();
  for (const id of ids) {
    const pin = fixedSource[id];
    if (pin && Number.isFinite(pin.x) && Number.isFinite(pin.y)) pinned.set(id, { x: pin.x, y: pin.y });
  }
  const hasPinned = pinned.size > 0;

  const pos = new Map<string, Vec>();
  const seedRadius = Math.min(width, height) * 0.36;
  ids.forEach((id, i) => {
    const pin = pinned.get(id);
    if (pin) {
      pos.set(id, { x: pin.x, y: pin.y });
      return;
    }
    const angle = (2 * Math.PI * i) / Math.max(1, n);
    pos.set(id, { x: cx + seedRadius * Math.cos(angle), y: cy + seedRadius * Math.sin(angle) });
  });
  if (n === 0) return pos;
  if (n === 1) {
    pos.set(ids[0]!, pinned.get(ids[0]!) ?? { x: cx, y: cy });
    return pos;
  }

  const k = Math.sqrt((width * height) / n); // ideal edge length
  const links = edges.filter((e) => pos.has(e.source) && pos.has(e.target));
  let temp = width / 8;
  const cool = temp / (iterations + 1);
  // With pins present the layout is not normalised afterwards (pins must stay
  // exact), so unpinned nodes are kept inside the frame each iteration instead;
  // otherwise repulsion flings them thousands of units out of view.
  const margin = Math.min(width, height) * 0.08;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, Vec>();
    for (const id of ids) disp.set(id, { x: 0, y: 0 });

    // Repulsion between every pair of nodes.
    for (let i = 0; i < n; i++) {
      const a = pos.get(ids[i]!)!;
      const da = disp.get(ids[i]!)!;
      for (let j = i + 1; j < n; j++) {
        const b = pos.get(ids[j]!)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        da.x += fx;
        da.y += fy;
        const db = disp.get(ids[j]!)!;
        db.x -= fx;
        db.y -= fy;
      }
    }

    // Attraction along edges.
    for (const edge of links) {
      const a = pos.get(edge.source)!;
      const b = pos.get(edge.target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp.get(edge.source)!.x -= fx;
      disp.get(edge.source)!.y -= fy;
      disp.get(edge.target)!.x += fx;
      disp.get(edge.target)!.y += fy;
    }

    // Apply displacement capped by the cooling temperature, plus a gentle pull
    // to centre so disconnected nodes do not drift away. Pinned nodes never
    // move: they exert forces on the rest but hold their own position.
    for (const id of ids) {
      if (pinned.has(id)) continue;
      const d = disp.get(id)!;
      const p = pos.get(id)!;
      const len = Math.hypot(d.x, d.y) || 0.01;
      p.x += (d.x / len) * Math.min(len, temp);
      p.y += (d.y / len) * Math.min(len, temp);
      p.x += (cx - p.x) * 0.012;
      p.y += (cy - p.y) * 0.012;
      if (hasPinned) {
        p.x = Math.min(width - margin, Math.max(margin, p.x));
        p.y = Math.min(height - margin, Math.max(margin, p.y));
      }
    }
    temp = Math.max(temp - cool, 0.5);
  }

  // With pins present the user's arrangement defines the frame, so leave the
  // coordinates exactly as relaxed (the view fits to them). Only an all-free
  // graph is normalised to fill the box.
  if (hasPinned) return pos;

  // The force sim leaves nodes anywhere the repulsion pushed them, often past
  // the box edges. Fit the whole layout into the viewport (uniform scale,
  // centred, with padding) so every node is always on screen at the default
  // zoom, whatever the graph's shape.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = Math.min(width, height) * 0.12;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;
  for (const p of pos.values()) {
    p.x = p.x * scale + offsetX;
    p.y = p.y * scale + offsetY;
  }

  return pos;
}
