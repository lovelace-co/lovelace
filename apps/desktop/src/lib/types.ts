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

export interface IndexBrief {
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

export interface ProjectIndex {
  spec_version: string;
  project: { id: string; name: string };
  tickets: IndexTicket[];
  briefs: IndexBrief[];
  sessions: IndexSession[];
  comments: IndexComment[];
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

export interface Snapshot {
  root: string;
  manifest: { spec_version: string; project_id: string; name: string; created: string };
  workflow: Workflow;
  actors: Actor[];
  index: ProjectIndex;
  fieldCatalogue: Record<string, FieldDef[]>;
  issues: Issue[];
  digest: string;
  activeTicket: string | null;
  /** Manual board ordering per status column; absent columns fall back to index order. */
  boardOrder?: Record<string, string[]>;
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
