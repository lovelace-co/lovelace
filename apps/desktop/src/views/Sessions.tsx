import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Markdown } from '../lib/markdown';
import { formatDateTimeShort } from '../lib/datetime';
import type { LinkResolver, OpenLink } from '../lib/links';
import { useHost } from '../state/store';
import type { Snapshot } from '../lib/types';

interface SessionsProps {
  snapshot: Snapshot;
  onOpenTicket: (id: string) => void;
  resolveLink?: LinkResolver;
  onOpenLink?: OpenLink;
}

function bodyOf(content: string): string {
  const parts = content.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').replace(/^\n/, '') : content;
}

/** Reverse-chronological session records with tickets, outcomes and commits. */
export function Sessions({ snapshot, onOpenTicket, resolveLink, onOpenLink }: SessionsProps) {
  const host = useHost();
  const sessions = [...snapshot.index.sessions].sort((a, b) => b.id.localeCompare(a.id));
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

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

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Sessions</h1>
        <span className="label">{sessions.length} records</span>
      </header>
      <div className="view-body">
        <div className="panel">
          {sessions.length === 0 && (
            <EmptyState note="No sessions yet" hint="Agent sessions write a record here as they finish." />
          )}
          {sessions.map((session) => (
            <div key={session.id} className="session-row">
              <div className="session-row-top">
                <span className="id-chip">{session.id}</span>
                <button className="btn-ghost" onClick={() => onOpenTicket(session.ticket)}>
                  {session.ticket}
                </button>
                <span className={`outcome-pill outcome-${session.outcome}`}>{session.outcome}</span>
                <span style={{ color: 'var(--text-faint)', fontSize: '0.6875rem' }}>
                  {formatDateTimeShort(session.ended)}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}>
                  @{session.actor}
                </span>
                {session.commits.length > 0 && (
                  <span className="mono" style={{ color: 'var(--text-faint)', fontSize: '0.6875rem' }}>
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
    </>
  );
}
