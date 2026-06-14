import { statusLabel, titleCase } from '../lib/format';
import { STATUS_HUE_CSS, statusHue } from '../lib/loom';
import type { Snapshot } from '../lib/types';

interface WorkflowProps {
  snapshot: Snapshot;
}

/** The human label for a status name, looked up in the workflow. */
function statusName(snapshot: Snapshot, name: string): string {
  const def = snapshot.workflow.statuses.find((s) => s.name === name);
  return def ? statusLabel(def) : titleCase(name);
}

/**
 * The project's state machine: every status and the moves it allows, read
 * from workflow.yaml. This is the structure Lovelace enforces; it is not
 * automation (the reactions to a move live under Automations).
 */
export function Workflow({ snapshot }: WorkflowProps) {
  const { workflow } = snapshot;
  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Workflow</h1>
        <span className="subtle">
          {workflow.statuses.length} statuses, the moves each one allows
        </span>
      </header>
      <div className="view-body" style={{ display: 'grid', gap: '1.4rem' }}>
        <section>
          <h2 className="section-heading">Statuses and transitions</h2>
          <p className="subtle" style={{ marginBottom: 14 }}>
            defined in workflow.yaml; these are the only moves Lovelace accepts
          </p>
          <div className="glass-card" style={{ padding: '6px 0' }}>
            {workflow.statuses.map((status) => {
              const targets = workflow.transitions.find((t) => t.from === status.name)?.to ?? [];
              return (
                <div key={status.name} className="transition-row">
                  <span className="transition-from">
                    <span
                      className="priority-dot"
                      style={{ background: STATUS_HUE_CSS[statusHue(workflow, status.name)] }}
                    />
                    {statusLabel(status)}
                  </span>
                  <span className="transition-arrow" aria-hidden>
                    &rarr;
                  </span>
                  <span className="transition-targets">
                    {targets.length === 0 ? (
                      <span className="subtle">terminal</span>
                    ) : (
                      targets.map((to) => (
                        <span key={to} className="transition-target">
                          <span
                            className="priority-dot"
                            style={{ background: STATUS_HUE_CSS[statusHue(workflow, to)] }}
                          />
                          {statusName(snapshot, to)}
                        </span>
                      ))
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
