import type { FieldDef, FieldType, ValidationIssue, Schema } from './types.js';
import { CORE_FIELDS } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function fieldsForType(schema: Schema, type: string): FieldDef[] {
  return schema.types.find((t) => t.name === type)?.fields ?? [];
}

export function enumValues(schema: Schema, field: FieldDef): string[] {
  if (field.values) return field.values;
  if (field.values_from === 'priorities') return schema.priorities;
  return [];
}

function checkScalar(
  schema: Schema,
  field: FieldDef,
  type: Exclude<FieldType, 'list'>,
  value: unknown,
): string | undefined {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? undefined : 'must be a string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'must be a number';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'must be true or false';
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value)
        ? undefined
        : 'must be an ISO 8601 date or datetime';
    case 'enum': {
      const allowed = enumValues(schema, field);
      return typeof value === 'string' && allowed.includes(value)
        ? undefined
        : `must be one of: ${allowed.join(', ')}`;
    }
    case 'reference':
      return typeof value === 'string' && value.length > 0
        ? undefined
        : 'must be an entity ID string';
  }
}

/**
 * Validates defined (non-core) field values for a ticket of the given type.
 * Reference resolution is link-integrity work and happens separately.
 */
export function validateTicketFields(
  schema: Schema,
  type: string,
  fields: Record<string, unknown>,
  file: string,
  keyLines?: Map<string, number>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const defs = fieldsForType(schema, type);
  const defByName = new Map(defs.map((d) => [d.name, d]));
  const push = (severity: 'error' | 'warning', rule: string, message: string, key?: string) => {
    const issue: ValidationIssue = { severity, file, rule, message };
    const line = key !== undefined ? keyLines?.get(key) : undefined;
    if (line !== undefined) issue.line = line;
    issues.push(issue);
  };

  for (const def of defs) {
    if (def.required && fields[def.name] === undefined) {
      push('error', 'fields/required', `required field "${def.name}" is missing`);
    }
  }

  for (const [name, value] of Object.entries(fields)) {
    if ((CORE_FIELDS as readonly string[]).includes(name)) continue;
    const def = defByName.get(name);
    if (!def) {
      push('warning', 'fields/unknown', `unknown frontmatter key "${name}"`, name);
      continue;
    }
    if (value === undefined || value === null) {
      push('error', 'fields/empty', `field "${name}" has no value`, name);
      continue;
    }
    if (def.type === 'list') {
      if (!Array.isArray(value)) {
        push('error', 'fields/type', `field "${name}" must be a list`, name);
        continue;
      }
      const itemType = def.item_type ?? 'string';
      value.forEach((item, i) => {
        const problem = checkScalar(schema, def, itemType, item);
        if (problem) {
          push('error', 'fields/type', `field "${name}"[${i}] ${problem}`, name);
        }
      });
    } else {
      const problem = checkScalar(schema, def, def.type, value);
      if (problem) {
        push('error', 'fields/type', `field "${name}" ${problem}`, name);
      }
    }
  }

  return issues;
}

/** Applies declared defaults for fields the input does not set. */
export function applyDefaults(
  schema: Schema,
  type: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...fields };
  for (const def of fieldsForType(schema, type)) {
    if (out[def.name] === undefined && def.default !== undefined) {
      out[def.name] = def.default;
    }
  }
  return out;
}

/** Collects reference values to check for link integrity: [field, target kinds, value]. */
export function collectReferences(
  schema: Schema,
  type: string,
  fields: Record<string, unknown>,
): Array<{ field: string; targets: string[] | undefined; value: string }> {
  const out: Array<{ field: string; targets: string[] | undefined; value: string }> = [];
  for (const def of fieldsForType(schema, type)) {
    const value = fields[def.name];
    if (value === undefined) continue;
    if (def.type === 'reference' && typeof value === 'string') {
      out.push({ field: def.name, targets: def.refers_to, value });
    }
    if (def.type === 'list' && def.item_type === 'reference' && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          out.push({ field: def.name, targets: def.refers_to, value: item });
        }
      }
    }
  }
  return out;
}
