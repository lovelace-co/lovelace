import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AutomationsIcon,
  BoardIcon,
  CloseIcon,
  DigestIcon,
  DocsIcon,
  FolderIcon,
  GraphIcon,
  InfoIcon,
  ListIcon,
  SearchIcon,
  SessionsIcon,
  WorkflowIcon,
} from '../components/icons';
import { formatDate } from '../lib/datetime';
import { EmptyState } from '../components/EmptyState';
import { NewTicketModal } from '../components/NewTicketModal';
import { SearchPalette } from '../components/SearchPalette';
import { Toast } from '../components/Toast';
import { ThemeToggle } from '../components/ThemeToggle';
import { rememberRecent, useProject } from '../state/store';
import { buildLinkResolver, wikiCandidates, type LinkResolver, type OpenLink } from '../lib/links';
import type { IndexTicket, SearchHit, Snapshot } from '../lib/types';
import { Automations } from './Automations';
import { Board } from './Board';
import { Briefs } from './Briefs';
import { Graph } from './Graph';
import { List } from './List';
import { Sessions } from './Sessions';
import { Workflow } from './Workflow';
import { TicketDetail } from './TicketDetail';

type NavKey = 'board' | 'list' | 'docs' | 'graph' | 'workflow' | 'sessions' | 'automations' | 'issues';

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
  const [infoOpen, setInfoOpen] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [docsFocus, setDocsFocus] = useState<string | null>(null);

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

  // Escape closes the project info card.
  useEffect(() => {
    if (!infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // Escape closes the digest.
  useEffect(() => {
    if (!digestOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDigestOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [digestOpen]);

  const openInfo = () => {
    setPathCopied(false);
    setInfoOpen(true);
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(root);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1600);
    } catch {
      setPathCopied(false);
    }
  };

  const humanActor = useMemo(
    () => snapshot?.actors.find((a) => a.kind === 'human')?.id ?? 'me',
    [snapshot],
  );

  // Wiki-link plumbing, shared by every editor and read-only body in the app.
  const resolveLink = useMemo<LinkResolver>(
    () => (snapshot ? buildLinkResolver(snapshot) : () => null),
    [snapshot],
  );
  const linkCandidates = useMemo(() => (snapshot ? wikiCandidates(snapshot) : []), [snapshot]);

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
    setNav(key);
    setOpenTicket(null);
  };

  /** Follow a clicked wiki-link: a ticket opens its detail, a brief opens in Documentation. */
  const openLink: OpenLink = (target) => {
    if (target.kind === 'ticket') {
      setOpenTicket(target.id);
    } else {
      setDocsFocus(target.path);
      goto('docs');
    }
  };

  const pickSearchHit = (hit: SearchHit) => {
    if (hit.kind === 'ticket') {
      setOpenTicket(hit.id);
    } else if (hit.kind === 'brief') {
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

  const navButton = (key: NavKey, icon: ReactNode, text: string, note?: number) => (
    <button
      className={`nav-item${nav === key && !openTicket ? ' active' : ''}`}
      onClick={() => goto(key)}
    >
      {icon}
      {text}
      {note !== undefined && note > 0 && <span className="count-note num">{note}</span>}
    </button>
  );

  const agentActor = snapshot.actors.find((a) => a.kind === 'agent')?.id ?? 'agent';
  const homePath = root.replace(/^\/Users\/[^/]+/, '~');
  const focusTask = presence.focus ?? snapshot.activeTicket;
  const healthClass =
    snapshot.issues.length === 0 ? 'clean' : errors.length > 0 ? 'snag-error' : 'snag-warning';

  return (
    <div className="workbench">
      <nav className="side-nav">
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
              <button
                className="head-btn"
                onClick={openInfo}
                aria-label="Project details"
                title="Project details"
              >
                <InfoIcon />
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
          {navButton('workflow', <WorkflowIcon />, 'Workflow')}
          {navButton('automations', <AutomationsIcon />, 'Automations')}
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
          <div className="seat-tools">
            <ThemeToggle />
            <div className="seat-tools-right">
              <button
                className="seat-tool tip tip--end"
                data-tip="Digest"
                aria-label="Open digest: what an agent sees at session start"
                onClick={() => setDigestOpen(true)}
              >
                <DigestIcon />
              </button>
              <button
                className="seat-tool seat-health tip tip--end"
                data-tip={
                  snapshot.issues.length === 0
                    ? 'No problems'
                    : `${snapshot.issues.length} problem${snapshot.issues.length === 1 ? '' : 's'}`
                }
                aria-label="View problems"
                onClick={() => goto('issues')}
              >
                <span className={`num health-count ${healthClass}`}>{snapshot.issues.length}</span>
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
            wikiCandidates={linkCandidates}
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
          <Briefs
            snapshot={snapshot}
            focusPath={docsFocus}
            wikiCandidates={linkCandidates}
            resolveLink={resolveLink}
            onOpenLink={openLink}
            onSaveBody={async (path, body) => {
              await apply((h) => h.writeBrief(root, path, { body }));
            }}
            onSaveProperties={async (path, summary, reviewBy) => {
              await apply((h) => h.writeBrief(root, path, { summary, review_by: reviewBy }));
            }}
            onCreateBrief={async (dir, name, summary, createOverview) => {
              await apply((h) => h.createBrief(root, dir, name, summary, createOverview));
            }}
            onRenameBrief={async (path, name) => {
              await apply((h) => h.renameBrief(root, path, name));
            }}
          />
        ) : nav === 'graph' ? (
          <Graph
            snapshot={snapshot}
            onOpenBrief={(path) => {
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
        ) : nav === 'workflow' ? (
          <Workflow
            snapshot={snapshot}
            onSave={async (edit) => {
              await apply((h) => h.writeWorkflow(root, edit));
            }}
          />
        ) : nav === 'automations' ? (
          <Automations
            snapshot={snapshot}
            onSaveAutomations={async (rules) => {
              await apply((h) => h.setAutomations(root, rules));
            }}
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
                    <span className="mono" style={{ color: 'var(--text-secondary)' }}>
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
      {infoOpen && (
        <div className="modal-backdrop" onClick={() => setInfoOpen(false)}>
          <div className="modal-shell">
            <button
              className="modal-close"
              aria-label="Close project details"
              onClick={() => setInfoOpen(false)}
            >
              <CloseIcon />
            </button>
            <div
              className="info-card"
              role="dialog"
              aria-label="project details"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="info-card-head">
                <div className="info-card-titles">
                  <h2 className="info-card-name">{snapshot.manifest.name}</h2>
                  <span className="info-card-sub">Project details</span>
                </div>
                <span className="spec-chip">spec {snapshot.manifest.spec_version}</span>
              </div>

              <div className="info-path">
                <FolderIcon />
                <span className="info-path-text mono">{homePath}</span>
                <button className="info-copy" onClick={copyPath}>
                  {pathCopied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="info-stats">
                {[
                  { n: snapshot.index.tickets.length, label: 'Tickets' },
                  { n: snapshot.index.briefs.length, label: 'Docs' },
                  { n: snapshot.index.sessions.length, label: 'Sessions' },
                ].map((stat) => (
                  <div key={stat.label} className="info-stat">
                    <span className="info-stat-num num">{stat.n}</span>
                    <span className="info-stat-label">{stat.label}</span>
                  </div>
                ))}
              </div>

              <dl className="info-grid">
                <dt>Created</dt>
                <dd>{formatDate(snapshot.manifest.created)}</dd>

                <dt>Project ID</dt>
                <dd className="mono">{snapshot.manifest.project_id}</dd>

                <dt>Team</dt>
                <dd className="info-team">
                  {snapshot.actors.map((a) => (
                    <span key={a.id} className="info-member">
                      {a.name}
                      <span className="info-member-kind">{a.kind}</span>
                    </span>
                  ))}
                </dd>
              </dl>

              <div className={`info-health ${healthClass}`}>
                {snapshot.issues.length === 0
                  ? 'Everything validates'
                  : `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>
        </div>
      )}
      {deleting !== null && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Delete this ticket?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
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
