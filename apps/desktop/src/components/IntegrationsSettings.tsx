import { useEffect, useState } from 'react';
import { HoleCheck } from './HoleCheck';
import { Toast } from './Toast';
import type { ClaudeInstallStatus, InstallClaudeResult } from '../lib/host';

interface IntegrationsSettingsProps {
  /** (Re)install the Claude Code assets; resolves to what was written and what needs doing by hand. */
  onInstall: (gitHook: boolean) => Promise<InstallClaudeResult>;
  /** Detect whether the Claude Code assets are already installed. */
  onClaudeStatus: () => Promise<ClaudeInstallStatus>;
}

function coreLabel(name: string): string {
  if (name === 'mcp') return 'MCP server';
  if (name === 'hooks') return 'Hooks';
  if (name === 'commands') return 'Slash commands';
  return name;
}

function missingCorePieces(status: ClaudeInstallStatus): string[] {
  const pieces: Array<keyof ClaudeInstallStatus> = ['mcp', 'hooks', 'commands'];
  return pieces.filter((k) => !status[k]).map(coreLabel);
}

function installSummary(status: ClaudeInstallStatus): string {
  if (status.installed) {
    return 'Claude Code assets are installed in this project.';
  }
  const missing = missingCorePieces(status);
  if (missing.length < 3) {
    return 'Claude Code assets are partially installed.';
  }
  return 'Claude Code assets are not installed in this project.';
}

/**
 * The Integrations settings section: shows whether the Claude Code assets are
 * installed, and installs or reinstalls them on request. Reinstalling is safe;
 * it regenerates the Lovelace-owned files and reports anything it could not do.
 */
export function IntegrationsSettings({ onInstall, onClaudeStatus }: IntegrationsSettingsProps) {
  const [gitHook, setGitHook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallClaudeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ClaudeInstallStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    void onClaudeStatus().then(
      (s) => {
        if (!cancelled) {
          setStatus(s);
          setStatusLoading(false);
        }
      },
      () => {
        if (!cancelled) setStatusLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [onClaudeStatus]);

  const install = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await onInstall(gitHook);
      setResult(r);
      try {
        setStatus(await onClaudeStatus());
      } catch {
        // silently ignore status refresh failure
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isInstalled = status?.installed ?? false;
  const missing = status && !status.installed ? missingCorePieces(status) : [];

  return (
    <div className="settings-section">
      {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
      <h2 className="section-heading section-heading--with-badge">
        Claude Code
        {status?.installed && <span className="badge-installed">installed</span>}
      </h2>
      <p className="subtle" style={{ maxWidth: '58ch', marginBottom: 18 }}>
        Install or reinstall the CLAUDE.md section, the MCP server and the hooks so a Claude Code session
        starts oriented and works tickets through Lovelace. Reinstalling regenerates the Lovelace-owned
        files and leaves your own content alone.
      </p>

      <div style={{ marginBottom: 18 }}>
        {statusLoading ? (
          <p className="subtle">Checking...</p>
        ) : status !== null ? (
          <>
            <p className="subtle" data-testid="claude-status-summary">{installSummary(status)}</p>
            {missing.length > 0 && (
              <p className="subtle" style={{ marginTop: 6 }}>
                Missing: {missing.join(', ')}.
              </p>
            )}
          </>
        ) : null}
      </div>

      <label className="wizard-check" style={{ marginBottom: 18 }}>
        <HoleCheck aria-label="install git hook" checked={gitHook} onChange={(e) => setGitHook(e.target.checked)} />
        Also install the git hook that adds the active ticket ID to commit messages
      </label>

      <div>
        <button className="btn btn-primary" onClick={() => void install()} disabled={busy}>
          {busy ? 'Installing...' : isInstalled ? 'Reinstall Claude Code assets' : 'Install Claude Code assets'}
        </button>
      </div>

      {result && (
        <div className="settings-result" style={{ marginTop: 18 }}>
          {result.written.length > 0 && (
            <p className="subtle">
              Wrote: <span className="mono">{result.written.join(', ')}</span>
            </p>
          )}
          {result.manual.length > 0 ? (
            <>
              <p className="subtle">A few steps could not be done automatically:</p>
              <ul className="subtle">
                {result.manual.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="subtle">Everything installed. Restart any open Claude Code session to pick it up.</p>
          )}
        </div>
      )}
    </div>
  );
}
