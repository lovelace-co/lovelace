import { useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { slugify, titleCase } from './format';
import type { FieldDef, WorkflowStatus, WorkflowType } from './types';

/**
 * The editable-row model shared by the init wizard and the workflow editor.
 * Each row keeps a human label and a machine name that the label auto-fills
 * until the machine is hand-edited (see applyHuman), plus the `original`
 * machine name it was seeded from, so a save can tell a rename (cascade to
 * existing data) from a fresh addition (`original` null).
 */

export const FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'list', 'reference'] as const;
export const ITEM_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'reference'] as const;
export const SPECIAL_REF_KINDS = ['actor', 'document'] as const;
export type FieldType = FieldDef['type'];

export interface StatusRow {
  human: string;
  machine: string;
  machineTouched: boolean;
  active: boolean;
  complete: boolean;
  original: string | null;
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
  /** Ticket types this field applies to; preserved even though not yet edited. */
  appliesTo: string[];
  locked: boolean;
  original: string | null;
}

export function seedStatus(s: WorkflowStatus): StatusRow {
  const human = s.label ?? titleCase(s.name);
  return {
    human,
    machine: s.name,
    machineTouched: s.name !== slugify(human),
    active: s.active ?? false,
    complete: s.complete ?? false,
    original: s.name,
  };
}
export function seedType(t: WorkflowType): TypeRow {
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
    appliesTo: f.applies_to ?? [],
    locked: f.name === 'title',
    original: f.name,
  };
}

/** A blank row for adding a new status/type/field; `original` is null. */
export const blankStatus = (): StatusRow => ({ ...seedStatus({ name: 'new_status' }), original: null });
export const blankType = (): TypeRow => ({ ...seedType({ name: 'new_type', id_prefix: 'X' }), original: null });
export const blankField = (): FieldRow => ({ ...seedField({ name: 'new_field', type: 'string' }), original: null });

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

/** Every status can move to every other status; used when statuses change. */
export function permissive(statuses: Array<{ machine: string }>): Array<{ from: string; to: string[] }> {
  return statuses.map((s) => ({
    from: s.machine,
    to: statuses.filter((o) => o.machine !== s.machine).map((o) => o.machine),
  }));
}

export function buildStatuses(rows: StatusRow[]): WorkflowStatus[] {
  return rows.map((r) => ({
    name: r.machine,
    ...(r.active ? { active: true } : {}),
    ...(r.complete ? { complete: true } : {}),
    ...(r.human && r.human !== titleCase(r.machine) ? { label: r.human } : {}),
  }));
}
export function buildTypes(rows: TypeRow[]): WorkflowType[] {
  return rows.map((r) => ({
    name: r.machine,
    id_prefix: r.prefix,
    ...(r.human && r.human !== titleCase(r.machine) ? { label: r.human } : {}),
    ...(r.plural && r.plural !== `${titleCase(r.machine)}s` ? { plural: r.plural } : {}),
  }));
}
export function buildFields(rows: FieldRow[], priorities: string[]): FieldDef[] {
  return rows.map((r) => {
    const f: FieldDef = { name: r.machine, type: r.type };
    if (r.human && r.human !== titleCase(r.machine)) f.label = r.human;
    if (r.required) f.required = true;
    if (r.type === 'enum') {
      if (r.valuesFrom) f.values_from = r.valuesFrom;
      else if (r.values.length > 0) f.values = r.values;
      // A default keeps the field safe for quick-add, which only sets a title.
      const effective = r.valuesFrom === 'priorities' ? priorities : r.values;
      if (r.defaultValue && effective.includes(r.defaultValue)) f.default = r.defaultValue;
    }
    if (r.type === 'reference' && r.refersTo.length > 0) f.refers_to = r.refersTo;
    if (r.type === 'list' && r.itemType) f.item_type = r.itemType;
    if (r.appliesTo.length > 0) f.applies_to = r.appliesTo;
    return f;
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
