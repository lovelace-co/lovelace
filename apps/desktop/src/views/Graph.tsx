import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { documentGraph } from '../lib/links';
import { layoutGraph, type Vec } from '../lib/forceGraph';
import type { GraphLayout, Snapshot } from '../lib/types';

interface GraphProps {
  snapshot: Snapshot;
  /** Open a document in the Documentation tab by its repository-relative path. */
  onOpenDocument: (path: string) => void;
  /** Persist manual node positions after a drag (machine-local). */
  onSaveLayout: (layout: GraphLayout) => void;
}

const VW = 1000;
const VH = 700;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
/** Below this pointer travel a node gesture counts as a click, not a drag. */
const CLICK_SLOP = 4;

interface Transform {
  x: number;
  y: number;
  k: number;
}

type Gesture =
  | { type: 'pan'; startClient: Vec; startTransform: Transform }
  | {
      type: 'node';
      id: string;
      path: string;
      startClient: Vec;
      startTransform: Transform;
      dragged: boolean;
      last: Vec;
    }
  | null;

/** Fits a set of points into the viewBox: centred, padded, uniform scale. */
function fitView(points: Iterable<Vec>): Transform {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    count += 1;
  }
  if (count === 0) return { x: 0, y: 0, k: 1 };
  const pad = 80;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const k = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, (VW - 2 * pad) / spanX, (VH - 2 * pad) / spanY, 1.4),
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, x: VW / 2 - cx * k, y: VH / 2 - cy * k };
}

/**
 * Maps a screen point into the local user space of an SVG element, using the
 * element's own CTM. This accounts for viewBox letterboxing (the default
 * `xMidYMid meet` centres the viewBox with bands) and, for the inner group, its
 * pan/zoom transform, so pointer coordinates line up exactly with node
 * positions. Returns the origin when no CTM is available (e.g. jsdom).
 */
function screenToLocal(el: SVGGraphicsElement | null, clientX: number, clientY: number): Vec {
  const ctm = el && typeof el.getScreenCTM === 'function' ? el.getScreenCTM() : null;
  if (!ctm) return { x: 0, y: 0 };
  const inv = ctm.inverse();
  return {
    x: inv.a * clientX + inv.c * clientY + inv.e,
    y: inv.b * clientX + inv.d * clientY + inv.f,
  };
}

/**
 * The documentation graph: documents as nodes, their wiki-links as edges, laid out
 * with a deterministic force simulation. Pan by dragging the canvas, zoom with
 * the wheel or the controls, drag a node to reposition it (positions persist),
 * hover to light up its connections, and click a node to open that document.
 */
