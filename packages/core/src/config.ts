import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, LineCounter } from 'yaml';
import { z } from 'zod';
import type { Actor, Manifest, ProjectPaths, ValidationIssue, Workflow } from './types.js';
import { SUPPORTED_SPEC_MAJOR } from './types.js';

const DEFAULT_PATHS: ProjectPaths = {
  tickets: 'tickets',
  documentation: 'documentation',
  comments: 'comments',
  sessions: 'sessions',
  templates: 'templates',
  index: 'index',
  state: 'state',
};

const manifestSchema = z.object({
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
});

const fieldTypeSchema = z.enum(['string', 'number', 'boolean', 'date', 'enum', 'list', 'reference']);

const fieldDefSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'field names are lowercase identifiers'),
  type: fieldTypeSchema,
  label: z.string().optional(),
  values: z.array(z.string()).optional(),
  values_from: z.string().optional(),
  item_type: fieldTypeSchema.exclude(['list']).optional(),
  refers_to: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  applies_to: z.array(z.string()).optional(),
});

const automationRuleSchema = z
  .object({
    when: z.record(z.unknown()).and(z.object({ to: z.string() })),
    run: z.string().optional(),
    agent: z.string().optional(),
  })
  .refine((r) => (r.run === undefined) !== (r.agent === undefined), {
    message: 'each on_transition rule needs exactly one of run or agent',
  });

/** The on_transition list, validated for app-side writes (CRUD). */
export const automationListSchema = z.array(automationRuleSchema);

const workflowSchema = z.object({
  types: z
    .array(
      z.object({
        name: z.string().min(1),
        id_prefix: z.string().regex(/^[A-Z]+$/),
        label: z.string().optional(),
        plural: z.string().optional(),
      }),
    )
    .min(1),
  statuses: z
    .array(
      z.object({
        name: z.string().min(1),
        active: z.boolean().optional(),
        complete: z.boolean().optional(),
        label: z.string().optional(),
      }),
    )
    .min(1),
  transitions: z.array(z.object({ from: z.string(), to: z.array(z.string()).min(1) })).default([]),
  priorities: z.array(z.string()).default([]),
  fields: z.array(fieldDefSchema).default([]),
  on_transition: z.array(automationRuleSchema).default([]),
});

const actorsSchema = z.object({
  actors: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), kind: z.enum(['human', 'agent']) }))
    .min(1),
});

export class ConfigError extends Error {
  constructor(
    message: string,
    public file: string,
    public line?: number,
  ) {
    super(message);
    this.name = 'ConfigError';
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
  const major = Number(manifest.spec_version.split('.')[0]);
  if (major !== SUPPORTED_SPEC_MAJOR) {
    throw new ConfigError(
      `manifest declares spec version ${manifest.spec_version}, but this tooling supports major version ${SUPPORTED_SPEC_MAJOR} only`,
      relPath,
    );
  }
  return manifest;
}

export function loadWorkflow(dir: string, rel = '.lovelace'): Workflow {
  const relPath = `${rel}/workflow.yaml`;
  const raw = parseYamlFile(join(dir, 'workflow.yaml'), relPath);
  const result = workflowSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(zodIssueToMessage(result.error), relPath);
  }
  return result.data as Workflow;
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

/** Static checks on the workflow definition itself. */
export function validateWorkflow(workflow: Workflow, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (rule: string, message: string) =>
    issues.push({ severity: 'error', file, rule, message });

  const statusNames = new Set(workflow.statuses.map((s) => s.name));
  const typeNames = new Set(workflow.types.map((t) => t.name));
  const fieldNames = new Set<string>();

  for (const field of workflow.fields) {
    if (fieldNames.has(field.name)) {
      err('workflow/duplicate-field', `field "${field.name}" is defined twice`);
    }
    fieldNames.add(field.name);
    if (['id', 'type', 'status', 'created', 'updated'].includes(field.name)) {
      err('workflow/core-field', `"${field.name}" is a locked core field and cannot be redefined`);
    }
    if (field.type === 'enum' && !field.values && field.values_from !== 'priorities') {
      err('workflow/enum-values', `enum field "${field.name}" needs values or values_from: priorities`);
    }
    if (field.type === 'list' && !field.item_type) {
      err('workflow/list-item-type', `list field "${field.name}" needs an item_type`);
    }
    for (const t of field.applies_to ?? []) {
      if (!typeNames.has(t)) {
        err('workflow/unknown-type', `field "${field.name}" applies_to unknown type "${t}"`);
      }
    }
    for (const target of field.refers_to ?? []) {
      if (!typeNames.has(target) && !['actor', 'document'].includes(target)) {
        err('workflow/unknown-ref-target', `field "${field.name}" refers_to unknown kind "${target}"`);
      }
    }
  }

  for (const t of workflow.transitions) {
    if (!statusNames.has(t.from)) {
      err('workflow/unknown-status', `transition from unknown status "${t.from}"`);
    }
    for (const to of t.to) {
      if (!statusNames.has(to)) {
        err('workflow/unknown-status', `transition to unknown status "${to}"`);
      }
    }
  }

  for (const rule of workflow.on_transition) {
    const { to, from, type, ...rest } = rule.when;
    if (!statusNames.has(to)) {
      err('automation/unknown-status', `on_transition rule targets unknown status "${to}"`);
    }
    if (from !== undefined && !statusNames.has(String(from))) {
      err('automation/unknown-status', `on_transition rule matches unknown from status "${from}"`);
    }
    if (type !== undefined && !typeNames.has(String(type))) {
      err('automation/unknown-type', `on_transition rule matches unknown type "${type}"`);
    }
    for (const key of Object.keys(rest)) {
      if (!fieldNames.has(key)) {
        err('automation/unknown-field', `on_transition rule matches unknown field "${key}"`);
      }
    }
  }

  return issues;
}

export function defaultStatus(workflow: Workflow): string {
  return workflow.statuses[0]?.name ?? 'backlog';
}

export function isLegalTransition(workflow: Workflow, from: string, to: string): boolean {
  if (from === to) return true;
  return workflow.transitions.some((t) => t.from === from && t.to.includes(to));
}
