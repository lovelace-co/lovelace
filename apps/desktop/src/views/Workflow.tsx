import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { titleCase } from '../lib/format';
import { STATUS_HUE_CSS, statusHue } from '../lib/loom';
import { FieldsEditor } from '../components/FieldsEditor';
import { HoleCheck } from '../components/HoleCheck';
import { Toast } from '../components/Toast';
import {
  applyHuman,
  blankStatus,
  blankType,
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
} from '../lib/workflowRows';
import type { Snapshot, Workflow, WorkflowEdit } from '../lib/types';

interface WorkflowProps {
  snapshot: Snapshot;
  /** Persist a workflow-editor save; core validates and cascades renames. */
  onSave: (edit: WorkflowEdit) => Promise<void>;
}

interface PriorityRow {
  original: string | null;
  value: string;
}

type WorkflowTab = 'statuses' | 'transitions' | 'types' | 'priorities' | 'fields';

const TABS: Array<{ key: WorkflowTab; label: string }> = [
  { key: 'statuses', label: 'Statuses' },
  { key: 'transitions', label: 'Transitions' },
  { key: 'types', label: 'Types' },
  { key: 'priorities', label: 'Priorities' },
  { key: 'fields', label: 'Fields' },
];

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
 * The workflow editor. The state machine, ticket types, priorities and custom
 * fields are edited in place; one Save writes the lot through core, which
 * validates it and cascades any rename to existing tickets, or refuses a
 * removal that would strand them. Resting state shows the current workflow;
 * a Save/Discard bar appears once something is changed.
 */
