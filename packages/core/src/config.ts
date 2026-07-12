import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, LineCounter } from 'yaml';
import { z } from 'zod';
import type { Actor, Manifest, ProjectPaths, ValidationIssue, Schema } from './types.js';
import { classifySpecVersion, SPEC_VERSION, SUPPORTED_SPEC_MAJOR } from './version.js';

const DEFAULT_PATHS: ProjectPaths = {
  tickets: 'tickets',
  documentation: 'documentation',
  comments: 'comments',
  sessions: 'sessions',
  templates: 'templates',
  index: 'index',
  state: 'state',
};

// Every manifest and schema.yaml object level uses .passthrough() rather
// than the zod default of stripping unknown keys (ADR-0011: tolerant reads,
// non-destructive writes). A newer-minor project's constructs survive
// parsing so validateSchema/validateProject can warn on them and writeSchema
// can carry them forward instead of destroying them. The manifest's nested
// `paths` object deliberately keeps zod's default strip behaviour (unknown
// keys drop from the parse without a warning): it is a closed, tooling-owned
// set of directory names, not a place hand edits or future minors add to,
// and writeManifest patches in place so the file keeps them anyway.
const manifestSchema = z
  .object({
    spec_version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a semver string'),
    project_id: z.string().min(8),
    name: z.string().min(1),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    presence_timeout_minutes: z.number().int().positive().optional(),
    paths: z
      .object({
        tickets: z.string().default('tickets'),
        documentation: z.string().default('documentation'),
        comments: z.string().default('comments'),
        sessions: z.string().default('sessions'),
        templates: z.string().default('templates'),
        index: z.string().default('index'),
        state: z.string().default('state'),
      })
      .default(DEFAULT_PATHS),
  })
  .passthrough();

const fieldTypeSchema = z.enum(['string', 'number', 'boolean', 'date', 'enum', 'list', 'reference']);

const fieldDefSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'field names are lowercase identifiers'),
    type: fieldTypeSchema,
    label: z.string().optional(),
    values: z.array(z.string()).optional(),
    values_from: z.string().optional(),
    item_type: fieldTypeSchema.exclude(['list']).optional(),
    refers_to: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })
  .passthrough();

const statusAgentSchema = z.enum(['ready', 'in_progress', 'complete']);

const typeSchema = z
  .object({
    name: z.string().min(1),
    id_prefix: z.string().regex(/^[A-Z]+$/),
    label: z.string().optional(),
    plural: z.string().optional(),
    fields: z.array(fieldDefSchema).default([]),
  })
  .passthrough();

const statusSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().optional(),
    agent: statusAgentSchema.optional(),
  })
  .passthrough();

const schemaConfig = z
  .object({
    types: z.array(typeSchema).min(1),
    statuses: z.array(statusSchema).min(1),
    priorities: z.array(z.string()).default([]),
  })
  .passthrough();

const actorsSchema = z.object({
  actors: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), kind: z.enum(['human', 'agent']) }))
    .min(1),
});

// Known-key sets, derived from the zod shapes rather than hand-maintained,
// so validateSchema's and writeSchema's notion of "unknown key" can never
// drift from what the parser actually recognises.
export const MANIFEST_KNOWN_KEYS = new Set(Object.keys(manifestSchema.shape));
const SCHEMA_KNOWN_KEYS = new Set(Object.keys(schemaConfig.shape));
export const TYPE_KNOWN_KEYS = new Set(Object.keys(typeSchema.shape));
export const STATUS_KNOWN_KEYS = new Set(Object.keys(statusSchema.shape));
export const FIELD_KNOWN_KEYS = new Set(Object.keys(fieldDefSchema.shape));

export class ConfigError extends Error {
  code?: 'spec-too-new' | 'spec-needs-migration';
  declared?: string;
  supported?: string;

  constructor(
    message: string,
    public file: string,
    public line?: number,
    extra?: { code?: 'spec-too-new' | 'spec-needs-migration'; declared?: string; supported?: string },
  ) {
    super(message);
    this.name = 'ConfigError';
    if (extra?.code !== undefined) this.code = extra.code;
    if (extra?.declared !== undefined) this.declared = extra.declared;
    if (extra?.supported !== undefined) this.supported = extra.supported;
  }
}

function parseYamlFile(absPath: string, relPath: string): unknown {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    throw new ConfigError('file is missing', relPath);
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const err = doc.errors[0];
  if (err) {
    const line = err.linePos?.[0]?.line;
    throw new ConfigError(err.message.split('\n')[0] ?? 'invalid YAML', relPath, line);
  }
  return doc.toJS() as unknown;
}

function zodIssueToMessage(e: z.ZodError): string {
  const first = e.issues[0];
  if (!first) return 'invalid configuration';
  const path = first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  return `${path}${first.message}`;
}

