import { Fragment, useMemo, useState } from 'react';
import { ContextMenu } from '../components/ContextMenu';
import { Dropdown } from '../components/Dropdown';
import { EmptyState } from '../components/EmptyState';
import { AddIcon } from '../components/icons';
import { formatDateShort } from '../lib/datetime';
import { statusLabel, titleCase, typeLabel } from '../lib/format';
import { STATUS_HUE_CSS, priorityFamily, statusHue } from '../lib/loom';
import { punch, release } from '../lib/punch';
import { formatElapsed } from '../lib/presence';
import type { ProjectPresence } from '../state/store';
import type { IndexTicket, Snapshot } from '../lib/types';

interface ListProps {
  snapshot: Snapshot;
  presence?: ProjectPresence;
  onOpenTicket: (id: string) => void;
  onNewTicket: (status?: string) => void;
  onQuickCreate: (status: string, title: string) => void;
  onRequestDelete: (ticket: IndexTicket) => void;
}

interface Filters {
  type: string;
  assignee: string;
  custom: Record<string, string>;
}

const EMPTY_FILTERS: Filters = { type: '', assignee: '', custom: {} };

/**
 * The board's tickets read as a single dense column instead of warp bands:
 * grouped by status in workflow order, one scannable row each. The status
 * hues, pills and IDs are reused identically so the mapping stays learned.
 */
