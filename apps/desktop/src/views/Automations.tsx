import { useState } from 'react';
import { AutomationModal } from '../components/AutomationModal';
import { EmptyState } from '../components/EmptyState';
import { AddIcon, AgentIcon, CommandIcon } from '../components/icons';
import { Toast } from '../components/Toast';
import { statusLabel, titleCase, typeLabel } from '../lib/format';
import { STATUS_HUE_CSS, statusHue, type StatusHue } from '../lib/loom';
import type { AutomationRule, Snapshot } from '../lib/types';
import { Actions } from './Actions';

interface AutomationsProps {
  snapshot: Snapshot;
  /** Persist the full on_transition list (core validates before writing). */
  onSaveAutomations: (rules: AutomationRule[]) => Promise<void>;
}

type Tab = 'rules' | 'activity';

interface Endpoint {
  label: string;
  hue: StatusHue;
}

/** One end of a transition, resolved to its human label and loom hue. */
function endpoint(snapshot: Snapshot, name: string): Endpoint {
  const def = snapshot.workflow.statuses.find((s) => s.name === name);
  return { label: def ? statusLabel(def) : titleCase(name), hue: statusHue(snapshot.workflow, name) };
}

/** The match conditions beyond the move itself: ticket type and field matches. */
function qualifiers(snapshot: Snapshot, rule: AutomationRule): Array<{ key: string; value: string }> {
  const { to: _to, from: _from, type, ...rest } = rule.when;
  const out: Array<{ key: string; value: string }> = [];
  if (type !== undefined) {
    const def = snapshot.workflow.types.find((t) => t.name === type);
    out.push({ key: 'type', value: def ? typeLabel(def) : titleCase(type) });
  }
  for (const [key, value] of Object.entries(rest)) {
    const def = snapshot.workflow.fields.find((f) => f.name === key);
    out.push({ key: def?.label ?? titleCase(key), value: titleCase(String(value)) });
  }
  return out;
}

/** A flat readable summary of a rule's conditions, for the delete prompt. */
function summarise(snapshot: Snapshot, rule: AutomationRule): string {
  const parts: string[] = [];
  if (rule.when.from !== undefined) parts.push(`from ${endpoint(snapshot, rule.when.from).label}`);
  parts.push(`to ${endpoint(snapshot, rule.when.to).label}`);
  for (const q of qualifiers(snapshot, rule)) parts.push(`${q.key} ${q.value}`);
  return parts.join(', ');
}

/**
 * The home for transition automation: a CRUD over the on_transition rules
 * (stored in workflow.yaml, validated by core on every write), plus the live
 * activity those rules produce: a dry-run probe and the run history. The
 * status graph the rules hook onto lives in the Workflow view.
 *
 * Each rule reads as the workflow edge it actually fires on: a move from one
 * status to another, threaded through to the reaction it triggers. The status
 * hues are the same ones the Workflow and Board views use, so an automation
 * looks like the transition it listens for.
 */
