import { useState } from 'react';
import logo from '../assets/logo.svg';
import logoWhite from '../assets/logo-white.svg';
import { InitWizard } from '../components/InitWizard';
import { Toast } from '../components/Toast';
import { useTheme } from '../state/theme';
import { forgetRecent, loadRecents, useHost } from '../state/store';
import type { Workflow } from '../lib/types';

interface WelcomeProps {
  onOpenProject: (root: string) => void;
  onInitialised: (root: string) => void;
}

export function Welcome({ onOpenProject, onInitialised }: WelcomeProps) {
  const host = useHost();
  const { theme } = useTheme();
  const [recents, setRecents] = useState(loadRecents);
  const [initTarget, setInitTarget] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Workflow | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openExisting = async () => {
    setError(null);
    try {
      const dir = await host.pickDirectory();
      if (!dir) return;
      if (await host.detect(dir)) {
        onOpenProject(dir);
      } else {
        // No .lovelace yet: gather the workflow and scaffold one.
        const wf = await host.defaultWorkflow();
        const leaf = dir.split('/').filter(Boolean).pop() ?? 'Project';
        setPendingName(leaf);
        setDefaults(wf);
        setInitTarget(dir);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="welcome">
      <img src={theme === 'dark' ? logoWhite : logo} alt="Lovelace" className="welcome-logo" />
      <p className="welcome-subtitle">Project management that lives in your repository.</p>
      <div className="welcome-actions">
        <button className="btn btn-primary" onClick={() => void openExisting()}>
          Open a project
        </button>
      </div>
      {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
      {recents.length > 0 && (
        <div className="recents">
          <p className="label" style={{ margin: '0.2rem 0 0.3rem', padding: '0 0.7rem' }}>
            Recent projects
          </p>
          {recents.map((r) => (
            <div key={r.root} className="recent-row" role="button" tabIndex={0} onClick={() => onOpenProject(r.root)}>
              <span className="recent-name">{r.name}</span>
              <span className="recent-path">{r.root}</span>
              <button
                className="recent-forget"
                aria-label={`remove ${r.name} from recents`}
                title="Remove from recents"
                onClick={(e) => {
                  e.stopPropagation();
                  setRecents(forgetRecent(r.root));
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {initTarget && defaults && (
        <InitWizard
          initTarget={initTarget}
          defaults={defaults}
          initialName={pendingName}
          onCancel={() => setInitTarget(null)}
          onDone={onInitialised}
        />
      )}
    </div>
  );
}