export function List({
  snapshot,
  presence,
  onOpenTicket,
  onNewTicket,
  onQuickCreate,
  onRequestDelete,
}: ListProps) {
  const { workflow, index } = snapshot;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [quickAdd, setQuickAdd] = useState<{ status: string; title: string } | null>(null);
  const [menu, setMenu] = useState<{ ticket: IndexTicket; x: number; y: number } | null>(null);

  const filterableCustom = useMemo(
    () =>
      workflow.fields.filter(
        (f) => (f.type === 'enum' || f.type === 'string') && !['title'].includes(f.name),
      ),
    [workflow.fields],
  );

  const visible = useMemo(
    () =>
      index.tickets.filter((t) => {
        if (filters.type && t.type !== filters.type) return false;
        if (filters.assignee && t.fields.assignee !== filters.assignee) return false;
        for (const [k, v] of Object.entries(filters.custom)) {
          if (v && String(t.fields[k] ?? '') !== v) return false;
        }
        return true;
      }),
    [index.tickets, filters],
  );

  const groups = workflow.statuses
    .map((status) => ({
      status,
      tickets: visible
        .filter((t) => t.status === status.name)
        .sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .filter((g) => g.tickets.length > 0 || quickAdd?.status === g.status.name);

  const row = (ticket: IndexTicket) => {
    const hue = STATUS_HUE_CSS[statusHue(workflow, ticket.status)];
    const isDone = workflow.statuses.find((s) => s.name === ticket.status)?.complete === true;
    const live = presence?.awake === true && presence.focus === ticket.id;
    const parentId = typeof ticket.fields.parent === 'string' ? ticket.fields.parent : null;
    const epicTitle = parentId
      ? (index.tickets.find((t) => t.id === parentId)?.title ?? parentId)
      : null;
    const priority = typeof ticket.fields.priority === 'string' ? ticket.fields.priority : null;
    const family = priority !== null ? priorityFamily(workflow, priority) : null;
    const assignee = typeof ticket.fields.assignee === 'string' ? ticket.fields.assignee : null;
    return (
      <div
        key={ticket.id}
        className={`list-row${isDone ? ' done' : ''}${live ? ' live' : ''}`}
        role="button"
        tabIndex={0}
        onPointerDown={punch}
        onPointerUp={release}
        onPointerLeave={release}
        onClick={() => onOpenTicket(ticket.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenTicket(ticket.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ ticket, x: e.clientX, y: e.clientY });
        }}
      >
        <span className="priority-dot" style={{ background: hue }} title={statusLabel(workflow.statuses.find((s) => s.name === ticket.status) ?? { name: ticket.status })} />
        <span className="list-row-title">{ticket.title}</span>
        <span className="list-row-meta">
          {epicTitle !== null && <span className="prio epic">{epicTitle}</span>}
          {!isDone && priority !== null && family !== null && (
            <span className={`prio ${family}`}>{titleCase(priority)}</span>
          )}
          {assignee !== null && <span className="list-assignee">@{assignee}</span>}
          <span className="list-updated num">{formatDateShort(ticket.updated)}</span>
          <span className={`id${live ? ' live' : ''}`}>
            {live && presence?.elapsedSeconds !== null ? `${formatElapsed(presence.elapsedSeconds)} · ` : ''}
            {ticket.id}
          </span>
        </span>
      </div>
    );
  };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">List</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Dropdown
            aria-label="filter type"
            value={filters.type}
            placeholder="All Types"
            options={workflow.types.map((t) => ({ value: t.name, label: typeLabel(t) }))}
            onChange={(v) => setFilters({ ...filters, type: v })}
          />
          <Dropdown
            aria-label="filter assignee"
            value={filters.assignee}
            placeholder="Anyone"
            options={snapshot.actors.map((a) => ({ value: a.id, label: titleCase(a.id) }))}
            onChange={(v) => setFilters({ ...filters, assignee: v })}
          />
          {filterableCustom
            .filter((f) => f.type === 'enum')
            .map((f) => (
              <Dropdown
                key={f.name}
                aria-label={`filter ${f.name}`}
                value={filters.custom[f.name] ?? ''}
                placeholder={`Any ${titleCase(f.name)}`}
                options={(f.values ?? (f.values_from === 'priorities' ? workflow.priorities : [])).map((v) => ({ value: v, label: titleCase(v) }))}
                onChange={(v) => setFilters({ ...filters, custom: { ...filters.custom, [f.name]: v } })}
              />
            ))}
          <button className="btn btn-primary" onClick={() => onNewTicket()}>
            <AddIcon />
            New ticket
          </button>
        </div>
      </header>
      <div className="list-scroll">
        {groups.length === 0 &&
          (filters.type || filters.assignee || Object.values(filters.custom).some(Boolean) ? (
            <EmptyState note="No tickets match these filters" hint="Clear a filter to see more." />
          ) : (
            <EmptyState note="No tickets yet" hint="Add one with New ticket, or on the board." />
          ))}
        {groups.map(({ status, tickets }) => (
          <section key={status.name} className="list-group">
            <header className="list-group-head">
              <span className="priority-dot" style={{ background: STATUS_HUE_CSS[statusHue(workflow, status.name)] }} />
              <h2 className="list-group-title">{statusLabel(status)}</h2>
              <span className="list-group-count num">{tickets.length}</span>
            </header>
            {tickets.map((ticket) => (
              <Fragment key={ticket.id}>{row(ticket)}</Fragment>
            ))}
            {quickAdd?.status === status.name ? (
              <input
                className="quick-add-input list-quick-add"
                aria-label={`new ticket title in ${status.name}`}
                placeholder="Ticket title, then Enter"
                autoFocus
                value={quickAdd.title}
                onChange={(e) => setQuickAdd({ status: status.name, title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const title = quickAdd.title.trim();
                    if (title) {
                      onQuickCreate(status.name, title);
                      setQuickAdd({ status: status.name, title: '' });
                    }
                  } else if (e.key === 'Escape') {
                    setQuickAdd(null);
                  }
                }}
                onBlur={() => {
                  if (quickAdd.title.trim() === '') setQuickAdd(null);
                }}
              />
            ) : (
              <button
                className="add-line list-add-line"
                aria-label={`add ticket to ${status.name}`}
                onPointerDown={punch}
                onPointerUp={release}
                onPointerLeave={release}
                onClick={() => setQuickAdd({ status: status.name, title: '' })}
                title={`Add a ticket to ${status.name}`}
              >
                <AddIcon />
                Add ticket
              </button>
            )}
          </section>
        ))}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Delete ticket',
              danger: true,
              onSelect: () => onRequestDelete(menu.ticket),
            },
          ]}
        />
      )}
    </>
  );
}
