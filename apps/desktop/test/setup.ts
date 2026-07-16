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

// jsdom implements Element.getBoundingClientRect but not Range.getBoundingClientRect;
// Lexical calls the latter when scrolling a collapsed selection into view, which a
// focused, selection-carrying editor can trigger on any commit.
if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function () {
    return new DOMRect(0, 0, 0, 0);
  };
}

afterEach(() => {
  cleanup();
  // Tabs and recents persist to localStorage; clear it so each test starts
  // from a clean session.
  localStorage.clear();
});
