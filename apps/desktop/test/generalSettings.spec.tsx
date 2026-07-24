import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettings } from '../src/components/GeneralSettings';
import type { CliInstall, CliStatus } from '../src/lib/cli';
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

// The command line tests below don't care about the app version line; give
// getVersion a resolved default so its own effect doesn't throw when a test
// hasn't set an explicit once-off value.
beforeEach(() => {
  getVersionSpy.mockReset();
  getVersionSpy.mockResolvedValue('0.0.0');
});

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

// The Command line section only renders outside the Tauri shell when its
// three functions are injected via props (jsdom has no __TAURI_INTERNALS__),
// which is also what lets these tests substitute fakes for the real
// lib/cli.ts implementations.
function renderWithCli(opts: {
  onCliStatus: () => Promise<CliStatus>;
  onCliInstall?: () => Promise<CliInstall>;
  onCliUninstall?: () => Promise<void>;
}) {
  render(
    <GeneralSettings
      snapshot={base}
      onRename={vi.fn().mockResolvedValue(undefined)}
      onSavePresenceTimeout={vi.fn().mockResolvedValue(undefined)}
      onOpenProject={vi.fn()}
      onOpenTicket={vi.fn()}
      onCliStatus={opts.onCliStatus}
      onCliInstall={opts.onCliInstall ?? vi.fn().mockRejectedValue(new Error('onCliInstall not stubbed'))}
      onCliUninstall={opts.onCliUninstall ?? vi.fn().mockRejectedValue(new Error('onCliUninstall not stubbed'))}
    />,
  );
}

const notInstalled: CliStatus = { installed: false, location: null, onPath: false, current: false };
const installed: CliStatus = {
  installed: true,
  location: '/usr/local/bin/lovelace',
  onPath: true,
  current: true,
};
const staleInstalled: CliStatus = {
  installed: true,
  location: '/usr/local/bin/lovelace',
  onPath: true,
  current: false,
};

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

describe('GeneralSettings command line', () => {
  it('not installed: renders the install button, installs on click, and shows the returned location', async () => {
    const onCliStatus = vi.fn().mockResolvedValue(notInstalled);
    const onCliInstall = vi
      .fn()
      .mockResolvedValue({ location: '/usr/local/bin/lovelace', note: null } satisfies CliInstall);
    renderWithCli({ onCliStatus, onCliInstall });

    const button = await screen.findByText("Install 'lovelace' command in PATH");
    fireEvent.click(button);

    expect(await screen.findByText((text) => text.includes('/usr/local/bin/lovelace'))).toBeTruthy();
    expect(onCliInstall).toHaveBeenCalledTimes(1);
  });

  it('installed: shows the location and remove button, removes on click, then shows not-installed', async () => {
    let current = installed;
    const onCliStatus = vi.fn(() => Promise.resolve(current));
    const onCliUninstall = vi.fn().mockImplementation(() => {
      current = notInstalled;
      return Promise.resolve();
    });
    renderWithCli({ onCliStatus, onCliUninstall });

    await screen.findByText("Remove 'lovelace' command from PATH");
    expect(screen.getByTestId('cli-status-summary').textContent).toContain('/usr/local/bin/lovelace');

    fireEvent.click(screen.getByText("Remove 'lovelace' command from PATH"));

    expect(await screen.findByText("Install 'lovelace' command in PATH")).toBeTruthy();
    expect(onCliUninstall).toHaveBeenCalledTimes(1);
  });

  it('stale: shows reinstall wording when the installed launcher is not current', async () => {
    const onCliStatus = vi.fn().mockResolvedValue(staleInstalled);
    renderWithCli({ onCliStatus });

    expect(await screen.findByText("Reinstall 'lovelace' command in PATH")).toBeTruthy();
    expect(screen.getByText('The installed command points at an old location.')).toBeTruthy();
  });

  it('install rejection renders the error inline without throwing', async () => {
    const onCliStatus = vi.fn().mockResolvedValue(notInstalled);
    const onCliInstall = vi.fn().mockRejectedValue(new Error('the fallback directory could not be created'));
    renderWithCli({ onCliStatus, onCliInstall });

    const button = await screen.findByText("Install 'lovelace' command in PATH");
    fireEvent.click(button);

    expect(await screen.findByText('the fallback directory could not be created')).toBeTruthy();
    // Still resting in the not-installed state; the rejection did not throw
    // out of the click handler.
    expect(screen.getByText("Install 'lovelace' command in PATH")).toBeTruthy();
  });
});
