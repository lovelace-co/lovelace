import { Fragment } from 'react';
import { AgentRoleRadios } from './AgentRoleRadios';
import type { SchemaDraft } from '../lib/useSchemaDraft';

/**
 * The Statuses settings section: the board columns as a reorderable table,
 * each tagged with its meaning to agent tooling (or none). Edits one shared
 * schema draft, alongside Types.
 */
export function StatusesSection({ draft }: { draft: SchemaDraft }) {
  const { statuses, statusDrag, editStatus, removeStatus, addStatus } = draft;

  return (
    <>
      <div className="wizard-table">
        <div className="wizard-thead cols-status">
          <span>Name</span>
          <span>Machine</span>
          <span>Agent role</span>
          <span />
        </div>
        {statuses.map((s, i) => (
          <Fragment key={i}>
            {statusDrag.over === i && statusDrag.active && <div className="wizard-drop-line" />}
            <div className="wizard-trow cols-status" {...statusDrag.zoneProps(i)}>
              <span className="wizard-handle" aria-label={`drag status ${i}`} {...statusDrag.handleProps(i)}>⠿</span>
              <input className="form-input" aria-label={`status ${i} label`} value={s.human} placeholder="Name" onChange={(e) => editStatus(i, { human: e.target.value })} />
              <input className="form-input mono" aria-label={`status ${i} machine`} value={s.machine} onChange={(e) => editStatus(i, { machine: e.target.value })} />
              <AgentRoleRadios
                name={`status-role-${i}`}
                aria-label={`status ${i} agent role`}
                value={s.agent}
                onChange={(next) => editStatus(i, { agent: next })}
              />
              <button className="btn btn-secondary btn-icon" aria-label={`remove status ${i}`} disabled={statuses.length <= 1} onClick={() => removeStatus(i)}>×</button>
            </div>
          </Fragment>
        ))}
      </div>
      <button className="btn btn-secondary wizard-add" onClick={addStatus}>
        Add status
      </button>
      <p className="subtle" style={{ marginTop: 14, maxWidth: '58ch' }}>
        Agents pick up work in Ready, move it to In Progress while working, and to Complete when done.
      </p>
    </>
  );
}