export function Workflow({ snapshot, onSave }: WorkflowProps) {
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
  const [tab, setTab] = useState<WorkflowTab>('statuses');

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

  const customFieldCount = fields.filter((f) => f.machine !== 'title').length;

  const tabHint: Record<WorkflowTab, string> = {
    statuses: 'The board columns, in order. Mark the working ones Active and the finished ones Complete.',
    transitions: 'The moves each status allows. Tick a target to make it a legal move; anything unticked is refused.',
    types: 'The kinds of ticket, each with its own ID prefix (for example T-0042).',
    priorities: 'The priority scale, highest first. Shown capitalised on cards.',
    fields: 'The data every ticket carries. Title and Body are built in; the rest are yours to define.',
  };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Workflow</h1>
        <div className="subtabs" role="tablist" aria-label="workflow sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`subtab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="workflow-actions">
          {dirty ? (
            <>
              <span className="subtle">Unsaved changes</span>
              <button className="btn btn-ghost" onClick={reseed} disabled={busy}>
                Discard
              </button>
              <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving...' : 'Save changes'}
              </button>
            </>
          ) : (
            <span className="subtle num">
              {statuses.length} statuses · {types.length} types · {customFieldCount} fields
            </span>
          )}
        </div>
      </header>

      {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}

      <div className="view-body">
        <p className="subtle" style={{ marginBottom: 18, maxWidth: '58ch' }}>
          {tabHint[tab]}
        </p>

        {tab === 'statuses' && (
          <section role="tabpanel" aria-label="Statuses">
            <div className="wizard-table">
              <div className="wizard-thead cols-status">
                <span>Name</span>
                <span>Machine</span>
                <span>Active</span>
                <span>Complete</span>
                <span />
              </div>
              {statuses.map((s, i) => (
                <Fragment key={i}>
                  {statusDrag.over === i && statusDrag.active && <div className="wizard-drop-line" />}
                  <div className="wizard-trow cols-status" {...statusDrag.zoneProps(i)}>
                    <span className="wizard-handle" aria-label={`drag status ${i}`} {...statusDrag.handleProps(i)}>⠿</span>
                    <input className="form-input" aria-label={`status ${i} label`} value={s.human} placeholder="Name" onChange={(e) => editStatus(i, { human: e.target.value })} />
                    <input className="form-input mono" aria-label={`status ${i} machine`} value={s.machine} onChange={(e) => editStatus(i, { machine: e.target.value })} />
                    <HoleCheck className="wizard-cell-check" aria-label={`status ${i} active`} checked={s.active} onChange={(e) => editStatus(i, { active: e.target.checked })} />
                    <HoleCheck className="wizard-cell-check" aria-label={`status ${i} complete`} checked={s.complete} onChange={(e) => editStatus(i, { complete: e.target.checked })} />
                    <button className="btn btn-secondary btn-icon" aria-label={`remove status ${i}`} disabled={statuses.length <= 1} onClick={() => removeStatus(i)}>×</button>
                  </div>
                </Fragment>
              ))}
            </div>
            <button className="btn btn-secondary wizard-add" onClick={addStatus}>
              Add status
            </button>
          </section>
        )}

        {tab === 'transitions' && (
          <section role="tabpanel" aria-label="Transitions">
            <div className="panel" style={{ padding: '6px 0' }}>
              {statuses.map((s) => (
                <div key={s.machine} className="transition-row">
                  <span className="transition-from">
                    <span className="priority-dot" style={{ background: STATUS_HUE_CSS[statusHue(draftWorkflow, s.machine)] }} />
                    {s.human || s.machine}
                  </span>
                  <span className="transition-arrow" aria-hidden>
                    &rarr;
                  </span>
                  <span className="transition-targets wizard-chips">
                    {statuses.filter((o) => o.machine !== s.machine).length === 0 ? (
                      <span className="subtle">no other statuses</span>
                    ) : (
                      statuses
                        .filter((o) => o.machine !== s.machine)
                        .map((o) => {
                          const on = (transitions[s.machine] ?? []).includes(o.machine);
                          return (
                            <button
                              key={o.machine}
                              type="button"
                              className={`wizard-chip${on ? ' on' : ''}`}
                              aria-label={`${s.machine} to ${o.machine}`}
                              aria-pressed={on}
                              onClick={() => toggleTransition(s.machine, o.machine)}
                            >
                              {o.human || o.machine}
                            </button>
                          );
                        })
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'types' && (
          <section role="tabpanel" aria-label="Types">
            <div className="wizard-table">
              <div className="wizard-thead cols-type">
                <span>Name</span>
                <span>Machine</span>
                <span>Plural</span>
                <span>ID prefix</span>
                <span />
              </div>
              {types.map((t, i) => (
                <div key={i} className="wizard-trow cols-type">
                  <input className="form-input" aria-label={`type ${i} label`} value={t.human} placeholder="Name" onChange={(e) => editType(i, { human: e.target.value })} />
                  <input className="form-input mono" aria-label={`type ${i} machine`} value={t.machine} onChange={(e) => editType(i, { machine: e.target.value })} />
                  <input className="form-input" aria-label={`type ${i} plural`} value={t.plural} placeholder="Plural" onChange={(e) => editType(i, { plural: e.target.value })} />
                  <input className="form-input mono" aria-label={`type ${i} prefix`} value={t.prefix} title={`e.g. ${t.prefix || 'X'}-0042`} onChange={(e) => editType(i, { prefix: e.target.value.toUpperCase() })} />
                  <button className="btn btn-secondary btn-icon" aria-label={`remove type ${i}`} disabled={types.length <= 1} onClick={() => setTypes((rows) => rows.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary wizard-add" onClick={() => setTypes((rows) => [...rows, blankType()])}>
              Add type
            </button>
          </section>
        )}

        {tab === 'priorities' && (
          <section role="tabpanel" aria-label="Priorities">
            <div className="wizard-table">
              <div className="wizard-thead cols-priority">
                <span>Value (highest first; shown capitalised)</span>
                <span />
              </div>
              {priorities.map((p, i) => (
                <Fragment key={i}>
                  {priorityDrag.over === i && priorityDrag.active && <div className="wizard-drop-line" />}
                  <div className="wizard-trow cols-priority" {...priorityDrag.zoneProps(i)}>
                    <span className="wizard-handle" aria-label={`drag priority ${i}`} {...priorityDrag.handleProps(i)}>⠿</span>
                    <input className="form-input" aria-label={`priority ${i}`} value={p.value} onChange={(e) => setPriorities((ps) => ps.map((q, j) => (j === i ? { ...q, value: e.target.value } : q)))} />
                    <button className="btn btn-secondary btn-icon" aria-label={`remove priority ${i}`} onClick={() => setPriorities((ps) => ps.filter((_, j) => j !== i))}>×</button>
                  </div>
                </Fragment>
              ))}
            </div>
            <button className="btn btn-secondary wizard-add" onClick={() => setPriorities((ps) => [...ps, { original: null, value: 'New' }])}>
              Add priority
            </button>
          </section>
        )}

        {tab === 'fields' && (
          <section role="tabpanel" aria-label="Fields">
            <FieldsEditor
              fields={fields}
              setFields={setFields}
              priorities={builtPriorities}
              typeNames={types.map((t) => t.machine)}
            />
          </section>
        )}
      </div>
    </>
  );
}
