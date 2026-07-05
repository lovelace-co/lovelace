import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Document, parseDocument, isSeq, isMap } from 'yaml';
import { pruneFromBoardOrder, renameBoardOrderColumns } from './order.js';
import { isLegalTransition, defaultStatus, validateWorkflow, automationListSchema } from './config.js';
import {
  applyWorkflowFlow,
  compactField,
  compactStatus,
  compactTransition,
  compactType,
} from './workflow-config.js';
import { applyDefaults, fieldsForType, validateTicketFields } from './fields.js';
import { parseFrontmatter } from './frontmatter.js';
import { nextId } from './ids.js';
import { matchRules } from './automation.js';
import { loadProject } from './project.js';
import { writeIndex } from './index-gen.js';
import type {
  Actor,
  AutomationRule,
  FieldDef,
  Project,
  StatusDef,
  Ticket,
  TransitionDef,
  TypeDef,
  ValidationIssue,
  Workflow,
} from './types.js';
import { CORE_FIELDS, SESSION_OUTCOMES } from './types.js';

export class MutationError extends Error {
  constructor(
    message: string,
    public issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'MutationError';
  }
}

export interface MutationContext {
  /** Injectable clock; defaults to the real time. */
  now?: () => Date;
  /** Actor performing the mutation; an agent acts on instructions inline, a human's queue for next session. */
  actor?: string;
  /** Skip reindexing after the write (for bulk operations). */
  skipReindex?: boolean;
  /**
   * Permit transitions outside workflow.yaml's legal moves. The app's
   * board offers this to humans, who could equally hand-edit the file;
   * the status must still exist. Agent tooling never sets it.
   */
  forceTransition?: boolean;
}

function isoNow(ctx: MutationContext): string {
  const d = ctx.now ? ctx.now() : new Date();
  return `${d.toISOString().slice(0, 19)}Z`;
}

function reindex(root: string, ctx: MutationContext): Project {
  const project = loadProject(root);
  if (!ctx.skipReindex) writeIndex(project);
  return project;
}

