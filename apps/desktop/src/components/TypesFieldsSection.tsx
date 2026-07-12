import { Fragment, useState } from 'react';
import { FieldsEditor } from './FieldsEditor';
import { ViewTabs } from './ViewTabs';
import { EditIcon } from './icons';
import { applyTypeIdentity, useReorder, type TypeRow } from '../lib/schemaRows';
import type { PriorityRow, SchemaDraft } from '../lib/useSchemaDraft';

/** A type's field count, shown as its tab's quiet note: custom fields plus the built-in title. */
function fieldCountNote(fieldCount: number): string {
  return `${fieldCount} field${fieldCount === 1 ? '' : 's'}`;
}

/**
 * The Types settings section: a tab per ticket type, each showing that
 * type's field table on the open canvas, where the only boxes are the
 * controls themselves. The type's identity lives behind the pencil on its
 * tab; Priorities behind a modal reached from the same row. All edit one
 * shared schema draft.
 */
export function TypesFieldsSection({ draft }: { draft: SchemaDraft }) {
  const { types, setTypeRow, addType, removeType, fieldsSetterFor, priorities, setPriorities, builtPriorities } =
    draft;
  const [activeIndex, setActiveIndex] = useState(0);
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  // The type's identity (name/machine/plural/prefix) stays out of the resting
  // view; the pencil on the active tab opens its wells in a modal.
  const [editTypeOpen, setEditTypeOpen] = useState(false);

  const index = Math.min(activeIndex, Math.max(types.length - 1, 0));
  const active = types[index];
  const tabs = types.map((t, i) => ({
    key: String(i),
    label: t.human || t.machine,
    note: fieldCountNote(t.fields.length),
    ...(i === index ? { action: { label: 'edit type', icon: <EditIcon />, onClick: () => setEditTypeOpen(true) } } : {}),
  }));
  const selectTab = (key: string) => setActiveIndex(Number(key));

  return (
    <>
      <div className="type-tabs-row">
        <ViewTabs tabs={tabs} active={String(index)} onChange={selectTab} ariaLabel="ticket types" />
        <button
          type="button"
          className="type-tab-add"
          onClick={() => {
            addType();
            setActiveIndex(types.length);
          }}
        >
          + Add type
        </button>
        <button className="btn btn-secondary" onClick={() => setPrioritiesOpen(true)}>
          Priorities
        </button>
      </div>

      {active && (
        <div className="type-editor">
          <FieldsEditor
            key={index}
            fields={active.fields}
            setFields={fieldsSetterFor(index)}
            priorities={builtPriorities}
            typeNames={types.map((t) => t.machine)}
          />
        </div>
      )}

      {editTypeOpen && active && (
        <EditTypeModal
          type={active}
          removable={types.length > 1}
          onSave={(row) => setTypeRow(index, row)}
          onRemove={() => {
            removeType(index);
            setActiveIndex((i) => Math.max(0, i - 1));
          }}
          onClose={() => setEditTypeOpen(false)}
        />
      )}

      {prioritiesOpen && (
        <PrioritiesModal
          priorities={priorities}
          onSave={setPriorities}
          onClose={() => setPrioritiesOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The active type's identity (name, machine name, plural, ID prefix),
 * behind a modal reached from the pencil on its tab: a working copy of the
 * row, committed to the shared schema draft on Save and dropped on Cancel,
 * the same local-draft-then-commit shape PrioritiesModal uses. "Remove
 * type" lives here too, as the destructive action on the left.
 */
function EditTypeModal({
  type,
  removable,
  onSave,
  onRemove,
  onClose,
}: {
  type: TypeRow;
  removable: boolean;
  onSave: (row: TypeRow) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [row, setRow] = useState<TypeRow>(type);
  const edit = (p: Partial<TypeRow>) => setRow((r) => applyTypeIdentity(r, p));
  const examplePrefix = row.prefix || 'X';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit type</h2>
        <div className="wizard-table">
          <div className="wizard-thead cols-type-props">
            <span>Name</span>
            <span>Machine</span>
            <span>Plural</span>
            <span>ID prefix</span>
          </div>
          <div className="wizard-trow cols-type-props">
            <input className="form-input" aria-label="type name" value={row.human} placeholder="Name" onChange={(e) => edit({ human: e.target.value })} />
            <input className="form-input mono" aria-label="type machine" value={row.machine} onChange={(e) => edit({ machine: e.target.value })} />
            <input className="form-input" aria-label="type plural" value={row.plural} placeholder="Plural" onChange={(e) => edit({ plural: e.target.value })} />
            <input className="form-input mono" aria-label="type id prefix" value={row.prefix} onChange={(e) => edit({ prefix: e.target.value.toUpperCase() })} />
          </div>
        </div>
        <p className="subtle type-id-example">
          Tickets are numbered <span className="id-chip">{examplePrefix}-0001</span>,{' '}
          <span className="id-chip">{examplePrefix}-0002</span>, ...
        </p>
        <div className="modal-actions">
          <button
            className="btn btn-ghost modal-actions-left"
            disabled={!removable}
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            Remove type
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(row);
              onClose();
            }}
          >
            Save type
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The priorities editor, behind a modal: a working copy of the reorderable
 * priority list, committed to the shared schema draft on Save and dropped on
 * Cancel, the same local-draft-then-commit shape as the New document modal.
 */
function PrioritiesModal({
  priorities,
  onSave,
  onClose,
}: {
  priorities: PriorityRow[];
  onSave: (next: PriorityRow[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PriorityRow[]>(priorities);
  const drag = useReorder(setRows);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Priorities</h2>
        <div className="wizard-table">
          <div className="wizard-thead cols-priority">
            <span>Value (highest first; shown capitalised)</span>
            <span />
          </div>
          {rows.map((p, i) => (
            <Fragment key={i}>
              {drag.over === i && drag.active && <div className="wizard-drop-line" />}
              <div className="wizard-trow cols-priority" {...drag.zoneProps(i)}>
                <span className="wizard-handle" aria-label={`drag priority ${i}`} {...drag.handleProps(i)}>⠿</span>
                <input
                  className="form-input"
                  aria-label={`priority ${i}`}
                  value={p.value}
                  onChange={(e) => setRows((ps) => ps.map((q, j) => (j === i ? { ...q, value: e.target.value } : q)))}
                />
                <button className="btn btn-secondary btn-icon" aria-label={`remove priority ${i}`} onClick={() => setRows((ps) => ps.filter((_, j) => j !== i))}>×</button>
              </div>
            </Fragment>
          ))}
        </div>
        <button className="btn btn-secondary wizard-add" onClick={() => setRows((ps) => [...ps, { original: null, value: 'New' }])}>
          Add priority
        </button>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(rows);
              onClose();
            }}
          >
            Save priorities
          </button>
        </div>
      </div>
    </div>
  );
}
