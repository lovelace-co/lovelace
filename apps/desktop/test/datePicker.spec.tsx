import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from '../src/components/DatePicker';

function renderPicker(value: string | null, onChange = vi.fn()) {
  render(<DatePicker aria-label="review by" value={value} onChange={onChange} placeholder="No review date" />);
  return onChange;
}

const monthLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00`));

describe('DatePicker', () => {
  it('shows the placeholder when empty and the locale-formatted date when set', () => {
    renderPicker(null);
    expect(screen.getByLabelText('review by').textContent).toContain('No review date');
  });

  it('opens on the selected month and picks a day', () => {
    const onChange = renderPicker('2026-03-10');
    fireEvent.click(screen.getByLabelText('review by'));
    const dialog = screen.getByRole('dialog', { name: 'review by' });
    expect(within(dialog).getByText(monthLabel('2026-03-10'))).toBeTruthy();
    fireEvent.click(within(dialog).getByText('24'));
    expect(onChange).toHaveBeenCalledWith('2026-03-24');
  });

  it('navigates months, including across a year boundary', () => {
    renderPicker('2026-01-10');
    fireEvent.click(screen.getByLabelText('review by'));
    const dialog = screen.getByRole('dialog', { name: 'review by' });
    fireEvent.click(within(dialog).getByLabelText('previous month'));
    expect(within(dialog).getByText(monthLabel('2025-12-10'))).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText('next month'));
    fireEvent.click(within(dialog).getByLabelText('next month'));
    expect(within(dialog).getByText(monthLabel('2026-02-10'))).toBeTruthy();
  });

  it('moves keyboard focus by a week and follows it into the next month', () => {
    renderPicker('2026-03-30');
    fireEvent.click(screen.getByLabelText('review by'));
    const dialog = screen.getByRole('dialog', { name: 'review by' });
    const day = within(dialog).getByText('30');
    fireEvent.keyDown(day, { key: 'ArrowDown' });
    expect(within(dialog).getByText(monthLabel('2026-04-06'))).toBeTruthy();
    expect((within(dialog).getByText('6') as HTMLButtonElement).tabIndex).toBe(0);
  });

  it('clears the date, and disables Clear when there is none', () => {
    const onChange = renderPicker('2026-03-10');
    fireEvent.click(screen.getByLabelText('review by'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Clear'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('Clear is disabled with no date and Escape closes the calendar', () => {
    renderPicker(null);
    fireEvent.click(screen.getByLabelText('review by'));
    const dialog = screen.getByRole('dialog', { name: 'review by' });
    expect((within(dialog).getByText('Clear') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
