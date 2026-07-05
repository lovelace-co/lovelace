import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AutomationsIcon,
  BoardIcon,
  CloseIcon,
  DigestIcon,
  DocsIcon,
  GraphIcon,
  ListIcon,
  ProblemsIcon,
  SearchIcon,
  SessionsIcon,
  SettingsIcon,
} from '../components/icons';
import { EmptyState } from '../components/EmptyState';
import { NewTicketModal } from '../components/NewTicketModal';
import { SearchPalette } from '../components/SearchPalette';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { Toast } from '../components/Toast';
import { ThemeToggle } from '../components/ThemeToggle';
import { rememberRecent, useHost, useProject } from '../state/store';
import { buildLinkResolver, referenceCandidates, type LinkResolver, type OpenLink } from '../lib/links';
import type { IndexTicket, SearchHit, Snapshot } from '../lib/types';
import { Actions } from './Actions';
import { Board } from './Board';
import { Documents } from './Documents';
import { Graph } from './Graph';
import { List } from './List';
import { Sessions } from './Sessions';
import { Settings } from './Settings';
import { TicketDetail } from './TicketDetail';

type NavKey = 'board' | 'list' | 'docs' | 'graph' | 'sessions' | 'runs' | 'settings' | 'issues';

interface ProjectViewProps {
  root: string;
}

