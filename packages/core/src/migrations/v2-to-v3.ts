import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LineCounter, parseDocument } from 'yaml';
import {
  FIELD_KNOWN_KEYS,
  STATUS_KNOWN_KEYS,
  TYPE_KNOWN_KEYS,
  loadSchema,
  validateSchema,
} from '../config.js';
import { MutationError } from '../mutate.js';
import { applySchemaFlow, compactField, compactStatus, compactType } from '../schema-config.js';
import type { FieldDef, StatusDef, TypeDef } from '../types.js';
import type { MigrationPlan, MigrationStep } from './types.js';

const WORKFLOW_REL_PATH = '.lovelace/workflow.yaml';

/** A 2.x field entry: a FieldDef plus the type-scoping key 3.0 removes. */
interface RawField extends FieldDef {
  applies_to?: string[];
}

interface RawType {
  name: string;
  id_prefix: string;
  label?: string;
  plural?: string;
}

interface RawStatus {
  name: string;
  active?: boolean;
  complete?: boolean;
  label?: string;
}

interface RawWorkflow {
  types: RawType[];
  statuses: RawStatus[];
  fields: RawField[];
  transitions?: unknown[];
  on_transition?: unknown[];
}

const DEFAULT_STATE_PATH = 'state';
const DEFAULT_INDEX_PATH = 'index';

/** The 2.x keys this step consumes on a field beyond the 3.0 shape. */
const FIELD_CONSUMED_KEYS = new Set<string>([...FIELD_KNOWN_KEYS, 'applies_to']);
/** The 2.x keys this step consumes on a status beyond the 3.0 shape. */
const STATUS_CONSUMED_KEYS = new Set<string>([...STATUS_KNOWN_KEYS, 'active', 'complete']);

/**
 * Keys on `source` this step does not consume, in file order. Carried
 * forward onto the generated node so a hand-added or newer-2.x-minor
 * construct survives instead of being silently dropped (mirrors
 * withUnknownKeys in schema-config.ts; the `consumed` set here also
 * includes the 2.x-only keys this step removes on purpose, so those are
 * never mistaken for a construct to preserve).
 */
function withExtraKeys(
  compacted: Record<string, unknown>,
  source: object | undefined,
  consumed: ReadonlySet<string>,
): Record<string, unknown> {
  if (!source) return compacted;
  const rec = source as unknown as Record<string, unknown>;
  const extra = Object.keys(rec).filter((k) => !consumed.has(k));
  if (extra.length === 0) return compacted;
  return { ...compacted, ...Object.fromEntries(extra.map((k) => [k, rec[k]])) };
}

/**
 * Reads and validates workflow.yaml before anything is written, so a
 * malformed 2.x project is refused up front with a clear message rather
 * than crashing raw or leaving a half-migrated project (schema.yaml written
 * and workflow.yaml gone, but nothing left the validator would accept).
 * Report, never repair: this never guesses at a missing or malformed shape.
 */
