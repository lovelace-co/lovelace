import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { CloseIcon } from './icons';
import { Dropdown } from './Dropdown';
import { SessionsModal } from './SessionsModal';
import { ProblemsModal } from './ProblemsModal';
import { Toast } from './Toast';
import { formatDate } from '../lib/datetime';
import { DEFAULT_PRESENCE_TIMEOUT_MINUTES } from '../lib/presence';
import { openUrl } from '../lib/os';
import type { LinkResolver, OpenLink } from '../lib/links';
import type { Snapshot } from '../lib/types';

interface GeneralSettingsProps {
  snapshot: Snapshot;
  /** Rename the project (saved on blur, like a document summary). */
  onRename: (name: string) => Promise<void>;
  /** Persist the presence stale cap in minutes; null returns to the default. */
  onSavePresenceTimeout: (minutes: number | null) => Promise<void>;
  /** Open the project folder in the operating system's file manager. */
  onOpenProject: () => void;
  onOpenTicket: (id: string) => void;
  resolveLink?: LinkResolver;
  onOpenLink?: OpenLink;
  /** A session ID to jump straight to (from search), or null for no pending focus. */
  focusSession?: string | null;
  /** Called once a pending focusSession has been consumed. */
  onFocusSessionHandled?: () => void;
}

/* The stale cap choices; the default stays out of the file so manifests
   remain clean until a project actually opts into a different window. */
const PRESENCE_CHOICES = [
  { minutes: DEFAULT_PRESENCE_TIMEOUT_MINUTES, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
];

/**
 * The General settings section: the editable project name, and the
 * tooling-managed facts (id, path, spec version, creation date) shown
 * read-only.
 */
export function GeneralSettings({
  snapshot,
  onRename,
  onSavePresenceTimeout,
  onOpenProject,
  onOpenTicket,
  resolveLink,
  onOpenLink,
  focusSession,
  onFocusSessionHandled,
}: GeneralSettingsProps) {
  const [digestOpen, setDigestOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsInitialOpen, setSessionsInitialOpen] = useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [bugError, setBugError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!digestOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDigestOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [digestOpen]);

  // A session picked from search opens the modal pre-expanded on that
  // session, then clears the request so re-picking it later still triggers.
  useEffect(() => {
    if (!focusSession) return;
    setSessionsInitialOpen(focusSession);
    setSessionsOpen(true);
    onFocusSessionHandled?.();
  }, [focusSession, onFocusSessionHandled]);
  const m = snapshot.manifest;
  const errors = snapshot.issues.filter((i) => i.severity === 'error');
  const homePath = snapshot.root.replace(/^\/Users\/[^/]+/, '~');
  const timeout = m.presence_timeout_minutes ?? DEFAULT_PRESENCE_TIMEOUT_MINUTES;
  const timeoutChoices = PRESENCE_CHOICES.some((c) => c.minutes === timeout)
    ? PRESENCE_CHOICES
    : [...PRESENCE_CHOICES, { minutes: timeout, label: `${timeout} minutes` }].sort((a, b) => a.minutes - b.minutes);

  return (
    <div className="settings-section">
      <div className="field-row">
        <span className="label">Project name</span>
        <input
          key={m.name}
          className="form-input"
          aria-label="project name"
          defaultValue={m.name}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (!next || next === m.name) {
              e.target.value = m.name;
              return;
            }
            void onRename(next);
          }}
        />
      </div>

      <div className="field-row">
        <span className="label">Agent presence</span>
        <div>
          <Dropdown
            aria-label="show a working agent as gone after"
            width="12rem"
            value={String(timeout)}
            options={timeoutChoices.map((c) => ({ value: String(c.minutes), label: c.label }))}
            onChange={(v) => {
              const minutes = Number(v);
              if (!Number.isInteger(minutes) || minutes <= 0 || minutes === timeout) return;
              void onSavePresenceTimeout(minutes === DEFAULT_PRESENCE_TIMEOUT_MINUTES ? null : minutes);
            }}
          />
          <p className="subtle" style={{ marginTop: 8 }}>
            A working agent whose session ends without saying so is shown as gone after this long. Raise it for
            long-running work.
          </p>
        </div>
      </div>

      <dl className="info-grid" style={{ marginTop: 22 }}>
        <dt>Project ID</dt>
        <dd className="mono">{m.project_id}</dd>

        <dt>Location</dt>
        <dd className="mono">{homePath}</dd>

        <dt>Spec version</dt>
        <dd>{m.spec_version}</dd>

        <dt>Created</dt>
        <dd>{formatDate(m.created)}</dd>
      </dl>
      <p className="subtle" style={{ marginTop: 14 }}>
        The ID, location and spec version are managed by the tooling and cannot be changed here.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn btn-secondary" onClick={onOpenProject}>
          Open project folder
        </button>
        <button className="btn btn-secondary" onClick={() => setDigestOpen(true)}>
          View digest
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setSessionsInitialOpen(null);
            setSessionsOpen(true);
          }}
        >
          View sessions
          {snapshot.index.sessions.length > 0 && (
            <span className="count-note num">{snapshot.index.sessions.length}</span>
          )}
        </button>
        <button className="btn btn-secondary" onClick={() => setProblemsOpen(true)}>
          View problems
          {snapshot.issues.length > 0 && (
            <span className={`count-note num ${errors.length > 0 ? 'snag-error' : 'snag-warning'}`}>
              {snapshot.issues.length}
            </span>
          )}
        </button>
      </div>

      {digestOpen && (
        <div className="modal-backdrop" onClick={() => setDigestOpen(false)}>
          <div className="modal-shell">
            <button className="modal-close" aria-label="Close digest" onClick={() => setDigestOpen(false)}>
              <CloseIcon />
            </button>
            <div
              className="digest-card"
              role="dialog"
              aria-label="digest"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="info-card-head">
                <div className="info-card-titles">
                  <h2 className="info-card-name">Digest</h2>
                  <span className="info-card-sub">what an agent sees at session start</span>
                </div>
              </div>
              <div className="digest-well">
                <pre className="digest-pre">{snapshot.digest}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {sessionsOpen && (
        <SessionsModal
          // Remount on a new focus so a search pick lands while already open.
          key={sessionsInitialOpen ?? ''}
          snapshot={snapshot}
          initialOpen={sessionsInitialOpen}
          onClose={() => {
            setSessionsOpen(false);
            setSessionsInitialOpen(null);
          }}
          onOpenTicket={(id) => {
            setSessionsOpen(false);
            onOpenTicket(id);
          }}
          resolveLink={resolveLink}
          onOpenLink={
            onOpenLink &&
            ((target) => {
              setSessionsOpen(false);
              onOpenLink(target);
            })
          }
        />
      )}

      {problemsOpen && <ProblemsModal issues={snapshot.issues} onClose={() => setProblemsOpen(false)} />}

      {bugError && <Toast onDismiss={() => setBugError(null)}>{bugError}</Toast>}

      <div style={{ marginTop: 'var(--sp-5)' }}>
        <button
          type="button"
          className="link-tertiary"
          onClick={() => {
            void openUrl('mailto:contact@lovelace.sh').catch((e) => {
              setBugError(e instanceof Error ? e.message : 'Could not open the mail app.');
            });
          }}
        >
          Report a bug
        </button>
        {appVersion && <p className="subtle">Lovelace {appVersion}</p>}
      </div>
    </div>
  );
}