export function Graph({ snapshot, onOpenDocument, onSaveLayout }: GraphProps) {
  const { nodes, links } = useMemo(() => documentGraph(snapshot), [snapshot]);
  const savedLayout = snapshot.graphLayout ?? {};

  const signature = useMemo(
    () => `${nodes.map((n) => n.id).join(',')}|${links.map((l) => `${l.source}-${l.target}`).join(',')}`,
    [nodes, links],
  );

  // Latest values read inside the mount-once gesture listeners and the layout
  // memo, without making them reactive: a save's snapshot refresh must not
  // re-run the layout and jump unpinned nodes.
  const savedRef = useRef(savedLayout);
  savedRef.current = savedLayout;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const onOpenDocumentRef = useRef(onOpenDocument);
  onOpenDocumentRef.current = onOpenDocument;
  const onSaveLayoutRef = useRef(onSaveLayout);
  onSaveLayoutRef.current = onSaveLayout;

  // Recompute only when the graph's shape changes, seeding from the saved pins.
  const baseLayout = useMemo(
    () => layoutGraph(nodes.map((n) => n.id), links, { width: VW, height: VH, fixed: savedRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const svgRef = useRef<SVGSVGElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  const gesture = useRef<Gesture>(null);
  // Ids dragged this session, so a save always re-includes every node the user
  // has moved even if an earlier save's snapshot has not round-tripped back yet.
  const pinnedRef = useRef<Set<string>>(new Set());
  const [positions, setPositions] = useState<Map<string, Vec>>(baseLayout);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const [transform, setTransform] = useState<Transform>(() => fitView(baseLayout.values()));
  const [hovered, setHovered] = useState<string | null>(null);

  // A shape change re-lays-out and re-frames; a save (pins-only) does not.
  useEffect(() => {
    setPositions(baseLayout);
    setTransform(fitView(baseLayout.values()));
  }, [baseLayout]);

  const degree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of links) {
      counts.set(link.source, (counts.get(link.source) ?? 0) + 1);
      counts.set(link.target, (counts.get(link.target) ?? 0) + 1);
    }
    return counts;
  }, [links]);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of nodes) map.set(node.id, new Set());
    for (const link of links) {
      map.get(link.source)?.add(link.target);
      map.get(link.target)?.add(link.source);
    }
    return map;
  }, [nodes, links]);

  // A single pair of window listeners drives whichever gesture is active, so
  // dragging keeps working even when the pointer leaves the SVG.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (g.type === 'pan') {
        // Translate the group by the cursor's movement in viewBox units.
        const start = screenToLocal(svgRef.current, g.startClient.x, g.startClient.y);
        const now = screenToLocal(svgRef.current, e.clientX, e.clientY);
        setTransform({
          x: g.startTransform.x + (now.x - start.x),
          y: g.startTransform.y + (now.y - start.y),
          k: g.startTransform.k,
        });
      } else {
        // Any move past the threshold turns the press into a drag, so it will
        // not be treated as a click on release.
        if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) >= CLICK_SLOP) {
          g.dragged = true;
        }
        // The node sits in the group's local space, so map straight into it and
        // the node tracks the cursor exactly.
        const graph = screenToLocal(groupRef.current, e.clientX, e.clientY);
        g.last = graph;
        setPositions((prev) => new Map(prev).set(g.id, graph));
      }
    };
    const onUp = () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.type !== 'node') return;
      if (!g.dragged) {
        // A node press with no real drag is a click: open that document.
        onOpenDocumentRef.current(g.path);
        return;
      }
      // Persist the arrangement: previously-saved pins for nodes that still
      // exist, overlaid with every node dragged this session read from live
      // positions, so no pin is lost to an in-flight save.
      pinnedRef.current.add(g.id);
      const currentIds = new Set(nodesRef.current.map((n) => n.id));
      const next: GraphLayout = {};
      for (const [id, p] of Object.entries(savedRef.current)) {
        if (currentIds.has(id)) next[id] = { x: p.x, y: p.y };
      }
      for (const id of pinnedRef.current) {
        if (!currentIds.has(id)) continue;
        const p = id === g.id ? g.last : positionsRef.current.get(id);
        if (p) next[id] = { x: p.x, y: p.y };
      }
      onSaveLayoutRef.current(next);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomTo = (factor: number, centre?: Vec) => {
    setTransform((t) => {
      const k2 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor));
      const c = centre ?? { x: VW / 2, y: VH / 2 };
      return { k: k2, x: c.x - ((c.x - t.x) / t.k) * k2, y: c.y - ((c.y - t.y) / t.k) * k2 };
    });
  };

  if (nodes.length === 0) {
    return (
      <>
        <header className="view-header">
          <h1 className="view-title">Graph</h1>
        </header>
        <div className="view-body">
          <EmptyState
            note="Nothing to graph yet"
            hint="Link documents with [[wiki-links]] in the editor and they will appear here as a connected map."
          />
        </div>
      </>
    );
  }

  const pos = (id: string): Vec => positions.get(id) ?? { x: VW / 2, y: VH / 2 };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Graph</h1>
        <span className="subtle">
          {nodes.length} document{nodes.length === 1 ? '' : 's'}, {links.length} link
          {links.length === 1 ? '' : 's'}
        </span>
      </header>
      <div className="graph-stage">
        <svg
          ref={svgRef}
          className="graph-canvas"
          viewBox={`0 0 ${VW} ${VH}`}
          role="img"
          aria-label="documentation link graph"
          onPointerDown={(e) => {
            e.preventDefault();
            gesture.current = {
              type: 'pan',
              startClient: { x: e.clientX, y: e.clientY },
              startTransform: transform,
            };
          }}
          onWheel={(e) => {
            zoomTo(e.deltaY < 0 ? 1.12 : 1 / 1.12, screenToLocal(svgRef.current, e.clientX, e.clientY));
          }}
        >
          <g ref={groupRef} transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {links.map((link) => {
              const a = pos(link.source);
              const b = pos(link.target);
              const active = hovered !== null && (hovered === link.source || hovered === link.target);
              const dim = hovered !== null && !active;
              return (
                <line
                  key={`${link.source}-${link.target}`}
                  className={`graph-edge${active ? ' active' : ''}${dim ? ' dim' : ''}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              );
            })}
            {nodes.map((node) => {
              const p = pos(node.id);
              const r = Math.min(16, 7 + (degree.get(node.id) ?? 0) * 1.6);
              const active = hovered === node.id;
              const near = hovered !== null && neighbours.get(hovered)?.has(node.id);
              const dim = hovered !== null && !active && !near;
              return (
                <g
                  key={node.id}
                  className={`graph-node${active ? ' active' : ''}${near ? ' near' : ''}${dim ? ' dim' : ''}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    gesture.current = {
                      type: 'node',
                      id: node.id,
                      path: node.path,
                      startClient: { x: e.clientX, y: e.clientY },
                      startTransform: transform,
                      dragged: false,
                      last: pos(node.id),
                    };
                  }}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered((h) => (h === node.id ? null : h))}
                >
                  <circle className="graph-dot" cx={p.x} cy={p.y} r={r} />
                  <text className="graph-label" x={p.x} y={p.y + r + 15} textAnchor="middle">
                    {node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="graph-controls">
          <button className="graph-ctl" aria-label="zoom in" onClick={() => zoomTo(1.2)}>
            +
          </button>
          <button className="graph-ctl" aria-label="zoom out" onClick={() => zoomTo(1 / 1.2)}>
            &minus;
          </button>
          <button
            className="graph-ctl"
            aria-label="fit view"
            onClick={() => setTransform(fitView(positions.values()))}
          >
            &#8634;
          </button>
        </div>
      </div>
    </>
  );
}
