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
import { cliInstall, cliStatus, cliUninstall, isShell } from '../lib/cli';
import type { CliInstall, CliStatus } from '../lib/cli';
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
  /** Check whether the `lovelace` command is on PATH. Defaults to the real Tauri command; tests inject a fake. */
  onCliStatus?: () => Promise<CliStatus>;
  /** Install (or repair) the `lovelace` launcher. Defaults to the real Tauri command; tests inject a fake. */
  onCliInstall?: () => Promise<CliInstall>;
  /** Remove the `lovelace` launcher. Defaults to the real Tauri command; tests inject a fake. */
  onCliUninstall?: () => Promise<void>;
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
  onCliStatus = cliStatus,
  onCliInstall = cliInstall,
  onCliUninstall = cliUninstall,
}: GeneralSettingsProps) {
  const [digestOpen, setDigestOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsInitialOpen, setSessionsInitialOpen] = useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [bugError, setBugError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [cliState, setCliState] = useState<CliStatus | null>(null);
  const [cliStateLoading, setCliStateLoading] = useState(true);
  // Which action is in flight, if any; drives both buttons' disabled state
  // and lets the button that was actually clicked show its own "-ing" label.
  const [cliBusy, setCliBusy] = useState<'install' | 'uninstall' | null>(null);
  const [cliResult, setCliResult] = useState<CliInstall | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);

  // Not passing these props at all (the real app) leaves them equal to the
  // Tauri-backed defaults, so the section only shows outside the app shell
  // when a test has deliberately substituted fakes.
  const cliPropsInjected = onCliStatus !== cliStatus || onCliInstall !== cliInstall || onCliUninstall !== cliUninstall;
  const showCli = isShell() || cliPropsInjected;

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!showCli) return;
    let cancelled = false;
    setCliStateLoading(true);
    void onCliStatus().then(
      (s) => {
        if (!cancelled) {
          setCliState(s);
          setCliStateLoading(false);
        }
      },
      () => {
        if (!cancelled) setCliStateLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCli, onCliStatus]);
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

  const refreshCliState = async () => {
    try {
      setCliState(await onCliStatus());
    } catch {
      // silently ignore status refresh failure
    }
  };

  const installCli = async () => {
    setCliBusy('install');
    setCliError(null);
    setCliResult(null);
    try {
      const r = await onCliInstall();
      setCliResult(r);
      await refreshCliState();
    } catch (e) {
      setCliError(e instanceof Error ? e.message : String(e));
    } finally {
      setCliBusy(null);
    }
  };

  const uninstallCli = async () => {
    setCliBusy('uninstall');
    setCliError(null);
    setCliResult(null);
    try {
      await onCliUninstall();
      await refreshCliState();
    } catch (e) {
      setCliError(e instanceof Error ? e.message : String(e));
    } finally {
      setCliBusy(null);
    }
  };

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

      {showCli && (
        <div style={{ marginTop: 'var(--sp-6)' }}>
          <h2 className="section-heading">Command line</h2>
          <p className="subtle" style={{ maxWidth: '58ch', marginBottom: 18 }}>
            Install a 'lovelace' command that opens or activates this app from a terminal. It carries no
            flags or subcommands; it only opens the app.
          </p>

          {cliStateLoading ? (
            <p className="subtle">Checking...</p>
          ) : cliState?.installed ? (
            <>
              <p className="subtle" data-testid="cli-status-summary">
                The 'lovelace' command is installed at <span className="mono">{cliState.location}</span>.
              </p>
              {!cliState.current && (
                <p className="subtle" style={{ marginTop: 6 }}>
                  The installed command points at an old location.
                </p>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                {!cliState.current && (
                  <button className="btn btn-secondary" onClick={() => void installCli()} disabled={cliBusy !== null}>
                    {cliBusy === 'install' ? 'Reinstalling...' : "Reinstall 'lovelace' command in PATH"}
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => void uninstallCli()} disabled={cliBusy !== null}>
                  {cliBusy === 'uninstall' ? 'Removing...' : "Remove 'lovelace' command from PATH"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="subtle" data-testid="cli-status-summary">
                The 'lovelace' command is not on your PATH.
              </p>
              <div style={{ marginTop: 18 }}>
                <button className="btn btn-secondary" onClick={() => void installCli()} disabled={cliBusy !== null}>
                  {cliBusy === 'install' ? 'Installing...' : "Install 'lovelace' command in PATH"}
                </button>
              </div>
            </>
          )}

          {cliError && (
            <div className="settings-result" style={{ marginTop: 18 }}>
              <p className="subtle">{cliError}</p>
            </div>
          )}
          {cliResult && !cliError && (
            <div className="settings-result" style={{ marginTop: 18 }}>
              <p className="subtle">
                Installed at <span className="mono">{cliResult.location}</span>.
              </p>
              {cliResult.note && (
                <p className="subtle" style={{ marginTop: 6 }}>
                  {cliResult.note}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 'var(--sp-5)' }}>
        <button
          type="button"
          className="link-tertiary"
          onClick={() => {
            void openUrl('mailto:contact@lovelace.co').catch((e) => {
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
