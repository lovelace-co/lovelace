import { Document, isMap, isScalar, isSeq } from 'yaml';
import { FIELD_KNOWN_KEYS, STATUS_KNOWN_KEYS, TYPE_KNOWN_KEYS } from './config.js';
import type { FieldDef, StatusDef, TypeDef, Schema } from './types.js';

/**
 * The default schema as structured data. This is the single source of
 * truth that both `initProject` (via its hardcoded string equivalent) and
 * the app's init wizard start from. Keep it in sync with the DEFAULT_SCHEMA
 * string in init.ts.
 */
export function defaultSchema(): Schema {
  return {
    types: [
      {
        name: 'epic',
        id_prefix: 'E',
        fields: [{ name: 'title', type: 'string', required: true }],
      },
      {
        name: 'task',
        id_prefix: 'T',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'assignee', type: 'reference', refers_to: ['actor'] },
          { name: 'priority', type: 'enum', values_from: 'priorities' },
        ],
      },
      {
        name: 'bug',
        id_prefix: 'T',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'assignee', type: 'reference', refers_to: ['actor'] },
          { name: 'priority', type: 'enum', values_from: 'priorities' },
        ],
      },
    ],
    statuses: [
      { name: 'backlog' },
      { name: 'todo', agent: 'ready' },
      { name: 'in_progress', agent: 'in_progress' },
      { name: 'in_review', agent: 'complete' },
      { name: 'done' },
      { name: 'cancelled' },
    ],
    priorities: ['urgent', 'high', 'medium', 'low'],
  };
}

/** Drops empty optional keys so the serialised field is minimal. */
export function compactField(field: FieldDef): Record<string, unknown> {
  // Key order matches the spec example and the demo fixture: the shape keys
  // (values, item_type, refers_to) precede the constraint keys (required,
  // default), so a serialised field round-trips those files byte-for-byte.
  return {
    name: field.name,
    type: field.type,
    ...(field.label ? { label: field.label } : {}),
    ...(field.values && field.values.length > 0 ? { values: [...field.values] } : {}),
    ...(field.values_from ? { values_from: field.values_from } : {}),
    ...(field.item_type ? { item_type: field.item_type } : {}),
    ...(field.refers_to && field.refers_to.length > 0 ? { refers_to: [...field.refers_to] } : {}),
    ...(field.required !== undefined ? { required: field.required } : {}),
    ...(field.default !== undefined ? { default: field.default } : {}),
  };
}

/** Drops empty optional keys so the serialised type is minimal; fields nest under it. */
export function compactType(type: TypeDef): Record<string, unknown> {
  return {
    name: type.name,
    id_prefix: type.id_prefix,
    ...(type.label ? { label: type.label } : {}),
    ...(type.plural ? { plural: type.plural } : {}),
    fields: type.fields.map(compactField),
  };
}

/** Drops empty optional keys so the serialised status is minimal. */
export function compactStatus(status: StatusDef): Record<string, unknown> {
  return {
    name: status.name,
    ...(status.agent ? { agent: status.agent } : {}),
    ...(status.label ? { label: status.label } : {}),
  };
}

/**
 * Keys on `source` that are not in `known`, in their original file order.
 * `source` is typed loosely on purpose: passthrough parsing (config.ts)
 * attaches extra properties to FieldDef/TypeDef/StatusDef values that the
 * TypeScript interfaces do not declare, so this is the one place that reads
 * them back off dynamically.
 */
function unknownEntries(source: object | undefined, known: ReadonlySet<string>): Array<[string, unknown]> {
  if (!source) return [];
  const rec = source as unknown as Record<string, unknown>;
  return Object.keys(rec)
    .filter((k) => !known.has(k))
    .map((k) => [k, rec[k]] as [string, unknown]);
}

/** Appends `old`'s unknown keys onto an already-compacted node, after its canonical keys. */
function withUnknownKeys(
  compacted: Record<string, unknown>,
  old: object | undefined,
  known: ReadonlySet<string>,
): Record<string, unknown> {
  const extra = unknownEntries(old, known);
  if (extra.length === 0) return compacted;
  return { ...compacted, ...Object.fromEntries(extra) };
}

/**
 * Like compactField, but carries forward any key `old` holds that this
 * tooling does not model, so a save does not destroy a newer-minor or
 * hand-authored key (ADR-0011: non-destructive writes). Used by writeSchema;
 * serializeSchema (which has no "old" field to preserve from) keeps using
 * compactField directly.
 */
export function mergeField(field: FieldDef, old: FieldDef | undefined): Record<string, unknown> {
  return withUnknownKeys(compactField(field), old, FIELD_KNOWN_KEYS);
}

/** Like mergeField, but for a status. */
export function mergeStatus(status: StatusDef, old: StatusDef | undefined): Record<string, unknown> {
  return withUnknownKeys(compactStatus(status), old, STATUS_KNOWN_KEYS);
}

/**
 * Like compactType, but merges unknown keys onto the type itself and onto
 * each of its fields. Fields match their old counterpart by name; there is
 * no field-rename map, so a renamed field does not carry its unknown keys
 * forward (accepted: see writeSchema).
 */
export function mergeType(type: TypeDef, old: TypeDef | undefined): Record<string, unknown> {
  const oldFieldsByName = new Map((old?.fields ?? []).map((f) => [f.name, f]));
  const fields = type.fields.map((f) => mergeField(f, oldFieldsByName.get(f.name)));
  return withUnknownKeys({ ...compactType(type), fields }, old, TYPE_KNOWN_KEYS);
}

/**
 * Renders the scalar arrays (priorities, enum values and reference targets)
 * in compact flow style, matching the project's house style. Applied to any
 * Document whose shape is schema.yaml, whether freshly built or patched in
 * place.
 */
export function applySchemaFlow(doc: Document): void {
  const flow = (node: unknown) => {
    if (isSeq(node)) (node as { flow?: boolean }).flow = true;
  };

  flow(doc.get('priorities', true));
  const types = doc.get('types', true);
  if (isSeq(types)) {
    for (const type of types.items) {
      if (!isMap(type)) continue;
      const fields = type.get('fields', true);
      if (isSeq(fields)) {
        for (const field of fields.items) {
          if (isMap(field)) {
            flow(field.get('values', true));
            flow(field.get('refers_to', true));
          }
        }
      }
    }
  }
}

/**
 * Serialises a Schema to schema.yaml text. Object lists render in block
 * style; scalar arrays render in compact flow style (see applySchemaFlow).
 * The output parses back through loadSchema and passes validateSchema.
 */
export function serializeSchema(schema: Schema): string {
  const obj = {
    types: schema.types.map(compactType),
    statuses: schema.statuses.map(compactStatus),
    priorities: [...schema.priorities],
  };

  const doc = new Document(obj);
  applySchemaFlow(doc);
  // A blank line before each top-level section, matching the readable
  // hardcoded default in init.ts and the demo schema.yaml.
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const key = pair.key;
      if (isScalar(key) && (key.value === 'statuses' || key.value === 'priorities')) {
        key.spaceBefore = true;
      }
    }
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}
