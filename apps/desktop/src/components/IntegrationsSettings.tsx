import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { HoleCheck } from './HoleCheck';
import { Toast } from './Toast';
import type { ClaudeInstallStatus, CodexInstallStatus, InstallClaudeResult, OpenCodeInstallStatus } from '../lib/host';

interface IntegrationsSettingsProps {
  /** (Re)install the Claude Code assets; resolves to what was written and what needs doing by hand. */
  onInstall: (gitHook: boolean) => Promise<InstallClaudeResult>;
  /** Detect whether the Claude Code assets are already installed. */
  onClaudeStatus: () => Promise<ClaudeInstallStatus>;
  /** (Re)install the OpenCode assets; resolves to what was written and what needs doing by hand. */
  onInstallOpenCode: (gitHook: boolean) => Promise<InstallClaudeResult>;
  /** Detect whether the OpenCode assets are already installed. */
  onOpenCodeStatus: () => Promise<OpenCodeInstallStatus>;
  /** (Re)install the Codex assets; resolves to what was written and what needs doing by hand. */
  onInstallCodex: (gitHook: boolean) => Promise<InstallClaudeResult>;
  /** Detect whether the Codex assets are already installed. */
  onCodexStatus: () => Promise<CodexInstallStatus>;
}

/** The three core pieces every integration shares: an MCP entry, a launcher (hooks or plugin) and slash commands. */
interface CoreInstallStatus {
  installed: boolean;
  mcp: boolean;
  hooks: boolean;
  commands: boolean;
}

const CORE_PIECES: Array<keyof CoreInstallStatus & ('mcp' | 'hooks' | 'commands')> = ['mcp', 'hooks', 'commands'];

function missingCorePieces(status: CoreInstallStatus, labels: Record<'mcp' | 'hooks' | 'commands', string>): string[] {
  return CORE_PIECES.filter((k) => !status[k]).map((k) => labels[k]);
}

function installSummary(productName: string, status: CoreInstallStatus, missing: string[]): string {
  if (status.installed) {
    return `${productName} assets are installed in this project.`;
  }
  if (missing.length < CORE_PIECES.length) {
    return `${productName} assets are partially installed.`;
  }
  return `${productName} assets are not installed in this project.`;
}

interface IntegrationCardProps<S extends CoreInstallStatus, R extends { written: string[]; manual: string[] }> {
  /** The human-facing product name, e.g. "Claude Code" or "OpenCode". */
  productName: string;
  /** Used to keep aria-labels and test ids distinct between cards. */
  cardId: string;
  description: ReactNode;
  pieceLabels: Record<'mcp' | 'hooks' | 'commands', string>;
  installLabel: string;
  reinstallLabel: string;
  restartHint: string;
  onInstall: (gitHook: boolean) => Promise<R>;
  onStatus: () => Promise<S>;
}

/**
 * One integration's install/status card: shows whether its assets are
 * installed, and installs or reinstalls them on request. Reinstalling is
 * safe; it regenerates the Lovelace-owned files and reports anything it
 * could not do. Both the Claude Code and OpenCode cards render through this,
 * each with their own git hook checkbox and busy/result state.
 */
