import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './icons';
import { EmptyState } from './EmptyState';
import { Markdown } from '../lib/markdown';
import { formatDateTimeShort } from '../lib/datetime';
import { titleCase } from '../lib/format';
import type { LinkResolver, OpenLink } from '../lib/links';
import { useHost } from '../state/store';
import type { Snapshot } from '../lib/types';

interface SessionsModalProps {
  snapshot: Snapshot;
  onClose: () => void;
  onOpenTicket: (id: string) => void;
  resolveLink?: LinkResolver;
  onOpenLink?: OpenLink;
  /** A session ID to open pre-expanded and scroll into view, or null for none. */
  initialOpen?: string | null;
}

function bodyOf(content: string): string {
  const parts = content.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').replace(/^\n/, '') : content;
}

/** Reverse-chronological session records with tickets, outcomes and commits, in a modal. */
export function SessionsModal({
  snapshot,
  onClose,
  onOpenTicket,
  resolveLink,
  onOpenLink,
  initialOpen = null,
}: SessionsModalProps) {
  const host = useHost();
  const sessions = [...snapshot.index.sessions].sort((a, b) => b.id.localeCompare(a.id));
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [body, setBody] = useState<string | null>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    setBody(null);
    const session = sessions.find((s) => s.id === open);
    if (session) {
      void host.readFile(snapshot.root, session.path).then(
        (text) => setBody(bodyOf(text)),
        () => setBody(''),
      );
    }
  }, [host, snapshot.root, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-shell">
        <button className="modal-close" aria-label="Close sessions" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="records-card" role="dialog" aria-label="sessions" onClick={(e) => e.stopPropagation()}>
          <div className="info-card-head">
            <div className="info-card-titles">
              <h2 className="info-card-name">Sessions</h2>
              <span className="info-card-sub">{sessions.length} records</span>
            </div>
          </div>
          <div className="records-well">
            {sessions.length === 0 && (
              <EmptyState note="No sessions yet" hint="Agent sessions write a record here as they finish." />
            )}
            {sessions.map((session) => (
              <div
                key={session.id}
                className="session-row"
                ref={(el) => {
                  if (el && initialOpen === session.id && !scrolledRef.current) {
                    scrolledRef.current = true;
                    el.scrollIntoView?.({ block: 'center' });
                  }
                }}
              >
                <div className="session-row-top">
                  <span className="id-chip">{session.id}</span>
                  <button className="btn-ghost" onClick={() => onOpenTicket(session.ticket)}>
                    {session.ticket}
                  </button>
                  <span className={`outcome-pill outcome-${session.outcome}`}>{titleCase(session.outcome)}</span>
                  <span style={{ color: 'var(--mist)', fontSize: '0.6875rem' }}>
                    {formatDateTimeShort(session.ended)}
                  </span>
                  <span style={{ color: 'var(--slate)', fontSize: '0.6875rem' }}>
                    @{session.actor}
                  </span>
                  {session.commits.length > 0 && (
                    <span className="mono" style={{ color: 'var(--mist)', fontSize: '0.6875rem' }}>
                      {session.commits.join(' ')}
                    </span>
                  )}
                  <button
                    className="btn-ghost"
                    style={{ marginLeft: 'auto' }}
                    aria-label={`toggle ${session.id}`}
                    onClick={() => setOpen(open === session.id ? null : session.id)}
                  >
                    {open === session.id ? 'collapse' : 'expand'}
                  </button>
                </div>
                {open === session.id && (
                  <div style={{ padding: '0.4rem 0.2rem 0.2rem' }}>
                    {body === null ? (
                      <p className="label">loading...</p>
                    ) : (
                      <Markdown source={body} resolveLink={resolveLink} onOpenLink={onOpenLink} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
