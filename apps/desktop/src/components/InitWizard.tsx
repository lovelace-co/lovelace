import { Fragment, useState, type Dispatch, type SetStateAction } from 'react';
import { useHost } from '../state/store';
import { AgentRoleRadios } from './AgentRoleRadios';
import { FieldsEditor } from './FieldsEditor';
import { HoleCheck } from './HoleCheck';
import { Toast } from './Toast';
import { ViewTabs } from './ViewTabs';
import {
  applyHuman,
  blankStatus,
  blankType,
  buildStatuses,
  buildTypes,
  seedStatus,
  seedType,
  useReorder,
  type FieldRow,
  type StatusRow,
  type TypeRow,
} from '../lib/schemaRows';
import type { Schema } from '../lib/types';

const STEPS = ['Project', 'Statuses', 'Types', 'Review'] as const;

interface InitWizardProps {
  initTarget: string;
  defaults: Schema;
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
  // Which type's tab is selected, showing that type's property fields and
  // its Fields sub-editor, since fields are owned per type rather than one
  // flat list. Priorities stay fixed at the defaults; they are only editable
  // later in Settings.
  const [typeIndex, setTypeIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualSteps, setManualSteps] = useState<string[]>([]);

  const statusDrag = useReorder(setStatuses);

  const editStatus = (i: number, p: Partial<StatusRow>) => {
    const prev = statuses[i]!;
    const next = applyHuman({ ...prev, ...p }, p) as StatusRow;
    // Selecting a role on one row clears it from any other; at most one
    // status per role.
    setStatuses((rows) =>
      rows.map((r, j) => {
        if (j === i) return next;
        return p.agent !== undefined && p.agent === r.agent ? { ...r, agent: undefined } : r;
      }),
    );
  };
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

  const index = Math.min(typeIndex, Math.max(types.length - 1, 0));
  const activeType = types[index];
  const setFieldsForActiveType: Dispatch<SetStateAction<FieldRow[]>> = (updater) =>
    setTypes((rows) =>
      rows.map((r, j) =>
        j === index
          ? { ...r, fields: typeof updater === 'function' ? (updater as (prev: FieldRow[]) => FieldRow[])(r.fields) : updater }
          : r,
      ),
    );

  const buildSchema = (): Schema => ({
    types: buildTypes(types, defaults.priorities),
    statuses: buildStatuses(statuses),
    priorities: defaults.priorities,
  });

  const finish = async (useDefaults: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let schema: Schema | undefined;
      if (!useDefaults) {
        const built = buildSchema();
        if (JSON.stringify(built) !== JSON.stringify(defaults)) schema = built;
      }
      await host.init(initTarget, projectName.trim() || 'Untitled project', userName.trim() || undefined, schema);
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
          <p style={{ color: 'var(--slate)', fontSize: '0.8125rem' }}>
            The project is initialised, but these could not be done automatically:
          </p>
          <ul style={{ fontSize: '0.8125rem', color: 'var(--slate)' }}>
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
            <p style={{ color: 'var(--slate)', fontSize: '0.8125rem' }}>
              <span className="mono">{initTarget}</span> has no <span className="mono">.lovelace</span> directory.
              Set up the schema below, or use the defaults. Your existing files are not touched.
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
                    name={`init-status-role-${i}`}
                    aria-label={`status ${i} agent role`}
                    value={s.agent}
                    onChange={(next) => editStatus(i, { agent: next })}
                  />
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
            <h2>Types</h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ViewTabs
                tabs={types.map((t, i) => ({ key: String(i), label: t.human || t.machine }))}
                active={String(index)}
                onChange={(key) => setTypeIndex(Number(key))}
                ariaLabel="ticket types"
              />
              <button
                type="button"
                className="type-tab-add"
                onClick={() => {
                  setTypes((rows) => [...rows, blankType()]);
                  setTypeIndex(types.length);
                }}
              >
                + Add type
              </button>
            </div>

            {activeType && (
              <div style={{ marginTop: 22 }}>
                <div className="wizard-table">
                  <div className="wizard-thead cols-type-props">
                    <span>Name</span>
                    <span>Machine</span>
                    <span>Plural</span>
                    <span>ID prefix</span>
                  </div>
                  <div className="wizard-trow cols-type-props">
                    <input className="form-input" aria-label="type name" value={activeType.human} placeholder="Name" onChange={(e) => editType(index, { human: e.target.value })} />
                    <input className="form-input mono" aria-label="type machine" value={activeType.machine} onChange={(e) => editType(index, { machine: e.target.value })} />
                    <input className="form-input" aria-label="type plural" value={activeType.plural} placeholder="Plural" onChange={(e) => editType(index, { plural: e.target.value })} />
                    <input className="form-input mono" aria-label="type id prefix" value={activeType.prefix} title={`e.g. ${activeType.prefix || 'X'}-0042`} onChange={(e) => editType(index, { prefix: e.target.value.toUpperCase() })} />
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 10 }}
                  disabled={types.length <= 1}
                  onClick={() => {
                    setTypes((rows) => rows.filter((_, j) => j !== index));
                    setTypeIndex((i) => Math.max(0, i - 1));
                  }}
                >
                  Remove type
                </button>

                <h2 className="section-heading" style={{ marginTop: 36 }}>
                  Fields
                </h2>
                <FieldsEditor
                  key={index}
                  fields={activeType.fields}
                  setFields={setFieldsForActiveType}
                  priorities={defaults.priorities}
                  typeNames={types.map((t) => t.machine)}
                />
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2>Review</h2>
            <div className="wizard-review">
              <div><span className="label">Columns</span> {statuses.map((s) => s.human).join(' · ')}</div>
              <div><span className="label">Types</span> {types.map((t) => `${t.human} (${t.prefix})`).join(', ')}</div>
              <div>
                <span className="label">Fields</span>{' '}
                {types
                  .map(
                    (t) =>
                      `${t.human}: ${['Title', 'Body', ...t.fields.filter((f) => f.machine !== 'title').map((f) => f.human)].join(', ')}`,
                  )
                  .join(' · ')}
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
