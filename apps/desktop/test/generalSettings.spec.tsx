import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneralSettings } from '../src/components/GeneralSettings';
import type { Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const base = fixture as unknown as Snapshot;

// Routed through a spy so each test can steer whether getVersion resolves or
// rejects, the same way update.spec.tsx keys its invoke spy off a mutable
// result.
const getVersionSpy = vi.fn();

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => getVersionSpy(),
}));

function renderGeneralSettings() {
  render(
    <GeneralSettings
      snapshot={base}
      onRename={vi.fn().mockResolvedValue(undefined)}
      onSavePresenceTimeout={vi.fn().mockResolvedValue(undefined)}
      onOpenProject={vi.fn()}
      onOpenTicket={vi.fn()}
    />,
  );
}

describe('GeneralSettings app version', () => {
  it('shows the running app version once getVersion resolves', async () => {
    getVersionSpy.mockResolvedValueOnce('1.2.3');
    renderGeneralSettings();

    expect(await screen.findByText('Lovelace 1.2.3')).toBeTruthy();
  });

  it('renders with no version line when getVersion rejects', async () => {
    getVersionSpy.mockRejectedValueOnce(new Error('not in a tauri webview'));
    renderGeneralSettings();

    expect(await screen.findByText('Report a bug')).toBeTruthy();
    // Give the rejected getVersion promise a turn to settle through its
    // .catch before asserting nothing rendered, so this actually exercises
    // the rejection path rather than passing on an unsettled promise.
    await waitFor(() => expect(getVersionSpy).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByText(/^Lovelace /)).toBeNull();
  });
});
