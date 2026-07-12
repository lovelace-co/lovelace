import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from '../src/views/Board';
import { ProjectView } from '../src/views/ProjectView';
import { HostProvider } from '../src/state/store';
import type { Snapshot } from '../src/lib/types';
import { FakeHost } from './fakeHost';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;

function renderBoard(overrides: Partial<Parameters<typeof Board>[0]> = {}) {
  const onReorder = vi.fn();
  const onOpenTicket = vi.fn();
  const onBulkMove = vi.fn().mockResolvedValue(undefined);
  const onBulkDelete = vi.fn().mockResolvedValue(undefined);
  render(
    <Board
      snapshot={snapshot}
      onOpenTicket={onOpenTicket}
      onReorder={onReorder}
      onNewTicket={() => undefined}
      onQuickCreate={() => undefined}
      onRequestDelete={() => undefined}
      onBulkMove={onBulkMove}
      onBulkDelete={onBulkDelete}
      {...overrides}
    />,
  );
  return { onReorder, onOpenTicket, onBulkMove, onBulkDelete };
}

// The bulk bar's count shares digits with the column counts, so scope count
// assertions to the bar itself (matches the List view's test helper).
function bulkBar() {
  return document.querySelector('.bulk-bar') as HTMLElement;
}

// Each card's checkbox is labelled by ticket id.
function checkbox(id: string) {
  return screen.getByLabelText(`select ${id}`) as HTMLInputElement;
}

function boardRoot() {
  return document.querySelector('.board') as HTMLElement;
}

