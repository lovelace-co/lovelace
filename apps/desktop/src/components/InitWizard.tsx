import { Fragment, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Dropdown } from './Dropdown';
import { slugify, titleCase } from '../lib/format';
import { useHost } from '../state/store';
import type { FieldDef, Workflow } from '../lib/types';

const STEPS = ['Project', 'Statuses', 'Types & Fields', 'Review'] as const;
const FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'list', 'reference'] as const;
const ITEM_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'reference'] as const;
const SPECIAL_REF_KINDS = ['actor', 'brief'] as const;
type FieldType = FieldDef['type'];

interface StatusRow {
  human: string;
  machine: string;
  machineTouched: boolean;
  active: boolean;
  complete: boolean;
}
interface TypeRow {
  human: string;
  machine: string;
  machineTouched: boolean;
  plural: string;
  pluralTouched: boolean;
  prefix: string;
  prefixTouched: boolean;
}
interface FieldRow {
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
}

interface InitWizardProps {
  initTarget: string;
  defaults: Workflow;
  initialName: string;
  onCancel: () => void;
  onDone: (root: string) => void;
}

function permissive(statuses: Array<{ name: string }>): Workflow['transitions'] {
  return statuses.map((s) => ({
    from: s.name,
    to: statuses.filter((o) => o.name !== s.name).map((o) => o.name),
  }));
}

function seedStatus(s: Workflow['statuses'][number]): StatusRow {
  const human = s.label ?? titleCase(s.name);
  return {
    human,
    machine: s.name,
    machineTouched: s.name !== slugify(human),
    active: s.active ?? false,
    complete: s.complete ?? false,
  };
}
function seedType(t: Workflow['types'][number]): TypeRow {
  const human = t.label ?? titleCase(t.name);
  return {
    human,
    machine: t.name,
    machineTouched: t.name !== slugify(human),
    plural: t.plural ?? `${human}s`,
    pluralTouched: t.plural !== undefined,
    prefix: t.id_prefix,
    prefixTouched: t.id_prefix !== (t.name[0] ?? '').toUpperCase(),
  };
}
function seedField(f: FieldDef): FieldRow {
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
  };
}

/**
 * HTML5 drag-to-reorder for a list state setter. A handle starts the drag;
 * `over` is the index the cursor is hovering, so the caller can render a thin
 * insertion line there.
 */
