import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  applyHuman,
  applyTypeIdentity,
  blankStatus,
  blankType,
  buildStatuses,
  buildTypes,
  renamesFrom,
  seedStatus,
  seedType,
  useReorder,
  type FieldRow,
  type StatusRow,
  type TypeRow,
} from './schemaRows';
import type { SchemaEdit, Snapshot } from './types';

export interface PriorityRow {
  original: string | null;
  value: string;
}

/** Stable JSON with object keys sorted, so key order never reads as a change. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/**
 * The schema-editing state, extracted so more than one surface can share it.
 * It holds the editable rows for statuses and types (each type owning its
 * own field rows) and priorities, tracks whether anything changed, and saves
 * the lot through core as a single SchemaEdit (which validates it and
 * cascades any rename, or refuses a removal that would strand tickets). Two
 * Settings tabs mount one instance of this, so their edits and their one
 * Save/Discard span both.
 */
export function useSchemaDraft(snapshot: Snapshot, onSave: (edit: SchemaEdit) => Promise<void>) {
  const [statuses, setStatuses] = useState<StatusRow[]>(() => snapshot.schema.statuses.map(seedStatus));
  const [types, setTypes] = useState<TypeRow[]>(() => snapshot.schema.types.map(seedType));
  const [priorities, setPriorities] = useState<PriorityRow[]>(() =>
    snapshot.schema.priorities.map((p) => ({ original: p, value: p })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusDrag = useReorder(setStatuses);
  const priorityDrag = useReorder(setPriorities);

  const reseed = () => {
    setStatuses(snapshot.schema.statuses.map(seedStatus));
    setTypes(snapshot.schema.types.map(seedType));
    setPriorities(snapshot.schema.priorities.map((p) => ({ original: p, value: p })));
    setError(null);
  };

  // Re-seed when the schema on disk changes (an external edit, or our own
  // save landing), but never mid-keystroke: local edits do not touch snapshot.
  const baseline = useMemo(
    () =>
      stable({
        statuses: snapshot.schema.statuses,
        types: snapshot.schema.types,
        priorities: snapshot.schema.priorities,
      }),
    [snapshot.schema],
  );
  const seededRef = useRef(baseline);
  useEffect(() => {
    if (seededRef.current !== baseline) {
      seededRef.current = baseline;
      reseed();
    }
    // reseed reads the latest snapshot via closure; baseline gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);

  const builtStatuses = buildStatuses(statuses);
  const builtPriorities = priorities.map((p) => p.value);
  const builtTypes = buildTypes(types, builtPriorities);

  // The dirty baseline is the seed-then-build projection of the loaded
  // schema, not the raw parsed schema: seeding and rebuilding an untouched
  // row is byte-faithful for everything the editor owns (label, plural,
  // required, non-enum default), so comparing built rows against this
  // projection makes dirty mean exactly "the user changed something the
  // editor manages". Diffing against the raw parsed schema would flag an
  // unknown key the merge layer preserves on save (a hand-authored
  // `unit: points`, say) as permanently dirty, since a row never carries an
  // unknown key through in the first place.
  const current = stable({
    statuses: buildStatuses(snapshot.schema.statuses.map(seedStatus)),
    types: buildTypes(snapshot.schema.types.map(seedType), snapshot.schema.priorities),
    priorities: snapshot.schema.priorities,
  });
  const built = stable({
    statuses: builtStatuses,
    types: builtTypes,
    priorities: builtPriorities,
  });
  const dirty = built !== current;

  /**
   * Selecting an agent role on one row is friendlier than erroring when
   * another row already carries it: the other row's role is cleared, since
   * core only allows one status per role.
   */
  const editStatus = (i: number, p: Partial<StatusRow>) => {
    const prev = statuses[i]!;
    const next = applyHuman({ ...prev, ...p }, p) as StatusRow;
    setStatuses((rows) =>
      rows.map((r, j) => {
        if (j === i) return next;
        return p.agent !== undefined && p.agent === r.agent ? { ...r, agent: undefined } : r;
      }),
    );
  };
  const removeStatus = (i: number) => setStatuses((rows) => rows.filter((_, j) => j !== i));
  const addStatus = () => setStatuses((rows) => [...rows, blankStatus()]);

  const editType = (i: number, p: Partial<TypeRow>) =>
    setTypes((rows) => rows.map((r, j) => (j === i ? applyTypeIdentity(r, p) : r)));
  const addType = () => setTypes((rows) => [...rows, blankType()]);
  const removeType = (i: number) => setTypes((rows) => rows.filter((_, j) => j !== i));
  /**
   * Replaces one type row outright, for a caller (the Edit type modal) that
   * already holds a fully derived row from its own local edits. Committing
   * through editType's patch would re-run applyTypeIdentity against every
   * field at once, which permanently marks plural/prefix/machine as
   * hand-touched even for fields the modal never touched; this bypasses
   * that.
   */
  const setTypeRow = (i: number, row: TypeRow) => setTypes((rows) => rows.map((r, j) => (j === i ? row : r)));

  /** A Dispatch-compatible field-rows setter scoped to one type, for FieldsEditor. */
  const fieldsSetterFor =
    (i: number): Dispatch<SetStateAction<FieldRow[]>> =>
    (updater) =>
      setTypes((rows) =>
        rows.map((r, j) =>
          j === i
            ? { ...r, fields: typeof updater === 'function' ? (updater as (prev: FieldRow[]) => FieldRow[])(r.fields) : updater }
            : r,
        ),
      );

  const save = async () => {
    setBusy(true);
    setError(null);
    const prioRenames: Record<string, string> = {};
    for (const p of priorities) if (p.original !== null && p.original !== p.value) prioRenames[p.original] = p.value;
    const edit: SchemaEdit = {
      statuses: builtStatuses,
      types: builtTypes,
      priorities: builtPriorities,
      renames: {
        statuses: renamesFrom(statuses),
        types: renamesFrom(types),
        priorities: prioRenames,
      },
    };
    try {
      await onSave(edit);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return {
    statuses,
    types,
    priorities,
    setTypes,
    setPriorities,
    statusDrag,
    priorityDrag,
    editStatus,
    removeStatus,
    addStatus,
    editType,
    addType,
    removeType,
    setTypeRow,
    fieldsSetterFor,
    builtPriorities,
    dirty,
    busy,
    error,
    setError,
    save,
    reseed,
  };
}

export type SchemaDraft = ReturnType<typeof useSchemaDraft>;
