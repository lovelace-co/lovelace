import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../src/components/Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById('toast-root')?.remove();
  });

  it('problems persist as alerts until dismissed', () => {
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss}>Something failed.</Toast>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Something failed.');
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('dismiss message'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('notices announce as status and dismiss themselves', () => {
    const onDismiss = vi.fn();
    render(
      <Toast kind="notice" onDismiss={onDismiss}>
        Files changed on disk.
      </Toast>,
    );
    expect(screen.getByRole('status').textContent).toContain('Files changed on disk.');
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
