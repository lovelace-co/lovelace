import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FieldInput } from '../components/FieldInput';
import { AddIcon, ArrowLeftIcon, EditIcon } from '../components/icons';
import { BlockEditor } from '../editor/BlockEditor';
import { formatDateTime, formatDateTimeShort } from '../lib/datetime';
import { fieldLabel, statusLabel, titleCase, typeLabel } from '../lib/format';
import { STATUS_HUE_CSS, statusHue } from '../lib/loom';
import { Markdown } from '../lib/markdown';
import type { LinkResolver, OpenLink, WikiCandidate } from '../lib/links';
import { useHost } from '../state/store';
import type { Snapshot } from '../lib/types';
import { fieldsFor } from '../lib/types';

interface TicketDetailProps {
  snapshot: Snapshot;
  ticketId: string;
  onBack: () => void;
  onOpenTicket: (id: string) => void;
  onUpdate: (id: string, changes: Record<string, unknown>) => Promise<void>;
  onComment: (ticket: string, body: string) => Promise<void>;
  onSaveBody?: (id: string, body: string) => Promise<void>;
  /** Wiki-link plumbing for the body editor, comment composer and read views. */
  wikiCandidates?: WikiCandidate[];
  resolveLink?: LinkResolver;
  onOpenLink?: OpenLink;
}

function frontmatterAndBody(content: string): string {
  const parts = content.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').trim() : content;
}

