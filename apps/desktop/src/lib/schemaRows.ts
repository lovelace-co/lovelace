import { useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { slugify, titleCase } from './format';
import type { FieldDef, SchemaStatus, SchemaType } from './types';

/**
 * The editable-row model shared by the init wizard and the schema editor.
 * Each row keeps a human label and a machine name that the label auto-fills
 * until the machine is hand-edited (see applyHuman), plus the `original`
 * machine name it was seeded from, so a save can tell a rename (cascade to
 * existing data) from a fresh addition (`original` null).
 */

export const FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'list', 'reference'] as const;
export const ITEM_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'reference'] as const;
export const SPECIAL_REF_KINDS = ['actor', 'document'] as const;
export type FieldType = FieldDef['type'];

export type AgentRole = 'ready' | 'in_progress' | 'complete';

export interface StatusRow {
  human: string;
  machine: string;
  machineTouched: boolean;
  /** The status's meaning to agent tooling; at most one row may carry a given role. */
  agent: AgentRole | undefined;
  original: string | null;
  /** The parsed status this row was seeded from, so an untouched row's label
   * rebuilds byte-faithfully instead of being regenerated. Null for a row
   * with no original (a newly added status). */
  originalDef: SchemaStatus | null;
}
export interface FieldRow {
  human: string;
  machine: string;
  machineTouched: boolean;
  type: FieldType;
  required: boolean;
  values: string[];
  valuesFrom: string;
  defaultValue: string;
  refersTo: string[];
  itemType: string;
  locked: boolean;
  original: string | null;
  /** The parsed field this row was seeded from, so an untouched row's label,
   * required flag and default rebuild byte-faithfully instead of being
   * regenerated. Null for a row with no original (a newly added field). */
  originalDef: FieldDef | null;
}
export interface TypeRow {
  human: string;
  machine: string;
  machineTouched: boolean;
  plural: string;
  pluralTouched: boolean;
  prefix: string;
  prefixTouched: boolean;
  original: string | null;
  /** The parsed type this row was seeded from, so an untouched row's label
   * rebuilds byte-faithfully instead of being regenerated. Null for a row
   * with no original (a newly added type). */
  originalDef: SchemaType | null;
  /** Fields owned by this type; `title` is seeded first and locked. */
  fields: FieldRow[];
}

export function seedStatus(s: SchemaStatus): StatusRow {
  const human = s.label ?? titleCase(s.name);
  return {
    human,
    machine: s.name,
    machineTouched: s.name !== slugify(human),
    agent: s.agent,
    original: s.name,
    originalDef: s,
  };
}
export function seedField(f: FieldDef): FieldRow {
  const human = f.label ?? titleCase(f.name);
  return {
    human,
    machine: f.name,
    machineTouched: f.name !== slugify(human),
    type: f.type,
    required: f.required ?? false,
    values: f.values ?? [],
    valuesFrom: f.values_from ?? '',
    defaultValue: typeof f.default === 'string' ? f.default : '',
    refersTo: f.refers_to ?? [],
    itemType: f.item_type ?? '',
    locked: f.name === 'title',
    original: f.name,
    originalDef: f,
  };
}
export function seedType(t: SchemaType): TypeRow {
  const human = t.label ?? titleCase(t.name);
  return {
    human,
    machine: t.name,
    machineTouched: t.name !== slugify(human),
    plural: t.plural ?? `${human}s`,
    pluralTouched: t.plural !== undefined,
    prefix: t.id_prefix,
    prefixTouched: t.id_prefix !== (t.name[0] ?? '').toUpperCase(),
    original: t.name,
    originalDef: t,
    fields: t.fields.map(seedField),
  };
}

/** A blank row for adding a new status/field; `original` is null. */
export const blankStatus = (): StatusRow => ({
  ...seedStatus({ name: 'new_status' }),
  original: null,
  originalDef: null,
});
export const blankField = (): FieldRow => ({
  ...seedField({ name: 'new_field', type: 'string' }),
  original: null,
  originalDef: null,
});
/** A blank type, pre-seeded with the locked, required title field every type carries. */
export const blankType = (): TypeRow => ({
  ...seedType({
    name: 'new_type',
    id_prefix: 'X',
    fields: [{ name: 'title', type: 'string', required: true }],
  }),
  original: null,
  originalDef: null,
});

/**
 * Keeps the human label and machine name coupled: editing the label reslugs
 * the machine until the machine has been touched, after which they are
 * independent. Returns the same object it was given, mutated.
 */
export function applyHuman<T extends { human: string; machine: string; machineTouched: boolean }>(
  next: T,
  patch: Partial<T>,
): T {
  if ('machine' in patch) next.machineTouched = true;
  else if ('human' in patch && !next.machineTouched) next.machine = slugify(next.human);
  return next;
}

/**
 * Applies a patch to a type row, keeping its identity fields coupled the
 * same way applyHuman couples label and machine name: editing the label
 * re-derives the plural until the plural is hand-touched, and editing the
 * machine name re-derives the ID prefix until the prefix is hand-touched.
 * Shared by the schema draft's editType and the Edit type modal's own
 * local copy, so the coupling rules live in one place.
 */
export function applyTypeIdentity(row: TypeRow, patch: Partial<TypeRow>): TypeRow {
  const next = applyHuman({ ...row, ...patch }, patch) as TypeRow;
  if (patch.human !== undefined && !next.pluralTouched) next.plural = `${next.human}s`;
  if (patch.machine !== undefined && !next.prefixTouched) next.prefix = (next.machine[0] ?? '').toUpperCase();
  if (patch.plural !== undefined) next.pluralTouched = true;
  if (patch.prefix !== undefined) next.prefixTouched = true;
  return next;
}

