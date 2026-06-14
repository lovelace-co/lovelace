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
  briefs: string;
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
}

export interface TypeDef {
  name: string;
  id_prefix: string;
  /** Human-readable singular and plural display names. */
  label?: string;
  plural?: string;
}

export interface StatusDef {
  name: string;
  /** Counts as in-progress work (digest, board signal hue, epic progress). */
  active?: boolean;
  /** A completion state (dims cards, counts toward epic completion). */
  complete?: boolean;
  /** Human-readable display name. */
  label?: string;
}

export interface TransitionDef {
  from: string;
  to: string[];
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
  applies_to?: string[];
}

export interface AutomationWhen {
  to: string;
  from?: string;
  type?: string;
  [field: string]: unknown;
}

export interface AutomationRule {
  when: AutomationWhen;
  run?: string;
  agent?: string;
}

export interface Workflow {
  types: TypeDef[];
  statuses: StatusDef[];
  transitions: TransitionDef[];
  priorities: string[];
  fields: FieldDef[];
  on_transition: AutomationRule[];
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

export interface Brief {
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
  workflow: Workflow;
  actors: Actor[];
  tickets: Ticket[];
  briefs: Brief[];
  sessions: SessionRecord[];
  comments: Comment[];
  /** Issues found while loading and parsing. Validation adds more. */
  issues: ValidationIssue[];
  /** 1-based frontmatter key lines per entity, keyed by repo-relative path. */
  keyLines: Map<string, Map<string, number>>;
}

export const SESSION_OUTCOMES = ['completed', 'partial', 'abandoned'] as const;

export const SPEC_VERSION = '1.0.0';
export const SUPPORTED_SPEC_MAJOR = 1;