export function ProjectView({ root }: ProjectViewProps) {
  const { snapshot, loading, error, externalChange, apply, dismissExternalChange, presence } =
    useProject(root);
  const [nav, setNav] = useState<NavKey>('board');
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ status?: string } | null>(null);
  const [deleting, setDeleting] = useState<IndexTicket | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [docsFocus, setDocsFocus] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  // Settings reports unsaved edits so navigating away can prompt; pendingNav
  // holds the destination the user asked for while that prompt is open.
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<NavKey | null>(null);
  const host = useHost();

  // The active nav row rests on a seat that glides between rows rather than
  // teleporting (state moves, never marks). Measured, not hard-coded, so a
  // count note or a new nav item never desynchronises it.
  const navRefs = useRef(new Map<NavKey, HTMLButtonElement>());
  const [navSeat, setNavSeat] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = openTicket ? undefined : navRefs.current.get(nav);
    if (!el) {
      setNavSeat(null);
      return;
    }
    setNavSeat({ top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight });
  }, [nav, openTicket, snapshot]);

  useEffect(() => {
    if (snapshot) rememberRecent({ root, name: snapshot.manifest.name });
  }, [snapshot, root]);

  // Cmd/Ctrl+K opens search from anywhere in the project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Escape closes the digest.
  useEffect(() => {
    if (!digestOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDigestOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [digestOpen]);

  const humanActor = useMemo(
    () => snapshot?.actors.find((a) => a.kind === 'human')?.id ?? 'me',
    [snapshot],
  );

  // Reference plumbing, shared by every editor and read-only body in the app.
  const resolveLink = useMemo<LinkResolver>(
    () => (snapshot ? buildLinkResolver(snapshot) : () => null),
    [snapshot],
  );
  // The repo file list backs the Files section of the insert menu; fetched once.
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void host.listFiles(root).then(
      (f) => {
        if (!cancelled) setFiles(f);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [host, root]);
  const linkCandidates = useMemo(
    () => (snapshot ? referenceCandidates(snapshot, files) : []),
    [snapshot, files],
  );

  /** A status move shown immediately, confirmed (or rolled back) by core. */
  const moveOptimistically = (id: string, to: string) => (current: Snapshot): Snapshot => ({
    ...current,
    index: {
      ...current.index,
      tickets: current.index.tickets.map((t) => (t.id === id ? { ...t, status: to } : t)),
    },
  });

  /** All app-side ticket updates flow through here. */
  const guardedUpdate = async (id: string, changes: Record<string, unknown>) => {
    const to = typeof changes.status === 'string' ? changes.status : undefined;
    await apply(
      (h) => h.updateTicket(root, id, changes, { actor: humanActor, force: to !== undefined }),
      to !== undefined ? moveOptimistically(id, to) : undefined,
    );
  };

  /**
   * A board drop: persist the target column's order, and when the card has
   * crossed columns, also perform the status transition.
   */
  const reorder = (id: string, status: string, orderedIds: string[]) => {
    const ticket = snapshot?.index.tickets.find((t) => t.id === id);
    const movingColumns = ticket !== undefined && ticket.status !== status;
    void apply(
      async (h) => {
        if (movingColumns) {
          await h.updateTicket(root, id, { status }, { actor: humanActor, force: true });
        }
        return h.setColumnOrder(root, status, orderedIds);
      },
      movingColumns ? moveOptimistically(id, status) : undefined,
    );
  };

  const goto = (key: NavKey) => {
    // Leaving Settings with unsaved edits prompts rather than dropping them.
    if (nav === 'settings' && key !== 'settings' && settingsDirty) {
      setPendingNav(key);
      return;
    }
    setNav(key);
    setOpenTicket(null);
  };

  /** Follow a clicked reference: a ticket/document navigates, a file previews, a person is a mention. */
  const openLink: OpenLink = (target) => {
    if (target.kind === 'ticket') {
      setOpenTicket(target.id);
    } else if (target.kind === 'document' && target.path) {
      setDocsFocus(target.path);
      goto('docs');
    } else if (target.kind === 'file' && target.path) {
      setPreviewFile(target.path);
    }
    // person: a mention only, for now.
  };

  const pickSearchHit = (hit: SearchHit) => {
    if (hit.kind === 'ticket') {
      setOpenTicket(hit.id);
    } else if (hit.kind === 'document') {
      setDocsFocus(hit.path);
      goto('docs');
    } else if (hit.kind === 'session') {
      goto('sessions');
    } else if (hit.path.includes('/tickets/')) {
      setOpenTicket(hit.id);
    } else {
      goto('docs');
    }
  };

  if (loading && !snapshot) {
    return <p className="subtle" style={{ padding: '1.5rem' }}>opening project...</p>;
  }
  if (error && !snapshot) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div className="problem-note">{error}</div>
      </div>
    );
  }
  if (!snapshot) return null;

  const errors = snapshot.issues.filter((i) => i.severity === 'error');
  const warnings = snapshot.issues.filter((i) => i.severity === 'warning');

  const navButton = (key: NavKey, icon: ReactNode, text: string, note?: number, noteClass?: string) => (
    <button
      ref={(el) => {
        if (el) navRefs.current.set(key, el);
        else navRefs.current.delete(key);
      }}
      className={`nav-item${nav === key && !openTicket ? ' active' : ''}`}
      onClick={() => goto(key)}
    >
      {icon}
      {text}
      {note !== undefined && note > 0 && (
        <span className={`count-note num${noteClass ? ` ${noteClass}` : ''}`}>{note}</span>
      )}
    </button>
  );

  const agentActor = snapshot.actors.find((a) => a.kind === 'agent')?.id ?? 'agent';
  const focusTask = presence.focus ?? snapshot.activeTicket;
  const healthClass =
    snapshot.issues.length === 0 ? 'clean' : errors.length > 0 ? 'snag-error' : 'snag-warning';

  return (
    <div className="workbench">
      <nav className="side-nav">
        {navSeat && <span className="nav-seat" style={navSeat} aria-hidden />}
        <div className="nav-head">
          <div className="head-title">
            <h1 className="project-name">{snapshot.manifest.name}</h1>
            <div className="head-actions">
              <button
                className="head-btn"
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                title="Search (⌘K)"
              >
                <SearchIcon />
              </button>
            </div>
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-section-head">Work</div>
          {navButton('board', <BoardIcon />, 'Board')}
          {navButton('list', <ListIcon />, 'List')}
        </div>

        <div className="nav-sep" />

        <div className="nav-group">
          <div className="nav-section-head">Knowledge</div>
          {navButton('docs', <DocsIcon />, 'Documentation')}
          {navButton('graph', <GraphIcon />, 'Graph')}
        </div>

        <div className="nav-sep" />

        <div className="nav-group">
          <div className="nav-section-head">Activity</div>
          {navButton('sessions', <SessionsIcon />, 'Sessions')}
          {navButton('runs', <AutomationsIcon />, 'Runs')}
          {navButton('issues', <ProblemsIcon />, 'Problems', snapshot.issues.length, healthClass)}
        </div>

        <div className="nav-footer">
          <div className="agent-seat">
            <div className="seat-top">
              <span className={`seat-dot${presence.awake ? ' awake' : ''}`} aria-hidden />
              <span className="seat-name">{agentActor}</span>
              <span className={`seat-state${presence.awake ? ' live' : ''}`}>
                {presence.awake
                  ? `weaving${presence.elapsedMinutes !== null ? ` · ${presence.elapsedMinutes}m` : ''}`
                  : 'idle'}
              </span>
            </div>
            <div className="seat-task">
              <span className="key">task</span>
              {focusTask ? (
                <button className="seat-link" onClick={() => setOpenTicket(focusTask)}>
                  {focusTask}
                </button>
              ) : (
                <span className="seat-idle">none</span>
              )}
            </div>
          </div>
          <div className="footer-bar">
            <button
              className={`footer-settings${nav === 'settings' && !openTicket ? ' active' : ''}`}
              onClick={() => goto('settings')}
            >
              <SettingsIcon />
              Settings
            </button>
            <div className="footer-tools">
              <ThemeToggle />
              <button
                className="seat-tool tip tip--end"
                data-tip="Digest"
                aria-label="Open digest: what an agent sees at session start"
                onClick={() => setDigestOpen(true)}
              >
                <DigestIcon />
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="main-pane">
        {externalChange && (
          <Toast kind="notice" onDismiss={dismissExternalChange}>
            Files changed on disk; the view has been refreshed.
          </Toast>
        )}
        {openTicket ? (
          <TicketDetail
            snapshot={snapshot}
            ticketId={openTicket}
            onBack={() => setOpenTicket(null)}
            onOpenTicket={setOpenTicket}
            onUpdate={guardedUpdate}
            candidates={linkCandidates}
            resolveLink={resolveLink}
            onOpenLink={openLink}
            onComment={async (ticket, body) => {
              await apply((h) => h.addComment(root, ticket, humanActor, body));
            }}
            onSaveBody={async (id, body) => {
              await apply((h) => h.writeTicketBody(root, id, body));
            }}
          />
        ) : nav === 'board' ? (
          <Board
            snapshot={snapshot}
            presence={presence}
            onOpenTicket={setOpenTicket}
            onNewTicket={(status) => setCreating({ ...(status !== undefined ? { status } : {}) })}
            onReorder={reorder}
            onQuickCreate={(status, title) => {
              const type =
                snapshot.workflow.types.find((t) => t.name === 'task') ?? snapshot.workflow.types[0];
              if (type) void apply((h) => h.createTicket(root, type.name, { title }, status));
            }}
            onRequestDelete={setDeleting}
          />
        ) : nav === 'list' ? (
          <List
            snapshot={snapshot}
            presence={presence}
            onOpenTicket={setOpenTicket}
            onNewTicket={(status) => setCreating({ ...(status !== undefined ? { status } : {}) })}
            onQuickCreate={(status, title) => {
              const type =
                snapshot.workflow.types.find((t) => t.name === 'task') ?? snapshot.workflow.types[0];
              if (type) void apply((h) => h.createTicket(root, type.name, { title }, status));
            }}
            onRequestDelete={setDeleting}
          />
        ) : nav === 'docs' ? (
          <Documents
            snapshot={snapshot}
            focusPath={docsFocus}
            candidates={linkCandidates}
            resolveLink={resolveLink}
            onOpenLink={openLink}
            onSaveBody={async (path, body) => {
              await apply((h) => h.writeDocument(root, path, { body }));
            }}
            onSaveProperties={async (path, summary, reviewBy) => {
              await apply((h) => h.writeDocument(root, path, { summary, review_by: reviewBy }));
            }}
            onCreateDocument={async (dir, name, summary) => {
              await apply((h) => h.createDocument(root, dir, name, summary));
            }}
            onCreateFolder={async (dir, name) => {
              await apply((h) => h.createFolder(root, dir, name));
            }}
            onRenameDocument={async (path, name) => {
              await apply((h) => h.renameDocument(root, path, name));
            }}
            onDeleteDocument={async (path) => {
              await apply((h) => h.deleteDocument(root, path));
            }}
            onDeleteFolder={async (path) => {
              await apply((h) => h.deleteFolder(root, path));
            }}
          />
        ) : nav === 'graph' ? (
          <Graph
            snapshot={snapshot}
            onOpenDocument={(path) => {
              setDocsFocus(path);
              goto('docs');
            }}
            onSaveLayout={(layout) => {
              void apply((h) => h.setGraphLayout(root, layout));
            }}
          />
        ) : nav === 'sessions' ? (
          <Sessions
            snapshot={snapshot}
            onOpenTicket={setOpenTicket}
            resolveLink={resolveLink}
            onOpenLink={openLink}
          />
        ) : nav === 'runs' ? (
          <Actions snapshot={snapshot} />
        ) : nav === 'settings' ? (
          <Settings
            snapshot={snapshot}
            onDirtyChange={setSettingsDirty}
            onSaveWorkflow={async (edit) => {
              await apply((h) => h.writeWorkflow(root, edit));
            }}
            onSaveAutomations={async (rules) => {
              await apply((h) => h.setAutomations(root, rules));
            }}
            onRenameProject={async (name) => {
              await apply((h) => h.writeManifest(root, { name }));
            }}
            onSavePresenceTimeout={async (minutes) => {
              await apply((h) => h.writeManifest(root, { presence_timeout_minutes: minutes }));
            }}
            onSaveActors={async (actors) => {
              await apply((h) => h.writeActors(root, actors));
            }}
            onInstallClaude={(gitHook) => host.installClaude(root, gitHook)}
          />
        ) : (
          <>
            <header className="view-header">
              <h1 className="view-title">Problems</h1>
              <span className="subtle">
                {errors.length} errors, {warnings.length} warnings
              </span>
            </header>
            <div className="view-body">
              <div className="panel">
                {snapshot.issues.length === 0 && (
                  <EmptyState note="Everything validates" hint="No errors or warnings across the project." />
                )}
                {snapshot.issues.map((issue, i) => (
                  <div key={i} className="issue-row">
                    <span className={`sev-${issue.severity}`}>{issue.severity}</span>
                    <span className="mono" style={{ color: 'var(--slate)' }}>
                      {issue.file}
                      {issue.line !== undefined ? `:${issue.line}` : ''}
                    </span>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
      {searchOpen && (
        <SearchPalette root={root} onClose={() => setSearchOpen(false)} onPick={pickSearchHit} />
      )}
      {previewFile && (
        <FilePreviewModal root={root} path={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      {digestOpen && (
        <div className="modal-backdrop" onClick={() => setDigestOpen(false)}>
          <div className="modal-shell">
            <button
              className="modal-close"
              aria-label="Close digest"
              onClick={() => setDigestOpen(false)}
            >
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
      {pendingNav !== null && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Discard unsaved changes?</h2>
            <p style={{ color: 'var(--slate)', fontSize: '0.8125rem' }}>
              You have unsaved changes in Settings. Leaving now discards them.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPendingNav(null)}>
                Keep editing
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  const key = pendingNav;
                  setSettingsDirty(false);
                  setPendingNav(null);
                  setNav(key);
                  setOpenTicket(null);
                }}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
      {deleting !== null && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Delete this ticket?</h2>
            <p style={{ color: 'var(--slate)', fontSize: '0.8125rem' }}>
              <span className="id-chip">{deleting.id}</span> {deleting.title}
            </p>
            {(() => {
              const comments = snapshot.index.comments.filter((c) => c.ticket === deleting.id).length;
              const sessions = snapshot.index.sessions.filter((s) => s.ticket === deleting.id).length;
              const extras = [
                comments > 0 ? `${comments} comment${comments === 1 ? '' : 's'}` : null,
                sessions > 0 ? `${sessions} session${sessions === 1 ? '' : 's'}` : null,
              ].filter(Boolean);
              return (
                <p style={{ color: 'var(--bad-fg)', fontSize: '0.8125rem' }}>
                  This permanently deletes the ticket
                  {extras.length > 0 ? ` and its ${extras.join(' and ')}` : ''}. It cannot be undone.
                </p>
              );
            })()}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  const id = deleting.id;
                  setDeleting(null);
                  if (openTicket === id) setOpenTicket(null);
                  void apply((h) => h.deleteTicket(root, id));
                }}
              >
                Delete ticket
              </button>
            </div>
          </div>
        </div>
      )}
      {creating !== null && (
        <NewTicketModal
          snapshot={snapshot}
          {...(creating.status !== undefined ? { initialStatus: creating.status } : {})}
          onClose={() => setCreating(null)}
          onCreate={async (type, fields, status) => {
            await apply((h) => h.createTicket(root, type, fields, status));
            setCreating(null);
          }}
        />
      )}
    </div>
  );
}