function useReorder<T>(setItems: Dispatch<SetStateAction<T[]>>) {
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
      onDragOver: (e: React.DragEvent) => {
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

export function InitWizard({ initTarget, defaults, initialName, onCancel, onDone }: InitWizardProps) {
  const host = useHost();
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState(initialName);
  const [userName, setUserName] = useState('');
  const [claudeSetup, setClaudeSetup] = useState(true);
  const [gitHook, setGitHook] = useState(true);
  const [statuses, setStatuses] = useState<StatusRow[]>(() => defaults.statuses.map(seedStatus));
  const [types, setTypes] = useState<TypeRow[]>(() => defaults.types.map(seedType));
  const [fields, setFields] = useState<FieldRow[]>(() => defaults.fields.map(seedField));
  const [priorities, setPriorities] = useState<string[]>(() => [...defaults.priorities]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualSteps, setManualSteps] = useState<string[]>([]);

  const statusDrag = useReorder(setStatuses);
  const priorityDrag = useReorder(setPriorities);
  const refKinds = [...types.map((t) => t.machine).filter(Boolean), ...SPECIAL_REF_KINDS];

  function applyHuman<T extends { human: string; machine: string; machineTouched: boolean }>(
    next: T,
    p: Partial<T>,
  ): T {
    if ('machine' in p) next.machineTouched = true;
    else if ('human' in p && !next.machineTouched) next.machine = slugify(next.human);
    return next;
  }

  const editStatus = (i: number, p: Partial<StatusRow>) =>
    setStatuses((rows) => rows.map((r, j) => (j === i ? applyHuman({ ...r, ...p }, p) : r)));
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
  const editField = (i: number, p: Partial<FieldRow>) =>
    setFields((rows) => rows.map((r, j) => (j === i ? applyHuman({ ...r, ...p }, p) : r)));

  // Enum value-list editing for the field at index i.
  const enumFrom = useRef<number | null>(null);
  const [enumOver, setEnumOver] = useState<{ field: number; over: number } | null>(null);
  const editValues = (i: number, fn: (values: string[]) => string[]) =>
    setFields((rows) => rows.map((r, j) => (j === i ? { ...r, values: fn(r.values) } : r)));

  const buildWorkflow = (): Workflow => {
    const builtStatuses = statuses.map((r) => ({
      name: r.machine,
      ...(r.active ? { active: true } : {}),
      ...(r.complete ? { complete: true } : {}),
      ...(r.human && r.human !== titleCase(r.machine) ? { label: r.human } : {}),
    }));
    const builtTypes = types.map((r) => ({
      name: r.machine,
      id_prefix: r.prefix,
      ...(r.human && r.human !== titleCase(r.machine) ? { label: r.human } : {}),
      ...(r.plural && r.plural !== `${titleCase(r.machine)}s` ? { plural: r.plural } : {}),
    }));
    const builtFields = fields.map((r) => {
      const f: FieldDef = { name: r.machine, type: r.type };
      if (r.human && r.human !== titleCase(r.machine)) f.label = r.human;
      if (r.required) f.required = true;
      if (r.type === 'enum') {
        if (r.valuesFrom) f.values_from = r.valuesFrom;
        else if (r.values.length > 0) f.values = r.values;
        // A default makes the field safe for quick-add, which only sets a title.
        const effective = r.valuesFrom === 'priorities' ? priorities : r.values;
        if (r.defaultValue && effective.includes(r.defaultValue)) f.default = r.defaultValue;
      }
      if (r.type === 'reference' && r.refersTo.length > 0) f.refers_to = r.refersTo;
      if (r.type === 'list' && r.itemType) f.item_type = r.itemType as Exclude<FieldType, 'list'>;
      return f;
    });
    const statusesChanged = JSON.stringify(builtStatuses) !== JSON.stringify(defaults.statuses);
    return {
      types: builtTypes,
      statuses: builtStatuses,
      transitions: statusesChanged ? permissive(builtStatuses) : defaults.transitions,
      priorities,
      fields: builtFields,
      on_transition: [],
    };
  };

  const finish = async (useDefaults: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let workflow: Workflow | undefined;
      if (!useDefaults) {
        const built = buildWorkflow();
        if (JSON.stringify(built) !== JSON.stringify(defaults)) workflow = built;
      }
      await host.init(initTarget, projectName.trim() || 'Untitled project', userName.trim() || undefined, workflow);
      if (claudeSetup) {
        const result = await host.installClaude(initTarget, gitHook);
        if (result.manual.length > 0) {
          setManualSteps(result.manual);
          setBusy(false);
          return;
        }
      }
      onDone(initTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (manualSteps.length > 0) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h2>A few manual steps</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            The project is initialised, but these could not be done automatically:
          </p>
          <ul style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            {manualSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => onDone(initTarget)}>
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fieldTypeCell = (row: FieldRow, i: number) => (
    <Dropdown
      aria-label={`field ${i} type`}
      value={row.type}
      placeholder="type"
      width="100%"
      options={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
      onChange={(v) => editField(i, { type: v as FieldType })}
    />
  );

  return (
    <div className="modal-backdrop">
      <div className="modal wizard">
        <div className="wizard-steps">
          {STEPS.map((label, i) => (
            <span key={label} className={`wizard-step${i === step ? ' current' : ''}${i < step ? ' done' : ''}`}>
              <span className="wizard-dot" />
              {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <>
            <h2>Initialise Lovelace here?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
              <span className="mono">{initTarget}</span> has no <span className="mono">.lovelace</span> directory.
              Set up the workflow below, or use the defaults. Your existing files are not touched.
            </p>
            <div className="field-row">
              <span className="label">Project name</span>
              <input className="form-input" aria-label="project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
            <div className="field-row">
              <span className="label">Your name</span>
              <input className="form-input" aria-label="your name" placeholder="for tracking authorship of tickets, comments, etc" value={userName} onChange={(e) => setUserName(e.target.value)} />
            </div>
            <div className="field-row">
              <span className="label">Claude Code</span>
              <label className="wizard-check">
                <input type="checkbox" aria-label="set up Claude Code" checked={claudeSetup} onChange={(e) => setClaudeSetup(e.target.checked)} />
                CLAUDE.md section, MCP server and hooks
              </label>
            </div>
            <div className="field-row">
              <span className="label">Git hook</span>
              <label className="wizard-check">
                <input type="checkbox" aria-label="install git hook" checked={gitHook} disabled={!claudeSetup} onChange={(e) => setGitHook(e.target.checked)} />
                Add ticket IDs to commit messages
              </label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Statuses</h2>
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
                  <input type="checkbox" className="wizard-cell-check" aria-label={`status ${i} active`} checked={s.active} onChange={(e) => editStatus(i, { active: e.target.checked })} />
                  <input type="checkbox" className="wizard-cell-check" aria-label={`status ${i} complete`} checked={s.complete} onChange={(e) => editStatus(i, { complete: e.target.checked })} />
                  <button className="btn btn-secondary btn-icon" aria-label={`remove status ${i}`} disabled={statuses.length <= 1} onClick={() => setStatuses((rows) => rows.filter((_, j) => j !== i))}>×</button>
                  </div>
                </Fragment>
              ))}
            </div>
            <button className="btn btn-secondary wizard-add" onClick={() => setStatuses((rows) => [...rows, seedStatus({ name: 'new_status' })])}>
              Add status
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Types, fields &amp; priorities</h2>

            <div className="wizard-section-title">Ticket types</div>
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
            <button className="btn btn-secondary wizard-add" onClick={() => setTypes((rows) => [...rows, seedType({ name: 'new_type', id_prefix: 'X' })])}>
              Add type
            </button>

            <div className="wizard-section-title">Priorities</div>
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
                    <input className="form-input" aria-label={`priority ${i}`} value={p} onChange={(e) => setPriorities((ps) => ps.map((q, j) => (j === i ? e.target.value : q)))} />
                    <button className="btn btn-secondary btn-icon" aria-label={`remove priority ${i}`} onClick={() => setPriorities((ps) => ps.filter((_, j) => j !== i))}>×</button>
                  </div>
                </Fragment>
              ))}
            </div>
            <button className="btn btn-secondary wizard-add" onClick={() => setPriorities((ps) => [...ps, 'New'])}>
              Add priority
            </button>

            <div className="wizard-section-title">Fields</div>
            <div className="wizard-thead cols-field wizard-field-head">
              <span>Name</span>
              <span>Machine</span>
              <span>Type</span>
              <span>Required</span>
              <span />
            </div>
            <div className="wizard-fields">
              {/* The mandatory defaults lead, shaped like the editable rows but locked. */}
              <LockedFieldRow human="Title" machine="title" type="string" />
              <LockedFieldRow human="Body" machine="body" type="markdown" />
              {fields.map((f, i) =>
                f.machine === 'title' ? null : (
                  <div key={i} className="wizard-frow">
                    <div className="wizard-trow cols-field">
                      <input className="form-input" aria-label={`field ${i} label`} value={f.human} placeholder="Name" onChange={(e) => editField(i, { human: e.target.value })} />
                      <input className="form-input mono" aria-label={`field ${i} machine`} value={f.machine} onChange={(e) => editField(i, { machine: slugify(e.target.value) || e.target.value })} />
                      {fieldTypeCell(f, i)}
                      <input type="checkbox" className="wizard-cell-check" aria-label={`field ${i} required`} checked={f.required} onChange={(e) => editField(i, { required: e.target.checked })} />
                      <button className="btn btn-secondary btn-icon" aria-label={`remove field ${i}`} onClick={() => setFields((rows) => rows.filter((_, j) => j !== i))}>×</button>
                    </div>

                    {f.type === 'enum' && (
                      <div className="wizard-fsub">
                        <Dropdown
                          aria-label={`field ${i} values from`}
                          value={f.valuesFrom || 'custom'}
                          placeholder="values from"
                          width={180}
                          options={[
                            { value: 'custom', label: 'Custom values' },
                            { value: 'priorities', label: 'From: Priorities' },
                          ]}
                          onChange={(v) => editField(i, { valuesFrom: v === 'priorities' ? 'priorities' : '' })}
                        />
                        {f.valuesFrom === 'priorities' && (
                          <label className="wizard-default-row">
                            <span className="wizard-default-label">Default</span>
                            <Dropdown
                              aria-label={`field ${i} default`}
                              value={f.defaultValue}
                              placeholder="(no default)"
                              width={200}
                              options={priorities.map((p) => ({ value: p, label: titleCase(p) }))}
                              onChange={(v) => editField(i, { defaultValue: v })}
                            />
                          </label>
                        )}
                        {f.valuesFrom !== 'priorities' && (
                          <div className="wizard-enum-list">
                            <div className="wizard-thead cols-enum">
                              <span>Value</span>
                              <span>Default</span>
                              <span />
                            </div>
                            {f.values.map((v, vi) => (
                              <Fragment key={vi}>
                                {enumOver?.field === i && enumOver.over === vi && <div className="wizard-drop-line" />}
                              <div
                                className="wizard-trow cols-enum"
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setEnumOver((o) => (o?.field === i && o.over === vi ? o : { field: i, over: vi }));
                                }}
                                onDrop={() => {
                                  const from = enumFrom.current;
                                  enumFrom.current = null;
                                  setEnumOver(null);
                                  if (from === null || from === vi) return;
                                  editValues(i, (vals) => {
                                    const next = [...vals];
                                    const [m] = next.splice(from, 1);
                                    next.splice(vi, 0, m!);
                                    return next;
                                  });
                                }}
                              >
                                <span
                                  className="wizard-handle"
                                  aria-label={`drag field ${i} value ${vi}`}
                                  draggable
                                  onDragStart={() => {
                                    enumFrom.current = vi;
                                    setEnumOver({ field: i, over: vi });
                                  }}
                                  onDragEnd={() => setEnumOver(null)}
                                >
                                  ⠿
                                </span>
                                <input
                                  className="form-input mono"
                                  aria-label={`field ${i} value ${vi}`}
                                  value={v}
                                  onChange={(e) => editValues(i, (vals) => vals.map((q, k) => (k === vi ? e.target.value : q)))}
                                />
                                <input
                                  type="radio"
                                  className="wizard-cell-check"
                                  name={`field-${i}-default`}
                                  aria-label={`field ${i} value ${vi} default`}
                                  checked={f.defaultValue === v && v !== ''}
                                  onChange={() => editField(i, { defaultValue: v })}
                                />
                                <button
                                  className="btn btn-secondary btn-icon"
                                  aria-label={`remove field ${i} value ${vi}`}
                                  onClick={() => {
                                    editValues(i, (vals) => vals.filter((_, k) => k !== vi));
                                    if (f.defaultValue === v) editField(i, { defaultValue: '' });
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                              </Fragment>
                            ))}
                            <button className="btn btn-secondary btn-small" onClick={() => editValues(i, (vals) => [...vals, ''])}>
                              Add value
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {f.type === 'reference' && (
                      <div className="wizard-fsub">
                        <div className="wizard-chips" aria-label={`field ${i} targets`}>
                          {refKinds.map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              className={`wizard-chip${f.refersTo.includes(kind) ? ' on' : ''}`}
                              onClick={() =>
                                editField(i, {
                                  refersTo: f.refersTo.includes(kind)
                                    ? f.refersTo.filter((k) => k !== kind)
                                    : [...f.refersTo, kind],
                                })
                              }
                            >
                              {titleCase(kind)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {f.type === 'list' && (
                      <div className="wizard-fsub">
                        <Dropdown
                          aria-label={`field ${i} item type`}
                          value={f.itemType}
                          placeholder="item type"
                          width={170}
                          options={ITEM_TYPES.map((t) => ({ value: t, label: `of ${t}` }))}
                          onChange={(v) => editField(i, { itemType: v })}
                        />
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
            <button className="btn btn-secondary wizard-add" onClick={() => setFields((rows) => [...rows, seedField({ name: 'new_field', type: 'string' })])}>
              Add field
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Review</h2>
            <div className="wizard-review">
              <div><span className="label">Columns</span> {statuses.map((s) => s.human).join(' · ')}</div>
              <div><span className="label">Types</span> {types.map((t) => `${t.human} (${t.prefix})`).join(', ')}</div>
              <div><span className="label">Fields</span> {['Title', 'Body', ...fields.filter((f) => f.machine !== 'title').map((f) => f.human)].join(', ')}</div>
              <div><span className="label">Priorities</span> {priorities.map((p) => titleCase(p)).join(', ')}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                {JSON.stringify(statuses.map((s) => s.machine)) !== JSON.stringify(defaults.statuses.map((s) => s.name))
                  ? 'Because you changed the statuses, agents will be allowed to move tickets between any columns. Tighten this later in workflow.yaml.'
                  : 'Using the default transition flow.'}
              </div>
            </div>
          </>
        )}

        {error && <div className="banner" style={{ margin: '0.8rem 0 0' }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {step === 0 && (
            <button className="btn btn-secondary" onClick={() => void finish(true)} disabled={busy}>
              Use defaults
            </button>
          )}
          {step > 0 && (
            <button className="btn btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)} disabled={busy}>
              Next
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void finish(false)} disabled={busy}>
              {busy ? 'Initialising...' : 'Initialise project'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A mandatory default field shown in the same shape as the editable rows, disabled. */
function LockedFieldRow({ human, machine, type }: { human: string; machine: string; type: string }) {
  return (
    <div className="wizard-frow">
      <div className="wizard-trow cols-field">
        <input className="form-input" value={human} readOnly tabIndex={-1} aria-label={`${machine} field name`} />
        <input className="form-input mono" value={machine} readOnly tabIndex={-1} aria-label={`${machine} field machine`} />
        <Dropdown aria-label={`${machine} field type`} value={type} disabled width="100%" options={[{ value: type, label: type }]} onChange={() => undefined} />
        <input type="checkbox" className="wizard-cell-check" checked readOnly disabled aria-label={`${machine} field required`} />
        <span className="wizard-locked-tag" title="Built-in and required">locked</span>
      </div>
    </div>
  );
}
