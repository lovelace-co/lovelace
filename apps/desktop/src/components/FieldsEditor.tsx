import { Fragment, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Dropdown } from './Dropdown';
import { HoleCheck } from './HoleCheck';
import { titleCase } from '../lib/format';
import {
  FIELD_TYPES,
  ITEM_TYPES,
  SPECIAL_REF_KINDS,
  applyHuman,
  blankField,
  type FieldRow,
  type FieldType,
} from '../lib/workflowRows';

interface FieldsEditorProps {
  fields: FieldRow[];
  setFields: Dispatch<SetStateAction<FieldRow[]>>;
  /** Enum defaults sourced from Priorities offer these options. */
  priorities: string[];
  /** Ticket type machine names a reference field may target. */
  typeNames: string[];
}

/**
 * The custom-field editor: a header row, the locked Title and Body defaults,
 * then one editable row per user field with a type-specific sub-editor (enum
 * value list, reference targets, list item type). Shared by the init wizard
 * and the workflow editor so the field model lives in one place.
 */
export function FieldsEditor({ fields, setFields, priorities, typeNames }: FieldsEditorProps) {
  const refKinds = [...typeNames.filter(Boolean), ...SPECIAL_REF_KINDS];

  const editField = (i: number, p: Partial<FieldRow>) =>
    setFields((rows) => rows.map((r, j) => (j === i ? applyHuman({ ...r, ...p }, p) : r)));

  // Enum value-list editing (and its drag-to-reorder) for the field at index i.
  const enumFrom = useRef<number | null>(null);
  const [enumOver, setEnumOver] = useState<{ field: number; over: number } | null>(null);
  const editValues = (i: number, fn: (values: string[]) => string[]) =>
    setFields((rows) => rows.map((r, j) => (j === i ? { ...r, values: fn(r.values) } : r)));

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
    <>
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
                <input className="form-input mono" aria-label={`field ${i} machine`} value={f.machine} onChange={(e) => editField(i, { machine: e.target.value })} />
                {fieldTypeCell(f, i)}
                <HoleCheck className="wizard-cell-check" aria-label={`field ${i} required`} checked={f.required} onChange={(e) => editField(i, { required: e.target.checked })} />
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
      <button className="btn btn-secondary wizard-add" onClick={() => setFields((rows) => [...rows, blankField()])}>
        Add field
      </button>
    </>
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
        <HoleCheck className="wizard-cell-check" checked readOnly disabled aria-label={`${machine} field required`} />
        <span className="wizard-locked-tag" title="Built-in and required">locked</span>
      </div>
    </div>
  );
}
