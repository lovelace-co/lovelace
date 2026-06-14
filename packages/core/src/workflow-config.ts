import { Document, isMap, isSeq } from 'yaml';
import type { StatusDef, TransitionDef, Workflow } from './types.js';

/**
 * The default workflow as structured data. This is the single source of
 * truth that both `initProject` (via its hardcoded string equivalent) and
 * the app's init wizard start from. Keep it in sync with the DEFAULT_WORKFLOW
 * string in init.ts.
 */
export function defaultWorkflow(): Workflow {
  return {
    types: [
      { name: 'epic', id_prefix: 'E' },
      { name: 'task', id_prefix: 'T' },
      { name: 'bug', id_prefix: 'T' },
    ],
    statuses: [
      { name: 'backlog' },
      { name: 'todo' },
      { name: 'in_progress', active: true },
      { name: 'in_review', active: true },
      { name: 'done', complete: true },
      { name: 'cancelled', complete: true },
    ],
    transitions: [
      { from: 'backlog', to: ['todo', 'cancelled'] },
      { from: 'todo', to: ['in_progress', 'backlog', 'cancelled'] },
      { from: 'in_progress', to: ['in_review', 'todo', 'cancelled'] },
      { from: 'in_review', to: ['done', 'in_progress', 'cancelled'] },
    ],
    priorities: ['urgent', 'high', 'medium', 'low'],
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'parent', type: 'reference', refers_to: ['epic'] },
      { name: 'depends_on', type: 'list', item_type: 'reference' },
      { name: 'assignee', type: 'reference', refers_to: ['actor'] },
      { name: 'priority', type: 'enum', values_from: 'priorities' },
    ],
    on_transition: [],
  };
}

/**
 * Permissive legal transitions: every status can move to every other status.
 * Used when a project's statuses are customised at init, so agents are as
 * free to move tickets as the human board already is. Projects that want a
 * tighter flow hand-edit workflow.yaml afterwards.
 */
export function permissiveTransitions(statuses: StatusDef[]): TransitionDef[] {
  const names = statuses.map((s) => s.name);
  return statuses.map((s) => ({ from: s.name, to: names.filter((n) => n !== s.name) }));
}

/** Drops empty optional keys so the serialised field is minimal. */
function compactField(field: Workflow['fields'][number]): Record<string, unknown> {
  return {
    name: field.name,
    type: field.type,
    ...(field.label ? { label: field.label } : {}),
    ...(field.required ? { required: true } : {}),
    ...(field.values && field.values.length > 0 ? { values: [...field.values] } : {}),
    ...(field.values_from ? { values_from: field.values_from } : {}),
    ...(field.item_type ? { item_type: field.item_type } : {}),
    ...(field.refers_to && field.refers_to.length > 0 ? { refers_to: [...field.refers_to] } : {}),
    ...(field.default !== undefined ? { default: field.default } : {}),
    ...(field.applies_to && field.applies_to.length > 0 ? { applies_to: [...field.applies_to] } : {}),
  };
}

/**
 * Serialises a Workflow to workflow.yaml text. Object lists render in block
 * style; scalar arrays (priorities, transition targets, enum values, ref
 * targets) render in compact flow style to match the project's house style.
 * The output parses back through loadWorkflow and passes validateWorkflow.
 */
export function serializeWorkflow(workflow: Workflow): string {
  const obj = {
    types: workflow.types.map((t) => ({
      name: t.name,
      id_prefix: t.id_prefix,
      ...(t.label ? { label: t.label } : {}),
      ...(t.plural ? { plural: t.plural } : {}),
    })),
    statuses: workflow.statuses.map((s) => ({
      name: s.name,
      ...(s.active ? { active: true } : {}),
      ...(s.complete ? { complete: true } : {}),
      ...(s.label ? { label: s.label } : {}),
    })),
    transitions: workflow.transitions.map((t) => ({ from: t.from, to: [...t.to] })),
    priorities: [...workflow.priorities],
    fields: workflow.fields.map(compactField),
    on_transition: workflow.on_transition ?? [],
  };

  const doc = new Document(obj);
  const flow = (node: unknown) => {
    if (isSeq(node)) (node as { flow?: boolean }).flow = true;
  };

  flow(doc.get('priorities', true));
  const transitions = doc.get('transitions', true);
  if (isSeq(transitions)) {
    for (const item of transitions.items) if (isMap(item)) flow(item.get('to', true));
  }
  const fields = doc.get('fields', true);
  if (isSeq(fields)) {
    for (const item of fields.items) {
      if (isMap(item)) {
        flow(item.get('values', true));
        flow(item.get('refers_to', true));
        flow(item.get('applies_to', true));
      }
    }
  }

  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}
