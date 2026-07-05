import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../src/components/EmptyState';
import { List } from '../src/views/List';
import { Sessions } from '../src/views/Sessions';
import { Settings } from '../src/views/Settings';
import { ProjectView } from '../src/views/ProjectView';
import { HostProvider } from '../src/state/store';
import type { Snapshot } from '../src/lib/types';
import { FakeHost } from './fakeHost';
import fixture from './fixtures/snapshot.json';

const base = fixture as unknown as Snapshot;

describe('List view', () => {
  function renderList() {
    const onOpenTicket = vi.fn();
    const onRequestDelete = vi.fn();
    render(
      <List
        snapshot={base}
        onOpenTicket={onOpenTicket}
        onNewTicket={() => undefined}
        onQuickCreate={() => undefined}
        onRequestDelete={onRequestDelete}
      />,
    );
    return { onOpenTicket, onRequestDelete };
  }

  it('groups tickets by status and opens one on click', () => {
    const { onOpenTicket } = renderList();
    // Group headers use the status labels; tickets appear as rows.
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Forecast endpoint')).toBeTruthy();
    fireEvent.click(screen.getByText('Forecast endpoint'));
    expect(onOpenTicket).toHaveBeenCalledWith('T-0002');
  });

  it('filters by type', () => {
    renderList();
    fireEvent.click(screen.getByLabelText('filter type'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'filter type' })).getByText('Bug'));
    expect(screen.getByText('Wind gusts reported as negative values')).toBeTruthy();
    expect(screen.queryByText('Forecast endpoint')).toBeNull();
  });
});

describe('Settings view', () => {
  function renderSettings() {
    const props = {
      onSaveWorkflow: vi.fn().mockResolvedValue(undefined),
      onSaveAutomations: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onDirtyChange: vi.fn(),
    };
    render(<Settings snapshot={base} {...props} />);
    return props;
  }

  it('opens on General with the editable name and every tab present', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    for (const label of ['General', 'Statuses', 'Types & fields', 'Automations', 'Team', 'Integrations']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect((screen.getByLabelText('project name') as HTMLInputElement).value).toBe(base.manifest.name);
  });

  it('renames the project on blur', async () => {
    const props = renderSettings();
    const input = screen.getByLabelText('project name');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);
    await waitFor(() => expect(props.onRenameProject).toHaveBeenCalledWith('Renamed'));
  });

  it('saves a status rename through the shared workflow draft', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveWorkflow).toHaveBeenCalled());
    expect(props.onSaveWorkflow.mock.calls[0][0].renames.statuses).toMatchObject({ backlog: 'inbox' });
  });

  it('shares one draft and Save bar across Statuses and Types & fields', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 label'), { target: { value: 'Inbox' } });
    expect(screen.getByText('Save changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Types & fields' }));
    // The Save bar follows to the other workflow tab.
    expect(screen.getByText('Save changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    expect((screen.getByLabelText('status 0 label') as HTMLInputElement).value).toBe('Inbox');
  });

  it('adds a custom field on the Types & fields tab', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types & fields' }));
    fireEvent.click(screen.getByText('Add field'));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveWorkflow).toHaveBeenCalled());
    expect(props.onSaveWorkflow.mock.calls[0][0].fields.length).toBe(base.workflow.fields.length + 1);
  });

  it('creates an automation on the Automations tab', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Automations' }));
    expect(screen.getByText('On transition')).toBeTruthy();
    fireEvent.click(screen.getByText('New automation'));
    fireEvent.click(screen.getByLabelText('to status'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'to status' })).getByText('Staging'));
    fireEvent.change(screen.getByLabelText('instruction'), { target: { value: 'Deploy it.' } });
    fireEvent.click(screen.getByText('Create automation'));
    await waitFor(() => expect(props.onSaveAutomations).toHaveBeenCalled());
    const saved = props.onSaveAutomations.mock.calls[0][0];
    expect(saved[saved.length - 1]).toMatchObject({ when: { to: 'staging' }, agent: 'Deploy it.' });
  });

  it('adds a team actor and saves the actor list', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Team' }));
    fireEvent.click(screen.getByText('Add actor'));
    const i = base.actors.length; // the new row's index
    fireEvent.change(screen.getByLabelText(`actor ${i} name`), { target: { value: 'Robo' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveActors).toHaveBeenCalled());
    const saved = props.onSaveActors.mock.calls[0][0];
    expect(saved[saved.length - 1]).toMatchObject({ id: 'robo', name: 'Robo', kind: 'agent' });
  });

  it('installs the Claude Code integration', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Integrations' }));
    fireEvent.click(screen.getByText('Install Claude Code assets'));
    await waitFor(() => expect(props.onInstallClaude).toHaveBeenCalledWith(true));
  });

  it('reports its dirty state so navigation can be guarded', () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    expect(props.onDirtyChange).toHaveBeenCalledWith(true);
  });
});

