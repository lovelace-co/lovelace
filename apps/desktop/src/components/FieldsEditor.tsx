import { Fragment, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Dropdown } from './Dropdown';
import { HoleCheck } from './HoleCheck';
import { LockIcon } from './icons';
import { titleCase } from '../lib/format';
import {
  FIELD_TYPES,
  ITEM_TYPES,
  SPECIAL_REF_KINDS,
  applyHuman,
  blankField,
  type FieldRow,
  type FieldType,
} from '../lib/schemaRows';

interface FieldsEditorProps {
  fields: FieldRow[];
  setFields: Dispatch<SetStateAction<FieldRow[]>>;
  /** Enum defaults sourced from Priorities offer these options. */
  priorities: string[];
  /** Ticket type machine names a reference field may target. */
  typeNames: string[];
}

/**
 * A plain-English summary of a field's type, read at rest instead of the
 * type dropdown: "enum, 3 values", "reference to Actor", "list of string".
 */
function fieldTypeSummary(f: FieldRow): string {
  if (f.type === 'enum') {
    if (f.valuesFrom === 'priorities') return 'enum, from Priorities';
    const n = f.values.length;
    return `enum, ${n} value${n === 1 ? '' : 's'}`;
  }
  if (f.type === 'reference') {
    return f.refersTo.length > 0 ? `reference to ${f.refersTo.map(titleCase).join(', ')}` : 'reference';
  }
  if (f.type === 'list') {
    const item = f.itemType || 'string';
    const to = item === 'reference' && f.refersTo.length > 0 ? ` to ${f.refersTo.map(titleCase).join(', ')}` : '';
    return `list of ${item}${to}`;
  }
  return f.type;
}

/**
 * The custom-field editor: the Title and Body defaults lead as static rows,
 * then one quiet row per user field. A field row is read-only at rest and
 * expands in place into its editor (name/machine wells, type dropdown,
 * required check, remove, and a type-specific sub-editor) on click; only one
 * row is open at a time, the same read-first, edit-on-intent model as ticket
 * bodies and documents. Shared by the init wizard and the schema editor (one
 * instance per ticket type) so the field model lives in one place.
 */
export function FieldsEditor({ fields, setFields, priorities, typeNames }: FieldsEditorProps) {
  const refKinds = [...typeNames.filter(Boolean), ...SPECIAL_REF_KINDS];
  const [expanded, setExpanded] = useState<number | null>(null);

  const editField = (i: number, p: Partial<FieldRow>) =>
    setFields((rows) => rows.map((r, j) => (j === i ? applyHuman({ ...r, ...p }, p) : r)));

  const removeField = (i: number) => {
    setFields((rows) => rows.filter((_, j) => j !== i));
    setExpanded((cur) => (cur === null || cur === i ? null : cur > i ? cur - 1 : cur));
  };

  // Appending a field opens it immediately: there is nothing useful to read
  // in a blank row, so it goes straight to editing.
  const addField = () => {
    const opened = fields.length;
    setFields((rows) => [...rows, blankField()]);
    setExpanded(opened);
  };

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
      <div className="wizard-fields">
        {/* The mandatory defaults lead, shaped like the read rows but static: nothing to edit, nothing to open. */}
        <LockedFieldRow human="Title" machine="title" type="string" />
        <LockedFieldRow human="Body" machine="body" type="markdown" />
        {fields.map((f, i) => {
          // The mandatory title row is pinned above by identity (seeded
          // from the file's own title field, or synthesised for a new
          // type), never by machine name: a field renamed to `title` stays
          // visible so core's duplicate-field rejection makes sense.
          if (f.locked) return null;
          if (expanded !== i) {
            return (
              <button
                key={i}
                type="button"
                className="field-row field-row-grid"
                aria-expanded={false}
                onClick={() => setExpanded(i)}
              >
                <span className="field-row-lead">
                  <span className="field-row-name">{f.human || 'Untitled field'}</span>
                  <span className="field-row-machine mono subtle">{f.machine}</span>
                </span>
                <span className="field-row-type subtle">{fieldTypeSummary(f)}</span>
                <span className="field-row-note subtle">{f.required ? 'required' : ''}</span>
              </button>
            );
          }

          return (
            <div key={i} className="field-row-open">
              <button
                type="button"
                className="field-row field-row-header"
                aria-expanded={true}
                onClick={() => setExpanded(null)}
              >
                <span className="field-row-lead">
                  <span className="field-row-name">{f.human || 'Untitled field'}</span>
                  <span className="field-row-machine mono subtle">{f.machine}</span>
                </span>
                <span className="field-row-collapse subtle">Done</span>
              </button>

              <div className="wizard-thead cols-field wizard-field-head">
                <span>Name</span>
                <span>Machine</span>
                <span>Type</span>
                <span>Required</span>
                <span />
              </div>
              <div className="wizard-trow cols-field">
                <input className="form-input" aria-label={`field ${i} label`} value={f.human} placeholder="Name" onChange={(e) => editField(i, { human: e.target.value })} />
                <input className="form-input mono" aria-label={`field ${i} machine`} value={f.machine} onChange={(e) => editField(i, { machine: e.target.value })} />
                {fieldTypeCell(f, i)}
                <HoleCheck className="wizard-cell-check" aria-label={`field ${i} required`} checked={f.required} onChange={(e) => editField(i, { required: e.target.checked })} />
                <button className="btn btn-secondary btn-icon" aria-label={`remove field ${i}`} onClick={() => removeField(i)}>×</button>
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
          );
        })}
      </div>
      <button className="btn btn-secondary wizard-add" onClick={addField}>
        Add field
      </button>
    </>
  );
}

/**
 * A mandatory default field shown in the same shape as the read rows, but
 * static: there is nothing to edit, so there is nothing to click.
 */
function LockedFieldRow({ human, machine, type }: { human: string; machine: string; type: string }) {
  return (
    <div className="field-row-grid field-row-locked">
      <span className="field-row-lead">
        <span className="field-row-name">{human}</span>
        <span className="field-row-machine mono subtle">{machine}</span>
      </span>
      <span className="field-row-type subtle">{type}</span>
      <span className="field-row-note subtle" role="img" aria-label="built in" title="Built in">
        <LockIcon />
      </span>
    </div>
  );
}
