import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type ContextMenuItem } from '../src/components/ContextMenu';

function renderMenu(items: ContextMenuItem[], onClose = vi.fn()) {
  render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);
  return onClose;
}

describe('ContextMenu', () => {
  it('renders each item as a menuitem inside a menu, flagging danger items', () => {
    renderMenu([
      { label: 'Move to top', onSelect: vi.fn() },
      { label: 'Delete ticket', danger: true, onSelect: vi.fn() },
    ]);
    expect(screen.getByRole('menu')).toBeTruthy();
    const move = screen.getByRole('menuitem', { name: 'Move to top' });
    const del = screen.getByRole('menuitem', { name: 'Delete ticket' });
    expect(move.className).not.toContain('danger');
    expect(del.className).toContain('danger');
  });

  it('clicking an item calls onSelect then onClose', () => {
    const calls: string[] = [];
    const onSelect = vi.fn(() => calls.push('select'));
    const onClose = vi.fn(() => calls.push('close'));
    renderMenu([{ label: 'Delete ticket', danger: true, onSelect }], onClose);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete ticket' }));
    expect(calls).toEqual(['select', 'close']);
  });

  it('Escape calls onClose', () => {
    const onClose = renderMenu([{ label: 'Delete ticket', onSelect: vi.fn() }]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pointerdown outside the menu calls onClose', () => {
    const onClose = renderMenu([{ label: 'Delete ticket', onSelect: vi.fn() }]);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pointerdown inside the menu does not call onClose', () => {
    const onClose = renderMenu([{ label: 'Delete ticket', onSelect: vi.fn() }]);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Delete ticket' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
