import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Document, parseDocument } from 'yaml';
import { pruneFromBoardOrder, renameBoardOrderColumns } from './order.js';
import { defaultStatus, loadManifest, validateSchema } from './config.js';
import { applySchemaFlow, mergeStatus, mergeType } from './schema-config.js';
import { applyDefaults, fieldsForType, validateTicketFields } from './fields.js';
import { parseFrontmatter } from './frontmatter.js';
import { nextId } from './ids.js';
import { loadProject } from './project.js';
import { writeIndex } from './index-gen.js';
import type {
  AgentPresence,
  Actor,
  Project,
  StatusDef,
  Ticket,
  TypeDef,
  ValidationIssue,
  Schema,
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
  /** Starting status; must exist in schema.yaml. Defaults to the first status. */
  status?: string;
}

/**
 * Rejects a fields object holding a key that is neither one of `extra`
 * (letting update pass "status" through) nor defined on the type. "body" is
 * a common mistake since it looks like a field but is not frontmatter, so it
 * gets its own message pointing at the right parameter.
 */
function rejectUnknownFields(
  schema: Schema,
  type: string,
  fields: Record<string, unknown>,
  extra: readonly string[] = [],
): void {
  const defs = fieldsForType(schema, type);
  const known = new Set<string>([...defs.map((d) => d.name), ...extra]);
  for (const key of Object.keys(fields)) {
    if (known.has(key)) continue;
    if (key === 'body') {
      throw new MutationError('"body" is not a frontmatter field; pass the ticket body with the body parameter');
    }
    throw new MutationError(
      `unknown field "${key}" for type "${type}"; defined fields: ${defs.map((d) => d.name).join(', ')}`,
    );
  }
}

export async function createTicket(
  root: string,
  input: CreateTicketInput,
  ctx: MutationContext = {},
): Promise<Ticket> {
  const project = loadProject(root);
  const typeDef = project.schema.types.find((t) => t.name === input.type);
  if (!typeDef) {
    throw new MutationError(
      `unknown ticket type "${input.type}"; defined types: ${project.schema.types.map((t) => t.name).join(', ')}`,
    );
  }
  for (const key of Object.keys(input.fields)) {
    if ((CORE_FIELDS as readonly string[]).includes(key)) {
      throw new MutationError(`"${key}" is a locked core field and cannot be set directly`);
    }
  }
  rejectUnknownFields(project.schema, input.type, input.fields);
  const fields = applyDefaults(project.schema, input.type, input.fields);
  const issues = validateTicketFields(project.schema, input.type, fields, '(new ticket)').filter(
    (i) => i.severity === 'error',
  );
  if (issues.length > 0) {
    throw new MutationError(`invalid fields: ${issues.map((i) => i.message).join('; ')}`, issues);
  }

  if (input.status !== undefined && !project.schema.statuses.some((s) => s.name === input.status)) {
    throw new MutationError(`unknown status "${input.status}"`);
  }
  const id = await nextId(project.dir, project.manifest, typeDef.id_prefix);
  const stamp = isoNow(ctx);
  const ordered: Array<[string, unknown]> = [
    ['id', id],
    ['type', input.type],
    ['status', input.status ?? defaultStatus(project.schema)],
    ['created', stamp],
    ['updated', stamp],
  ];
  for (const def of fieldsForType(project.schema, input.type)) {
    if (fields[def.name] !== undefined) ordered.push([def.name, fields[def.name]]);
  }
  // A body is optional; when absent (or blank), the file carries frontmatter
  // only, with no dangling blank line after the closing fence.
  const body = (input.body ?? '').trimEnd();
  const content =
    body === ''
      ? `---\n${buildFrontmatterYaml(ordered)}---\n`
      : `---\n${buildFrontmatterYaml(ordered)}---\n\n${body}\n`;
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
}

export interface UpdateTicketInput {
  /** Field changes; include "status" to move the ticket; null removes a field. */
  fields?: Record<string, unknown>;
  /** When set, replaces the whole markdown body. Undefined leaves the body untouched. */
  body?: string;
}