export function Automations({ snapshot, onSaveAutomations }: AutomationsProps) {
  const { workflow } = snapshot;
  const rules = workflow.on_transition;
  const [tab, setTab] = useState<Tab>('rules');
  const [editing, setEditing] = useState<{ rule: AutomationRule | null } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const saveRule = async (built: AutomationRule) => {
    const next = editing?.rule ? rules.map((r) => (r === editing.rule ? built : r)) : [...rules, built];
    await onSaveAutomations(next);
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (deleting === null) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onSaveAutomations(rules.filter((_, i) => i !== deleting));
      setDeleting(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Automations</h1>
        <div className="subtabs" role="tablist" aria-label="automations sections">
          <button
            role="tab"
            aria-selected={tab === 'rules'}
            className={`subtab${tab === 'rules' ? ' active' : ''}`}
            onClick={() => setTab('rules')}
          >
            Rules
          </button>
          <button
            role="tab"
            aria-selected={tab === 'activity'}
            className={`subtab${tab === 'activity' ? ' active' : ''}`}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
        </div>
      </header>

      {tab === 'rules' ? (
        <div className="view-body" style={{ display: 'grid', gap: '1.4rem' }}>
          <section>
            <div className="section-head-row">
              <h2 className="section-heading">On transition</h2>
              <button className="btn btn-primary" onClick={() => setEditing({ rule: null })}>
                <AddIcon />
                New automation
              </button>
            </div>

            {rules.length === 0 ? (
              <EmptyState
                compact
                note="No automations yet"
                hint="Run a script or hand the agent an instruction whenever a ticket reaches a status."
              />
            ) : (
              <>
                <p className="subtle" style={{ marginBottom: 18 }}>
                  {rules.length} rule{rules.length === 1 ? '' : 's'}, woven into the workflow and fired
                  when a matching move lands
                </p>
                <div className="flow-stack">
                  {rules.map((rule, i) => {
                    const isAgent = rule.run === undefined;
                    const to = endpoint(snapshot, rule.when.to);
                    const from = rule.when.from !== undefined ? endpoint(snapshot, rule.when.from) : null;
                    const quals = qualifiers(snapshot, rule);
                    return (
                      <div key={i} className={`flow-rail ${isAgent ? 'is-agent' : 'is-run'}`}>
                        <div className="flow-rail-body">
                          <div className="flow-trigger">
                            <span className="flow-eyebrow">When a ticket moves</span>
                            <div className="flow-move">
                              {from ? (
                                <span
                                  className="flow-dot"
                                  style={{ background: STATUS_HUE_CSS[from.hue] }}
                                />
                              ) : (
                                <span className="flow-dot any" aria-hidden />
                              )}
                              <span className="flow-status">{from ? from.label : 'Any status'}</span>
                              <span className="flow-arrow" aria-hidden>
                                &rarr;
                              </span>
                              <span className="flow-dot" style={{ background: STATUS_HUE_CSS[to.hue] }} />
                              <span className="flow-status to">{to.label}</span>
                            </div>
                            {quals.length > 0 && (
                              <div className="flow-quals">
                                {quals.map((q) => (
                                  <span key={q.key} className="flow-qual">
                                    <span className="flow-qual-key">{q.key}</span>
                                    {q.value}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flow-thread" aria-hidden>
                            <span className="flow-knot" />
                          </div>

                          <div className="flow-response">
                            <div className="flow-response-head">
                              <span className="flow-eyebrow">Lovelace responds</span>
                              <div className="flow-rail-actions">
                                <button className="btn-ghost" onClick={() => setEditing({ rule })}>
                                  Edit
                                </button>
                                <button className="btn-ghost" onClick={() => setDeleting(i)}>
                                  Delete
                                </button>
                              </div>
                            </div>
                            <span className="flow-action-kind">
                              <span className="flow-action-glyph">
                                {isAgent ? <AgentIcon /> : <CommandIcon />}
                              </span>
                              {isAgent ? 'Instruct the agent' : 'Run a command'}
                            </span>
                            <div className={`flow-payload${isAgent ? '' : ' mono'}`}>
                              {rule.run ?? rule.agent}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <p className="subtle" style={{ marginTop: 18 }}>
              Stored in <span className="mono">.lovelace/workflow.yaml</span>. Lovelace runs the
              actions; it does not own them.
            </p>
          </section>
        </div>
      ) : (
        <div className="view-body">
          <Actions snapshot={snapshot} embedded />
        </div>
      )}

      {editing && (
        <AutomationModal
          snapshot={snapshot}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSave={saveRule}
        />
      )}

      {deleting !== null && rules[deleting] && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Delete this automation?</h2>
            {deleteError && <Toast onDismiss={() => setDeleteError(null)}>{deleteError}</Toast>}
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
              The rule on <span className="id-chip">{summarise(snapshot, rules[deleting])}</span> will be
              removed. It cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void confirmDelete()} disabled={deleteBusy}>
                Delete automation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
