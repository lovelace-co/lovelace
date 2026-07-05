import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no ResizeObserver; the board's edge-scroll affordances use one.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

afterEach(() => {
  cleanup();
  // Tabs and recents persist to localStorage; clear it so each test starts
  // from a clean session.
  localStorage.clear();
});
