import { useEffect, useState } from 'react';
import { Toast } from '../components/Toast';
import { ViewTabs } from '../components/ViewTabs';
import { StatusesSection } from '../components/StatusesSection';
import { TypesFieldsSection } from '../components/TypesFieldsSection';
import { AutomationRules } from '../components/AutomationRules';
import { GeneralSettings } from '../components/GeneralSettings';
import { TeamSettings } from '../components/TeamSettings';
import { IntegrationsSettings } from '../components/IntegrationsSettings';
import { useWorkflowDraft } from '../lib/useWorkflowDraft';
import type { InstallClaudeResult } from '../lib/host';
import type { Actor, AutomationRule, Snapshot, WorkflowEdit } from '../lib/types';

interface SettingsProps {
  snapshot: Snapshot;
  onSaveWorkflow: (edit: WorkflowEdit) => Promise<void>;
  onSaveAutomations: (rules: AutomationRule[]) => Promise<void>;
  onRenameProject: (name: string) => Promise<void>;
  /** Persist the presence stale cap in minutes; null returns to the default. */
  onSavePresenceTimeout: (minutes: number | null) => Promise<void>;
  /** Open the project folder in the operating system's file manager. */
  onOpenProject: () => void;
  onSaveActors: (actors: Actor[]) => Promise<void>;
  onInstallClaude: (gitHook: boolean) => Promise<InstallClaudeResult>;
  /** Reports whether any section has unsaved edits, so leaving Settings can prompt. */
  onDirtyChange: (dirty: boolean) => void;
}

type Tab = 'general' | 'statuses' | 'fields' | 'automations' | 'team' | 'integrations';

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: 'general', label: 'General', hint: 'The project name and the facts the tooling manages.' },
  {
    key: 'statuses',
    label: 'Statuses',
    hint: 'Your board columns and the moves between them. Mark the working columns Active and the finished ones Complete.',
  },
  {
    key: 'fields',
    label: 'Types & fields',
    hint: 'The kinds of ticket, the priority scale, and the data every ticket carries.',
  },
  { key: 'automations', label: 'Automations', hint: 'What Lovelace does when a ticket reaches a status.' },
  { key: 'team', label: 'Team', hint: 'The human and agent identities work is attributed to.' },
  { key: 'integrations', label: 'Integrations', hint: 'Wire this project up to Claude Code.' },
];

/**
 * The configuration home. Every setting the project has, behind one level of
 * tabs in the same order the onboarding wizard collected them. The Statuses and
 * Types & fields tabs edit one shared workflow draft (so a single Save spans
 * both); the other sections own their own saves. A combined dirty flag is
 * reported up so navigating away can prompt rather than drop unsaved edits.
 */
export function Settings({
  snapshot,
  onSaveWorkflow,
  onSaveAutomations,
  onRenameProject,
  onSavePresenceTimeout,
  onOpenProject,
  onSaveActors,
  onInstallClaude,
  onDirtyChange,
}: SettingsProps) {
  const wf = useWorkflowDraft(snapshot, onSaveWorkflow);
  const [tab, setTab] = useState<Tab>('general');
  const [teamDirty, setTeamDirty] = useState(false);

  const dirty = wf.dirty || teamDirty;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const onWorkflowTab = tab === 'statuses' || tab === 'fields';
  const hint = TABS.find((t) => t.key === tab)!.hint;

  return (
    <>
      <header className="view-header view-header--tabbed">
        <div className="view-titlebar">
          <h1 className="view-title">Settings</h1>
          {onWorkflowTab && wf.dirty && (
            <div className="workflow-actions">
              <span className="subtle">Unsaved changes</span>
              <button className="btn btn-ghost" onClick={wf.reseed} disabled={wf.busy}>
                Discard
              </button>
              <button className="btn btn-primary" onClick={() => void wf.save()} disabled={wf.busy}>
                {wf.busy ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
        <ViewTabs
          tabs={TABS}
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          ariaLabel="settings sections"
        />
      </header>

      {wf.error && <Toast onDismiss={() => wf.setError(null)}>{wf.error}</Toast>}

      <div className="view-body">
        <p className="subtle" style={{ marginBottom: 18, maxWidth: '58ch' }}>
          {hint}
        </p>

        {tab === 'general' && <GeneralSettings snapshot={snapshot} onRename={onRenameProject} onSavePresenceTimeout={onSavePresenceTimeout} onOpenProject={onOpenProject} />}
        {tab === 'statuses' && <StatusesSection draft={wf} />}
        {tab === 'fields' && <TypesFieldsSection draft={wf} />}
        {tab === 'automations' && (
          <AutomationRules snapshot={snapshot} onSaveAutomations={onSaveAutomations} />
        )}
        {tab === 'team' && (
          <TeamSettings snapshot={snapshot} onSave={onSaveActors} onDirtyChange={setTeamDirty} />
        )}
        {tab === 'integrations' && <IntegrationsSettings onInstall={onInstallClaude} />}
      </div>
    </>
  );
}
