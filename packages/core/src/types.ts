export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  /** Path relative to the repository root. */
  file: string;
  line?: number;
  rule: string;
  message: string;
}

export interface ProjectPaths {
  tickets: string;
  documentation: string;
  comments: string;
  sessions: string;
  templates: string;
  index: string;
  state: string;
}

export interface Manifest {
  spec_version: string;
  project_id: string;
  name: string;
  created: string;
  paths: ProjectPaths;
  /**
   * How long a live agent presence stays believable without a heartbeat, in
   * minutes. Guards against sessions that die without cleaning up. Optional;
   * tooling defaults to 15.
   */
  presence_timeout_minutes?: number;
}

/**
 * A live agent marker, one file per session under
 * state/presence/<session-id>.json: written when an agent begins processing
 * a turn and refreshed by a heartbeat on every tool call, so liveness never
 * has to be inferred from a stale started_at alone. Machine-local and
 * gitignored, like the active ticket pointer. A legacy singleton
 * state/presence.json (pre-3.2 projects) is read as one more entry and
 * cleaned up on the next presence write.
 */
export interface AgentPresence {
  ticket: string | null;
  actor: string | null;
  started_at: string;
  /** The last heartbeat; freshness checks prefer this over started_at when present. */
  beat_at?: string;
}

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'list' | 'reference';

export interface FieldDef {
  name: string;
  type: FieldType;
  /** Human-readable display name. */
  label?: string;
  values?: string[];
  values_from?: string;
  item_type?: Exclude<FieldType, 'list'>;
  refers_to?: string[];
  required?: boolean;
  default?: unknown;
}

export interface TypeDef {
  name: string;
  id_prefix: string;
  /** Human-readable singular and plural display names. */
  label?: string;
  plural?: string;
  /** Fields owned by this ticket type. */
  fields: FieldDef[];
}

export interface StatusDef {
  name: string;
  /**
   * The status's meaning to agent tooling: `ready` work an agent can pick
   * up, `in_progress` active work (surfaced in the digest), or `complete` a
   * finished state. At most one status may carry a given role.
   */
  agent?: 'ready' | 'in_progress' | 'complete';
  /** Human-readable display name. */
  label?: string;
}

export interface Schema {
  types: TypeDef[];
  statuses: StatusDef[];
  priorities: string[];
}

export interface Actor {
  id: string;
  name: string;
  kind: 'human' | 'agent';
}

export const CORE_FIELDS = ['id', 'type', 'status', 'created', 'updated'] as const;
export type CoreField = (typeof CORE_FIELDS)[number];

export interface Ticket {
  id: string;
  type: string;
  status: string;
  created: string;
  updated: string;
  /** Defined (non-core) field values from frontmatter. */
  fields: Record<string, unknown>;
  body: string;
  path: string;
}

export interface Document {
  id: string;
  summary: string;
  updated?: string;
  review_by?: string;
  extra: Record<string, unknown>;
  body: string;
  path: string;
}

export interface SessionRecord {
  id: string;
  ticket: string;
  actor: string;
  started: string;
  ended: string;
  commits: string[];
  outcome: string;
  body: string;
  path: string;
}

export interface Comment {
  ticket: string;
  actor: string;
  created: string;
  body: string;
  path: string;
}

export interface Project {
  /** Absolute path to the repository root (the directory containing .lovelace). */
  root: string;
  /** Absolute path to the .lovelace directory. */
  dir: string;
  manifest: Manifest;
  schema: Schema;
  actors: Actor[];
  tickets: Ticket[];
  documents: Document[];
  sessions: SessionRecord[];
  comments: Comment[];
  /** Issues found while loading and parsing. Validation adds more. */
  issues: ValidationIssue[];
  /** 1-based frontmatter key lines per entity, keyed by repo-relative path. */
  keyLines: Map<string, Map<string, number>>;
}

export const SESSION_OUTCOMES = ['completed', 'partial', 'abandoned'] as const;
