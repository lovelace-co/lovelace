import { useEffect, useState } from 'react';

interface UpdateReady {
  version: string;
  notes: string | null;
}

/** Renders nothing until the Rust side has downloaded and staged an update.
    Once "lovelace://update-ready" fires, a capsule offers a restart; nothing
    installs or restarts on its own, the user chooses when. */
export function UpdatePill() {
  const [ready, setReady] = useState<UpdateReady | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Outside the app shell (a plain browser preview) there is no Tauri
    // runtime to listen to; skip so `listen` never throws there.
    if (!('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => {
      void listen<UpdateReady>('lovelace://update-ready', (event) => {
        setReady(event.payload);
      }).then((un) => {
        if (cancelled) un();
        else unlisten = un;
      });
    });
    // A window opened after an update was already staged (Cmd+N), or a check
    // that finished before this listener registered, would otherwise never
    // learn about it; ask once directly. The event above stays the live path;
    // last write wins, and both carry the same shape.
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<UpdateReady | null>('staged_update'))
      .then((staged) => {
        if (!cancelled && staged) setReady(staged);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!ready) return null;

  const install = () => {
    setInstalling(true);
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('install_update'))
      .catch((error: unknown) => {
        // No modal for a failed install. Installing consumed the staged
        // download, so the offer is withdrawn rather than left promising a
        // retry that must fail; the Rust side re-checks in the background
        // and the pill returns once a fresh download is staged.
        console.error('failed to install update', error);
        setInstalling(false);
        setReady(null);
      });
  };

  return (
    <button
      className="btn btn-secondary tip tip--start"
      data-tip={`Restart to update to ${ready.version}`}
      title={ready.notes ?? undefined}
      disabled={installing}
      onClick={install}
    >
      {installing ? 'Restarting…' : 'Update ready'}
    </button>
  );
}