describe('Empty states', () => {
  it('renders a note and hint with no decorative dots', () => {
    const { container } = render(<EmptyState note="No sessions yet" hint="They appear here." />);
    expect(screen.getByText('No sessions yet')).toBeTruthy();
    expect(screen.getByText('They appear here.')).toBeTruthy();
    // The punchcard-hole motif has been removed everywhere.
    expect(container.querySelectorAll('.hole, .punchrow').length).toBe(0);
  });

  it('Sessions and Problems use the same empty state when empty', () => {
    const empty = {
      ...base,
      index: { ...base.index, sessions: [] },
    } as Snapshot;
    render(
      <HostProvider host={new FakeHost()}>
        <Sessions snapshot={empty} onOpenTicket={vi.fn()} />
      </HostProvider>,
    );
    expect(screen.getByText('No sessions yet')).toBeTruthy();
    expect(document.querySelector('.empty-state')).toBeTruthy();
  });
});

describe('ProjectView sidebar', () => {
  it('shows the grouped nav and routes to the new destinations', async () => {
    render(
      <HostProvider host={new FakeHost()}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    // The board is the default destination.
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    // The regrouped nav: configuration now lives under one Settings home, and
    // Activity holds only the read-only Sessions and Runs.
    for (const label of ['Board', 'List', 'Documentation', 'Graph', 'Sessions', 'Runs', 'Problems', 'Settings', 'Search']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /^Workflow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Automations/ })).toBeNull();
    // Settings (now pinned in the footer) is the configuration home.
    fireEvent.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Automations' })).toBeTruthy();
    // Runs is the automation history; Problems is the validation review.
    fireEvent.click(screen.getByRole('button', { name: /^Runs/ }));
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Problems/ }));
    expect(screen.getByRole('heading', { name: 'Problems' })).toBeTruthy();
    // Graph routes to the documentation link graph.
    fireEvent.click(screen.getByRole('button', { name: /^Graph/ }));
    expect(screen.getByRole('heading', { name: 'Graph' })).toBeTruthy();
    expect(document.querySelector('.graph-canvas')).not.toBeNull();
  });

  it('prompts before leaving Settings with unsaved changes', async () => {
    render(
      <HostProvider host={new FakeHost()}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Settings/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    // Trying to leave raises the guard.
    fireEvent.click(screen.getByRole('button', { name: /^Board/ }));
    expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();
    // Keep editing stays on Settings.
    fireEvent.click(screen.getByText('Keep editing'));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    // Discarding leaves.
    fireEvent.click(screen.getByRole('button', { name: /^Board/ }));
    fireEvent.click(screen.getByText('Discard changes'));
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
  });

  it('opens the search palette from the sidebar', async () => {
    render(
      <HostProvider host={new FakeHost()}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Search/ }));
    expect(screen.getByLabelText('search query')).toBeTruthy();
  });

  it('pins Settings in the footer, not the main nav groups', async () => {
    render(
      <HostProvider host={new FakeHost()}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    // The old project-details button is gone (its facts live in Settings now).
    expect(screen.queryByRole('button', { name: 'Project details' })).toBeNull();
    // Settings lives in the footer bar.
    expect(document.querySelector('.nav-footer .footer-settings')).not.toBeNull();
  });
});
