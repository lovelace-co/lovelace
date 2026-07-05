import { Fragment } from 'react';
import { FieldsEditor } from './FieldsEditor';
import { blankType } from '../lib/workflowRows';
import type { WorkflowDraft } from '../lib/useWorkflowDraft';

/**
 * The Types & fields settings section: the ticket types, the priority scale,
 * and the custom fields every ticket carries. All edit one shared draft.
 */
export function TypesFieldsSection({ draft }: { draft: WorkflowDraft }) {
  const { types, editType, setTypes, priorities, priorityDrag, setPriorities, fields, setFields, builtPriorities } =
    draft;

  return (
    <>
      <h2 className="section-heading">Ticket types</h2>
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

      <h2 className="section-heading" style={{ marginTop: 36 }}>
        Priorities
      </h2>
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

      <h2 className="section-heading" style={{ marginTop: 36 }}>
        Fields
      </h2>
      <FieldsEditor
        fields={fields}
        setFields={setFields}
        priorities={builtPriorities}
        typeNames={types.map((t) => t.machine)}
      />
    </>
  );
}
