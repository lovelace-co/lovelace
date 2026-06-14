import { useState } from 'react';
import { Dropdown } from './Dropdown';
import { AgentIcon, CommandIcon } from './icons';
import { statusLabel, titleCase, typeLabel } from '../lib/format';
import { STATUS_HUE_CSS, statusHue } from '../lib/loom';
import { enumValuesFor } from '../lib/types';
import type { AutomationRule, FieldDef, Snapshot } from '../lib/types';

interface AutomationModalProps {
  snapshot: Snapshot;
  /** The rule being edited, or null to create a new one. */
  rule: AutomationRule | null;
  onSave: (rule: AutomationRule) => Promise<void>;
  onClose: () => void;
}

interface Condition {
  field: string;
  value: string;
}

interface Draft {
  to: string;
  from: string;
  type: string;
  conditions: Condition[];
  kind: 'run' | 'agent';
  payload: string;
}

const CORE_FIELDS = ['id', 'type', 'status', 'created', 'updated', 'title'];

function toDraft(rule: AutomationRule | null): Draft {
  if (!rule) {
    return { to: '', from: '', type: '', conditions: [], kind: 'agent', payload: '' };
  }
  const { to, from, type, ...rest } = rule.when;
  return {
    to,
    from: from ?? '',
    type: type ?? '',
    conditions: Object.entries(rest).map(([field, value]) => ({ field, value: String(value) })),
    kind: rule.run !== undefined ? 'run' : 'agent',
    payload: rule.run ?? rule.agent ?? '',
  };
}

/**
 * Create or edit one on_transition automation. The dialog reads as the workflow
 * edge it builds: a live rail at the top weaves the chosen move through to the
 * reaction it fires, updating as the form is filled. Conditions are picked from
 * the workflow's statuses, types and matchable fields so the rule can only ever
 * reference things that exist; core validates again before it is written.
 */
