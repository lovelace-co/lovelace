import { Fragment, useMemo, useState } from 'react';
import { BulkActions } from '../components/BulkActions';
import { ContextMenu } from '../components/ContextMenu';
import { Dropdown } from '../components/Dropdown';
import { LiveRing } from '../components/LiveRing';
import { AddIcon } from '../components/icons';
import { formatDateShort } from '../lib/datetime';
import { statusLabel, titleCase, typeLabel } from '../lib/format';
import { STATUS_HUE_CSS, priorityFamily, statusHue } from '../lib/loom';
import { punch, release } from '../lib/punch';
import { formatElapsed } from '../lib/presence';
import type { ProjectPresence } from '../state/store';
import type { FieldDef, IndexTicket, Snapshot } from '../lib/types';

interface ListProps {
  snapshot: Snapshot;
  presence?: ProjectPresence;
  onOpenTicket: (id: string) => void;
  onNewTicket: (status?: string) => void;
  onQuickCreate: (status: string, title: string) => void;
  onRequestDelete: (ticket: IndexTicket) => void;
  onBulkMove: (ids: string[], status: string) => Promise<void>;
  onBulkDelete: (ids: string[]) => Promise<void>;
}

interface Filters {
  type: string;
  assignee: string;
  custom: Record<string, string>;
}

const EMPTY_FILTERS: Filters = { type: '', assignee: '', custom: {} };

/**
 * The board's tickets read as a single dense column instead of warp bands:
 * grouped by status in schema order, one scannable row each. The status
 * hues, pills and IDs are reused identically so the mapping stays learned.
 */
