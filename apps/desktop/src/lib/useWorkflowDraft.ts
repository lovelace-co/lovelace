import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyHuman,
  blankStatus,
  buildFields,
  buildStatuses,
  buildTypes,
  renamesFrom,
  seedField,
  seedStatus,
  seedType,
  useReorder,
  type FieldRow,
  type StatusRow,
  type TypeRow,
} from './workflowRows';
import type { Snapshot, Workflow, WorkflowEdit } from './types';

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

/** Order-independent transition shape for comparison (targets and rows sorted). */
function normTransitions(ts: Array<{ from: string; to: string[] }>) {
  return [...ts]
    .map((t) => ({ from: t.from, to: [...t.to].sort() }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

function seedTransitions(workflow: Workflow): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of workflow.statuses) {
    out[s.name] = workflow.transitions.find((t) => t.from === s.name)?.to ?? [];
  }
  return out;
}

/**
 * The workflow-editing state, extracted so more than one surface can share it.
 * It holds the editable rows for statuses, transitions, types, priorities and
 * fields, tracks whether anything changed, and saves the lot through core as a
 * single WorkflowEdit (which validates it and cascades any rename, or refuses a
 * removal that would strand tickets). Two Settings tabs mount one instance of
 * this, so their edits and their one Save/Discard span both.
 */
export function useWorkflowDraft(snapshot: Snapshot, onSave: (edit: WorkflowEdit) => Promise<void>) {
  const [statuses, setStatuses] = useState<StatusRow[]>(() => snapshot.workflow.statuses.map(seedStatus));
  const [types, setTypes] = useState<TypeRow[]>(() => snapshot.workflow.types.map(seedType));
  const [fields, setFields] = useState<FieldRow[]>(() => snapshot.workflow.fields.map(seedField));
  const [priorities, setPriorities] = useState<PriorityRow[]>(() =>
    snapshot.workflow.priorities.map((p) => ({ original: p, value: p })),
  );
  const [transitions, setTransitions] = useState<Record<string, string[]>>(() =>
    seedTransitions(snapshot.workflow),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusDrag = useReorder(setStatuses);
  const priorityDrag = useReorder(setPriorities);

  const reseed = () => {
    setStatuses(snapshot.workflow.statuses.map(seedStatus));
    setTypes(snapshot.workflow.types.map(seedType));
    setFields(snapshot.workflow.fields.map(seedField));
    setPriorities(snapshot.workflow.priorities.map((p) => ({ original: p, value: p })));
    setTransitions(seedTransitions(snapshot.workflow));
    setError(null);
  };

  // Re-seed when the workflow on disk changes (an external edit, or our own
  // save landing), but never mid-keystroke: local edits do not touch snapshot.
  const baseline = useMemo(
    () =>
      stable({
        statuses: snapshot.workflow.statuses,
        types: snapshot.workflow.types,
        priorities: snapshot.workflow.priorities,
        fields: snapshot.workflow.fields,
        transitions: normTransitions(snapshot.workflow.transitions),
      }),
    [snapshot.workflow],
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
  const builtTypes = buildTypes(types);
  const builtPriorities = priorities.map((p) => p.value);
  const builtFields = buildFields(fields, builtPriorities);
  const builtTransitions = statuses
    .map((s) => ({
      from: s.machine,
      to: (transitions[s.machine] ?? []).filter((to) => statuses.some((x) => x.machine === to)),
    }))
    .filter((t) => t.to.length > 0);

  const draftWorkflow: Workflow = {
    types: builtTypes,
    statuses: builtStatuses,
    transitions: builtTransitions,
    priorities: builtPriorities,
    fields: builtFields,
    on_transition: snapshot.workflow.on_transition,
  };

  const current = stable({
    statuses: snapshot.workflow.statuses,
    types: snapshot.workflow.types,
    priorities: snapshot.workflow.priorities,
    fields: snapshot.workflow.fields,
    transitions: normTransitions(snapshot.workflow.transitions),
  });
  const built = stable({
    statuses: builtStatuses,
    types: builtTypes,
    priorities: builtPriorities,
    fields: builtFields,
    transitions: normTransitions(builtTransitions),
  });
  const dirty = built !== current;

  const editStatus = (i: number, p: Partial<StatusRow>) => {
    const prev = statuses[i]!;
    const next = applyHuman({ ...prev, ...p }, p) as StatusRow;
    setStatuses((rows) => rows.map((r, j) => (j === i ? next : r)));
    if (next.machine !== prev.machine) {
      // Keep the transition graph pointing at the renamed status.
      setTransitions((tr) => {
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(tr)) {
          out[k === prev.machine ? next.machine : k] = v.map((t) => (t === prev.machine ? next.machine : t));
        }
        return out;
      });
    }
  };
  const removeStatus = (i: number) => {
    const removed = statuses[i]!.machine;
    setStatuses((rows) => rows.filter((_, j) => j !== i));
    setTransitions((tr) => {
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(tr)) {
        if (k === removed) continue;
        out[k] = v.filter((t) => t !== removed);
      }
      return out;
    });
  };
  const addStatus = () => {
    const row = blankStatus();
    setStatuses((rows) => [...rows, row]);
    setTransitions((tr) => ({ ...tr, [row.machine]: [] }));
  };
  const toggleTransition = (from: string, to: string) =>
    setTransitions((tr) => {
      const cur = tr[from] ?? [];
      return { ...tr, [from]: cur.includes(to) ? cur.filter((x) => x !== to) : [...cur, to] };
    });

  const editType = (i: number, p: Partial<TypeRow>) =>
    setTypes((rows) =>
      rows.map((r, j) => {
        if (j !== i) return r;
        const next = applyHuman({ ...r, ...p }, p) as TypeRow;
        if (p.human !== undefined && !next.pluralTouched) next.plural = `${next.human}s`;
        if (p.machine !== undefined && !next.prefixTouched) next.prefix = (next.machine[0] ?? '').toUpperCase();
        if (p.plural !== undefined) next.pluralTouched = true;
        if (p.prefix !== undefined) next.prefixTouched = true;
        return next;
      }),
    );

  const save = async () => {
    setBusy(true);
    setError(null);
    const prioRenames: Record<string, string> = {};
    for (const p of priorities) if (p.original !== null && p.original !== p.value) prioRenames[p.original] = p.value;
    const edit: WorkflowEdit = {
      statuses: builtStatuses,
      types: builtTypes,
      transitions: builtTransitions,
      priorities: builtPriorities,
      fields: builtFields,
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
    fields,
    priorities,
    transitions,
    setTypes,
    setFields,
    setPriorities,
    statusDrag,
    priorityDrag,
    editStatus,
    removeStatus,
    addStatus,
    toggleTransition,
    editType,
    builtPriorities,
    draftWorkflow,
    dirty,
    busy,
    error,
    setError,
    save,
    reseed,
  };
}

export type WorkflowDraft = ReturnType<typeof useWorkflowDraft>;
