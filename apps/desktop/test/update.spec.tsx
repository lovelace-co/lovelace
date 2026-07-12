import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { HostProvider } from '../src/state/store';
import { FakeHost } from './fakeHost';

interface UpdateReadyEvent {
  payload: { version: string; notes: string | null };
}

type ReadyHandler = (event: UpdateReadyEvent) => void;

// App.tsx itself listens for its own macOS-menu events once the app shell is
// present, so the mock keys handlers by event name rather than assuming
// UpdatePill's is the only (or the last) `listen` call.
const listeners = new Map<string, ReadyHandler>();

// staged_update stands in for a window that either opened after an update
// was already staged, or whose listener registered after the event already
// fired; install_update is the restart trigger. Routing both through one
// spy, keyed by command, lets a test assert install_update was (or was not)
// called without staged_update's resolved value being mistaken for it.
let stagedUpdateResult: { version: string; notes: string | null } | null = null;
const invokeSpy = vi.fn((command: unknown, ..._rest: unknown[]) => {
  if (command === 'staged_update') return Promise.resolve(stagedUpdateResult);
  return Promise.resolve(undefined);
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, handler: ReadyHandler) => {
    listeners.set(event, handler);
    return Promise.resolve(() => undefined);
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: unknown, ...rest: unknown[]) => invokeSpy(command, ...rest),
}));

describe('UpdatePill', () => {
  // UpdatePill only listens (and asks) inside the app shell; stand in for it
  // the same way the real Tauri webview would set this global.
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    stagedUpdateResult = null;
    listeners.clear();
    invokeSpy.mockClear();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('stays hidden until an update is ready, then restarts on click', async () => {
    render(
      <HostProvider host={new FakeHost()}>
        <App />
      </HostProvider>,
    );

    expect(screen.queryByText('Update ready')).toBeNull();

    await waitFor(() => expect(listeners.has('lovelace://update-ready')).toBe(true));
    listeners.get('lovelace://update-ready')?.({ payload: { version: '9.9.9', notes: 'notes' } });

    const button = await screen.findByText('Update ready');
    expect(button.getAttribute('data-tip')).toBe('Restart to update to 9.9.9');
    expect(button.getAttribute('title')).toBe('notes');
    fireEvent.click(button);

    expect(screen.getByText('Restarting…')).toBeTruthy();
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledWith('install_update'));
  });

  it('shows the pill from a staged update alone, with no event fired', async () => {
    stagedUpdateResult = { version: '4.2.0', notes: null };

    render(
      <HostProvider host={new FakeHost()}>
        <App />
      </HostProvider>,
    );

    expect(await screen.findByText('Update ready')).toBeTruthy();
    expect(invokeSpy).toHaveBeenCalledWith('staged_update');
    expect(invokeSpy).not.toHaveBeenCalledWith('install_update');
  });
});