export function TicketDetail({
  snapshot,
  ticketId,
  onBack,
  onOpenTicket,
  onUpdate,
  onComment,
  onSaveBody,
  wikiCandidates,
  resolveLink,
  onOpenLink,
}: TicketDetailProps) {
  const host = useHost();
  const ticket = snapshot.index.tickets.find((t) => t.id === ticketId);
  const [body, setBody] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [savingBody, setSavingBody] = useState(false);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const [composeKey, setComposeKey] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commits, setCommits] = useState<Array<{ sha: string; subject: string }>>([]);
  const [commentBodies, setCommentBodies] = useState<Record<string, string>>({});
  const [titleDraft, setTitleDraft] = useState(ticket?.title ?? '');
  const titleFocused = useRef(false);

  // Keep the editable title in sync with the file, except while editing.
  useEffect(() => {
    if (!titleFocused.current) setTitleDraft(ticket?.title ?? '');
  }, [ticket?.title]);

  // The body is read once when the ticket opens; it is not re-synced from
  // disk while open. Editing is an explicit mode (see the Edit button), so
  // changes to the file's body underneath us are ignored until the next open.
  useEffect(() => {
    setBody(null);
    setEditingBody(false);
    if (ticket) {
      void host.readFile(snapshot.root, ticket.path).then(
        (content) => setBody(frontmatterAndBody(content)),
        () => setBody(''),
      );
      void host.commitsForTicket(snapshot.root, ticket.id).then(setCommits, () => setCommits([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, snapshot.root, ticket?.id]);

  // Comment bodies aren't in the index (metadata only), so read each file.
  useEffect(() => {
    if (!ticket) {
      setCommentBodies({});
      return;
    }
    const comments = snapshot.index.comments.filter((c) => c.ticket === ticket.id);
    let cancelled = false;
    void Promise.all(
      comments.map((c) =>
        host.readFile(snapshot.root, c.path).then(
          (text) => [c.path, frontmatterAndBody(text)] as const,
          () => [c.path, ''] as const,
        ),
      ),
    ).then((pairs) => {
      if (!cancelled) setCommentBodies(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, snapshot.root, ticket?.id, snapshot.index]);

  // Title is edited in the header, so it is excluded from the properties list.
  const defs = useMemo(
    () => (ticket ? fieldsFor(snapshot.fieldCatalogue, ticket.type).filter((d) => d.name !== 'title') : []),
    [snapshot.fieldCatalogue, ticket],
  );

  // Direct children only: tickets whose parent reference points at this one.
  const children = useMemo(
    () =>
      ticket
        ? snapshot.index.tickets
            .filter((t) => t.fields.parent === ticket.id)
            .sort((a, b) => a.id.localeCompare(b.id))
        : [],
    [snapshot.index.tickets, ticket],
  );

  if (!ticket) {
    return (
      <div style={{ padding: '1.4rem' }}>
        <p className="label">Ticket {ticketId} no longer exists.</p>
        <button className="btn btn-secondary" onClick={onBack}>
          Back to board
        </button>
      </div>
    );
  }

  const timeline = [
    ...snapshot.index.comments
      .filter((c) => c.ticket === ticket.id)
      .map((c) => ({
        kind: 'comment' as const,
        at: c.created,
        who: c.actor,
        what: commentBodies[c.path] ?? '…',
      })),
    ...snapshot.index.sessions
      .filter((s) => s.ticket === ticket.id)
      .map((s) => ({ kind: 'session' as const, at: s.ended, who: s.actor, what: `${s.id}: ${s.outcome}` })),
    ...commits.map((c) => ({ kind: 'commit' as const, at: '', who: '', what: `${c.sha} ${c.subject}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const change = async (changes: Record<string, unknown>, label: string) => {
    setSaving(label);
    setError(null);
    try {
      await onUpdate(ticket.id, changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(ticket.title); // title is required; revert an empty edit
    } else if (next !== ticket.title) {
      void change({ title: next }, 'title');
    }
  };

  const submitComment = () => {
    const next = draft.trim();
    if (!next) return; // empty or whitespace-only is a no-op
    void onComment(ticket.id, next).then(() => {
      setDraft('');
      setComposing(false);
      setComposeKey((k) => k + 1); // remount a fresh, empty editor next time
    });
  };

  const discardComment = () => {
    setDraft('');
    setComposing(false);
    setComposeKey((k) => k + 1); // remount a fresh, empty editor next time
  };

  // The body is view-only until Edit is pressed; saving writes once and
  // returns to the rendered view. No autosave, no live disk sync.
  const startEditBody = () => {
    setBodyDraft(body ?? '');
    setEditingBody(true);
  };

  const cancelEditBody = () => {
    setEditingBody(false);
  };

  const saveBody = async () => {
    if (!onSaveBody) return;
    setSavingBody(true);
    setError(null);
    try {
      await onSaveBody(ticket.id, bodyDraft);
      setBody(bodyDraft);
      setEditingBody(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingBody(false);
    }
  };

  // Toggle a task checkbox directly from the rendered view: flip the Nth
  // `- [ ]`/`- [x]` line in place (byte-identical elsewhere) and save.
  const toggleTask = async (taskIndex: number, next: boolean) => {
    if (!onSaveBody || body === null) return;
    let seen = -1;
    const taskLine = /^(\s*(?:[-*]|\d+\.)\s+)\[([ xX])\](\s.*)$/;
    const nextBody = body
      .split('\n')
      .map((line) => {
        const m = taskLine.exec(line);
        if (!m) return line;
        seen += 1;
        return seen === taskIndex ? `${m[1]}[${next ? 'x' : ' '}]${m[3]}` : line;
      })
      .join('\n');
    if (nextBody === body) return;
    setBody(nextBody); // optimistic; the file is the source of truth on reopen
    try {
      await onSaveBody(ticket.id, nextBody);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBody(body);
    }
  };

  return (
    <>
      <header className="view-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: 1 }}>
          <button className="btn btn-secondary btn-icon" onClick={onBack} aria-label="Back" title="Back">
            <ArrowLeftIcon />
          </button>
          <input
            className="view-title view-title-input"
            aria-label="ticket title"
            value={titleDraft}
            placeholder="Untitled"
            onChange={(e) => setTitleDraft(e.target.value)}
            onFocus={() => {
              titleFocused.current = true;
            }}
            onBlur={() => {
              titleFocused.current = false;
              commitTitle();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setTitleDraft(ticket.title);
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      </header>
      {error && <div className="banner">{error}</div>}
      <div className="detail-grid">
        <div>
          <div className="panel" style={{ padding: '16px 18px 18px' }}>
            {body === null ? (
              <p className="label body-prose">loading...</p>
            ) : editingBody ? (
              <div
                className="body-editor"
                onKeyDownCapture={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void saveBody();
                  }
                }}
              >
                <BlockEditor
                  source={bodyDraft}
                  onChange={setBodyDraft}
                  wikiCandidates={wikiCandidates}
                  resolveLink={resolveLink}
                  onOpenLink={onOpenLink}
                />
                <div className="comment-actions">
                  <button type="button" className="btn btn-danger" onClick={cancelEditBody}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={savingBody}
                    onClick={() => void saveBody()}
                  >
                    {savingBody ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {body.trim() === '' ? (
                  <p className="subtle body-prose">No description yet.</p>
                ) : (
                  <div className="body-prose">
                    <Markdown
                      source={body}
                      onToggleTask={onSaveBody ? toggleTask : undefined}
                      resolveLink={resolveLink}
                      onOpenLink={onOpenLink}
                    />
                  </div>
                )}
                {onSaveBody && (
                  <div className="comment-compose body-edit-bar">
                    <button type="button" className="btn btn-primary comment-add" onClick={startEditBody}>
                      <EditIcon />
                      Edit
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="panel activity-card" style={{ padding: '16px 18px 18px' }}>
            <h2 className="panel-heading activity-heading">Activity</h2>
            {timeline.length === 0 && (
              <EmptyState compact note="There are no comments yet. Click add a comment to create one." />
            )}
            {timeline.length > 0 && (
              <div className="thread-line">
                {timeline.map((entry, i) => (
                  <div key={i} className="thread-event">
                    <div className="thread-main">
                      <div className="thread-meta">
                        <span className="thread-who">{entry.who ? `@${entry.who}` : entry.kind}</span>
                        {entry.who && <span className="thread-kind">{entry.kind}</span>}
                        {entry.at && <span className="when">{formatDateTimeShort(entry.at)}</span>}
                      </div>
                      {entry.kind === 'comment' ? (
                        <div className="thread-body is-rich">
                          <Markdown source={entry.what} resolveLink={resolveLink} onOpenLink={onOpenLink} />
                        </div>
                      ) : (
                        <div className="thread-body">{entry.what}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="comment-compose">
              {!composing && draft.trim() === '' ? (
                <button
                  type="button"
                  className="btn btn-primary comment-add"
                  aria-label="comment"
                  onClick={() => setComposing(true)}
                  onFocus={() => setComposing(true)}
                >
                  <AddIcon />
                  Add a comment
                </button>
              ) : (
                <div
                  className="comment-editor"
                  onKeyDownCapture={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submitComment();
                    }
                  }}
                >
                  <BlockEditor
                    key={composeKey}
                    source={draft}
                    onChange={setDraft}
                    wikiCandidates={wikiCandidates}
                    resolveLink={resolveLink}
                    onOpenLink={onOpenLink}
                  />
                  <div className="comment-actions">
                    <button type="button" className="btn btn-danger" onClick={discardComment}>
                      Discard
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={draft.trim() === ''}
                      onClick={submitComment}
                    >
                      Comment
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <aside>
          <div className="props-panel">
            <div className="panel-heading props-heading">Properties</div>
            <div className="props-list">
              <div className="prop">
                <span className="prop-label">{titleCase('id')}</span>
                <span className="prop-value">{ticket.id}</span>
              </div>
              <div className="prop">
                <span className="prop-label">{titleCase('type')}</span>
                <span className="prop-value">
                  {typeLabel(snapshot.workflow.types.find((t) => t.name === ticket.type) ?? { name: ticket.type })}
                </span>
              </div>
              <div className="prop">
                <span className="prop-label">{titleCase('status')}</span>
                <span className="prop-value">
                  <span className="status-chip">
                    <span
                      className="priority-dot"
                      style={{ background: STATUS_HUE_CSS[statusHue(snapshot.workflow, ticket.status)] }}
                    />
                    {statusLabel(
                      snapshot.workflow.statuses.find((s) => s.name === ticket.status) ?? { name: ticket.status },
                    )}
                  </span>
                </span>
              </div>
              <div className="prop">
                <span className="prop-label">{titleCase('created')}</span>
                <span className="prop-value">{formatDateTime(ticket.created)}</span>
              </div>
              <div className="prop">
                <span className="prop-label">{titleCase('updated')}</span>
                <span className="prop-value">{formatDateTime(ticket.updated)}</span>
              </div>
              {defs.map((def) => (
                <div className="prop" key={def.name}>
                  <span className="prop-label">
                    {fieldLabel(def)}
                    {def.required ? ' *' : ''}
                  </span>
                  <div className="prop-control">
                    <FieldInput
                      def={def}
                      value={ticket.fields[def.name]}
                      workflow={snapshot.workflow}
                      index={snapshot.index}
                      actors={snapshot.actors}
                      onChange={(value) => void change({ [def.name]: value }, def.name)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {children.length > 0 && (
            <div className="props-panel children-panel">
              <div className="panel-heading props-heading">Children</div>
              <div className="children-list">
                {children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    className="child-row"
                    onClick={() => onOpenTicket(child.id)}
                  >
                    <span
                      className="priority-dot"
                      style={{ background: STATUS_HUE_CSS[statusHue(snapshot.workflow, child.status)] }}
                      title={statusLabel(
                        snapshot.workflow.statuses.find((s) => s.name === child.status) ?? {
                          name: child.status,
                        },
                      )}
                    />
                    <span className="child-title">{child.title}</span>
                    <span className="id-chip">{child.id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
