import { useEffect, useState } from 'react';
import { Toast } from '../components/Toast';
import { ViewTabs } from '../components/ViewTabs';
import { StatusesSection } from '../components/StatusesSection';
import { TypesFieldsSection } from '../components/TypesFieldsSection';
import { GeneralSettings } from '../components/GeneralSettings';
import { TeamSettings } from '../components/TeamSettings';
import { IntegrationsSettings } from '../components/IntegrationsSettings';
import { useSchemaDraft } from '../lib/useSchemaDraft';
import type { ClaudeInstallStatus, InstallClaudeResult, OpenCodeInstallStatus } from '../lib/host';
import type { LinkResolver, OpenLink } from '../lib/links';
import type { Actor, SchemaEdit, Snapshot } from '../lib/types';

interface SettingsProps {
  snapshot: Snapshot;
  onSaveSchema: (edit: SchemaEdit) => Promise<void>;
  onRenameProject: (name: string) => Promise<void>;
  /** Persist the presence stale cap in minutes; null returns to the default. */
  onSavePresenceTimeout: (minutes: number | null) => Promise<void>;
  /** Open the project folder in the operating system's file manager. */
  onOpenProject: () => void;
  onSaveActors: (actors: Actor[]) => Promise<void>;
  onInstallClaude: (gitHook: boolean) => Promise<InstallClaudeResult>;
  onClaudeStatus: () => Promise<ClaudeInstallStatus>;
  onInstallOpenCode: (gitHook: boolean) => Promise<InstallClaudeResult>;
  onOpenCodeStatus: () => Promise<OpenCodeInstallStatus>;
  /** Reports whether any section has unsaved edits, so leaving Settings can prompt. */
  onDirtyChange: (dirty: boolean) => void;
  onOpenTicket: (id: string) => void;
  resolveLink?: LinkResolver;
  onOpenLink?: OpenLink;
  /** A session ID to jump straight to (from search), or null for no pending focus. */
  focusSession?: string | null;
  /** Called once a pending focusSession has been consumed. */
  onFocusSessionHandled?: () => void;
}

type Tab = 'general' | 'statuses' | 'fields' | 'team' | 'integrations';

const TABS: Array<{ key: Tab; label: string; hint?: string }> = [
  { key: 'general', label: 'General', hint: 'The project name and the facts the tooling manages.' },
  {
    key: 'statuses',
    label: 'Statuses',
    hint: 'Your board columns. Tag the ones agents care about with a role.',
  },
  { key: 'fields', label: 'Types' },
  { key: 'team', label: 'Team', hint: 'The human and agent identities work is attributed to.' },
  { key: 'integrations', label: 'Integrations', hint: 'Wire this project up to your coding agents.' },
];

/**
 * The configuration home. Every setting the project has, behind one level of
 * tabs in the same order the onboarding wizard collected them. The Statuses and
 * Types tabs edit one shared schema draft (so a single Save spans both); the
 * other sections own their own saves. A combined dirty flag is reported up so
 * navigating away can prompt rather than drop unsaved edits.
 */
export function Settings({
  snapshot,
  onSaveSchema,
  onRenameProject,
  onSavePresenceTimeout,
  onOpenProject,
  onSaveActors,
  onInstallClaude,
  onClaudeStatus,
  onInstallOpenCode,
  onOpenCodeStatus,
  onDirtyChange,
  onOpenTicket,
  resolveLink,
  onOpenLink,
  focusSession,
  onFocusSessionHandled,
}: SettingsProps) {
  const draft = useSchemaDraft(snapshot, onSaveSchema);
  const [tab, setTab] = useState<Tab>('general');
  const [teamDirty, setTeamDirty] = useState(false);

  const dirty = draft.dirty || teamDirty;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // A session picked from search always surfaces on the General tab.
  useEffect(() => {
    if (focusSession) setTab('general');
  }, [focusSession]);

  const onSchemaTab = tab === 'statuses' || tab === 'fields';
  const hint = TABS.find((t) => t.key === tab)!.hint;

  return (
    <>
      <header className="view-header view-header--tabbed">
        <div className="view-titlebar">
          <h1 className="view-title">Settings</h1>
          {onSchemaTab && draft.dirty && (
            <div className="schema-actions">
              <span className="subtle">Unsaved changes</span>
              <button className="btn btn-ghost" onClick={draft.reseed} disabled={draft.busy}>
                Discard
              </button>
              <button className="btn btn-primary" onClick={() => void draft.save()} disabled={draft.busy}>
                {draft.busy ? 'Saving...' : 'Save changes'}
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

      {draft.error && <Toast onDismiss={() => draft.setError(null)}>{draft.error}</Toast>}

      <div className="view-body">
        {hint && (
          <p className="subtle" style={{ marginBottom: 18, maxWidth: '58ch' }}>
            {hint}
          </p>
        )}

        {tab === 'general' && (
          <GeneralSettings
            snapshot={snapshot}
            onRename={onRenameProject}
            onSavePresenceTimeout={onSavePresenceTimeout}
            onOpenProject={onOpenProject}
            onOpenTicket={onOpenTicket}
            resolveLink={resolveLink}
            onOpenLink={onOpenLink}
            focusSession={focusSession}
            onFocusSessionHandled={onFocusSessionHandled}
          />
        )}
        {tab === 'statuses' && <StatusesSection draft={draft} />}
        {tab === 'fields' && <TypesFieldsSection draft={draft} />}
        {tab === 'team' && (
          <TeamSettings snapshot={snapshot} onSave={onSaveActors} onDirtyChange={setTeamDirty} />
        )}
        {tab === 'integrations' && (
          <IntegrationsSettings
            onInstall={onInstallClaude}
            onClaudeStatus={onClaudeStatus}
            onInstallOpenCode={onInstallOpenCode}
            onOpenCodeStatus={onOpenCodeStatus}
          />
        )}
      </div>
    </>
  );
}
