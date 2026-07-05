import { titleCase } from './format';
import type { Snapshot } from './types';

export type LinkKind = 'ticket' | 'brief';

/** A wiki-link target the user can open. */
export interface LinkTarget {
  kind: LinkKind;
  id: string;
  /** The current human label: a ticket's title or a brief's title-cased id. */
  label: string;
  /** Repository-relative path, used to deep-link a brief into Documentation. */
  path: string;
}

/** Resolves a stored `[[id]]` token to its current target, or null if broken. */
export type LinkResolver = (id: string) => LinkTarget | null;

/** Opens a resolved wiki-link: a ticket in its detail view, a brief in Documentation. */
export type OpenLink = (target: LinkTarget) => void;

/**
 * The display label for a brief. Briefs have no title field and many share the
 * filename OVERVIEW.md, so the unique id slug (title-cased) is the readable name.
 */
export function briefLabel(id: string): string {
  return titleCase(id);
}

/** Builds a resolver over the current snapshot: id -> ticket or brief target. */
export function buildLinkResolver(snapshot: Snapshot): LinkResolver {
  const tickets = new Map(snapshot.index.tickets.map((t) => [t.id, t]));
  const briefs = new Map(snapshot.index.briefs.map((b) => [b.id, b]));
  return (id: string) => {
    const ticket = tickets.get(id);
    if (ticket) return { kind: 'ticket', id, label: ticket.title || id, path: ticket.path };
    const brief = briefs.get(id);
    if (brief) return { kind: 'brief', id, label: briefLabel(id), path: brief.path };
    return null;
  };
}

/** A candidate for the `[[` typeahead. */
export interface WikiCandidate {
  id: string;
  label: string;
  kind: LinkKind;
  /** Secondary line: the ticket id or the brief summary. */
  hint: string;
}

/** All linkable entities (tickets then briefs), for the `[[` menu. */
export function wikiCandidates(snapshot: Snapshot): WikiCandidate[] {
  const tickets = snapshot.index.tickets.map(
    (t): WikiCandidate => ({ id: t.id, label: t.title || t.id, kind: 'ticket', hint: t.id }),
  );
  const briefs = snapshot.index.briefs.map(
    (b): WikiCandidate => ({ id: b.id, label: briefLabel(b.id), kind: 'brief', hint: b.summary }),
  );
  return [...tickets, ...briefs];
}

export interface GraphNode {
  id: string;
  label: string;
  path: string;
}

export interface GraphLink {
  source: string;
  target: string;
}

/**
 * The documentation graph: every brief as a node, and one undirected edge per
 * unique pair of briefs that link to each other in either direction. Ticket
 * links are excluded (the graph is documentation-only). Deterministic: nodes
 * sorted by id, links sorted by pair.
 */
export function briefGraph(snapshot: Snapshot): { nodes: GraphNode[]; links: GraphLink[] } {
  const briefIds = new Set(snapshot.index.briefs.map((b) => b.id));
  const nodes = snapshot.index.briefs
    .map((b): GraphNode => ({ id: b.id, label: briefLabel(b.id), path: b.path }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const seen = new Set<string>();
  const links: GraphLink[] = [];
  for (const edge of snapshot.index.links ?? []) {
    if (!briefIds.has(edge.source) || !briefIds.has(edge.target) || edge.source === edge.target) continue;
    const [a, b] = edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source];
    const key = `${a} ${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: a, target: b });
  }
  links.sort((x, y) => x.source.localeCompare(y.source) || x.target.localeCompare(y.target));
  return { nodes, links };
}
