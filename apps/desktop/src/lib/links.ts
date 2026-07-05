import { titleCase } from './format';
import type { Snapshot } from './types';

export type LinkKind = 'ticket' | 'brief' | 'file' | 'person';

/** The `file:` scheme prefix for a source-file reference token. */
export const FILE_SCHEME = 'file:';

/** A reference target the user can open. */
export interface LinkTarget {
  kind: LinkKind;
  /** The stored token: an entity id, `file:<path>`, or `@<actor>`. */
  id: string;
  /** The current human label: a ticket title, brief/file name, or actor name. */
  label: string;
  /** Repository-relative path (briefs deep-link by it; files preview/open by it). Absent for people. */
  path?: string;
}

/** Resolves a stored `[[token]]` to its current target, or null if broken. */
export type LinkResolver = (token: string) => LinkTarget | null;

/** Opens a resolved reference: a ticket/brief navigates, a file previews, a person is a mention. */
export type OpenLink = (target: LinkTarget) => void;

/** The last path segment, for a file's display label. */
export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * The display label for a brief. Briefs have no title field and many share the
 * filename OVERVIEW.md, so the unique id slug (title-cased) is the readable name.
 */
export function briefLabel(id: string): string {
  return titleCase(id);
}

/**
 * Builds a resolver over the current snapshot, dispatching on the token's
 * scheme: `file:<path>` -> a source file, `@<actor>` -> a person, otherwise a
 * ticket or brief id.
 */
export function buildLinkResolver(snapshot: Snapshot): LinkResolver {
  const tickets = new Map(snapshot.index.tickets.map((t) => [t.id, t]));
  const briefs = new Map(snapshot.index.briefs.map((b) => [b.id, b]));
  const actors = new Map(snapshot.actors.map((a) => [a.id, a]));
  return (token: string) => {
    if (token.startsWith(FILE_SCHEME)) {
      const path = token.slice(FILE_SCHEME.length);
      return { kind: 'file', id: token, label: basename(path), path };
    }
    if (token.startsWith('@')) {
      const actor = actors.get(token.slice(1));
      return actor ? { kind: 'person', id: token, label: actor.name } : null;
    }
    const ticket = tickets.get(token);
    if (ticket) return { kind: 'ticket', id: token, label: ticket.title || token, path: ticket.path };
    const brief = briefs.get(token);
    if (brief) return { kind: 'brief', id: token, label: briefLabel(token), path: brief.path };
    return null;
  };
}

/** One choice in the reference picker / unified insert menu. */
export interface ReferenceCandidate {
  /** The token stored in `[[...]]`: an entity id, or `file:<path>`. */
  token: string;
  label: string;
  kind: LinkKind;
  /** Secondary line: the ticket id, brief summary, or file path. */
  hint: string;
}

/**
 * Every insertable reference for the unified `/` menu and the toolbar pickers:
 * tickets, then briefs, then repo files (as `file:<path>` tokens). People are
 * added later. `files` is the repo file list from `host.listFiles`.
 */
export function referenceCandidates(snapshot: Snapshot, files: string[] = []): ReferenceCandidate[] {
  const tickets = snapshot.index.tickets.map(
    (t): ReferenceCandidate => ({ token: t.id, label: t.title || t.id, kind: 'ticket', hint: t.id }),
  );
  const briefs = snapshot.index.briefs.map(
    (b): ReferenceCandidate => ({ token: b.id, label: briefLabel(b.id), kind: 'brief', hint: b.summary }),
  );
  const fileCandidates = files.map(
    (p): ReferenceCandidate => ({ token: `${FILE_SCHEME}${p}`, label: basename(p), kind: 'file', hint: p }),
  );
  return [...tickets, ...briefs, ...fileCandidates];
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
