import { Fragment, useEffect, useRef, useState } from 'react';
import symbol from './assets/symbol.svg';
import { ThemeProvider } from './state/theme';
import { ProjectView } from './views/ProjectView';
import { Welcome } from './views/Welcome';

interface Tab {
  id: number;
  root: string | null; // null = welcome tab
  name: string;
}

/** The shape persisted to localStorage so the next launch reopens the same tabs. */
interface PersistedTab {
  root: string | null;
  name: string;
}

interface PersistedSession {
  tabs: PersistedTab[];
  activeIndex: number;
}

const SESSION_KEY = 'lovelace.tabs';

let nextTabId = 1;

function welcomeTab(): Tab {
  return { id: nextTabId++, root: null, name: 'Welcome' };
}

/**
 * This window's Tauri label, read the same way the official API does. The
 * primary window (and any non-Tauri context, such as tests) is "main"; windows
 * opened with Cmd+N get their own label.
 */
function windowLabel(): string {
  try {
    const internals = (
      window as {
        __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
      }
    ).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? 'main';
  } catch {
    return 'main';
  }
}

// A secondary window is its own instance: it starts on a fresh Welcome tab and
// never touches the saved session, so opening one cannot disturb the primary
// window's restored tabs.
const isSecondaryWindow = windowLabel() !== 'main';

/** Asks the Rust side to open another app window (Cmd+N). */
function openNewWindow(): void {
  if (!('__TAURI_INTERNALS__' in window)) return;
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('new_window'))
    .catch(() => undefined);
}

/**
 * Restores the tabs that were open when the app last closed. Falls back to a
 * single welcome tab on first run or if the stored session is unreadable.
 */
function loadSession(): { tabs: Tab[]; activeId: number } {
  if (isSecondaryWindow) {
    const welcome = welcomeTab();
    return { tabs: [welcome], activeId: welcome.id };
  }
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedSession;
      const restored = (parsed.tabs ?? [])
        .filter((t) => t && typeof t.name === 'string')
        .map((t) => ({ id: nextTabId++, root: t.root ?? null, name: t.name }));
      if (restored.length > 0) {
        const active = restored[parsed.activeIndex] ?? restored[restored.length - 1];
        return { tabs: restored, activeId: active.id };
      }
    }
  } catch {
    // A corrupt store should never block startup; fall through to a fresh tab.
  }
  const welcome = welcomeTab();
  return { tabs: [welcome], activeId: welcome.id };
}