/** jsdom has no layout, so fake the board's scroll metrics. */
function setBoardMetrics(scrollWidth: number, clientWidth: number, scrollLeft: number) {
  const board = document.querySelector('.board') as HTMLElement;
  Object.defineProperty(board, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(board, 'clientWidth', { value: clientWidth, configurable: true });
  board.scrollLeft = scrollLeft;
  fireEvent.scroll(board);
  return board;
}

describe('Board edge scroll affordances', () => {
  it('shows no arrows when the board fits', () => {
    renderBoard();
    setBoardMetrics(800, 800, 0);
    expect(screen.queryByLabelText('Scroll columns left')).toBeNull();
    expect(screen.queryByLabelText('Scroll columns right')).toBeNull();
  });

  it('shows the right arrow when there is more board to the right', () => {
    renderBoard();
    setBoardMetrics(2000, 800, 0);
    expect(screen.getByLabelText('Scroll columns right')).toBeTruthy();
    expect(screen.queryByLabelText('Scroll columns left')).toBeNull();
  });

  it('shows the left arrow once scrolled, and hides the right at the end', () => {
    renderBoard();
    setBoardMetrics(2000, 800, 1200);
    expect(screen.getByLabelText('Scroll columns left')).toBeTruthy();
    expect(screen.queryByLabelText('Scroll columns right')).toBeNull();
  });

  it('scrolls by one column when an arrow is clicked', () => {
    renderBoard();
    const board = setBoardMetrics(2000, 800, 0);
    // Fake the first two columns' positions: a 272px column step.
    const cols = board.querySelectorAll('.board-column');
    Object.defineProperty(cols[0], 'offsetLeft', { value: 0, configurable: true });
    Object.defineProperty(cols[1], 'offsetLeft', { value: 272, configurable: true });
    board.scrollBy = vi.fn();
    fireEvent.click(screen.getByLabelText('Scroll columns right'));
    expect(board.scrollBy).toHaveBeenCalledWith({ left: 272, behavior: 'smooth' });
  });
});

describe('Board', () => {
  it('renders columns from schema.yaml in order with ticket cards', () => {
    renderBoard();
    // Column headers display Title-Cased labels derived from the machine name.
    const labels = Array.from(document.querySelectorAll('.board-column-header .label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']);
    expect(screen.getByText('Forecast endpoint')).toBeTruthy();
    expect(screen.getByText('T-0004')).toBeTruthy();
  });

  it('every other column is droppable; nothing is blocked', () => {
    renderBoard();
    const card = screen.getByText('Location search endpoint').closest('.ticket-card');
    fireEvent.dragStart(card!);
    expect(document.querySelector('.drop-blocked')).toBeNull();
    const done = document.querySelector('[data-status="done"]');
    fireEvent.dragOver(done!);
    expect(done?.className).toContain('drop-ok');
  });

  it('dropping on another column reorders the card into it', () => {
    const { onReorder } = renderBoard();
    const card = screen.getByText('Location search endpoint').closest('.ticket-card');
    // T-0003 is in todo; the human owns the board, and the drop carries the
    // target column order regardless of any status's role.
    fireEvent.dragStart(card!);
    const done = document.querySelector('[data-status="done"]');
    fireEvent.dragOver(done!);
    fireEvent.drop(done!);
    expect(onReorder).toHaveBeenCalledTimes(1);
    const [id, status, ids] = onReorder.mock.calls[0]!;
    expect(id).toBe('T-0003');
    expect(status).toBe('done');
    expect(ids).toContain('T-0003');
  });

  it('shows an insertion line in the column being dragged over', () => {
    renderBoard();
    const card = screen.getByText('Location search endpoint').closest('.ticket-card');
    fireEvent.dragStart(card!);
    const done = document.querySelector('[data-status="done"]');
    fireEvent.dragOver(done!);
    expect(done!.querySelector('.drop-line')).toBeTruthy();
  });

  it('filters by type, assignee and custom enum fields', () => {
    renderBoard();
    fireEvent.click(screen.getByLabelText('filter type'));
    // Option labels render in Title Case ("Bug"); the stored value stays "bug".
    fireEvent.click(within(screen.getByRole('listbox', { name: 'filter type' })).getByText('Bug'));
    expect(screen.queryByText('Forecast endpoint')).toBeNull();
    expect(screen.getByText('Wind gusts reported as negative values')).toBeTruthy();
    // environment is a user-defined enum field and appears as a filter automatically.
    fireEvent.click(screen.getByLabelText('filter environment'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'filter environment' })).getByText('Production'));
    expect(screen.queryByText('Wind gusts reported as negative values')).toBeNull();
  });

  it('opens a ticket on click', () => {
    const { onOpenTicket } = renderBoard();
    fireEvent.click(screen.getByText('Forecast endpoint'));
    expect(onOpenTicket).toHaveBeenCalledWith('T-0002');
  });

  it('quick-adds a ticket inline from a column without the modal', () => {
    const onQuickCreate = vi.fn();
    const onNewTicket = vi.fn();
    renderBoard({ onQuickCreate, onNewTicket });
    fireEvent.click(screen.getByLabelText('add ticket to todo'));
    const input = screen.getByLabelText('new ticket title in todo');
    fireEvent.change(input, { target: { value: 'Spike the parser' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQuickCreate).toHaveBeenCalledWith('todo', 'Spike the parser');
    // The full-modal path is never triggered by the inline composer.
    expect(onNewTicket).not.toHaveBeenCalled();
  });

  it('right-clicking a card opens a menu that requests deletion', () => {
    const onRequestDelete = vi.fn();
    renderBoard({ onRequestDelete });
    const card = screen.getByText('Forecast endpoint').closest('.ticket-card')!;
    fireEvent.contextMenu(card);
    const item = screen.getByRole('menuitem', { name: 'Delete ticket' });
    fireEvent.click(item);
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect((onRequestDelete.mock.calls[0]![0] as { id: string }).id).toBe('T-0002');
    // The menu closes after selection.
    expect(screen.queryByRole('menuitem', { name: 'Delete ticket' })).toBeNull();
  });

  it('checking a card selects it into a bulk bar and enters checkbox mode, without opening the ticket', () => {
    const { onOpenTicket } = renderBoard();
    // Every card renders a checkbox labelled by ticket id.
    expect(checkbox('T-0001')).toBeTruthy();

    fireEvent.click(checkbox('T-0003'));
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(checkbox('T-0003').closest('.ticket-card')?.classList.contains('selected')).toBe(true);
    expect(within(bulkBar()).getByText('1')).toBeTruthy();
    expect(within(bulkBar()).getByText('selected')).toBeTruthy();
    expect(boardRoot().classList.contains('selecting')).toBe(true);

    // Unticking the last selected checkbox drops the bulk bar and checkbox mode.
    fireEvent.click(checkbox('T-0003'));
    expect(screen.queryByText('selected')).toBeNull();
    expect(boardRoot().classList.contains('selecting')).toBe(false);
  });

  it('with a card checked, clicking another card body adds it to the selection instead of opening it', () => {
    const { onOpenTicket } = renderBoard();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(screen.getByText('Atomic cache writes'));
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(checkbox('T-0001').closest('.ticket-card')?.classList.contains('selected')).toBe(true);
    expect(within(bulkBar()).getByText('2')).toBeTruthy();
  });

  it('clicking a selected card body deselects it, and once empty a card click opens the ticket again', () => {
    const { onOpenTicket } = renderBoard();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(screen.getByText('Location search endpoint'));
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(checkbox('T-0003').closest('.ticket-card')?.classList.contains('selected')).toBe(false);
    expect(boardRoot().classList.contains('selecting')).toBe(false);

    fireEvent.click(screen.getByText('Location search endpoint'));
    expect(onOpenTicket).toHaveBeenCalledWith('T-0003');
  });

  it('shift-click on a checkbox extends the selection across columns in visible order', () => {
    renderBoard();
    // Visible order: Location search endpoint (todo), Public API v1 and
    // Forecast endpoint (in progress), Wind gusts... (in review), Atomic
    // cache writes (done).
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('T-0004'), { shiftKey: true });
    for (const id of ['T-0003', 'E-0001', 'T-0002', 'T-0004']) {
      expect(checkbox(id).closest('.ticket-card')?.classList.contains('selected')).toBe(true);
    }
    expect(checkbox('T-0001').closest('.ticket-card')?.classList.contains('selected')).toBe(false);
    expect(within(bulkBar()).getByText('4')).toBeTruthy();
  });

  it('shift-clicking a card body extends the selection across columns in visible order', () => {
    renderBoard();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(screen.getByText('Wind gusts reported as negative values'), { shiftKey: true });
    for (const id of ['T-0003', 'E-0001', 'T-0002', 'T-0004']) {
      expect(checkbox(id).closest('.ticket-card')?.classList.contains('selected')).toBe(true);
    }
    expect(checkbox('T-0001').closest('.ticket-card')?.classList.contains('selected')).toBe(false);
    expect(within(bulkBar()).getByText('4')).toBeTruthy();
  });

  it('choosing a status in the bulk bar moves the selection and clears it', () => {
    const { onBulkMove } = renderBoard();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('E-0001'));
    fireEvent.click(screen.getByLabelText('move to'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'move to' })).getByText('Done'));
    expect(onBulkMove).toHaveBeenCalledWith(['T-0003', 'E-0001'], 'done');
    expect(screen.queryByText('selected')).toBeNull();
  });

  it('bulk delete confirms before calling onBulkDelete', () => {
    const { onBulkDelete } = renderBoard();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('E-0001'));
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete 2 tickets?')).toBeTruthy();
    expect(onBulkDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete 2 tickets?')).toBeNull();
    expect(onBulkDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Delete tickets'));
    expect(onBulkDelete).toHaveBeenCalledWith(['T-0003', 'E-0001']);
    expect(screen.queryByText('selected')).toBeNull();
  });

  it('Escape clears the selection', () => {
    renderBoard();
    fireEvent.click(checkbox('T-0003'));
    expect(screen.getByText('selected')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('selected')).toBeNull();
    expect(checkbox('T-0003').closest('.ticket-card')?.classList.contains('selected')).toBe(false);
  });

  it('dragging still works once the checkbox has been added to the card', () => {
    const { onReorder } = renderBoard();
    const card = screen.getByText('Location search endpoint').closest('.ticket-card');
    fireEvent.dragStart(card!);
    const done = document.querySelector('[data-status="done"]');
    fireEvent.dragOver(done!);
    fireEvent.drop(done!);
    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it('marks the card of a lit ticket live and renders its live ring, leaving other cards untouched', () => {
    renderBoard({ presence: { awake: true, tickets: new Map([['T-0002', 42]]) } });
    const liveCard = screen.getByText('Forecast endpoint').closest('.ticket-card') as HTMLElement;
    expect(liveCard.classList.contains('live')).toBe(true);
    expect(liveCard.querySelector('.live-ring')).toBeTruthy();
    const otherCard = screen.getByText('Location search endpoint').closest('.ticket-card') as HTMLElement;
    expect(otherCard.classList.contains('live')).toBe(false);
    expect(otherCard.querySelector('.live-ring')).toBeNull();
  });
});

describe('deleting a ticket from the board', () => {
  async function openMenu(host: FakeHost) {
    render(
      <HostProvider host={host}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    fireEvent.contextMenu(screen.getByText('Forecast endpoint').closest('.ticket-card')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete ticket' }));
    await waitFor(() => expect(screen.getByText('Delete this ticket?')).toBeTruthy());
  }

  it('confirms with a destructive warning, then calls the host', async () => {
    const host = new FakeHost();
    await openMenu(host);
    expect(screen.getByText(/permanently deletes the ticket/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }));
    await waitFor(() => {
      const call = host.calls.find((c) => c.method === 'deleteTicket');
      expect(call).toBeDefined();
      expect(call?.args[1]).toBe('T-0002');
    });
  });

  it('cancelling the confirmation does not call the host', async () => {
    const host = new FakeHost();
    await openMenu(host);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(host.calls.some((c) => c.method === 'deleteTicket')).toBe(false);
    expect(screen.queryByText('Delete this ticket?')).toBeNull();
  });
});

describe('deleting a ticket from the detail view', () => {
  // The header icon button and the modal's confirm button share the
  // accessible name "Delete ticket" once both are on screen, so the modal's
  // button is looked up scoped to the modal itself.
  function modal() {
    return screen.getByText('Delete this ticket?').closest('.modal') as HTMLElement;
  }

  async function openDetailAndModal(host: FakeHost) {
    render(
      <HostProvider host={host}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    fireEvent.click(screen.getByText('Forecast endpoint'));
    await waitFor(() => expect(screen.getByLabelText('ticket title')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }));
    await waitFor(() => expect(screen.getByText('Delete this ticket?')).toBeTruthy());
  }

  it('confirms with the shared warning modal, calls the host and closes the detail view', async () => {
    const host = new FakeHost();
    await openDetailAndModal(host);
    fireEvent.click(within(modal()).getByRole('button', { name: 'Delete ticket' }));
    await waitFor(() => {
      const call = host.calls.find((c) => c.method === 'deleteTicket');
      expect(call).toBeDefined();
      expect(call?.args[1]).toBe('T-0002');
    });
    // The detail view has closed: no title input, and the board is visible again.
    expect(screen.queryByLabelText('ticket title')).toBeNull();
    expect(screen.getByText('Forecast endpoint')).toBeTruthy();
  });

  it('cancelling the confirmation does not call the host and leaves the detail view open', async () => {
    const host = new FakeHost();
    await openDetailAndModal(host);
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));
    expect(host.calls.some((c) => c.method === 'deleteTicket')).toBe(false);
    expect(screen.queryByText('Delete this ticket?')).toBeNull();
    expect(screen.getByLabelText('ticket title')).toBeTruthy();
  });
});