export function loadManifest(dir: string, rel = '.lovelace'): Manifest {
  const relPath = `${rel}/manifest.yaml`;
  const raw = parseYamlFile(join(dir, 'manifest.yaml'), relPath);
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(zodIssueToMessage(result.error), relPath);
  }
  const manifest = result.data as Manifest;
  const fit = classifySpecVersion(manifest.spec_version);
  if (fit === 'too-new') {
    throw new ConfigError(
      `this project uses spec version ${manifest.spec_version}, but this lovelace supports ${SUPPORTED_SPEC_MAJOR}.x; update lovelace to open it`,
      relPath,
      undefined,
      { code: 'spec-too-new', declared: manifest.spec_version, supported: SPEC_VERSION },
    );
  }
  if (fit === 'needs-migration') {
    throw new ConfigError(
      `this project uses spec version ${manifest.spec_version}, which is older than the supported ${SUPPORTED_SPEC_MAJOR}.x; open it in the lovelace app to migrate it`,
      relPath,
      undefined,
      { code: 'spec-needs-migration', declared: manifest.spec_version, supported: SPEC_VERSION },
    );
  }
  return manifest;
}

export function loadSchema(dir: string, rel = '.lovelace'): Schema {
  const relPath = `${rel}/schema.yaml`;
  const raw = parseYamlFile(join(dir, 'schema.yaml'), relPath);
  const result = schemaConfig.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(zodIssueToMessage(result.error), relPath);
  }
  return result.data as Schema;
}

export function loadActors(dir: string, rel = '.lovelace'): Actor[] {
  const relPath = `${rel}/actors.yaml`;
  const raw = parseYamlFile(join(dir, 'actors.yaml'), relPath);
  const result = actorsSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(zodIssueToMessage(result.error), relPath);
  }
  return result.data.actors;
}

/** Static checks on the schema definition itself. */
export function validateSchema(schema: Schema, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (rule: string, message: string) =>
    issues.push({ severity: 'error', file, rule, message });
  const warn = (message: string) =>
    issues.push({ severity: 'warning', file, rule: 'schema/unknown-key', message });

  // A construct this tooling does not recognise (a hand edit, or a
  // newer-minor field) is never an error: it surfaces as a warning naming
  // where it sits, and writeSchema carries it forward untouched (ADR-0011).
  for (const key of Object.keys(schema).filter((k) => !SCHEMA_KNOWN_KEYS.has(k))) {
    warn(`schema.yaml carries unknown top-level key "${key}"`);
  }
  for (const type of schema.types) {
    for (const key of Object.keys(type).filter((k) => !TYPE_KNOWN_KEYS.has(k))) {
      warn(`type "${type.name}" carries unknown key "${key}"`);
    }
    for (const field of type.fields) {
      for (const key of Object.keys(field).filter((k) => !FIELD_KNOWN_KEYS.has(k))) {
        warn(`field "${field.name}" of type "${type.name}" carries unknown key "${key}"`);
      }
    }
  }
  for (const status of schema.statuses) {
    for (const key of Object.keys(status).filter((k) => !STATUS_KNOWN_KEYS.has(k))) {
      warn(`status "${status.name}" carries unknown key "${key}"`);
    }
  }

  const typeNames = new Set(schema.types.map((t) => t.name));

  // Duplicate type or status names make lookups ambiguous (the first match
  // wins everywhere), so both are rejected outright.
  const seenTypes = new Set<string>();
  for (const type of schema.types) {
    if (seenTypes.has(type.name)) {
      err('schema/duplicate-type', `more than one type is named "${type.name}"`);
    }
    seenTypes.add(type.name);
  }
  const seenStatuses = new Set<string>();
  for (const status of schema.statuses) {
    if (seenStatuses.has(status.name)) {
      err('schema/duplicate-status', `more than one status is named "${status.name}"`);
    }
    seenStatuses.add(status.name);
  }

  for (const type of schema.types) {
    const fieldNames = new Set<string>();
    for (const field of type.fields) {
      if (fieldNames.has(field.name)) {
        err('schema/duplicate-field', `type "${type.name}" defines field "${field.name}" twice`);
      }
      fieldNames.add(field.name);
      if (['id', 'type', 'status', 'created', 'updated'].includes(field.name)) {
        err('schema/core-field', `"${field.name}" is a locked core field and cannot be redefined`);
      }
      if (field.type === 'enum' && !field.values && field.values_from !== 'priorities') {
        err('schema/enum-values', `enum field "${field.name}" needs values or values_from: priorities`);
      }
      if (field.type === 'list' && !field.item_type) {
        err('schema/list-item-type', `list field "${field.name}" needs an item_type`);
      }
      for (const target of field.refers_to ?? []) {
        if (!typeNames.has(target) && !['actor', 'document'].includes(target)) {
          err('schema/unknown-ref-target', `field "${field.name}" refers_to unknown kind "${target}"`);
        }
      }
    }
  }

  const roleCounts = new Map<string, number>();
  for (const status of schema.statuses) {
    if (!status.agent) continue;
    roleCounts.set(status.agent, (roleCounts.get(status.agent) ?? 0) + 1);
  }
  for (const [role, count] of roleCounts) {
    if (count > 1) {
      err('schema/duplicate-agent-role', `more than one status has agent role "${role}"`);
    }
  }

  return issues;
}

export function defaultStatus(schema: Schema): string {
  return schema.statuses[0]?.name ?? 'backlog';
}
