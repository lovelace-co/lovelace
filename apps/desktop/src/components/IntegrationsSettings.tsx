import { useState } from 'react';
import { HoleCheck } from './HoleCheck';
import { Toast } from './Toast';
import type { InstallClaudeResult } from '../lib/host';

interface IntegrationsSettingsProps {
  /** (Re)install the Claude Code assets; resolves to what was written and what needs doing by hand. */
  onInstall: (gitHook: boolean) => Promise<InstallClaudeResult>;
}

/**
 * The Integrations settings section: install or reinstall the Claude Code
 * assets (the CLAUDE.md section, the MCP server registration and the hooks),
 * and optionally the commit-message git hook. Reinstalling is safe; it
 * regenerates the Lovelace-owned files and reports anything it could not do.
 */
export function IntegrationsSettings({ onInstall }: IntegrationsSettingsProps) {
  const [gitHook, setGitHook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallClaudeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await onInstall(gitHook));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
      <h2 className="section-heading">Claude Code</h2>
      <p className="subtle" style={{ maxWidth: '58ch', marginBottom: 18 }}>
        Install or reinstall the CLAUDE.md section, the MCP server and the hooks so a Claude Code session
        starts oriented and works tickets through Lovelace. Reinstalling regenerates the Lovelace-owned
        files and leaves your own content alone.
      </p>

      <label className="wizard-check" style={{ marginBottom: 18 }}>
        <HoleCheck aria-label="install git hook" checked={gitHook} onChange={(e) => setGitHook(e.target.checked)} />
        Also install the git hook that adds the active ticket ID to commit messages
      </label>

      <div>
        <button className="btn btn-primary" onClick={() => void install()} disabled={busy}>
          {busy ? 'Installing...' : 'Install Claude Code assets'}
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
