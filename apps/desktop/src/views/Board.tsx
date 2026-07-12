import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BulkActions } from '../components/BulkActions';
import { ContextMenu } from '../components/ContextMenu';
import { Dropdown } from '../components/Dropdown';
import { LiveRing } from '../components/LiveRing';
import { AddIcon, CaretIcon } from '../components/icons';
import { statusLabel, titleCase, typeLabel } from '../lib/format';
import { STATUS_HUE_CSS, priorityFamily, statusHue } from '../lib/loom';
import { punch, release } from '../lib/punch';
import { formatElapsed } from '../lib/presence';
import type { ProjectPresence } from '../state/store';
import type { FieldDef, IndexTicket, Snapshot } from '../lib/types';

interface BoardProps {
  snapshot: Snapshot;
  presence?: ProjectPresence;
  onOpenTicket: (id: string) => void;
  /**
   * A human drop: the target column and that column's full ordered ticket
   * ids (with the dragged card placed at its new position). When the column
   * differs from the card's current status, this also moves the ticket.
   */
  onReorder: (id: string, status: string, orderedIds: string[]) => void;
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

export function Board({
  snapshot,
  presence,
  onOpenTicket,
  onReorder,
  onNewTicket,
  onQuickCreate,
  onRequestDelete,
  onBulkMove,
  onBulkDelete,
}: BoardProps) {
  const { schema, index } = snapshot;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [dragging, setDragging] = useState<IndexTicket | null>(null);
  const [dropAt, setDropAt] = useState<{ status: string; index: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ status: string; title: string } | null>(null);
  const [menu, setMenu] = useState<{ ticket: IndexTicket; x: number; y: number } | null>(null);
  // Selection mirrors the List view: hovering a card (or having anything
  // selected) swaps its status dot for a checkbox in the same lead slot.
  // Checking one toggles the card, shift-click on a later checkbox extends
  // from the last-toggled card (the anchor) through the clicked card in
  // visible order (columns in schema order, cards in column order). Once
  // checkbox mode is active (anything selected), clicking anywhere on a
  // card does the same toggle; only with nothing selected does a click
  // open the ticket.
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

  // Any column is a drop target; the human owns the board. Cards within a
  // column follow the persisted board order, with anything unlisted (e.g. a
  // brand new ticket) falling back to the index order after the ordered ones.
  const cardsFor = (statusName: string): IndexTicket[] => {
    const order = snapshot.boardOrder?.[statusName] ?? [];
    return visible
      .filter((t) => t.status === statusName)
      .sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
  };

  // The flattened visible card order, across column boundaries, that
  // shift-click ranges walk: columns in schema order, cards in column order.
  const flatIds = schema.statuses.flatMap((status) => cardsFor(status.name).map((t) => t.id));

  // Shared by the checkbox and, once checkbox mode is active, the card body
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

  // The insertion point is the first card whose midpoint sits below the
  // pointer; past the last card it appends.
  const dropIndexAt = (section: HTMLElement, clientY: number): number => {
    const cardEls = Array.from(section.querySelectorAll<HTMLElement>('.board-cards .ticket-card'));
    for (let i = 0; i < cardEls.length; i += 1) {
      const rect = cardEls[i]!.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cardEls.length;
  };

  const commitDrop = (statusName: string) => {
    const dragged = dragging;
    const at = dropAt;
    setDropAt(null);
    setDragging(null);
    if (!dragged) return;
    const fullIds = cardsFor(statusName).map((t) => t.id);
    const lineIndex = at && at.status === statusName ? at.index : fullIds.length;
    const others = fullIds.filter((id) => id !== dragged.id);
    const draggedPos = fullIds.indexOf(dragged.id);
    const insertAt = draggedPos !== -1 && draggedPos < lineIndex ? lineIndex - 1 : lineIndex;
    const orderedIds = [...others.slice(0, insertAt), dragged.id, ...others.slice(insertAt)];
    const unchanged =
      dragged.status === statusName &&
      orderedIds.length === fullIds.length &&
      orderedIds.every((id, i) => id === fullIds[i]);
    if (unchanged) return; // dropped back into the same slot
    onReorder(dragged.id, statusName, orderedIds);
  };

  // Edge scroll affordances for anyone without horizontal scroll input.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const el = boardRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    updateEdges();
    el.addEventListener('scroll', updateEdges, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', updateEdges);
      observer.disconnect();
    };
  }, [updateEdges, schema.statuses.length]);

