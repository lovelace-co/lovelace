import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { HostClient } from '../lib/host';
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

export interface ProjectState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
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
        setError(e instanceof Error ? e.message : String(e));
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
      .watch(root, () => {
        if (mutating.current) return;
        setExternalChange(true);
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

  // Presence is a marker file plus a clock: re-read the clock every 15
  // seconds while a marker exists, so elapsed minutes tick over and a
  // stale marker eventually falls out, and reset it whenever a new turn
  // begins. No marker, no timer.
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const markerStartedAt = snapshot?.agentPresence?.started_at;
  useEffect(() => {
    if (markerStartedAt === undefined) return;
    setPresenceNow(Date.now());
    const timer = setInterval(() => setPresenceNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [markerStartedAt]);

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
    ? derivePresence(snapshot.agentPresence, snapshot.manifest.presence_timeout_minutes, presenceNow)
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