/** Serialises frontmatter in a stable key order with flow-style lists. */
function buildFrontmatterYaml(entries: Array<[string, unknown]>): string {
  const doc = new Document({});
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    doc.set(key, value);
  }
  for (const item of (doc.contents as { items?: Array<{ value?: unknown }> }).items ?? []) {
    const v = item.value;
    if (v && typeof v === 'object' && 'items' in v) {
      (v as { flow?: boolean }).flow = true;
    }
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

export interface CreateTicketInput {
  type: string;
  fields: Record<string, unknown>;
  body?: string;
  /** Starting status; must exist in workflow.yaml. Defaults to the first status. */
  status?: string;
}

export async function createTicket(
  root: string,
  input: CreateTicketInput,
  ctx: MutationContext = {},
): Promise<Ticket> {
  const project = loadProject(root);
  const typeDef = project.workflow.types.find((t) => t.name === input.type);
  if (!typeDef) {
    throw new MutationError(
      `unknown ticket type "${input.type}"; defined types: ${project.workflow.types.map((t) => t.name).join(', ')}`,
    );
  }
  for (const key of Object.keys(input.fields)) {
    if ((CORE_FIELDS as readonly string[]).includes(key)) {
      throw new MutationError(`"${key}" is a locked core field and cannot be set directly`);
    }
  }
  const fields = applyDefaults(project.workflow, input.type, input.fields);
  const issues = validateTicketFields(project.workflow, input.type, fields, '(new ticket)').filter(
    (i) => i.severity === 'error',
  );
  if (issues.length > 0) {
    throw new MutationError(`invalid fields: ${issues.map((i) => i.message).join('; ')}`, issues);
  }

  if (input.status !== undefined && !project.workflow.statuses.some((s) => s.name === input.status)) {
    throw new MutationError(`unknown status "${input.status}"`);
  }
  const id = await nextId(project.dir, project.manifest, typeDef.id_prefix);
  const stamp = isoNow(ctx);
  const ordered: Array<[string, unknown]> = [
    ['id', id],
    ['type', input.type],
    ['status', input.status ?? defaultStatus(project.workflow)],
    ['created', stamp],
    ['updated', stamp],
  ];
  for (const def of fieldsForType(project.workflow, input.type)) {
    if (fields[def.name] !== undefined) ordered.push([def.name, fields[def.name]]);
  }
  const body =
    input.body ?? '## Description\n\n(to be written)\n\n## Acceptance criteria\n\n- [ ] (to be defined)\n';
  const content = `---\n${buildFrontmatterYaml(ordered)}---\n\n${body.trimEnd()}\n`;
  const ticketsDir = join(project.dir, project.manifest.paths.tickets);
  mkdirSync(ticketsDir, { recursive: true });
  const path = join(ticketsDir, `${id}.md`);
  writeFileSync(path, content);
  const after = reindex(root, ctx);
  const ticket = after.tickets.find((t) => t.id === id);
  if (!ticket) throw new MutationError(`ticket ${id} was written but could not be read back`);
  return ticket;
}

export interface UpdateResult {
  ticket: Ticket;
  /** Automation rules matched by a status transition, in definition order. */
  firedRules: Array<{ rule: AutomationRule; from: string; to: string }>;
}

/**
 * Updates defined fields and, when "status" is included, performs a
 * transition validated against workflow.yaml. Edits preserve the file's
 * existing frontmatter formatting; only changed keys are touched.
 */
export async function updateTicket(
  root: string,
  id: string,
  changes: Record<string, unknown>,
  ctx: MutationContext = {},
): Promise<UpdateResult> {
  const project = loadProject(root);
  const ticket = project.tickets.find((t) => t.id === id);
  if (!ticket) {
    throw new MutationError(`ticket "${id}" does not exist`);
  }
  for (const key of Object.keys(changes)) {
    if (key !== 'status' && (CORE_FIELDS as readonly string[]).includes(key)) {
      throw new MutationError(`"${key}" is a locked core field and cannot be edited`);
    }
  }

  const from = ticket.status;
  const to = typeof changes.status === 'string' ? changes.status : undefined;
  if (to !== undefined) {
    if (!project.workflow.statuses.some((s) => s.name === to)) {
      throw new MutationError(`unknown status "${to}"`);
    }
    if (!ctx.forceTransition && !isLegalTransition(project.workflow, from, to)) {
      const legal = project.workflow.transitions
        .filter((t) => t.from === from)
        .flatMap((t) => t.to);
      throw new MutationError(
        `illegal transition ${from} -> ${to}; legal targets from ${from}: ${legal.join(', ') || '(none)'}`,
      );
    }
  }

  const { status: _status, ...fieldChanges } = changes;
  const merged = { ...ticket.fields, ...fieldChanges };
  for (const [key, value] of Object.entries(fieldChanges)) {
    if (value === null) delete merged[key];
  }
  const issues = validateTicketFields(project.workflow, ticket.type, merged, ticket.path).filter(
    (i) => i.severity === 'error',
  );
  if (issues.length > 0) {
    throw new MutationError(`invalid fields: ${issues.map((i) => i.message).join('; ')}`, issues);
  }

  const abs = join(root, ticket.path);
  const text = readFileSync(abs, 'utf8');
  const parsed = parseFrontmatter(text);
  const doc = parseDocument(parsed.raw);
  for (const [key, value] of Object.entries(fieldChanges)) {
    if (value === null) {
      doc.delete(key);
    } else {
      doc.set(key, value);
    }
  }
  if (to !== undefined) doc.set('status', to);
  doc.set('updated', isoNow(ctx));
  const newText = `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${parsed.body}`;
  writeFileSync(abs, newText);

  const after = reindex(root, ctx);
  const updated = after.tickets.find((t) => t.id === id);
  if (!updated) throw new MutationError(`ticket ${id} was updated but could not be read back`);
  const firedRules =
    to !== undefined && to !== from
      ? matchRules(project.workflow, updated, from, to).map((rule) => ({ rule, from, to }))
      : [];
  return { ticket: updated, firedRules };
}

export interface DeleteResult {
  id: string;
  /** How much attached history was removed alongside the ticket. */
  comments: number;
  sessions: number;
}

/**
 * Removes a ticket and everything attached to it: the ticket file, its
 * comment directory, and every session that records work on it. This
 * destroys history, which is why the app gates it behind an explicit
 * confirmation. The id is also pruned from board-order.yaml.
 */
export async function deleteTicket(
  root: string,
  id: string,
  ctx: MutationContext = {},
): Promise<DeleteResult> {
  const project = loadProject(root);
  const ticket = project.tickets.find((t) => t.id === id);
  if (!ticket) {
    throw new MutationError(`ticket "${id}" does not exist`);
  }
  const commentCount = project.comments.filter((c) => c.ticket === id).length;
  const sessions = project.sessions.filter((s) => s.ticket === id);

  rmSync(join(root, ticket.path), { force: true });
  rmSync(join(project.dir, project.manifest.paths.comments, id), { recursive: true, force: true });
  for (const session of sessions) {
    rmSync(join(root, session.path), { force: true });
  }
  pruneFromBoardOrder(project.dir, [id]);

  reindex(root, ctx);
  return { id, comments: commentCount, sessions: sessions.length };
}

/**
 * Replaces the on_transition automation rules in workflow.yaml. Validates
 * structure (exactly one of run/agent, a target status) and references
 * (statuses, types and fields must exist) before writing, so the app can
 * never persist a rule set the validator would reject. Only the
 * on_transition node is rewritten; the rest of workflow.yaml is preserved.
 */
export async function writeAutomations(
  root: string,
  rules: unknown,
  ctx: MutationContext = {},
): Promise<AutomationRule[]> {
  const project = loadProject(root);

  const parsed = automationListSchema.safeParse(rules);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
    throw new MutationError(`invalid automation: ${path}${first?.message ?? 'invalid'}`);
  }
  const next = parsed.data as AutomationRule[];

  const candidate: Project['workflow'] = { ...project.workflow, on_transition: next };
  const issues = validateWorkflow(candidate, '.lovelace/workflow.yaml').filter((i) =>
    i.rule.startsWith('automation/'),
  );
  if (issues.length > 0) {
    throw new MutationError(issues.map((i) => i.message).join('; '), issues);
  }

  const abs = join(project.dir, 'workflow.yaml');
  const doc = parseDocument(readFileSync(abs, 'utf8'));
  doc.set('on_transition', next);
  // Match the house style: each rule's `when` map renders in flow style.
  const seq = doc.get('on_transition', true);
  if (isSeq(seq)) {
    for (const item of seq.items) {
      if (isMap(item)) {
        const when = item.get('when', true);
        if (isMap(when)) (when as { flow?: boolean }).flow = true;
      }
    }
  }
  writeFileSync(abs, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
  if (!ctx.skipReindex) reindex(root, ctx);
  return next;
}

/** A rename maps an old machine name to its new one, per schema section. */
export interface WorkflowRenames {
  statuses?: Record<string, string>;
  types?: Record<string, string>;
  priorities?: Record<string, string>;
}

/**
 * A workflow-editor save. Each section present replaces its counterpart;
 * omitted sections are kept. `renames` carries the editor's in-place name
 * changes so they cascade to existing data rather than stranding it.
 */
export interface WorkflowEdit {
  types?: TypeDef[];
  statuses?: StatusDef[];
  transitions?: TransitionDef[];
  priorities?: string[];
  fields?: FieldDef[];
  renames?: WorkflowRenames;
}

/** Remaps a name through a rename map, leaving unmapped names untouched. */
function remap(map: Record<string, string>, name: string): string {
  return name in map ? map[name]! : name;
}

/**
 * Persists a workflow-editor save to workflow.yaml. Renames cascade to
 * existing tickets, the board order and the automation rules, so nothing
 * dangles. Removing a status or type that tickets still use, or a priority
 * still in use, is blocked with a message naming the count, because those
 * would strand tickets in an invalid state. Structure is validated with the
 * same rules the validator enforces before anything is written. Each schema
 * node is patched in place, so hand-authored comments elsewhere survive.
 */
export async function writeWorkflow(
  root: string,
  edit: WorkflowEdit,
  ctx: MutationContext = {},
): Promise<void> {
  const project = loadProject(root);
  const current = project.workflow;
  const statusRenames = edit.renames?.statuses ?? {};
  const typeRenames = edit.renames?.types ?? {};
  const prioRenames = edit.renames?.priorities ?? {};

  // Assemble the candidate: a provided section replaces, an omitted one is
  // kept. Sections that can reference a renamed status or type are remapped so
  // they stay consistent even when the caller sent the old names.
  const statuses = edit.statuses ?? current.statuses;
  const types = edit.types ?? current.types;
  const priorities = edit.priorities ?? current.priorities;
  const transitions = (edit.transitions ?? current.transitions).map((t) => ({
    from: remap(statusRenames, t.from),
    to: t.to.map((to) => remap(statusRenames, to)),
  }));
  const fields = (edit.fields ?? current.fields).map((f) => ({
    ...f,
    ...(f.applies_to ? { applies_to: f.applies_to.map((x) => remap(typeRenames, x)) } : {}),
    ...(f.refers_to ? { refers_to: f.refers_to.map((x) => remap(typeRenames, x)) } : {}),
  }));
  const onTransition = current.on_transition.map((rule) => {
    const when = { ...rule.when };
    when.to = remap(statusRenames, when.to);
    if (typeof when.from === 'string') when.from = remap(statusRenames, when.from);
    if (typeof when.type === 'string') when.type = remap(typeRenames, when.type);
    return { ...rule, when };
  });

  const candidate: Workflow = {
    types,
    statuses,
    transitions,
    priorities,
    fields,
    on_transition: onTransition,
  };

  // The enum fields whose values are the priorities list; a removed priority
  // is "in use" if any ticket holds it in one of these.
  const prioFields = fields
    .filter((f) => f.type === 'enum' && f.values_from === 'priorities')
    .map((f) => f.name);

  // Block removals that would strand existing tickets. A section member is
  // gone if it is absent from the new list and was not renamed away.
  const statusNames = new Set(statuses.map((s) => s.name));
  for (const s of current.statuses) {
    if (statusNames.has(s.name) || s.name in statusRenames) continue;
    const n = project.tickets.filter((t) => t.status === s.name).length;
    if (n > 0) {
      throw new MutationError(
        `cannot remove status "${s.name}": ${n} ticket${n === 1 ? '' : 's'} still use it; move them first`,
      );
    }
  }
  const typeNames = new Set(types.map((t) => t.name));
  for (const t of current.types) {
    if (typeNames.has(t.name) || t.name in typeRenames) continue;
    const n = project.tickets.filter((tk) => tk.type === t.name).length;
    if (n > 0) {
      throw new MutationError(
        `cannot remove type "${t.name}": ${n} ticket${n === 1 ? '' : 's'} still use it`,
      );
    }
  }
  const prioSet = new Set(priorities);
  for (const p of current.priorities) {
    if (prioSet.has(p) || p in prioRenames) continue;
    const n = project.tickets.filter((t) => prioFields.some((pf) => t.fields[pf] === p)).length;
    if (n > 0) {
      throw new MutationError(
        `cannot remove priority "${p}": ${n} ticket${n === 1 ? '' : 's'} still use it`,
      );
    }
  }

  // Structural validation: the same errors the validator would report.
  const issues = validateWorkflow(candidate, '.lovelace/workflow.yaml').filter(
    (i) => i.severity === 'error',
  );
  if (issues.length > 0) {
    throw new MutationError(issues.map((i) => i.message).join('; '), issues);
  }

  // Cascade renames into existing tickets: status, type and any priority value.
  const renaming =
    Object.keys(statusRenames).length +
      Object.keys(typeRenames).length +
      Object.keys(prioRenames).length >
    0;
  if (renaming) {
    for (const ticket of project.tickets) {
      const sets: Array<[string, string]> = [];
      if (ticket.status in statusRenames) sets.push(['status', statusRenames[ticket.status]!]);
      if (ticket.type in typeRenames) sets.push(['type', typeRenames[ticket.type]!]);
      for (const pf of prioFields) {
        const v = ticket.fields[pf];
        if (typeof v === 'string' && v in prioRenames) sets.push([pf, prioRenames[v]!]);
      }
      if (sets.length === 0) continue;
      const abs = join(root, ticket.path);
      const parsed = parseFrontmatter(readFileSync(abs, 'utf8'));
      const doc = parseDocument(parsed.raw);
      for (const [key, value] of sets) doc.set(key, value);
      doc.set('updated', isoNow(ctx));
      writeFileSync(
        abs,
        `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${parsed.body}`,
      );
    }
    renameBoardOrderColumns(project.dir, statusRenames);
  }

  // Patch each schema node in place so comments and untouched sections survive.
  const abs = join(project.dir, 'workflow.yaml');
  const doc = parseDocument(readFileSync(abs, 'utf8'));
  doc.set('types', candidate.types.map(compactType));
  doc.set('statuses', candidate.statuses.map(compactStatus));
  doc.set('transitions', candidate.transitions.map(compactTransition));
  doc.set('priorities', [...candidate.priorities]);
  doc.set('fields', candidate.fields.map(compactField));
  // The automation rules are owned by the Automations editor, not this one, so
  // leave the node untouched, only remapping the status and type names a rename
  // changed. Editing the node in place preserves keys this editor does not
  // model (for example a rule's `confirm` gate).
  const automations = doc.get('on_transition', true);
  if (!isSeq(automations)) {
    doc.set('on_transition', candidate.on_transition);
  } else if (Object.keys(statusRenames).length + Object.keys(typeRenames).length > 0) {
    for (const item of automations.items) {
      if (!isMap(item)) continue;
      const when = item.get('when', true);
      if (!isMap(when)) continue;
      const to = when.get('to');
      if (typeof to === 'string' && to in statusRenames) when.set('to', statusRenames[to]);
      const from = when.get('from');
      if (typeof from === 'string' && from in statusRenames) when.set('from', statusRenames[from]);
      const type = when.get('type');
      if (typeof type === 'string' && type in typeRenames) when.set('type', typeRenames[type]);
    }
  }
  applyWorkflowFlow(doc);
  writeFileSync(abs, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));

  if (!ctx.skipReindex) reindex(root, ctx);
}

