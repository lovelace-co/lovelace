import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Document, parseDocument, isSeq, isMap } from 'yaml';
import { pruneFromBoardOrder } from './order.js';
import { isLegalTransition, defaultStatus, validateWorkflow, automationListSchema } from './config.js';
import { applyDefaults, fieldsForType, validateTicketFields } from './fields.js';
import { parseFrontmatter } from './frontmatter.js';
import { nextId } from './ids.js';
import { matchRules } from './automation.js';
import { loadProject } from './project.js';
import { writeIndex } from './index-gen.js';
import type { AutomationRule, Project, Ticket, ValidationIssue } from './types.js';
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
