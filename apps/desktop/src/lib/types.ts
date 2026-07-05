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
  applies_to?: string[];
}

export interface Workflow {
  types: Array<{ name: string; id_prefix: string; label?: string; plural?: string }>;
  statuses: Array<{ name: string; active?: boolean; complete?: boolean; label?: string }>;
  transitions: Array<{ from: string; to: string[] }>;
  priorities: string[];
  fields: FieldDef[];
  on_transition: Array<{
    when: { to: string; from?: string; type?: string; [k: string]: unknown };
    run?: string;
    agent?: string;
  }>;
}

export type WorkflowType = Workflow['types'][number];
export type WorkflowStatus = Workflow['statuses'][number];
export type WorkflowTransition = Workflow['transitions'][number];

/** Old-to-new machine name maps so a rename cascades to existing data. */
export interface WorkflowRenames {
  statuses?: Record<string, string>;
  types?: Record<string, string>;
  priorities?: Record<string, string>;
}

/** A workflow-editor save: each present section replaces its counterpart. */
export interface WorkflowEdit {
  types?: WorkflowType[];
  statuses?: WorkflowStatus[];
  transitions?: WorkflowTransition[];
  priorities?: string[];
  fields?: FieldDef[];
  renames?: WorkflowRenames;
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

export interface AutomationRule {
  when: { to: string; from?: string; type?: string; [k: string]: unknown };
  run?: string;
  agent?: string;
}

export interface TransitionOutcome {
  instructions: string[];
  queued: string[];
  executed: Array<{ kind: 'run'; command: string; exitCode: number; logTail: string }>;
}

/** The live agent marker from state/presence.json. */
export interface AgentPresence {
  ticket: string | null;
  actor: string | null;
  started_at: string;
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
  workflow: Workflow;
  actors: Actor[];
  index: ProjectIndex;
  fieldCatalogue: Record<string, FieldDef[]>;
  issues: Issue[];
  digest: string;
  activeTicket: string | null;
  /** The live agent marker, or null when no agent is processing. */
  agentPresence?: AgentPresence | null;
  /** Manual board ordering per status column; absent columns fall back to index order. */
  boardOrder?: Record<string, string[]>;
  /** Manual graph node positions; nodes absent here fall back to the force layout. */
  graphLayout?: GraphLayout;
}

export interface SearchHit {
  kind: string;
  id: string;
  path: string;
  snippet: string;
  score: number;
}

/** Legal drop targets for a ticket in `from`, per workflow transitions. */
export function legalTargets(workflow: Workflow, from: string): Set<string> {
  const out = new Set<string>([from]);
  for (const t of workflow.transitions) {
    if (t.from === from) for (const to of t.to) out.add(to);
  }
  return out;
}

export function fieldsFor(catalogue: Record<string, FieldDef[]>, type: string): FieldDef[] {
  return catalogue[type] ?? [];
}

export function enumValuesFor(workflow: Workflow, def: FieldDef): string[] {
  if (def.values) return def.values;
  if (def.values_from === 'priorities') return workflow.priorities;
  return [];
}