/**
 * Renames the project (or edits other editable manifest fields). Only `name`
 * is user-editable; `project_id`, `created`, `spec_version` and `paths` are
 * managed by the tooling. Patches the name node in place so any comments and
 * other keys in manifest.yaml survive.
 */
export async function writeManifest(
  root: string,
  changes: { name?: string },
  ctx: MutationContext = {},
): Promise<void> {
  const project = loadProject(root);
  const abs = join(project.dir, 'manifest.yaml');
  const doc = parseDocument(readFileSync(abs, 'utf8'));
  if (changes.name !== undefined) {
    const name = String(changes.name).trim();
    if (name === '') throw new MutationError('project name cannot be empty');
    doc.set('name', name);
  }
  writeFileSync(abs, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
  if (!ctx.skipReindex) reindex(root, ctx);
}

/** Counts how many tickets, sessions and comments point at an actor id. */
function countActorRefs(project: Project, id: string): number {
  let n = 0;
  for (const t of project.tickets) if (t.fields.assignee === id) n += 1;
  for (const s of project.sessions) if (s.actor === id) n += 1;
  for (const c of project.comments) if (c.actor === id) n += 1;
  return n;
}

/**
 * Replaces the project's actors (actors.yaml). Enforces the spec's rules
 * (exactly one human, unique lowercase ids, a name per actor) and blocks
 * removing an actor still referenced by a ticket assignee, a session or a
 * comment, since that would break link integrity. Renaming an actor's id is
 * not supported here: it would need to cascade into every reference, so the
 * editor keeps ids stable and only adds, renames the display name, or removes
 * an unreferenced actor.
 */
export async function writeActors(
  root: string,
  actors: unknown,
  ctx: MutationContext = {},
): Promise<Actor[]> {
  const project = loadProject(root);
  if (!Array.isArray(actors)) throw new MutationError('actors must be a list');

  const next: Actor[] = [];
  const ids = new Set<string>();
  for (const raw of actors) {
    const a = (raw ?? {}) as Partial<Actor>;
    const id = typeof a.id === 'string' ? a.id.trim() : '';
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new MutationError(`actor id "${String(a.id ?? '')}" must be lowercase letters, digits and hyphens`);
    }
    if (name === '') throw new MutationError(`actor "${id}" needs a name`);
    if (a.kind !== 'human' && a.kind !== 'agent') {
      throw new MutationError(`actor "${id}" kind must be human or agent`);
    }
    if (ids.has(id)) throw new MutationError(`duplicate actor id "${id}"`);
    ids.add(id);
    next.push({ id, name, kind: a.kind });
  }

  if (next.filter((a) => a.kind === 'human').length !== 1) {
    throw new MutationError('exactly one actor must have kind: human');
  }

  for (const a of project.actors) {
    if (ids.has(a.id)) continue;
    const refs = countActorRefs(project, a.id);
    if (refs > 0) {
      throw new MutationError(
        `cannot remove actor "${a.id}": still referenced ${refs} time${refs === 1 ? '' : 's'} by tickets, sessions or comments; reassign them first`,
      );
    }
  }

  const abs = join(project.dir, 'actors.yaml');
  const doc = parseDocument(readFileSync(abs, 'utf8'));
  doc.set(
    'actors',
    next.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
  );
  writeFileSync(abs, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
  if (!ctx.skipReindex) reindex(root, ctx);
  return next;
}

export interface LogSessionInput {
  ticket: string;
  actor: string;
  approach: string;
  whatHappened?: string;
  outcome: string;
  commits?: string[];
  openQuestions?: string[];
  started?: string;
  ended?: string;
}

export async function logSession(
  root: string,
  input: LogSessionInput,
  ctx: MutationContext = {},
): Promise<{ id: string; path: string }> {
  const project = loadProject(root);
  if (!project.tickets.some((t) => t.id === input.ticket)) {
    throw new MutationError(`ticket "${input.ticket}" does not exist`);
  }
  if (!project.actors.some((a) => a.id === input.actor)) {
    throw new MutationError(`actor "${input.actor}" is not in actors.yaml`);
  }
  if (!(SESSION_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new MutationError(`outcome must be one of: ${SESSION_OUTCOMES.join(', ')}`);
  }
  const id = await nextId(project.dir, project.manifest, 'S');
  const stamp = isoNow(ctx);
  const ordered: Array<[string, unknown]> = [
    ['id', id],
    ['ticket', input.ticket],
    ['actor', input.actor],
    ['started', input.started ?? stamp],
    ['ended', input.ended ?? stamp],
    ['commits', input.commits ?? []],
    ['outcome', input.outcome],
  ];
  const questions = (input.openQuestions ?? []).filter((q) => q.trim().length > 0);
  const body = [
    '## Approach',
    '',
    input.approach.trim(),
    '',
    '## What happened',
    '',
    (input.whatHappened ?? '').trim() || '(not recorded)',
    '',
    '## Open questions',
    '',
    questions.length > 0 ? questions.map((q) => `- ${q.trim()}`).join('\n') : '- None.',
    '',
  ].join('\n');
  const sessionsDir = join(project.dir, project.manifest.paths.sessions);
  mkdirSync(sessionsDir, { recursive: true });
  const path = join(sessionsDir, `${id}.md`);
  writeFileSync(path, `---\n${buildFrontmatterYaml(ordered)}---\n\n${body.trimEnd()}\n`);
  reindex(root, ctx);
  return { id, path };
}

export interface AddCommentInput {
  ticket: string;
  actor: string;
  body: string;
}

export async function addComment(
  root: string,
  input: AddCommentInput,
  ctx: MutationContext = {},
): Promise<{ path: string }> {
  const project = loadProject(root);
  if (!project.tickets.some((t) => t.id === input.ticket)) {
    throw new MutationError(`ticket "${input.ticket}" does not exist`);
  }
  if (!project.actors.some((a) => a.id === input.actor)) {
    throw new MutationError(`actor "${input.actor}" is not in actors.yaml`);
  }
  const stamp = isoNow(ctx);
  const fileStamp = stamp.slice(0, 16).replace(/:/g, '');
  const dir = join(project.dir, project.manifest.paths.comments, input.ticket);
  mkdirSync(dir, { recursive: true });
  let path = join(dir, `${fileStamp}-${input.actor}.md`);
  let suffix = 1;
  while (existsSync(path)) {
    path = join(dir, `${fileStamp}-${input.actor}-${suffix}.md`);
    suffix += 1;
  }
  const ordered: Array<[string, unknown]> = [
    ['ticket', input.ticket],
    ['actor', input.actor],
    ['created', stamp],
  ];
  writeFileSync(path, `---\n${buildFrontmatterYaml(ordered)}---\n\n${input.body.trim()}\n`);
  reindex(root, ctx);
  return { path };
}

/** Writes the active ticket pointer in state/. */
export function setActiveTicket(root: string, id: string | null): void {
  const project = loadProject(root);
  const stateDir = join(project.dir, project.manifest.paths.state);
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, 'active_ticket');
  if (id === null) {
    if (existsSync(file)) writeFileSync(file, '');
    return;
  }
  if (!project.tickets.some((t) => t.id === id)) {
    throw new MutationError(`ticket "${id}" does not exist`);
  }
  writeFileSync(file, `${id}\n`);
}

export function getActiveTicket(root: string): string | null {
  const project = loadProject(root);
  const file = join(project.dir, project.manifest.paths.state, 'active_ticket');
  if (!existsSync(file)) return null;
  const id = readFileSync(file, 'utf8').trim();
  return id.length > 0 ? id : null;
}
