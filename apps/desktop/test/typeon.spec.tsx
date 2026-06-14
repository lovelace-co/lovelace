import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypeOn } from '../src/components/TypeOn';

describe('TypeOn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reveals the text progressively and removes the caret at the end', async () => {
    const { container } = render(<TypeOn text="hello agent" speed={40} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    const partialLength = (container.textContent ?? '').length;
    expect(partialLength).toBeGreaterThan(0);
    expect(partialLength).toBeLessThan('hello agent'.length);
    expect(container.querySelector('.type-caret')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText('hello agent')).toBeTruthy();
    expect(container.querySelector('.type-caret')).toBeNull();
  });

  it('renders instantly when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<TypeOn text="all at once" />);
    expect(screen.getByText('all at once')).toBeTruthy();
    expect(document.querySelector('.type-caret')).toBeNull();
  });
});
