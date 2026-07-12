import type { MigrationPlan } from '../lib/types';

export interface SpecGateProps {
  code: 'spec-too-new' | 'spec-needs-migration';
  /** The spec version the project declares, for example "4.0.0". */
  declared: string;
  /** The spec version this Lovelace supports, for example "3.0.0". */
  supported: string;
  /** The migration plan (spec-needs-migration only); null while it loads. */
  plan?: MigrationPlan | null;
  /** True while a migration is running; disables the button. */
  migrating?: boolean;
  /** A migration or plan-fetch failure, shown through the usual problem-note pattern. */
  migrateError?: string | null;
  /** Runs the migration, then the caller's normal reload path. */
  onMigrate?: () => void;
}

/**
 * The dedicated screen a project renders in place of the workbench when its
 * declared spec version does not match this tooling (ADR-0011). The
 * spec-too-new branch is kept quiet, with no controls; the
 * spec-needs-migration branch offers the one-click migration flow.
 */
export function SpecGate({ code, declared, supported, plan, migrating, migrateError, onMigrate }: SpecGateProps) {
  const major = supported.split('.')[0];
  return (
    <div className="spec-gate">
      {code === 'spec-too-new' ? (
        <>
          <h1 className="section-heading">This project needs a newer Lovelace</h1>
          <p className="spec-gate-body">
            It uses format {declared}. This version of Lovelace understands {major}.x. Update Lovelace to
            open it.
          </p>
        </>
      ) : (
        <>
          <h1 className="section-heading">This project uses an older format</h1>
          <p className="spec-gate-body">
            It declares format {declared}; this Lovelace works with {major}.x.
          </p>
          {plan && (
            <div className="spec-gate-plan">
              {plan.steps.map((step, i) => (
                <div key={i}>
                  <p className="subtle">{step.summary}</p>
                  <ul className="subtle">
                    {step.changes.map((change, j) => (
                      <li key={j}>{change}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="spec-gate-body">
            Migration rewrites the files in .lovelace. Commit or back up your project first.
          </p>
          {migrateError && <div className="problem-note">{migrateError}</div>}
          <button className="btn btn-primary" onClick={onMigrate} disabled={!plan || !!migrating}>
            Update project
          </button>
        </>
      )}
    </div>
  );
}
