import { Fragment, useState } from 'react';
import { titleCase } from '../lib/format';
import { useHost } from '../state/store';
import { FieldsEditor } from './FieldsEditor';
import { HoleCheck } from './HoleCheck';
import { Toast } from './Toast';
import {
  applyHuman,
  blankStatus,
  blankType,
  buildFields,
  buildStatuses,
  buildTypes,
  permissive,
  seedField,
  seedStatus,
  seedType,
  useReorder,
  type FieldRow,
  type StatusRow,
  type TypeRow,
} from '../lib/workflowRows';
import type { Workflow } from '../lib/types';

const STEPS = ['Project', 'Statuses', 'Types & Fields', 'Review'] as const;

interface InitWizardProps {
  initTarget: string;
  defaults: Workflow;
  initialName: string;
  onCancel: () => void;
  onDone: (root: string) => void;
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

  const buildWorkflow = (): Workflow => {
    const builtStatuses = buildStatuses(statuses);
    const statusesChanged = JSON.stringify(builtStatuses) !== JSON.stringify(defaults.statuses);
    return {
      types: buildTypes(types),
      statuses: builtStatuses,
      transitions: statusesChanged ? permissive(statuses) : defaults.transitions,
      priorities,
      fields: buildFields(fields, priorities),
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
                <HoleCheck aria-label="set up Claude Code" checked={claudeSetup} onChange={(e) => setClaudeSetup(e.target.checked)} />
                CLAUDE.md section, MCP server and hooks
              </label>
            </div>
            <div className="field-row">
              <span className="label">Git hook</span>
              <label className="wizard-check">
                <HoleCheck aria-label="install git hook" checked={gitHook} disabled={!claudeSetup} onChange={(e) => setGitHook(e.target.checked)} />
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
                  <HoleCheck className="wizard-cell-check" aria-label={`status ${i} active`} checked={s.active} onChange={(e) => editStatus(i, { active: e.target.checked })} />
                  <HoleCheck className="wizard-cell-check" aria-label={`status ${i} complete`} checked={s.complete} onChange={(e) => editStatus(i, { complete: e.target.checked })} />
                  <button className="btn btn-secondary btn-icon" aria-label={`remove status ${i}`} disabled={statuses.length <= 1} onClick={() => setStatuses((rows) => rows.filter((_, j) => j !== i))}>×</button>
                  </div>
                </Fragment>
              ))}
            </div>
            <button className="btn btn-secondary wizard-add" onClick={() => setStatuses((rows) => [...rows, blankStatus()])}>
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
            <button className="btn btn-secondary wizard-add" onClick={() => setTypes((rows) => [...rows, blankType()])}>
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
            <FieldsEditor
              fields={fields}
              setFields={setFields}
              priorities={priorities}
              typeNames={types.map((t) => t.machine)}
            />
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

        {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}

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
