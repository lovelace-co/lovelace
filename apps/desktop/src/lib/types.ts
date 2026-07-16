/** Mirrors the shapes the core host returns. */

export interface FieldDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'list' | 'reference';
  label?: string;
  values?: string[];
  values_from?: string;
  item_type?: string;
  refers_to?: string[];
  required?: boolean;
  default?: unknown;
}

export interface Schema {
  types: Array<{ name: string; id_prefix: string; label?: string; plural?: string; fields: FieldDef[] }>;
  statuses: Array<{ name: string; agent?: 'ready' | 'in_progress' | 'complete'; label?: string }>;
  priorities: string[];
}

export type SchemaType = Schema['types'][number];
export type SchemaStatus = Schema['statuses'][number];

/** Old-to-new machine name maps so a rename cascades to existing data. */
export interface SchemaRenames {
  statuses?: Record<string, string>;
  types?: Record<string, string>;
  priorities?: Record<string, string>;
}

/** A schema-editor save: each present section replaces its counterpart. */
export interface SchemaEdit {
  types?: SchemaType[];
  statuses?: SchemaStatus[];
  priorities?: string[];
  renames?: SchemaRenames;
}

export interface Actor {
  id: string;
  name: string;
  kind: 'human' | 'agent';
}

export interface IndexTicket {
  id: string;
  type: string;
  status: string;
  created: string;
  updated: string;
  title: string;
  fields: Record<string, unknown>;
  path: string;
}

export interface IndexDocument {
  id: string;
  summary: string;
  updated?: string;
  review_by?: string;
  path: string;
}

export interface IndexSession {
  id: string;
  ticket: string;
  actor: string;
  started: string;
  ended: string;
  commits: string[];
  outcome: string;
  path: string;
}

export interface IndexComment {
  ticket: string;
  actor: string;
  created: string;
  path: string;
}

/** One derived wiki-link edge: `source` and `target` are entity ids. */
export interface LinkEdge {
  source: string;
  target: string;
}

/** Persisted graph node positions, keyed by node id (machine-local view state). */
export type GraphLayout = Record<string, { x: number; y: number }>;

export interface ProjectIndex {
  spec_version: string;
  project: { id: string; name: string };
  tickets: IndexTicket[];
  documents: IndexDocument[];
  sessions: IndexSession[];
  comments: IndexComment[];
  /** The wiki-link graph derived from ticket and document bodies. */
  links: LinkEdge[];
}

export interface Issue {
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  rule: string;
  message: string;
}

/** One live agent marker from state/presence/<session-id>.json. */
export interface AgentPresence {
  ticket: string | null;
  actor: string | null;
  started_at: string;
  /** The last heartbeat; freshness checks prefer this over started_at when present. */
  beat_at?: string;
}

export interface Snapshot {
  root: string;
  manifest: {
    spec_version: string;
    project_id: string;
    name: string;
    created: string;
    presence_timeout_minutes?: number;
  };
  schema: Schema;
  actors: Actor[];
  index: ProjectIndex;
  fieldCatalogue: Record<string, FieldDef[]>;
  issues: Issue[];
  digest: string;
  activeTicket: string | null;
  /** Every live session's agent marker; absent or empty when no agent is processing. */
  agentPresences?: AgentPresence[];
  /** Manual board ordering per status column; absent columns fall back to index order. */
  boardOrder?: Record<string, string[]>;
  /** Manual graph node positions; nodes absent here fall back to the force layout. */
  graphLayout?: GraphLayout;
}

/** One migration step's dry-run result: a heading plus its decision lines. */
export interface MigrationPlanStep {
  summary: string;
  changes: string[];
}

/** The full migration plan for a project declaring an older spec major (ADR-0011). */
export interface MigrationPlan {
  declared: string;
  target: string;
  steps: MigrationPlanStep[];
  /** SPEC.md changelog entries strictly newer than declared, up to and including target. */
  releaseNotes: { version: string; description: string }[];
}

/** The result of running the migration chain. */
export interface MigrationResult {
  declared: string;
  finalVersion: string;
  steps: string[];
  issues: Issue[];
}

export interface SearchHit {
  kind: string;
  id: string;
  path: string;
  snippet: string;
  score: number;
}

export function fieldsFor(catalogue: Record<string, FieldDef[]>, type: string): FieldDef[] {
  return catalogue[type] ?? [];
}

export function enumValuesFor(schema: Schema, def: FieldDef): string[] {
  if (def.values) return def.values;
  if (def.values_from === 'priorities') return schema.priorities;
  return [];
}