/**
 * Updates defined fields and, when "status" is included, moves the ticket.
 * Any status defined in schema.yaml is a legal move; there is no configured
 * flow to gate it. Edits preserve the file's existing frontmatter
 * formatting; only changed keys are touched. A body, when given, replaces
 * the whole body using the same blank-body handling as createTicket.
 */
export async function updateTicket(
  root: string,
  id: string,
  input: UpdateTicketInput,
  ctx: MutationContext = {},
): Promise<UpdateResult> {
  const project = loadProject(root);
  const ticket = project.tickets.find((t) => t.id === id);
  if (!ticket) {
    throw new MutationError(`ticket "${id}" does not exist`);
  }
  const changes = input.fields ?? {};
  // An update carrying nothing would still rewrite the file to stamp
  // `updated`, so an empty call is rejected rather than producing churn.
  if (Object.keys(changes).length === 0 && input.body === undefined) {
    throw new MutationError('nothing to update: pass field changes or a body');
  }
  for (const key of Object.keys(changes)) {
    if (key !== 'status' && (CORE_FIELDS as readonly string[]).includes(key)) {
      throw new MutationError(`"${key}" is a locked core field and cannot be edited`);
    }
  }
  // A hand-edited ticket can carry a type the schema no longer defines. Its
  // fields cannot be checked against anything, so field edits are refused
  // with the real cause named; a status move stays legal so the ticket can
  // still be parked or closed.
  if (project.schema.types.some((t) => t.name === ticket.type)) {
    rejectUnknownFields(project.schema, ticket.type, changes, ['status']);
  } else if (Object.keys(changes).some((k) => k !== 'status')) {
    throw new MutationError(
      `ticket "${id}" has unknown type "${ticket.type}"; correct the type in the file before editing fields`,
    );
  }

  // A non-string status would otherwise be dropped silently, reporting
  // success for a move that never happened.
  if ('status' in changes && typeof changes.status !== 'string') {
    throw new MutationError('status must be a string naming a status defined in schema.yaml');
  }
  const to = typeof changes.status === 'string' ? changes.status : undefined;
  if (to !== undefined && !project.schema.statuses.some((s) => s.name === to)) {
    throw new MutationError(`unknown status "${to}"`);
  }

  const { status: _status, ...fieldChanges } = changes;
  const merged = { ...ticket.fields, ...fieldChanges };
  for (const [key, value] of Object.entries(fieldChanges)) {
    if (value === null) delete merged[key];
  }
  const issues = validateTicketFields(project.schema, ticket.type, merged, ticket.path).filter(
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
  const fm = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  let newText: string;
  if (input.body === undefined) {
    newText = `---\n${fm}---\n${parsed.body}`;
  } else {
    const body = input.body.trimEnd();
    newText = body === '' ? `---\n${fm}---\n` : `---\n${fm}---\n\n${body}\n`;
  }
  writeFileSync(abs, newText);

  const after = reindex(root, ctx);
  const updated = after.tickets.find((t) => t.id === id);
  if (!updated) throw new MutationError(`ticket ${id} was updated but could not be read back`);
  return { ticket: updated };
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

/** A rename maps an old machine name to its new one, per schema section. */
export interface SchemaRenames {
  statuses?: Record<string, string>;
  types?: Record<string, string>;
  priorities?: Record<string, string>;
}

/**
 * A schema-editor save. Each section present replaces its counterpart;
 * omitted sections are kept. `renames` carries the editor's in-place name
 * changes so they cascade to existing data rather than stranding it.
 */
export interface SchemaEdit {
  types?: TypeDef[];
  statuses?: StatusDef[];
  priorities?: string[];
  renames?: SchemaRenames;
}

/** Remaps a name through a rename map, leaving unmapped names untouched. */
function remap(map: Record<string, string>, name: string): string {
  return name in map ? map[name]! : name;
}

/**
 * Finds the previously loaded item a candidate type or status corresponds
 * to, so its unknown keys can be carried forward. Identity follows the
 * renames map before the name: in a single save one rename can vacate a
 * name another node takes (a swap or a chain), so a direct name match is
 * only trusted when no rename produced this name and the old holder of the
 * name was not renamed away.
 */
function matchOld<T extends { name: string }>(
  newName: string,
  oldByName: Map<string, T>,
  renames: Record<string, string>,
): T | undefined {
  const renamedFrom = Object.entries(renames).find(([, to]) => to === newName)?.[0];
  if (renamedFrom !== undefined) return oldByName.get(renamedFrom);
  if (newName in renames) return undefined;
  return oldByName.get(newName);
}

/**
 * Persists a schema-editor save to schema.yaml. Renames cascade to existing
 * tickets and the board order, so nothing dangles. Removing a status or type
 * that tickets still use, or a priority still in use, is blocked with a
 * message naming the count, because those would strand tickets in an
 * invalid state. Structure is validated with the same rules the validator
 * enforces before anything is written. Each schema node is patched in
 * place, so hand-authored comments elsewhere survive.
 */
export async function writeSchema(
  root: string,
  edit: SchemaEdit,
  ctx: MutationContext = {},
): Promise<void> {
  const project = loadProject(root);
  const current = project.schema;
  const statusRenames = edit.renames?.statuses ?? {};
  const typeRenames = edit.renames?.types ?? {};
  const prioRenames = edit.renames?.priorities ?? {};

  // Assemble the candidate: a provided section replaces, an omitted one is
  // kept. A field's refers_to can reference a renamed type, so it is
  // remapped even when the caller sent the old names.
  const statuses = edit.statuses ?? current.statuses;
  const types = (edit.types ?? current.types).map((t) => ({
    ...t,
    fields: t.fields.map((f) => ({
      ...f,
      ...(f.refers_to ? { refers_to: f.refers_to.map((x) => remap(typeRenames, x)) } : {}),
    })),
  }));
  const priorities = edit.priorities ?? current.priorities;

  const candidate: Schema = { types, statuses, priorities };

  // The enum fields whose values are the priorities list; a removed priority
  // is "in use" if any ticket holds it in one of these.
  const prioFields = new Set<string>();
  for (const t of types) {
    for (const f of t.fields) {
      if (f.type === 'enum' && f.values_from === 'priorities') prioFields.add(f.name);
    }
  }

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
    const n = project.tickets.filter((t) => [...prioFields].some((pf) => t.fields[pf] === p)).length;
    if (n > 0) {
      throw new MutationError(
        `cannot remove priority "${p}": ${n} ticket${n === 1 ? '' : 's'} still use it`,
      );
    }
  }

  // Structural validation: the same errors the validator would report.
  const issues = validateSchema(candidate, '.lovelace/schema.yaml').filter(
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
  // Build real YAML nodes via createNode (not plain JS) so applySchemaFlow's
  // isSeq/isMap guards fire and the scalar arrays keep their compact flow style;
  // a plain doc.set stores JS values that reflow to block style on every save.
  // Types and statuses are merged, not just compacted: a matched old item
  // (by name, or through the renames map) carries its unknown keys forward
  // so a save does not destroy a newer-minor or hand-authored construct
  // (ADR-0011).
  const oldTypeByName = new Map(current.types.map((t) => [t.name, t] as const));
  const oldStatusByName = new Map(current.statuses.map((s) => [s.name, s] as const));
  const abs = join(project.dir, 'schema.yaml');
  const doc = parseDocument(readFileSync(abs, 'utf8'));
  doc.set(
    'types',
    doc.createNode(candidate.types.map((t) => mergeType(t, matchOld(t.name, oldTypeByName, typeRenames)))),
  );
  doc.set(
    'statuses',
    doc.createNode(
      candidate.statuses.map((s) => mergeStatus(s, matchOld(s.name, oldStatusByName, statusRenames))),
    ),
  );
  doc.set('priorities', doc.createNode([...candidate.priorities]));
  applySchemaFlow(doc);
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
  changes: { name?: string; presence_timeout_minutes?: number | null },
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
  if (changes.presence_timeout_minutes !== undefined) {
    // null clears the key back to the tooling default, keeping files clean.
    if (changes.presence_timeout_minutes === null) {
      doc.delete('presence_timeout_minutes');
    } else {
      const minutes = Number(changes.presence_timeout_minutes);
      if (!Number.isInteger(minutes) || minutes <= 0) {
        throw new MutationError('presence timeout must be a positive whole number of minutes');
      }
      doc.set('presence_timeout_minutes', minutes);
    }
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

// At least one alphanumeric, so the dot-only names "." and ".." can never
// pass and navigate out of the active/ directory.
const SESSION_ID_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]+$/;

/**
 * Writes the active-ticket pointer for one Claude Code session
 * (state/active/<session-id>), so concurrent sessions do not share the
 * singleton slot. A session ID outside the safe pattern is silently
 * refused rather than used to build a path.
 */
export function writeSessionActiveTicket(root: string, sessionId: string, id: string | null): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  const project = loadProject(root);
  const dir = join(project.dir, project.manifest.paths.state, 'active');
  const file = join(dir, sessionId);
  if (id === null) {
    if (existsSync(file)) rmSync(file);
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${id}\n`);
}

/** The active-ticket pointer for one Claude Code session, or null when it never claimed one. */
export function readSessionActiveTicket(root: string, sessionId: string): string | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;
  const project = loadProject(root);
  const file = join(project.dir, project.manifest.paths.state, 'active', sessionId);
  if (!existsSync(file)) return null;
  const id = readFileSync(file, 'utf8').trim();
  return id.length > 0 ? id : null;
}

/** The default stale cap when the manifest does not set presence_timeout_minutes, in minutes. */
export const DEFAULT_PRESENCE_TIMEOUT_MINUTES = 15;

/** Parses one presence entry file; a torn write or a missing started_at is not an error state, just no entry. */
function parsePresenceFile(file: string): AgentPresence | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentPresence>;
    if (typeof raw.started_at !== 'string') return null;
    const presence: AgentPresence = {
      ticket: typeof raw.ticket === 'string' ? raw.ticket : null,
      actor: typeof raw.actor === 'string' ? raw.actor : null,
      started_at: raw.started_at,
    };
    if (typeof raw.beat_at === 'string') presence.beat_at = raw.beat_at;
    return presence;
  } catch {
    return null;
  }
}

/**
 * Deletes presence entries whose last heartbeat (or started_at, when no
 * heartbeat has landed) is older than the cap. Called from writePresence,
 * once per turn; never from beatPresence, which stays on the hot path.
 */
function gcPresence(presenceDir: string, capMinutes: number): void {
  if (!existsSync(presenceDir)) return;
  const capMs = capMinutes * 60_000;
  const now = Date.now();
  for (const name of readdirSync(presenceDir)) {
    if (!name.endsWith('.json')) continue;
    const file = join(presenceDir, name);
    const presence = parsePresenceFile(file);
    if (!presence) continue; // a torn entry cannot be timed; leave it for readPresences to skip
    const age = now - Date.parse(presence.beat_at ?? presence.started_at);
    if (Number.isNaN(age) || age > capMs) rmSync(file);
  }
}

/**
 * Writes one session's live agent marker; presence-start calls this once per
 * turn. A session ID outside the safe pattern is silently refused, exactly
 * like writeSessionActiveTicket. Also removes the legacy singleton
 * state/presence.json when still present (cleanup of a pre-3.2 marker on
 * the write path, per SPEC 3.2.0) and prunes entries the heartbeat cap has
 * outlived.
 */
export function writePresence(root: string, sessionId: string, presence: AgentPresence): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  const project = loadProject(root);
  const stateDir = join(project.dir, project.manifest.paths.state);
  const presenceDir = join(stateDir, 'presence');
  mkdirSync(presenceDir, { recursive: true });
  writeFileSync(join(presenceDir, `${sessionId}.json`), `${JSON.stringify(presence, null, 2)}\n`);
  const legacy = join(stateDir, 'presence.json');
  if (existsSync(legacy)) rmSync(legacy);
  gcPresence(presenceDir, project.manifest.presence_timeout_minutes ?? DEFAULT_PRESENCE_TIMEOUT_MINUTES);
}

/**
 * Removes one session's live agent marker; the hooks call this when a
 * passing stop or a session end lets the turn finish. Also removes the
 * legacy singleton state/presence.json, if a pre-3.2 marker is still there.
 */
export function clearPresence(root: string, sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  const project = loadProject(root);
  const stateDir = join(project.dir, project.manifest.paths.state);
  const file = join(stateDir, 'presence', `${sessionId}.json`);
  if (existsSync(file)) rmSync(file);
  const legacy = join(stateDir, 'presence.json');
  if (existsSync(legacy)) rmSync(legacy);
}

/**
 * Every live session's presence entry, plus the legacy singleton
 * state/presence.json read as one more entry when it is still around (a
 * pre-3.2 project, or a marker not yet swept by a write). A torn or foreign
 * file is not an error state; it is skipped. Sorted by started_at then
 * filename so output is deterministic. Missing state/presence/ means [].
 */
export function readPresences(root: string): AgentPresence[] {
  const project = loadProject(root);
  const stateDir = join(project.dir, project.manifest.paths.state);
  const presenceDir = join(stateDir, 'presence');
  const entries: Array<{ file: string; presence: AgentPresence }> = [];

  if (existsSync(presenceDir)) {
    // presence/ existing but not a directory (foreign junk, same stance as
    // parsePresenceFile) reads as no entries rather than throwing ENOTDIR.
    let names: string[] = [];
    try {
      names = readdirSync(presenceDir).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const presence = parsePresenceFile(join(presenceDir, name));
      if (presence) entries.push({ file: name, presence });
    }
  }
  const legacy = join(stateDir, 'presence.json');
  if (existsSync(legacy)) {
    const presence = parsePresenceFile(legacy);
    if (presence) entries.push({ file: 'presence.json', presence });
  }

  return entries
    .sort((a, b) => a.presence.started_at.localeCompare(b.presence.started_at) || a.file.localeCompare(b.file))
    .map((e) => e.presence);
}

/**
 * The turn's heartbeat: called on every tool use, so it must stay far
 * lighter than loadProject (which parses every ticket). Resolves state/
 * from manifest.yaml alone, re-resolves the focus ticket from
 * state/active/<session-id> falling back to state/active_ticket (the same
 * plain reads and trim semantics as readSessionActiveTicket/
 * getActiveTicket), and writes the entry back with a fresh beat_at while
 * preserving started_at and actor. Creates a missing entry rather than
 * doing nothing, so a beat after the entry has been garbage-collected still
 * lights the ring on the next paint. Never runs garbage collection; that is
 * writePresence's job, once per turn.
 */
export function beatPresence(root: string, sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  const lovelaceDir = join(root, '.lovelace');
  const manifest = loadManifest(lovelaceDir);
  const stateDir = join(lovelaceDir, manifest.paths.state);
  const now = `${new Date().toISOString().slice(0, 19)}Z`;

  const readTrimmed = (file: string): string | null => {
    if (!existsSync(file)) return null;
    const value = readFileSync(file, 'utf8').trim();
    return value.length > 0 ? value : null;
  };
  const ticket =
    readTrimmed(join(stateDir, 'active', sessionId)) ?? readTrimmed(join(stateDir, 'active_ticket'));

  const presenceDir = join(stateDir, 'presence');
  const entryFile = join(presenceDir, `${sessionId}.json`);
  const existing = parsePresenceFile(entryFile);
  const entry: AgentPresence = {
    ticket,
    actor: existing?.actor ?? null,
    started_at: existing?.started_at ?? now,
    beat_at: now,
  };

  mkdirSync(presenceDir, { recursive: true });
  writeFileSync(entryFile, `${JSON.stringify(entry, null, 2)}\n`);

  const legacy = join(stateDir, 'presence.json');
  if (existsSync(legacy)) rmSync(legacy);
}

export function getActiveTicket(root: string): string | null {
  const project = loadProject(root);
  const file = join(project.dir, project.manifest.paths.state, 'active_ticket');
  if (!existsSync(file)) return null;
  const id = readFileSync(file, 'utf8').trim();
  return id.length > 0 ? id : null;
}
