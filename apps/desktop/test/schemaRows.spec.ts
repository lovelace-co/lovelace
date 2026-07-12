import { describe, expect, it } from 'vitest';
import { buildFields, buildTypes, seedField, seedType, type FieldRow, type TypeRow } from '../src/lib/schemaRows';
import type { FieldDef, SchemaType } from '../src/lib/types';

/**
 * Round-trip fidelity for the schema editor's row model (T-0079). A
 * hand-authored field carrying a non-enum default, a label equal to Title
 * Case(name), and an explicit `required: false` must survive an
 * open-and-rebuild with no edits, byte-for-byte in the built FieldDef.
 */
describe('schemaRows field fidelity', () => {
  function seedAndRebuild(f: FieldDef): FieldDef {
    const row = seedField(f);
    return buildFields([row], [])[0]!;
  }

  it('reproduces an authored default, redundant label and required: false untouched', () => {
    const authored: FieldDef = {
      name: 'estimate',
      type: 'number',
      label: 'Estimate', // Title Case(estimate) is already "Estimate".
      required: false,
      default: 3,
    };
    const rebuilt = seedAndRebuild(authored);
    expect(rebuilt).toEqual(authored);
  });

  it('preserves a non-string default of any scalar type untouched', () => {
    expect(seedAndRebuild({ name: 'active', type: 'boolean', default: true }).default).toBe(true);
    expect(seedAndRebuild({ name: 'launch', type: 'date', default: '2026-01-01' }).default).toBe('2026-01-01');
  });

  it('drops the preserved default when the editor changes the field type', () => {
    const row = seedField({ name: 'estimate', type: 'number', default: 3 });
    const changed: FieldRow = { ...row, type: 'string' };
    const rebuilt = buildFields([changed], [])[0]!;
    expect(rebuilt.default).toBeUndefined();
  });

  it('keeps the preserved default when an unrelated property is edited', () => {
    const row = seedField({ name: 'estimate', type: 'number', default: 3 });
    const edited: FieldRow = { ...row, required: true };
    const rebuilt = buildFields([edited], [])[0]!;
    expect(rebuilt.default).toBe(3);
    expect(rebuilt.required).toBe(true);
  });

  it('keeps an explicit required: false only when the original authored it that way', () => {
    // Original had no required key at all: unchecking stays omitted.
    const untouched = seedField({ name: 'estimate', type: 'number' });
    expect(buildFields([untouched], [])[0]).not.toHaveProperty('required');

    // Original was required: true, unchecked in the editor: omitted, not false.
    const wasRequired = seedField({ name: 'title', type: 'string', required: true });
    const unchecked: FieldRow = { ...wasRequired, required: false };
    expect(buildFields([unchecked], [])[0]).not.toHaveProperty('required');

    // Original explicitly carried required: false: stays explicitly false.
    const wasFalse = seedField({ name: 'estimate', type: 'number', required: false });
    expect(buildFields([wasFalse], [])[0]).toMatchObject({ required: false });
  });

  it('a fresh row (no original) rebuilds exactly as today: no label, no required, no default', () => {
    const row: FieldRow = {
      human: 'New Field',
      machine: 'new_field',
      machineTouched: false,
      type: 'string',
      required: false,
      values: [],
      valuesFrom: '',
      defaultValue: '',
      refersTo: [],
      itemType: '',
      locked: false,
      original: null,
      originalDef: null,
    };
    expect(buildFields([row], [])[0]).toEqual({ name: 'new_field', type: 'string' });
  });

  it('an edited label persists only when it differs from Title Case of the current machine name', () => {
    const row = seedField({ name: 'estimate', type: 'number' }); // no authored label
    const relabelled: FieldRow = { ...row, human: 'Story Points' };
    expect(buildFields([relabelled], [])[0]!.label).toBe('Story Points');
    // Editing it back to the redundant Title Case form drops the label again.
    const backToDefault: FieldRow = { ...row, human: 'Estimate' };
    expect(buildFields([backToDefault], [])[0]).not.toHaveProperty('label');
  });
});

/**
 * The same fidelity class as above, for a type's plural (T-0079 follow-up):
 * an authored plural equal to the derived default ("Tasks" on type "task")
 * must not be dropped by an untouched row.
 */
describe('schemaRows type fidelity', () => {
  function seedAndRebuildType(t: SchemaType): SchemaType {
    const row = seedType(t);
    return buildTypes([row], [])[0]!;
  }

  it('reproduces an authored plural equal to the derived default untouched', () => {
    const authored: SchemaType = {
      name: 'task',
      id_prefix: 'T',
      plural: 'Tasks', // titleCase('task') + 's' is already "Tasks".
      fields: [{ name: 'title', type: 'string', required: true }],
    };
    expect(seedAndRebuildType(authored).plural).toBe('Tasks');
  });

  it('keeps the authored plural after an unrelated edit to the same row', () => {
    const row = seedType({ name: 'task', id_prefix: 'T', plural: 'Tasks', fields: [] });
    const edited: TypeRow = { ...row, prefix: 'Z' };
    expect(buildTypes([edited], [])[0]!.plural).toBe('Tasks');
  });

  it('an edited plural persists only when it differs from the derived default of the current machine name', () => {
    const row = seedType({ name: 'task', id_prefix: 'T', fields: [] }); // no authored plural
    const relabelled: TypeRow = { ...row, plural: 'Taskers' };
    expect(buildTypes([relabelled], [])[0]!.plural).toBe('Taskers');
    // Editing it back to the redundant default drops the plural again.
    const backToDefault: TypeRow = { ...row, plural: 'Tasks' };
    expect(buildTypes([backToDefault], [])[0]).not.toHaveProperty('plural');
  });

  it('a fresh type (no original) rebuilds exactly as today: no plural', () => {
    const row: TypeRow = {
      human: 'New Type',
      machine: 'new_type',
      machineTouched: false,
      plural: 'New Types',
      pluralTouched: false,
      prefix: 'N',
      prefixTouched: false,
      original: null,
      originalDef: null,
      fields: [],
    };
    expect(buildTypes([row], [])[0]).not.toHaveProperty('plural');
  });
});