export function AutomationModal({ snapshot, rule, onSave, onClose }: AutomationModalProps) {
  const { workflow } = snapshot;
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusOptions = workflow.statuses.map((s) => ({ value: s.name, label: statusLabel(s) }));
  const typeOptions = workflow.types.map((t) => ({ value: t.name, label: typeLabel(t) }));
  const matchable = workflow.fields.filter(
    (f) => (f.type === 'enum' || f.type === 'string') && !CORE_FIELDS.includes(f.name),
  );

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const fieldDef = (name: string): FieldDef | undefined => matchable.find((f) => f.name === name);
  const statusText = (name: string): string => {
    const def = workflow.statuses.find((s) => s.name === name);
    return def ? statusLabel(def) : titleCase(name);
  };

  const buildRule = (): AutomationRule => {
    const when: AutomationRule['when'] = { to: draft.to };
    if (draft.from) when.from = draft.from;
    if (draft.type) when.type = draft.type;
    for (const c of draft.conditions) if (c.field && c.value) when[c.field] = c.value;
    return {
      when,
      ...(draft.kind === 'run' ? { run: draft.payload.trim() } : { agent: draft.payload.trim() }),
    };
  };

  const canSave = draft.to !== '' && draft.payload.trim() !== '' && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(buildRule());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const isAgent = draft.kind === 'agent';
  const actionSummary =
    draft.payload.trim() || (isAgent ? 'describe the instruction' : 'command to run');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal automation-modal" role="dialog" aria-label="automation" onClick={(e) => e.stopPropagation()}>
        <h2>{rule ? 'Edit automation' : 'New automation'}</h2>
        {error && <div className="banner">{error}</div>}

        {/* The live rail: the automation as the workflow edge it fires on. */}
        <div className={`flow-preview ${isAgent ? 'is-agent' : 'is-run'}`} aria-hidden>
          <div className="flow-move">
            {draft.from ? (
              <span className="flow-dot" style={{ background: STATUS_HUE_CSS[statusHue(workflow, draft.from)] }} />
            ) : (
              <span className="flow-dot any" />
            )}
            <span className="flow-status">{draft.from ? statusText(draft.from) : 'Any status'}</span>
            <span className="flow-arrow">&rarr;</span>
            {draft.to ? (
              <>
                <span className="flow-dot" style={{ background: STATUS_HUE_CSS[statusHue(workflow, draft.to)] }} />
                <span className="flow-status to">{statusText(draft.to)}</span>
              </>
            ) : (
              <>
                <span className="flow-dot any" />
                <span className="flow-status pending">choose a status</span>
              </>
            )}
          </div>
          <div className="flow-thread">
            <span className="flow-knot" />
          </div>
          <div className="flow-preview-action">
            <span className="flow-action-glyph">{isAgent ? <AgentIcon /> : <CommandIcon />}</span>
            <span className={`flow-preview-payload${isAgent ? '' : ' mono'}${draft.payload.trim() ? '' : ' pending'}`}>
              {actionSummary}
            </span>
          </div>
        </div>

        <div className="flow-form-section">
          <p className="flow-section-eyebrow">The trigger</p>
          <div className="flow-build-move">
            <div className="flow-build-field">
              <span className="label">from status</span>
              <Dropdown
                aria-label="from status"
                width="100%"
                value={draft.from}
                placeholder="Any status"
                options={statusOptions}
                onChange={(v) => set({ from: v })}
              />
            </div>
            <span className="flow-build-arrow" aria-hidden>
              &rarr;
            </span>
            <div className="flow-build-field">
              <span className="label">to status</span>
              <Dropdown
                aria-label="to status"
                width="100%"
                value={draft.to}
                placeholder="choose a status"
                options={statusOptions}
                onChange={(v) => set({ to: v })}
              />
            </div>
          </div>

          <div className="field-row">
            <span className="label">ticket type</span>
            <Dropdown
              aria-label="ticket type"
              width="100%"
              value={draft.type}
              placeholder="Any type"
              options={typeOptions}
              onChange={(v) => set({ type: v })}
            />
          </div>

          {matchable.length > 0 && (
            <div className="field-row" style={{ alignItems: 'start' }}>
              <span className="label" style={{ paddingTop: 8 }}>
                field matches
              </span>
              <div className="cond-list">
                {draft.conditions.map((c, i) => {
                  const def = fieldDef(c.field);
                  const enumValues = def && def.type === 'enum' ? enumValuesFor(workflow, def) : null;
                  return (
                    <div key={i} className="cond-edit-row">
                      <Dropdown
                        aria-label={`condition field ${i}`}
                        value={c.field}
                        placeholder="field"
                        options={matchable.map((f) => ({ value: f.name, label: titleCase(f.name) }))}
                        onChange={(v) =>
                          set({
                            conditions: draft.conditions.map((x, j) =>
                              j === i ? { field: v, value: '' } : x,
                            ),
                          })
                        }
                      />
                      {enumValues ? (
                        <Dropdown
                          aria-label={`condition value ${i}`}
                          value={c.value}
                          placeholder="value"
                          options={enumValues.map((v) => ({ value: v, label: titleCase(v) }))}
                          onChange={(v) =>
                            set({
                              conditions: draft.conditions.map((x, j) => (j === i ? { ...x, value: v } : x)),
                            })
                          }
                        />
                      ) : (
                        <input
                          className="form-input"
                          aria-label={`condition value ${i}`}
                          placeholder="value"
                          value={c.value}
                          onChange={(e) =>
                            set({
                              conditions: draft.conditions.map((x, j) =>
                                j === i ? { ...x, value: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      )}
                      <button
                        className="btn-ghost"
                        aria-label={`remove condition ${i}`}
                        onClick={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                      >
                        remove
                      </button>
                    </div>
                  );
                })}
                <button
                  className="btn-ghost cond-add"
                  onClick={() =>
                    set({ conditions: [...draft.conditions, { field: matchable[0]?.name ?? '', value: '' }] })
                  }
                >
                  + field condition
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flow-form-section">
          <p className="flow-section-eyebrow">The response</p>
          <div className="kind-toggle" role="radiogroup" aria-label="action kind">
            <button
              role="radio"
              aria-checked={draft.kind === 'agent'}
              className={`kind-option${draft.kind === 'agent' ? ' active' : ''}`}
              onClick={() => set({ kind: 'agent' })}
            >
              <AgentIcon />
              Instruct the agent
            </button>
            <button
              role="radio"
              aria-checked={draft.kind === 'run'}
              className={`kind-option${draft.kind === 'run' ? ' active' : ''}`}
              onClick={() => set({ kind: 'run' })}
            >
              <CommandIcon />
              Run a command
            </button>
          </div>
          {draft.kind === 'run' ? (
            <input
              className="form-input mono flow-payload-input"
              aria-label="command"
              placeholder="./scripts/deploy.sh"
              value={draft.payload}
              onChange={(e) => set({ payload: e.target.value })}
            />
          ) : (
            <textarea
              className="form-textarea flow-payload-input"
              aria-label="instruction"
              placeholder="Deploy the current branch and comment the result on the ticket."
              value={draft.payload}
              onChange={(e) => set({ payload: e.target.value })}
            />
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canSave} onClick={() => void save()}>
            {rule ? 'Save changes' : 'Create automation'}
          </button>
        </div>
      </div>
    </div>
  );
}
