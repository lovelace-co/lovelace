import { Fragment } from 'react';
import { HoleCheck } from './HoleCheck';
import { STATUS_HUE_CSS, statusHue } from '../lib/loom';
import type { WorkflowDraft } from '../lib/useWorkflowDraft';

/**
 * The Statuses settings section: the board columns (a reorderable table), then
 * the transitions each one allows. Both edit one shared workflow draft.
 */
export function StatusesSection({ draft }: { draft: WorkflowDraft }) {
  const { statuses, statusDrag, editStatus, removeStatus, addStatus, transitions, toggleTransition, draftWorkflow } =
    draft;

  return (
    <>
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

      <h2 className="section-heading" style={{ marginTop: 36 }}>
        Transitions
      </h2>
      <p className="subtle" style={{ marginBottom: 14, maxWidth: '58ch' }}>
        Tick the statuses each one can move to. Anything unticked is not a legal move.
      </p>
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
    </>
  );
}
