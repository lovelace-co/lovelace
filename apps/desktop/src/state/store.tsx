import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { HostError, type HostClient } from '../lib/host';
import type { Snapshot } from '../lib/types';
import { STILL, derivePresence, type LivePresence } from '../lib/presence';

const HostContext = createContext<HostClient | null>(null);

export function HostProvider({ host, children }: { host: HostClient; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useHost(): HostClient {
  const host = useContext(HostContext);
  if (!host) throw new Error('useHost outside HostProvider');
  return host;
}

/** A failure loading the project; code/declared/supported ride along for a
 * spec-version mismatch so the UI can render a dedicated screen instead of
 * pattern-matching the message text. */
export interface ProjectLoadError {
  message: string;
  code?: string;
  declared?: string;
  supported?: string;
}

export interface ProjectState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: ProjectLoadError | null;
  /** Set when the files changed under an open editor. */
  externalChange: boolean;
  reload: () => Promise<void>;
  /**
   * Run a mutation that resolves to a fresh snapshot. An optional
   * optimistic patch is shown immediately and rolled back on failure,
   * so moves land where they were dropped without waiting on the host.
   */
  apply: (
    mutation: (host: HostClient) => Promise<Snapshot>,
    optimistic?: (current: Snapshot) => Snapshot,
  ) => Promise<Snapshot>;
  dismissExternalChange: () => void;
  /** The live agent presence, read from the hooks' marker file. */
  presence: ProjectPresence;
}

export type ProjectPresence = LivePresence;

/**
 * Loads a project snapshot, keeps it fresh through the watcher, and routes
 * every mutation through the host so the UI always reflects the files.
 */
export function useProject(root: string): ProjectState {
  const host = useHost();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ProjectLoadError | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const mutating = useRef(false);
  /** The optimistic baseline: the last snapshot known to match the files. */
  const previous = useRef<Snapshot | null>(null);

  const reload = useCallback(
    async (_external = false) => {
      try {
        const fresh = await host.snapshot(root);
        previous.current = fresh;
        setSnapshot(fresh);
        setError(null);
      } catch (e) {
        if (e instanceof HostError) {
          setError({ message: e.message, code: e.code, declared: e.declared, supported: e.supported });
        } else {
          setError({ message: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        setLoading(false);
      }
    },
    [host, root],
  );

  useEffect(() => {
    setLoading(true);
    void reload();
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void host
      .watch(root, (change) => {
        if (mutating.current) return;
        // Presence heartbeats refresh the snapshot but never raise the
        // toast; only a non-presence path counts as an external change.
        if (!change.presenceOnly) setExternalChange(true);
        void reload(true);
      })
      .then((unsub) => {
        if (cancelled) unsub();
        else cleanup = unsub;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [host, root, reload]);

  // Presence is per-session marker files plus a clock: tick once a second
  // while any marker exists, so the elapsed readouts count and a stale
  // marker eventually falls out. Keyed on the entry count, not a
  // timestamp, so a heartbeat refreshing beat_at does not churn the timer.
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const presenceCount = snapshot?.agentPresences?.length ?? 0;
  useEffect(() => {
    if (presenceCount === 0) return;
    setPresenceNow(Date.now());
    const timer = setInterval(() => setPresenceNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [presenceCount]);

  const apply = useCallback(
    async (
      mutation: (h: HostClient) => Promise<Snapshot>,
      optimistic?: (current: Snapshot) => Snapshot,
    ) => {
      mutating.current = true;
      const before = previous.current;
      if (optimistic && before) {
        const patched = optimistic(before);
        previous.current = patched;
        setSnapshot(patched);
      }
      try {
        const fresh = await mutation(host);
        previous.current = fresh;
        setSnapshot(fresh);
        return fresh;
      } catch (e) {
        if (optimistic && before) {
          previous.current = before;
          setSnapshot(before);
        }
        throw e;
      } finally {
        // Let the watcher settle before treating events as external again.
        setTimeout(() => {
          mutating.current = false;
        }, 500);
      }
    },
    [host],
  );

  const presence: ProjectPresence = snapshot
    ? derivePresence(snapshot.agentPresences, snapshot.manifest.presence_timeout_minutes, presenceNow)
    : STILL;

  return {
    snapshot,
    loading,
    error,
    externalChange,
    reload: () => reload(false),
    apply,
    dismissExternalChange: () => setExternalChange(false),
    presence,
  };
}

/* ---------- recents, persisted locally ---------- */

export interface RecentProject {
  root: string;
  name: string;
}

const RECENTS_KEY = 'lovelace.recents';

export function loadRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentProject[]) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(entry: RecentProject): void {
  const rest = loadRecents().filter((r) => r.root !== entry.root);
  localStorage.setItem(RECENTS_KEY, JSON.stringify([entry, ...rest].slice(0, 8)));
}

/** Removes one project from the recents list and returns the remainder. */
export function forgetRecent(root: string): RecentProject[] {
  const rest = loadRecents().filter((r) => r.root !== root);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(rest));
  return rest;
}
