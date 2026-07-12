import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Board } from '../src/views/Board';
import type { IndexTicket, Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const baseSnapshot = fixture as unknown as Snapshot;

// This jsdom has no window.DragEvent, so @testing-library's
// fireEvent.dragOver(el, { clientY }) silently drops clientY: createEvent()
// falls back to a plain Event, which has no such property, and dropIndexAt's
// `clientY < rect.top + rect.height / 2` is then always false, so it falls
// through to cards.length every time regardless of rects. That is the actual
// mechanism behind the existing "insertion line" tests passing vacuously
// (not only the zeroed getBoundingClientRect noted in the brief). Dispatch a
// real MouseEvent instead, which jsdom supports fully and which React's
// synthetic drag event reads clientY from just the same.
function dragOverAt(el: Element, clientY: number) {
  fireEvent(el, new MouseEvent('dragover', { clientY, bubbles: true, cancelable: true }));
}

// The real .board-cards layout: cards are CARD_HEIGHT tall, separated by the
// flex gap, and an in-flow .drop-line (if rendered) consumes its own height
// plus an extra gap on top of that (app.css: .drop-line height 2px, margin
// 1px 2px -> 4px total, .board-cards gap 8px -> 12px net shift for every
// card that follows the line once it lands in the layout).
const CARD_HEIGHT = 80;
const GAP = 8;
const LINE_HEIGHT = 4;
const STEP = CARD_HEIGHT + GAP;

/** The pointer position that selects `index` when no line is in the layout. */
function midOf(index: number): number {
  return index * STEP + CARD_HEIGHT / 2;
}

/**
 * jsdom performs no layout, so getBoundingClientRect() is always zero. This
 * stub fakes a real stacked, scrollable .board-cards column: cumulative flow
 * position for every .ticket-card and .drop-line child, offset by a fake
 * scrollTop, exactly as a real flex column with overflow-y: auto would
 * report through getBoundingClientRect (which returns true
 * viewport-relative coordinates for elements above or below the visible
 * scroll window too, not just what is currently painted).
 */
function stubBoardLayout(scrollTop = 0): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const isCard = this.classList.contains('ticket-card');
    const isLine = this.classList.contains('drop-line');
    const parent = this.parentElement;
    if ((isCard || isLine) && parent?.classList.contains('board-cards')) {
      let top = 0;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === this) break;
        top += (sibling.classList.contains('drop-line') ? LINE_HEIGHT : CARD_HEIGHT) + GAP;
      }
      top -= scrollTop;
      const height = isLine ? LINE_HEIGHT : CARD_HEIGHT;
      return {
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 280,
        width: 280,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      } as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** count of ticket-cards that precede the (single) rendered .drop-line, or -1 if absent. */
function dropLineIndex(section: Element): number {
  const cardsEl = section.querySelector('.board-cards')!;
  const children = Array.from(cardsEl.children);
  const lineIdx = children.findIndex((el) => el.classList.contains('drop-line'));
  if (lineIdx === -1) return -1;
  return children.slice(0, lineIdx).filter((el) => el.classList.contains('ticket-card')).length;
}

/** A snapshot whose done column has `count` tickets, long enough to scroll
 * (the real board-order.yaml carries ~90 done tickets; other columns have a
 * handful, per the ticket's own description of the bug). */
function longDoneSnapshot(count: number): Snapshot {
  const doneTickets: IndexTicket[] = Array.from({ length: count }, (_, i) => ({
    id: `T-9${String(i).padStart(3, '0')}`,
    type: 'task',
    status: 'done',
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    title: `Done ticket ${i}`,
    fields: { title: `Done ticket ${i}` },
    path: `.lovelace/tickets/T-9${String(i).padStart(3, '0')}.md`,
  }));
  return {
    ...baseSnapshot,
    index: {
      ...baseSnapshot.index,
      tickets: [...baseSnapshot.index.tickets.filter((t) => t.status !== 'done'), ...doneTickets],
    },
  };
}

function renderBoard(snapshot: Snapshot) {
  render(
    <Board
      snapshot={snapshot}
      onOpenTicket={() => undefined}
      onReorder={() => undefined}
      onNewTicket={() => undefined}
      onQuickCreate={() => undefined}
      onRequestDelete={() => undefined}
      onBulkMove={async () => undefined}
      onBulkDelete={async () => undefined}
    />,
  );
}

function startDrag() {
  const card = screen.getByText('Location search endpoint').closest('.ticket-card');
  fireEvent.dragStart(card!);
  return card!;
}