export function List({
  snapshot,
  presence,
  onOpenTicket,
  onNewTicket,
  onQuickCreate,
  onRequestDelete,
  onBulkMove,
  onBulkDelete,
}: ListProps) {
  const { schema, index } = snapshot;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [quickAdd, setQuickAdd] = useState<{ status: string; title: string } | null>(null);
  const [menu, setMenu] = useState<{ ticket: IndexTicket; x: number; y: number } | null>(null);
  // Selection is carried by the seat surface, never a mark: hovering a row
  // (or having anything selected) swaps its status dot for a checkbox in
  // the same leading slot. Checking one toggles the row, shift-click on a
  // later checkbox extends from the last-toggled row (the anchor) through
  // the clicked row in visible order. Once checkbox mode is active
  // (anything selected), clicking or activating anywhere on a row does the
  // same toggle; only with nothing selected does it open the ticket.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  // Fields are owned per type now; the filter bar offers the union across
  // every type (deduplicated by name), matching the old flat-list behaviour.
  const filterableCustom = useMemo(() => {
    const seen = new Map<string, FieldDef>();
    for (const t of schema.types) {
      for (const f of t.fields) {
        if ((f.type === 'enum' || f.type === 'string') && f.name !== 'title' && !seen.has(f.name)) {
          seen.set(f.name, f);
        }
      }
    }
    return [...seen.values()];
  }, [schema.types]);

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

  const groups = schema.statuses.map((status) => ({
    status,
    tickets: visible
      .filter((t) => t.status === status.name)
      .sort((a, b) => a.id.localeCompare(b.id)),
  }));

  // The flattened visible row order, across group boundaries, that
  // shift-click ranges walk.
  const flatIds = groups.flatMap((g) => g.tickets.map((t) => t.id));

  // Shared by the checkbox and, once checkbox mode is active, the row
  // itself: a plain toggle adds or removes the ticket and moves the anchor
  // to it; a shift toggle extends the range from the anchor through the
  // clicked ticket in flatIds order without moving the anchor.
  const toggleSelect = (id: string, shiftKey: boolean) => {
    if (shiftKey) {
      const from = anchor ? flatIds.indexOf(anchor) : -1;
      const to = flatIds.indexOf(id);
      if (from === -1 || to === -1) {
        setSelected(new Set([id]));
      } else {
        const [start, end] = from <= to ? [from, to] : [to, from];
        setSelected(new Set(flatIds.slice(start, end + 1)));
      }
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  };

  const row = (ticket: IndexTicket) => {
    const hue = STATUS_HUE_CSS[statusHue(schema, ticket.status)];
    const isDone = schema.statuses.find((s) => s.name === ticket.status)?.agent === 'complete';
    const live = presence?.tickets.has(ticket.id) ?? false;
    const elapsed = live ? presence?.tickets.get(ticket.id) : undefined;
    const parentId = typeof ticket.fields.parent === 'string' ? ticket.fields.parent : null;
    const epicTitle = parentId
      ? (index.tickets.find((t) => t.id === parentId)?.title ?? parentId)
      : null;
    const priority = typeof ticket.fields.priority === 'string' ? ticket.fields.priority : null;
    const family = priority !== null ? priorityFamily(schema, priority) : null;
    const assignee = typeof ticket.fields.assignee === 'string' ? ticket.fields.assignee : null;
    const isSelected = selected.has(ticket.id);
    return (
      <div
        key={ticket.id}
        className={`list-row${isDone ? ' done' : ''}${live ? ' live' : ''}${isSelected ? ' selected' : ''}`}
        role="button"
        tabIndex={0}
        onPointerDown={punch}
        onPointerUp={release}
        onPointerLeave={release}
        onClick={(e) => {
          if (selected.size > 0) {
            toggleSelect(ticket.id, e.shiftKey);
          } else {
            onOpenTicket(ticket.id);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (selected.size > 0) {
              toggleSelect(ticket.id, e.shiftKey);
            } else {
              onOpenTicket(ticket.id);
            }
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ ticket, x: e.clientX, y: e.clientY });
        }}
      >
        {live && <LiveRing />}
        <span className="list-row-lead">
          <span
            className="priority-dot"
            style={{ background: hue }}
            title={statusLabel(schema.statuses.find((s) => s.name === ticket.status) ?? { name: ticket.status })}
          />
          <span className="hole-check list-row-check">
            <input
              type="checkbox"
              aria-label={`select ${ticket.id}`}
              checked={isSelected}
              onChange={() => {}}
              onClick={(e) => {
                // The row itself is, once checkbox mode is active, also a
                // toggle on click; the checkbox must not let this click
                // bubble to the row.
                e.stopPropagation();
                toggleSelect(ticket.id, e.shiftKey);
              }}
            />
            <span className="hole-mark" aria-hidden />
          </span>
        </span>
        <span className="list-row-title">{ticket.title}</span>
        <span className="list-row-meta">
          {epicTitle !== null && <span className="prio epic">{epicTitle}</span>}
          {!isDone && priority !== null && family !== null && (
            <span className={`prio ${family}`}>{titleCase(priority)}</span>
          )}
          {assignee !== null && <span className="list-assignee">@{assignee}</span>}
          <span className="list-updated num">{formatDateShort(ticket.updated)}</span>
          <span className={`id${live ? ' live' : ''}`}>
            {elapsed !== undefined ? `${formatElapsed(elapsed)} · ` : ''}
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
            options={schema.types.map((t) => ({ value: t.name, label: typeLabel(t) }))}
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
                options={(f.values ?? (f.values_from === 'priorities' ? schema.priorities : [])).map((v) => ({ value: v, label: titleCase(v) }))}
                onChange={(v) => setFilters({ ...filters, custom: { ...filters.custom, [f.name]: v } })}
              />
            ))}
          <button className="btn btn-primary" onClick={() => onNewTicket()}>
            <AddIcon />
            New ticket
          </button>
        </div>
      </header>
      <div className={`list-scroll${selected.size > 0 ? ' selecting' : ''}`}>
        {groups.map(({ status, tickets }) => (
          <section key={status.name} className="list-group">
            <header className="list-group-head">
              <span className="priority-dot" style={{ background: STATUS_HUE_CSS[statusHue(schema, status.name)] }} />
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
      <BulkActions
        selected={[...selected]}
        statuses={schema.statuses}
        index={index}
        onMove={(ids, status) => {
          setSelected(new Set());
          setAnchor(null);
          void onBulkMove(ids, status);
        }}
        onDelete={(ids) => {
          setSelected(new Set());
          setAnchor(null);
          void onBulkDelete(ids);
        }}
        onClear={() => {
          setSelected(new Set());
          setAnchor(null);
        }}
      />
    </>
  );
}
