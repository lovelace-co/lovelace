import { useEffect, useState } from 'react';
import { Dropdown } from './Dropdown';
import { statusLabel } from '../lib/format';
import type { IndexComment, IndexSession, SchemaStatus } from '../lib/types';

interface BulkActionsProps {
  selected: string[];
  statuses: SchemaStatus[];
  index: { comments: IndexComment[]; sessions: IndexSession[] };
  onMove: (ids: string[], status: string) => void;
  onDelete: (ids: string[]) => void;
  onClear: () => void;
}

/**
 * The bulk-action bar and its delete confirmation, shared by every view with
 * a checkbox selection (List, Board). Owns only the confirm-modal state and
 * the Escape handling; the caller owns what is selected and how a move or
 * delete actually happens.
 */
export function BulkActions({ selected, statuses, index, onMove, onDelete, onClear }: BulkActionsProps) {
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The confirmation modal reads the live selection, so close it before
      // clearing; otherwise Escape would leave it open over zero tickets.
      if (bulkDeleting) {
        setBulkDeleting(false);
        return;
      }
      onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bulkDeleting, onClear]);

  if (selected.length === 0) return null;

  const comments = index.comments.filter((c) => selected.includes(c.ticket)).length;
  const sessions = index.sessions.filter((s) => selected.includes(s.ticket)).length;
  const extras = [
    comments > 0 ? `${comments} comment${comments === 1 ? '' : 's'}` : null,
    sessions > 0 ? `${sessions} session${sessions === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  const single = selected.length === 1;

  return (
    <>
      <div className="bulk-bar">
        <span className="bulk-count">
          <span className="num">{selected.length}</span> selected
        </span>
        <Dropdown
          aria-label="move to"
          value=""
          placeholder="Move to..."
          options={statuses.map((s) => ({ value: s.name, label: statusLabel(s) }))}
          onChange={(status) => {
            if (!status) return;
            onMove(selected, status);
          }}
        />
        <button
          className="btn btn-secondary"
          onClick={() => {
            void navigator.clipboard.writeText(selected.join(', ')).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy Ticket IDs'}
        </button>
        <button className="btn btn-danger" onClick={() => setBulkDeleting(true)}>
          Delete
        </button>
        <button className="btn btn-ghost" onClick={onClear}>
          Clear
        </button>
      </div>
      {bulkDeleting && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{single ? 'Delete this ticket?' : `Delete ${selected.length} tickets?`}</h2>
            <p style={{ color: 'var(--bad-fg)', fontSize: '0.8125rem' }}>
              This permanently deletes {single ? 'the ticket' : `these ${selected.length} tickets`}
              {extras.length > 0 ? ` and ${single ? 'its' : 'their'} ${extras.join(' and ')}` : ''}. It
              cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setBulkDeleting(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setBulkDeleting(false);
                  onDelete(selected);
                }}
              >
                {single ? 'Delete ticket' : 'Delete tickets'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