function readWorkflow(dir: string): { doc: ReturnType<typeof parseDocument>; raw: RawWorkflow } {
  let text: string;
  try {
    text = readFileSync(join(dir, 'workflow.yaml'), 'utf8');
  } catch {
    throw new MutationError(`${WORKFLOW_REL_PATH} is missing`);
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const err = doc.errors[0];
  if (err) {
    const line = err.linePos?.[0]?.line;
    const message = err.message.split('\n')[0] ?? 'invalid YAML';
    throw new MutationError(
      line !== undefined ? `${WORKFLOW_REL_PATH}:${line}: ${message}` : `${WORKFLOW_REL_PATH}: ${message}`,
    );
  }

  const parsed = doc.toJS() as unknown;
  const raw = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  if (!Array.isArray(raw.types) || raw.types.length === 0) {
    throw new MutationError(`${WORKFLOW_REL_PATH}: types is missing or empty`);
  }
  if (!Array.isArray(raw.statuses) || raw.statuses.length === 0) {
    throw new MutationError(`${WORKFLOW_REL_PATH}: statuses is missing or empty`);
  }
  if (raw.fields !== undefined && !Array.isArray(raw.fields)) {
    throw new MutationError(`${WORKFLOW_REL_PATH}: fields must be a list`);
  }

  const types = raw.types as RawType[];
  const fields = (raw.fields as RawField[] | undefined) ?? [];
  const typeNames = new Set(types.map((t) => t.name));
  for (const field of fields) {
    for (const target of field.applies_to ?? []) {
      if (!typeNames.has(target)) {
        throw new MutationError(
          `${WORKFLOW_REL_PATH}: field "${field.name}" applies_to unknown type "${target}"; correct applies_to in workflow.yaml first`,
        );
      }
    }
  }

  return {
    doc,
    raw: {
      types,
      statuses: raw.statuses as RawStatus[],
      fields,
      transitions: raw.transitions as unknown[] | undefined,
      on_transition: raw.on_transition as unknown[] | undefined,
    },
  };
}

/** The `paths` block from manifest.yaml, read raw so this runs before the project can load. */
function readManifestPaths(dir: string): { state: string; index: string } {
  const text = readFileSync(join(dir, 'manifest.yaml'), 'utf8');
  const raw = parseDocument(text).toJS() as { paths?: { state?: string; index?: string } };
  return {
    state: raw.paths?.state ?? DEFAULT_STATE_PATH,
    index: raw.paths?.index ?? DEFAULT_INDEX_PATH,
  };
}

/** The fields a 2.x type receives: every field without `applies_to`, plus any scoped to it by name. */
function fieldsForType(raw: RawWorkflow, typeName: string): FieldDef[] {
  return raw.fields
    .filter((f) => !f.applies_to || f.applies_to.includes(typeName))
    .map((f) => {
      const { applies_to: _appliesTo, ...field } = f;
      return field;
    });
}

/**
 * The decisions this step makes on a validated 2.x project's actual files:
 * the 3.0 types and statuses to write, plus the same decisions as
 * plain-English lines, so plan() and apply() can never disagree.
 */
function decide(raw: RawWorkflow): { types: TypeDef[]; statuses: StatusDef[]; changes: string[] } {
  const types: TypeDef[] = raw.types.map((t) => ({
    name: t.name,
    id_prefix: t.id_prefix,
    ...(t.label ? { label: t.label } : {}),
    ...(t.plural ? { plural: t.plural } : {}),
    fields: fieldsForType(raw, t.name),
  }));

  const scopedLines = raw.fields
    .filter((f) => f.applies_to && f.applies_to.length > 0)
    .map((f) => `${f.name} applies to ${f.applies_to!.join(', ')} only`);
  const fieldCount = raw.fields.length;
  const fieldsLine = `nest ${fieldCount} field${fieldCount === 1 ? '' : 's'} under their types${
    scopedLines.length > 0 ? `; ${scopedLines.join('; ')}` : ''
  }`;

  // Single-pass, one decision per status: complete (first unclaimed) wins
  // for that status, else active (first unclaimed) gives it the in_progress
  // role. Either way, any flag this status carries but did not win its role
  // with is reported lost, exactly like a plain duplicate flag.
  let assignedComplete = false;
  let assignedInProgress = false;
  const completeLosers: string[] = [];
  const activeLosers: string[] = [];
  const roleLines: string[] = [];
  const statuses: StatusDef[] = raw.statuses.map((s) => {
    const wantsComplete = s.complete === true;
    const wantsActive = s.active === true;
    let agent: StatusDef['agent'];
    if (wantsComplete && !assignedComplete) {
      assignedComplete = true;
      agent = 'complete';
      roleLines.push(`status "${s.name}" becomes the complete role`);
    } else if (wantsActive && !assignedInProgress) {
      assignedInProgress = true;
      agent = 'in_progress';
      roleLines.push(`status "${s.name}" becomes the in progress role`);
    }
    if (wantsComplete && agent !== 'complete') completeLosers.push(s.name);
    if (wantsActive && agent !== 'in_progress') activeLosers.push(s.name);
    return {
      name: s.name,
      ...(agent ? { agent } : {}),
      ...(s.label ? { label: s.label } : {}),
    };
  });

  const loserLine = (names: string[], flag: string): string | undefined => {
    if (names.length === 0) return undefined;
    const quoted = names.map((n) => `"${n}"`).join(', ');
    const verb = names.length === 1 ? 'loses' : 'lose';
    const pronoun = names.length === 1 ? 'its' : 'their';
    return `status ${quoted} ${verb} ${pronoun} ${flag} flag (no 3.0 equivalent)`;
  };

  const statusLines = [
    ...roleLines,
    loserLine(activeLosers, 'active'),
    loserLine(completeLosers, 'complete'),
    'no status carries a ready role; assign one in settings if you want agents to pick up work automatically',
  ].filter((line): line is string => line !== undefined);

  const onTransitionCount = Array.isArray(raw.on_transition) ? raw.on_transition.length : 0;
  const hasTransitions = Array.isArray(raw.transitions) && raw.transitions.length > 0;
  const automationLines: string[] = [];
  if (hasTransitions || onTransitionCount > 0) {
    automationLines.push(
      onTransitionCount > 0
        ? `remove transitions and ${onTransitionCount} automation rule${onTransitionCount === 1 ? '' : 's'}`
        : 'remove transitions',
    );
  }

  return {
    types,
    statuses,
    changes: [fieldsLine, ...statusLines, ...automationLines, 'rename workflow.yaml to schema.yaml'],
  };
}

const SUMMARY =
  'upgrades the 2.x workflow format to 3.0: fields nest under their types, status roles replace the active and complete flags, and transitions and automation move out of the schema';

/**
 * The reference migration step (ADR-0011): 2.x's flat `fields` list with
 * `applies_to` scoping becomes 3.0's per-type nested fields, 2.x's
 * `active`/`complete` status flags become 3.0's single `agent` role, and
 * `transitions`/`on_transition` are removed (transition automation moved out
 * of the schema in 3.0). workflow.yaml is renamed to schema.yaml. Unknown
 * keys on a 2.x node (anything this step does not itself consume) ride
 * along onto the generated node, the same way the mutation layer preserves
 * them on a same-major save.
 */
export const v2ToV3: MigrationStep = {
  from: 2,
  to: 3,

  summary: SUMMARY,

  plan(root: string): MigrationPlan {
    const dir = join(root, '.lovelace');
    const { raw } = readWorkflow(dir);
    const { changes } = decide(raw);
    const paths = readManifestPaths(dir);
    const fileLines: string[] = [];
    if (existsSync(join(dir, paths.state, 'agent_instructions.json'))) {
      fileLines.push(`remove ${paths.state}/agent_instructions.json`);
    }
    if (existsSync(join(dir, paths.index, 'actions.log'))) {
      fileLines.push(`remove ${paths.index}/actions.log`);
    }
    return { summary: SUMMARY, changes: [...changes, ...fileLines] };
  },

  apply(root: string): void {
    const dir = join(root, '.lovelace');
    const { doc, raw } = readWorkflow(dir);
    const { types, statuses } = decide(raw);

    // Validated above: types is a non-empty array, statuses is a non-empty
    // array, and every applies_to target names a real type, so nothing here
    // can throw partway through a write.
    const rawTypeByName = new Map(raw.types.map((t) => [t.name, t] as const));
    const rawStatusByName = new Map(raw.statuses.map((s) => [s.name, s] as const));
    const rawFieldByName = new Map(raw.fields.map((f) => [f.name, f] as const));

    const typeNodes = types.map((t) => {
      const fields = t.fields.map((f) =>
        withExtraKeys(compactField(f), rawFieldByName.get(f.name), FIELD_CONSUMED_KEYS),
      );
      return withExtraKeys({ ...compactType(t), fields }, rawTypeByName.get(t.name), TYPE_KNOWN_KEYS);
    });
    const statusNodes = statuses.map((s) =>
      withExtraKeys(compactStatus(s), rawStatusByName.get(s.name), STATUS_CONSUMED_KEYS),
    );

    doc.set('types', doc.createNode(typeNodes));
    doc.set('statuses', doc.createNode(statusNodes));
    doc.delete('fields');
    doc.delete('transitions');
    doc.delete('on_transition');
    applySchemaFlow(doc);

    writeFileSync(join(dir, 'schema.yaml'), doc.toString({ lineWidth: 0, flowCollectionPadding: false }));

    // The generated file must satisfy the 3.0 parser before anything
    // destructive happens: element-level garbage the shape guards cannot
    // anticipate (a scalar where a mapping belongs) would otherwise leave a
    // half-migrated tree. On failure the generated file is removed, so
    // workflow.yaml and the manifest stay untouched and the migration can be
    // retried once workflow.yaml is corrected.
    try {
      const schema = loadSchema(dir);
      const problems = validateSchema(schema, WORKFLOW_REL_PATH).filter((i) => i.severity === 'error');
      if (problems.length > 0) throw new Error(problems.map((i) => i.message).join('; '));
    } catch (e) {
      rmSync(join(dir, 'schema.yaml'));
      const message = e instanceof Error ? e.message : String(e);
      throw new MutationError(
        `${WORKFLOW_REL_PATH}: migration would produce an invalid schema.yaml (${message}); correct workflow.yaml and retry`,
      );
    }

    rmSync(join(dir, 'workflow.yaml'));

    const manifestAbs = join(dir, 'manifest.yaml');
    const paths = readManifestPaths(dir);
    const manifestDoc = parseDocument(readFileSync(manifestAbs, 'utf8'));
    manifestDoc.set('spec_version', '3.0.0');
    writeFileSync(manifestAbs, manifestDoc.toString({ lineWidth: 0, flowCollectionPadding: false }));

    const agentInstructions = join(dir, paths.state, 'agent_instructions.json');
    if (existsSync(agentInstructions)) rmSync(agentInstructions);
    const actionsLog = join(dir, paths.index, 'actions.log');
    if (existsSync(actionsLog)) rmSync(actionsLog);
  },
};
