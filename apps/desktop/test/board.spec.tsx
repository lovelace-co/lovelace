import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from '../src/views/Board';
import { legalTargets } from '../src/lib/types';
import type { Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;

function renderBoard(overrides: Partial<Parameters<typeof Board>[0]> = {}) {
  const onReorder = vi.fn();
  const onOpenTicket = vi.fn();
  render(
    <Board
      snapshot={snapshot}
      onOpenTicket={onOpenTicket}
      onReorder={onReorder}
      onNewTicket={() => undefined}
      onQuickCreate={() => undefined}
      onRequestDelete={() => undefined}
      {...overrides}
    />,
  );
  return { onReorder, onOpenTicket };
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
  it('renders columns from workflow.yaml in order with ticket cards', () => {
    renderBoard();
    // Column headers display Title-Cased labels derived from the machine name.
    const labels = Array.from(document.querySelectorAll('.board-column-header .label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'In Review',
      'Staging',
      'Done',
      'Cancelled',
    ]);
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
    // T-0003 is in todo; done was never a legal workflow move, but the
    // human owns the board, and the drop carries the target column order.
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
});

describe('legalTargets', () => {
  it('derives drop targets from workflow transitions', () => {
    const targets = legalTargets(snapshot.workflow, 'in_review');
    expect(targets.has('staging')).toBe(true);
    expect(targets.has('in_progress')).toBe(true);
    expect(targets.has('done')).toBe(false);
  });
});
