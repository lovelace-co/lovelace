import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Actions } from '../src/views/Actions';
import { ProjectView } from '../src/views/ProjectView';
import { HostProvider } from '../src/state/store';
import type { Snapshot } from '../src/lib/types';
import { FakeHost } from './fakeHost';
import fixture from './fixtures/snapshot.json';

const base = fixture as unknown as Snapshot;

describe('Activity: automation history and dry run', () => {
  function renderActivity() {
    const host = new FakeHost();
    host.log = '--- 2026-06-10T11:00:00Z run in_review->staging T-0002 exit=0\n$ ./deploy.sh\nok';
    render(
      <HostProvider host={host}>
        <Actions snapshot={base} />
      </HostProvider>,
    );
    return { host };
  }

  it('shows the run history from actions.log', async () => {
    renderActivity();
    await waitFor(() => expect(screen.getByText(/exit=0/)).toBeTruthy());
  });

  it('dry-runs a transition, listing what would fire without executing it', async () => {
    const { host } = renderActivity();
    host.transitionRules = [{ when: { to: 'in_review' }, agent: 'Deploy it.' }];
    fireEvent.click(screen.getByLabelText('dry run ticket'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'dry run ticket' })).getByText(/T-0002/));
    fireEvent.click(screen.getByLabelText('dry run status'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'dry run status' })).getByText('In Review'));
    fireEvent.click(screen.getByText('What would fire?'));
    await waitFor(() => expect(screen.getByText(/Deploy it\./)).toBeTruthy());
    expect(host.calls.some((c) => c.method === 'updateTicket')).toBe(false);
  });
});

describe('deleting a ticket from the board', () => {
  async function openMenu(host: FakeHost) {
    render(
      <HostProvider host={host}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    fireEvent.contextMenu(screen.getByText('Forecast endpoint').closest('.ticket-card')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete ticket' }));
    await waitFor(() => expect(screen.getByText('Delete this ticket?')).toBeTruthy());
  }

  it('confirms with a destructive warning, then calls the host', async () => {
    const host = new FakeHost();
    await openMenu(host);
    expect(screen.getByText(/permanently deletes the ticket/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }));
    await waitFor(() => {
      const call = host.calls.find((c) => c.method === 'deleteTicket');
      expect(call).toBeDefined();
      expect(call?.args[1]).toBe('T-0002');
    });
  });

  it('cancelling the confirmation does not call the host', async () => {
    const host = new FakeHost();
    await openMenu(host);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(host.calls.some((c) => c.method === 'deleteTicket')).toBe(false);
    expect(screen.queryByText('Delete this ticket?')).toBeNull();
  });
});