  const scrollByColumn = (direction: -1 | 1) => {
    const el = boardRef.current;
    if (!el) return;
    const cols = el.querySelectorAll<HTMLElement>('.board-column');
    let step = el.clientWidth * 0.75;
    if (cols.length >= 2) step = cols[1]!.offsetLeft - cols[0]!.offsetLeft;
    else if (cols.length === 1) step = cols[0]!.offsetWidth + 24;
    el.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Board</h1>
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
      <div className="board-scroll">
        {edges.left && (
          <button
            className="board-scroll-arrow left"
            aria-label="Scroll columns left"
            title="Scroll left"
            onClick={() => scrollByColumn(-1)}
          >
            <CaretIcon style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
        {edges.right && (
          <button
            className="board-scroll-arrow right"
            aria-label="Scroll columns right"
            title="Scroll right"
            onClick={() => scrollByColumn(1)}
          >
            <CaretIcon />
          </button>
        )}
        <div
          ref={boardRef}
          className={`board${selected.size > 0 ? ' selecting' : ''}`}
          style={{ gridTemplateColumns: `repeat(${schema.statuses.length}, minmax(298px, 1fr))` }}
        >
          {schema.statuses.map((status) => {
          const cards = cardsFor(status.name);
          const isTarget = dragging !== null && dropAt?.status === status.name;
          return (
            <section
              key={status.name}
              data-status={status.name}
              className={`board-column${isTarget ? ' drop-ok' : ''}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setDropAt({ status: status.name, index: dropIndexAt(e.currentTarget, e.clientY) });
              }}
              onDragLeave={(e) => {
                // relatedTarget is unreliable across engines (frequently
                // null when the pointer crosses from one card to a sibling
                // card rather than truly leaving the column), which cleared
                // the insertion line on every card boundary in a long
                // column such as Done. Ask the DOM what is actually under
                // the pointer at this position instead.
                const under = document.elementFromPoint(e.clientX, e.clientY);
                if (!(under && e.currentTarget.contains(under))) {
                  setDropAt((d) => (d?.status === status.name ? null : d));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                commitDrop(status.name);
              }}
            >
              <header className="board-column-header">
                <span className="label">{statusLabel(status)}</span>
                <span className="board-column-count">{cards.length}</span>
              </header>
              <div className="board-cards">
                {cards.map((ticket, cardIndex) => {
                  const live = presence?.tickets.has(ticket.id) ?? false;
                  const elapsed = live ? presence?.tickets.get(ticket.id) : undefined;
                  const hue = STATUS_HUE_CSS[statusHue(schema, ticket.status)];
                  const isDone = schema.statuses.find((s) => s.name === ticket.status)?.agent === 'complete';
                  const parentId = typeof ticket.fields.parent === 'string' ? ticket.fields.parent : null;
                  const epicTitle = parentId
                    ? (index.tickets.find((t) => t.id === parentId)?.title ?? parentId)
                    : null;
                  const priority = typeof ticket.fields.priority === 'string' ? ticket.fields.priority : null;
                  const family = priority !== null ? priorityFamily(schema, priority) : null;
                  const isSelected = selected.has(ticket.id);
                  return (
                    <Fragment key={ticket.id}>
                      {isTarget && dropAt.index === cardIndex && <div className="drop-line" />}
                    <article
                      className={`ticket-card${dragging?.id === ticket.id ? ' dragging' : ''}${live ? ' live' : ''}${isDone ? ' done-card' : ''}${isSelected ? ' selected' : ''}`}
                      draggable
                      tabIndex={0}
                      onPointerDown={punch}
                      onPointerUp={release}
                      onPointerLeave={release}
                      onDragStart={() => setDragging(ticket)}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropAt(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ ticket, x: e.clientX, y: e.clientY });
                      }}
                      onClick={(e) => {
                        if (selected.size > 0) {
                          toggleSelect(ticket.id, e.shiftKey);
                        } else {
                          onOpenTicket(ticket.id);
                        }
                      }}
                    >
                      {live && <LiveRing />}
                      <div className="ticket-card-top">
                        <span className="card-lead" draggable={false}>
                          <span className="priority-dot" style={{ background: hue }} title={statusLabel(status)} />
                          <span className="hole-check card-check">
                            <input
                              type="checkbox"
                              aria-label={`select ${ticket.id}`}
                              checked={isSelected}
                              onChange={() => {}}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                // The card itself is draggable and, once
                                // checkbox mode is active, also toggles on
                                // click; the checkbox must not let this
                                // click bubble or drag.
                                e.stopPropagation();
                                toggleSelect(ticket.id, e.shiftKey);
                              }}
                            />
                            <span className="hole-mark" aria-hidden />
                          </span>
                        </span>
                        <div className="ticket-card-title">{ticket.title}</div>
                      </div>
                      <div className="ticket-card-meta">
                        {epicTitle !== null && <span className="prio epic">{epicTitle}</span>}
                        {!isDone && priority !== null && family !== null && (
                          <span className={`prio ${family}`}>{titleCase(priority)}</span>
                        )}
                        <span className={`id${live ? ' live' : ''}`}>
                          {elapsed !== undefined ? `${formatElapsed(elapsed)} · ` : ''}
                          {ticket.id}
                        </span>
                      </div>
                    </article>
                    </Fragment>
                  );
                })}
                {isTarget && dropAt.index >= cards.length && <div className="drop-line" />}
                {quickAdd?.status === status.name ? (
                  <input
                    className="quick-add-input"
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
                      // Leave an empty composer; keep a draft if one is in progress.
                      if (quickAdd.title.trim() === '') setQuickAdd(null);
                    }}
                  />
                ) : (
                  <button
                    className="add-line"
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
              </div>
            </section>
          );
          })}
        </div>
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