/**
 * The label a rebuilt row should carry. A row that is entirely untouched
 * (neither its label nor its machine name has been edited since seeding)
 * reproduces the original's exact label, present or not, even where it
 * happens to equal Title Case(name); this is what lets a hand-authored
 * redundant label survive open-and-save unedited. Anything else (a fresh
 * row, or one where the label or the machine name has changed) falls back
 * to today's rule: write a label only where it differs from Title Case of
 * the current machine name. Shared by statuses, types and fields, which all
 * carry the identical label-normalisation class.
 */
function rebuildLabel<T extends { label?: string; name: string }>(
  row: { human: string; machine: string; original: string | null },
  originalDef: T | null,
): string | undefined {
  const untouched =
    originalDef !== null &&
    row.machine === row.original &&
    row.human === (originalDef.label ?? titleCase(originalDef.name));
  if (untouched) return originalDef!.label;
  return row.human && row.human !== titleCase(row.machine) ? row.human : undefined;
}

/**
 * The plural a rebuilt type should carry: the same untouched/edited split as
 * rebuildLabel (an untouched row reproduces the original's exact authored
 * plural, present or not, even where it equals today's derived default), but
 * plural's own derived default is the human label plus "s" (matching
 * seedType), not Title Case(machine) directly, so it carries its own seeded
 * comparison instead of reusing rebuildLabel's.
 */
function rebuildPlural(row: TypeRow): string | undefined {
  const originalDef = row.originalDef;
  if (originalDef !== null && row.machine === row.original) {
    const seededHuman = originalDef.label ?? titleCase(originalDef.name);
    if (row.plural === (originalDef.plural ?? `${seededHuman}s`)) return originalDef.plural;
  }
  return row.plural && row.plural !== `${titleCase(row.machine)}s` ? row.plural : undefined;
}

export function buildStatuses(rows: StatusRow[]): SchemaStatus[] {
  return rows.map((r) => {
    const label = rebuildLabel(r, r.originalDef);
    return {
      name: r.machine,
      ...(r.agent ? { agent: r.agent } : {}),
      ...(label !== undefined ? { label } : {}),
    };
  });
}
export function buildFields(rows: FieldRow[], priorities: string[]): FieldDef[] {
  return rows.map((r) => {
    const f: FieldDef = { name: r.machine, type: r.type };
    const label = rebuildLabel(r, r.originalDef);
    if (label !== undefined) f.label = label;
    // A user-checked required always emits true; an unchecked box stays
    // explicitly false only when the original authored it that way, so a
    // hand-authored `required: false` round-trips instead of being dropped.
    if (r.required) f.required = true;
    else if (r.originalDef?.required === false) f.required = false;
    if (r.type === 'enum') {
      if (r.valuesFrom) f.values_from = r.valuesFrom;
      else if (r.values.length > 0) f.values = r.values;
      // A default keeps the field safe for quick-add, which only sets a title.
      const effective = r.valuesFrom === 'priorities' ? priorities : r.values;
      if (r.defaultValue && effective.includes(r.defaultValue)) f.default = r.defaultValue;
    } else if (r.originalDef && r.originalDef.type === r.type && r.originalDef.default !== undefined) {
      // Non-enum defaults have no editor; pass the original through
      // untouched as long as the field's type has not changed, since a
      // stale default for a different type would be nonsense.
      f.default = r.originalDef.default;
    }
    if (r.type === 'reference' && r.refersTo.length > 0) f.refers_to = r.refersTo;
    if (r.type === 'list' && r.itemType) f.item_type = r.itemType;
    return f;
  });
}
export function buildTypes(rows: TypeRow[], priorities: string[]): SchemaType[] {
  return rows.map((r) => {
    const label = rebuildLabel(r, r.originalDef);
    const plural = rebuildPlural(r);
    return {
      name: r.machine,
      id_prefix: r.prefix,
      ...(label !== undefined ? { label } : {}),
      ...(plural !== undefined ? { plural } : {}),
      fields: buildFields(r.fields, priorities),
    };
  });
}

/** old-to-new machine name map for rows whose name changed since seeding. */
export function renamesFrom(rows: Array<{ original: string | null; machine: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.original !== null && r.original !== r.machine) out[r.original] = r.machine;
  }
  return out;
}

/**
 * HTML5 drag-to-reorder for a list state setter. A handle starts the drag;
 * `over` is the index the cursor is hovering, so the caller can render a thin
 * insertion line there.
 */
export function useReorder<T>(setItems: Dispatch<SetStateAction<T[]>>) {
  const from = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return {
    over,
    active: over !== null,
    handleProps: (i: number) => ({
      draggable: true,
      onDragStart: () => {
        from.current = i;
        setOver(i);
      },
      onDragEnd: () => {
        from.current = null;
        setOver(null);
      },
    }),
    zoneProps: (i: number) => ({
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setOver((o) => (o === i ? o : i));
      },
      onDrop: () => {
        const f = from.current;
        from.current = null;
        setOver(null);
        if (f === null || f === i) return;
        setItems((prev) => {
          const next = [...prev];
          const [moved] = next.splice(f, 1);
          next.splice(i, 0, moved!);
          return next;
        });
      },
    }),
  };
}