function IntegrationCard<S extends CoreInstallStatus, R extends { written: string[]; manual: string[] }>({
  productName,
  cardId,
  description,
  pieceLabels,
  installLabel,
  reinstallLabel,
  restartHint,
  onInstall,
  onStatus,
}: IntegrationCardProps<S, R>) {
  const [gitHook, setGitHook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<S | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    void onStatus().then(
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
  }, [onStatus]);

  const install = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await onInstall(gitHook);
      setResult(r);
      try {
        setStatus(await onStatus());
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
  const missing = status && !status.installed ? missingCorePieces(status, pieceLabels) : [];

  return (
    <div>
      {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
      <h2 className="section-heading section-heading--with-badge">
        {productName}
        {status?.installed && <span className="badge-installed">installed</span>}
      </h2>
      <p className="subtle" style={{ maxWidth: '58ch', marginBottom: 18 }}>
        {description}
      </p>

      <div style={{ marginBottom: 18 }}>
        {statusLoading ? (
          <p className="subtle">Checking...</p>
        ) : status !== null ? (
          <>
            <p className="subtle" data-testid={`${cardId}-status-summary`}>
              {installSummary(productName, status, missing)}
            </p>
            {missing.length > 0 && (
              <p className="subtle" style={{ marginTop: 6 }}>
                Missing: {missing.join(', ')}.
              </p>
            )}
          </>
        ) : null}
      </div>

      <label className="wizard-check" style={{ marginBottom: 18 }}>
        <HoleCheck
          aria-label={cardId === 'claude' ? 'install git hook' : `install ${cardId} git hook`}
          checked={gitHook}
          onChange={(e) => setGitHook(e.target.checked)}
        />
        Also install the git hook that adds the active ticket ID to commit messages
      </label>

      <div>
        <button className="btn btn-primary" onClick={() => void install()} disabled={busy}>
          {busy ? 'Installing...' : isInstalled ? reinstallLabel : installLabel}
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
            <p className="subtle">{restartHint}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Integrations settings section: one card per coding agent Lovelace
 * wires up to, each showing whether its assets are installed and installing
 * or reinstalling them on request.
 */
export function IntegrationsSettings({
  onInstall,
  onClaudeStatus,
  onInstallOpenCode,
  onOpenCodeStatus,
  onInstallCodex,
  onCodexStatus,
}: IntegrationsSettingsProps) {
  return (
    <div className="settings-section">
      <IntegrationCard
        productName="Claude Code"
        cardId="claude"
        description="Install or reinstall the CLAUDE.md section, the MCP server and the hooks so a Claude Code session starts oriented and works tickets through Lovelace. Reinstalling regenerates the Lovelace-owned files and leaves your own content alone."
        pieceLabels={{ mcp: 'MCP server', hooks: 'Hooks', commands: 'Slash commands' }}
        installLabel="Install Claude Code assets"
        reinstallLabel="Reinstall Claude Code assets"
        restartHint="Everything installed. Restart any open Claude Code session to pick it up."
        onInstall={onInstall}
        onStatus={onClaudeStatus}
      />
      <div style={{ marginTop: 'var(--sp-6)' }}>
        <IntegrationCard
          productName="OpenCode"
          cardId="opencode"
          description="Install or reinstall the AGENTS.md section, the MCP server and the launcher plugin so an OpenCode session starts oriented and works tickets through Lovelace. Reinstalling regenerates the Lovelace-owned files and leaves your own content alone."
          pieceLabels={{ mcp: 'MCP server', hooks: 'Plugin', commands: 'Commands' }}
          installLabel="Install OpenCode assets"
          reinstallLabel="Reinstall OpenCode assets"
          restartHint="Everything installed. Restart any open OpenCode session to pick it up."
          onInstall={onInstallOpenCode}
          onStatus={onOpenCodeStatus}
        />
      </div>
      <div style={{ marginTop: 'var(--sp-6)' }}>
        <IntegrationCard
          productName="Codex"
          cardId="codex"
          description="Install or reinstall the AGENTS.md section, the MCP server and the hooks so a Codex session starts oriented and works tickets through Lovelace. Reinstalling regenerates the Lovelace-owned files and leaves your own content alone."
          pieceLabels={{ mcp: 'MCP server', hooks: 'Hooks', commands: 'Skills' }}
          installLabel="Install Codex assets"
          reinstallLabel="Reinstall Codex assets"
          restartHint="Everything installed. In Codex, trust this project and review the Lovelace hooks with /hooks, then restart any open session."
          onInstall={onInstallCodex}
          onStatus={onCodexStatus}
        />
      </div>
    </div>
  );
}