describe('Board drop-line positioning in a long, layout-faithful Done column', () => {
  let restoreLayout: (() => void) | null = null;

  afterEach(() => {
    restoreLayout?.();
    restoreLayout = null;
  });

  it('resolves the correct index before, between and after cards once real rects are in play', () => {
    const N = 30;
    renderBoard(longDoneSnapshot(N));
    restoreLayout = stubBoardLayout(0);
    const done = document.querySelector('[data-status="done"]')!;
    const card = startDrag();

    // Before the first card.
    dragOverAt(done, -50);
    expect(dropLineIndex(done)).toBe(0);

    // Reset so the next measurement starts from a line-free layout.
    fireEvent.dragEnd(card);
    fireEvent.dragStart(card);

    // Between card 9 and card 10.
    dragOverAt(done, midOf(9) + 5);
    expect(dropLineIndex(done)).toBe(10);

    fireEvent.dragEnd(card);
    fireEvent.dragStart(card);

    // Past the last card: appends.
    dragOverAt(done, midOf(N - 1) + 200);
    expect(dropLineIndex(done)).toBe(N);
  });

  it('does not oscillate: the resolved index is a stable fixed point once the in-flow line has shifted the cards below it', () => {
    const N = 30;
    renderBoard(longDoneSnapshot(N));
    restoreLayout = stubBoardLayout(0);
    const done = document.querySelector('[data-status="done"]')!;
    startDrag();

    // Land on a boundary the *unshifted* layout would place right at index 15,
    // the single pixel most likely to flip once the line's 12px shift lands.
    const boundaryY = midOf(15) - 1;
    dragOverAt(done, boundaryY);
    const first = dropLineIndex(done);

    // Fire several more dragOver events at the exact same clientY, now with
    // the line already in the layout (and shifting every following card).
    dragOverAt(done, boundaryY);
    const second = dropLineIndex(done);
    dragOverAt(done, boundaryY);
    const third = dropLineIndex(done);

    expect([first, second, third]).toEqual([first, first, first]);
  });

  it('resolves the correct index when the column is scrolled partway down', () => {
    const N = 30;
    renderBoard(longDoneSnapshot(N));
    // Scroll the equivalent of 10 cards' worth of content.
    const scrollTop = 10 * STEP;
    restoreLayout = stubBoardLayout(scrollTop);
    const done = document.querySelector('[data-status="done"]')!;
    startDrag();

    // Card 15 sits at viewport position midOf(15) - scrollTop once scrolled.
    dragOverAt(done, midOf(15) - scrollTop + 5);
    expect(dropLineIndex(done)).toBe(16);
  });
});

/**
 * The convicted mechanism: relatedTarget on dragleave is unreliable (this is
 * a documented WebKit characteristic, not just a jsdom artefact: WebKit's
 * clientX/clientY on drag events are also known to diverge from the spec).
 * When the pointer moves from one .ticket-card to a sibling .ticket-card
 * within the same column, the browser fires dragleave on the first card
 * bubbling up to the column's onDragLeave handler; if relatedTarget is
 * reported as null there (rather than the sibling card), the handler's
 * `e.currentTarget.contains(e.relatedTarget)` check reads false and clears
 * dropAt, hiding the insertion line, even though the pointer never left the
 * column. A long column such as Done, where reordering crosses dozens of
 * card boundaries per drag, hits this on almost every pointer movement;
 * short columns rarely cross a single card boundary before the drop, so the
 * same defect is nearly invisible there. This is reproducible in jsdom by
 * dispatching a dragleave with relatedTarget: null directly, matching the
 * reported real-world behaviour.
 */
function stubElementFromPoint(returns: Element | null): () => void {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => returns;
  return () => {
    document.elementFromPoint = original;
  };
}

describe('Board drop-line survives crossing card boundaries within a column', () => {
  it('a dragleave with an unreported relatedTarget keeps the line when the pointer is still over a sibling card', () => {
    renderBoard(longDoneSnapshot(30));
    const done = document.querySelector('[data-status="done"]')!;
    startDrag();
    dragOverAt(done, 0);
    expect(done.querySelector('.drop-line')).toBeTruthy();

    const cards = done.querySelectorAll('.board-cards .ticket-card');
    const [firstCard, secondCard] = [cards[0]!, cards[1]!];
    // The pointer is still logically over the next card in the column; only
    // relatedTarget failed to report it.
    const restore = stubElementFromPoint(secondCard);
    fireEvent(
      firstCard,
      new MouseEvent('dragleave', { relatedTarget: null, bubbles: true, cancelable: true } as MouseEventInit),
    );
    restore();

    expect(done.querySelector('.drop-line')).toBeTruthy();
  });

  it('a dragleave that truly exits the column still clears the line', () => {
    renderBoard(longDoneSnapshot(30));
    const done = document.querySelector('[data-status="done"]')!;
    startDrag();
    dragOverAt(done, 0);
    expect(done.querySelector('.drop-line')).toBeTruthy();

    const firstCard = done.querySelectorAll('.board-cards .ticket-card')[0]!;
    // The pointer has genuinely left the column onto unrelated chrome.
    const restore = stubElementFromPoint(document.body);
    fireEvent(
      firstCard,
      new MouseEvent('dragleave', { relatedTarget: null, bubbles: true, cancelable: true } as MouseEventInit),
    );
    restore();

    expect(done.querySelector('.drop-line')).toBeNull();
  });
});