export function App() {
  // Read the stored session exactly once, before the first render.
  const boot = useRef<{ tabs: Tab[]; activeId: number } | null>(null);
  if (boot.current === null) boot.current = loadSession();

  const [tabs, setTabs] = useState<Tab[]>(boot.current.tabs);
  const [activeId, setActiveId] = useState(boot.current.activeId);

  // Drag-to-reorder tabs: the dragged tab id, and the insertion-line index.
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Persist the open tabs and the active one on every change so a relaunch
  // reinstates the previous session. Secondary windows stay out of this so they
  // cannot overwrite the primary window's saved session.
  useEffect(() => {
    if (isSecondaryWindow) return;
    const activeIndex = Math.max(
      0,
      tabs.findIndex((t) => t.id === activeId),
    );
    const session: PersistedSession = {
      tabs: tabs.map((t) => ({ root: t.root, name: t.name })),
      activeIndex,
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Best effort: a full or unavailable store just means no restore.
    }
  }, [tabs, activeId]);

  const openProject = (root: string) => {
    const name = root.split('/').filter(Boolean).pop() ?? root;
    const existing = tabs.find((t) => t.root === root);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    setTabs((current) => {
      const active = current.find((t) => t.id === activeId);
      if (active && active.root === null) {
        // Replace the welcome tab in place.
        return current.map((t) => (t.id === activeId ? { ...t, root, name } : t));
      }
      const tab: Tab = { id: nextTabId++, root, name };
      setActiveId(tab.id);
      return [...current, tab];
    });
  };

  const newTab = () => {
    const tab = welcomeTab();
    setTabs((t) => [...t, tab]);
    setActiveId(tab.id);
  };

  const closeTab = (id: number) => {
    setTabs((current) => {
      const remaining = current.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const welcome = welcomeTab();
        setActiveId(welcome.id);
        return [welcome];
      }
      if (activeId === id) setActiveId(remaining[remaining.length - 1]?.id ?? 0);
      return remaining;
    });
  };

  // The insertion point is the first tab whose horizontal midpoint sits to the
  // right of the pointer; past the last tab it appends.
  const tabDropIndex = (bar: HTMLElement, clientX: number): number => {
    const els = Array.from(bar.querySelectorAll<HTMLElement>('.tab'));
    for (let i = 0; i < els.length; i += 1) {
      const rect = els[i]!.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return els.length;
  };

  const commitReorder = () => {
    const id = dragId;
    const line = dropIndex;
    setDragId(null);
    setDropIndex(null);
    if (id === null || line === null) return;
    setTabs((current) => {
      const from = current.findIndex((t) => t.id === id);
      if (from === -1) return current;
      const without = current.filter((t) => t.id !== id);
      // The line index is in terms of the current list; drop one when the
      // dragged tab sat before it.
      const insertAt = from < line ? line - 1 : line;
      const next = [...without.slice(0, insertAt), current[from]!, ...without.slice(insertAt)];
      const same = next.every((t, i) => t.id === current[i]!.id);
      return same ? current : next;
    });
  };

  // Cmd/Ctrl+W closes the active tab (never the OS window); Cmd/Ctrl+T opens a
  // new tab; Cmd/Ctrl+N opens a new window. Keep the latest tab actions in refs
  // so the listeners, registered once below, always act on the current tabs.
  const closeActive = () => closeTab(activeId);
  const closeRef = useRef(closeActive);
  closeRef.current = closeActive;
  const newRef = useRef(newTab);
  newRef.current = newTab;

  useEffect(() => {
    // Collapse the rare case where both a native menu event and the keydown
    // fire for one shortcut into a single action.
    const last: Record<string, number> = {};
    const once = (action: string, run: () => void) => {
      const now = Date.now();
      if (now - (last[action] ?? 0) < 120) return;
      last[action] = now;
      run();
    };

    // Windows and Linux have no native menu, so the webview gets these here.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'w') {
        e.preventDefault();
        once('close', () => closeRef.current());
      } else if (key === 't') {
        e.preventDefault();
        once('new', () => newRef.current());
      } else if (key === 'n') {
        e.preventDefault();
        once('window', openNewWindow);
      }
    };
    window.addEventListener('keydown', onKey);

    // On macOS the native File menu owns these accelerators (so Cmd+W can never
    // reach the window); it forwards each to the focused window as an event.
    // `listen` resolves asynchronously, so guard against the effect being torn
    // down first (React StrictMode mounts effects twice in dev): without this
    // the first listener is never removed and every menu command fires twice.
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const track = (un: () => void) => {
      if (cancelled) un();
      else unlisteners.push(un);
    };
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/event').then(({ listen }) => {
        void listen('lovelace://close-tab', () => once('close', () => closeRef.current())).then(track);
        void listen('lovelace://new-tab', () => once('new', () => newRef.current())).then(track);
        void listen('lovelace://new-window', () => once('window', openNewWindow)).then(track);
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      unlisteners.forEach((un) => un());
    };
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <ThemeProvider>
      <div className="app-frame">
        <div
          className="tab-bar"
          onDragOver={(e) => {
            if (dragId === null) return;
            e.preventDefault();
            setDropIndex(tabDropIndex(e.currentTarget, e.clientX));
          }}
          onDrop={(e) => {
            if (dragId === null) return;
            e.preventDefault();
            commitReorder();
          }}
        >
          {/* Decorative brand mark; the same cyan glyph reads on both themes. */}
          <div className="tab-bar-brand">
            <img src={symbol} alt="" className="tab-bar-logo" />
          </div>
          {tabs.map((tab, i) => (
            <Fragment key={tab.id}>
              {dragId !== null && dropIndex === i && <div className="tab-drop-line" />}
              <button
                className={`tab${tab.id === active?.id ? ' active' : ''}${dragId === tab.id ? ' dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(tab.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropIndex(null);
                }}
                onClick={() => setActiveId(tab.id)}
              >
                <span className="tab-name">{tab.name}</span>
                <span
                  className="tab-close"
                  role="button"
                  aria-label={`close ${tab.name}`}
                  title={`Close ${tab.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  x
                </span>
              </button>
            </Fragment>
          ))}
          {dragId !== null && dropIndex !== null && dropIndex >= tabs.length && (
            <div className="tab-drop-line" />
          )}
          <button className="btn-ghost tab-new" aria-label="new tab" title="Open another project" onClick={newTab}>
            +
          </button>
        </div>
        {tabs.map((tab) => (
          <div key={tab.id} style={{ display: tab.id === active?.id ? 'contents' : 'none' }}>
            {tab.root === null ? (
              tab.id === active?.id ? (
                <Welcome onOpenProject={openProject} onInitialised={openProject} />
              ) : null
            ) : (
              <ProjectView root={tab.root} />
            )}
          </div>
        ))}
      </div>
    </ThemeProvider>
  );
}
