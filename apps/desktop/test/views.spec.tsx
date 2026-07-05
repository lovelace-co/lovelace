import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Automations } from '../src/views/Automations';
import { EmptyState } from '../src/components/EmptyState';
import { List } from '../src/views/List';
import { Sessions } from '../src/views/Sessions';
import { Workflow } from '../src/views/Workflow';
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

describe('Automations view', () => {
  function renderAutomations() {
    const host = new FakeHost();
    host.log = '--- 2026-06-10T11:00:00Z in_review->staging T-0002 exit=0\nok';
    const onSaveAutomations = vi.fn().mockResolvedValue(undefined);
    render(
      <HostProvider host={host}>
        <Automations snapshot={base} onSaveAutomations={onSaveAutomations} />
      </HostProvider>,
    );
    return { host, onSaveAutomations };
  }

  it('shows the on_transition rules, with the transition map moved to Workflow', () => {
    renderAutomations();
    expect(screen.getByText('On transition')).toBeTruthy();
    expect(screen.queryByText('Transitions')).toBeNull(); // now lives in the Workflow view
    // The fixture's two rules: an agent deploy and a run on done.
    expect(screen.getByText(/Deploy the current branch/)).toBeTruthy();
    expect(screen.getByText('./scripts/archive-artifacts.sh')).toBeTruthy();
  });

  it('switches to Activity and surfaces the run history', async () => {
    renderAutomations();
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    await waitFor(() => expect(screen.getByText(/exit=0/)).toBeTruthy());
    expect(screen.getByText('Dry run')).toBeTruthy();
  });

  it('creates a new automation through the form', async () => {
    const { onSaveAutomations } = renderAutomations();
    fireEvent.click(screen.getByText('New automation'));
    // Pick the target status.
    fireEvent.click(screen.getByLabelText('to status'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'to status' })).getByText('Staging'));
    // Agent is the default action kind; type an instruction.
    fireEvent.change(screen.getByLabelText('instruction'), { target: { value: 'Deploy it.' } });
    fireEvent.click(screen.getByText('Create automation'));
    await waitFor(() => expect(onSaveAutomations).toHaveBeenCalled());
    const saved = onSaveAutomations.mock.calls[0][0];
    expect(saved).toHaveLength(base.workflow.on_transition.length + 1);
    expect(saved[saved.length - 1]).toMatchObject({ when: { to: 'staging' }, agent: 'Deploy it.' });
  });

  it('deletes an automation after confirming', async () => {
    const { onSaveAutomations } = renderAutomations();
    fireEvent.click(screen.getAllByText('Delete')[0]);
    expect(screen.getByText('Delete this automation?')).toBeTruthy();
    fireEvent.click(screen.getByText('Delete automation'));
    await waitFor(() => expect(onSaveAutomations).toHaveBeenCalled());
    expect(onSaveAutomations.mock.calls[0][0]).toHaveLength(base.workflow.on_transition.length - 1);
  });
});

describe('Workflow view', () => {
  function renderWorkflow() {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Workflow snapshot={base} onSave={onSave} />);
    return { onSave };
  }

  it('opens on the Statuses tab with editable, seeded rows and no Save bar', () => {
    renderWorkflow();
    expect(screen.getByRole('heading', { name: 'Workflow' })).toBeTruthy();
    for (const label of ['Statuses', 'Transitions', 'Types', 'Priorities', 'Fields']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: 'Statuses' }).getAttribute('aria-selected')).toBe('true');
    // Rows are seeded, editable inputs, not static text.
    expect((screen.getByLabelText('status 0 machine') as HTMLInputElement).value).toBe('backlog');
    // Nothing has changed, so there is no Save bar yet.
    expect(screen.queryByText('Save changes')).toBeNull();
  });

  it('sends a rename map when a status machine name is changed', async () => {
    const { onSave } = renderWorkflow();
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const edit = onSave.mock.calls[0]![0];
    expect(edit.renames.statuses).toMatchObject({ backlog: 'inbox' });
    expect(edit.statuses[0].name).toBe('inbox');
    // Transitions follow the rename, so nothing dangles.
    expect(edit.transitions.every((t: { from: string; to: string[] }) => t.from !== 'backlog')).toBe(true);
  });

  it('toggling a transition target on the Transitions tab updates the saved graph', async () => {
    const { onSave } = renderWorkflow();
    fireEvent.click(screen.getByRole('tab', { name: 'Transitions' }));
    const chip = screen.getByLabelText('backlog to todo');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const edit = onSave.mock.calls[0]![0];
    const backlog = edit.transitions.find((t: { from: string }) => t.from === 'backlog');
    expect(backlog?.to ?? []).not.toContain('todo');
  });

  it('adds a custom field on the Fields tab and includes it in the save', async () => {
    const { onSave } = renderWorkflow();
    fireEvent.click(screen.getByRole('tab', { name: 'Fields' }));
    fireEvent.click(screen.getByText('Add field'));
    const before = base.workflow.fields.length;
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].fields.length).toBe(before + 1);
  });

  it('keeps edits when switching tabs, and the Save bar spans them', () => {
    renderWorkflow();
    // Edit on Statuses, then move to Transitions; the change must persist.
    fireEvent.change(screen.getByLabelText('status 0 label'), { target: { value: 'Inbox' } });
    expect(screen.getByText('Save changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Transitions' }));
    expect(screen.getByText('Save changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    expect((screen.getByLabelText('status 0 label') as HTMLInputElement).value).toBe('Inbox');
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
    // The regrouped, renamed nav is present.
    for (const label of ['Board', 'List', 'Documentation', 'Graph', 'Sessions', 'Workflow', 'Automations', 'Search']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    // Workflow routes to the state machine; Automations to just the rules.
    fireEvent.click(screen.getByRole('button', { name: /^Workflow/ }));
    expect(screen.getByRole('heading', { name: 'Workflow' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Automations/ }));
    expect(screen.getByText('On transition')).toBeTruthy();
    // Graph routes to the documentation link graph.
    fireEvent.click(screen.getByRole('button', { name: /^Graph/ }));
    expect(screen.getByRole('heading', { name: 'Graph' })).toBeTruthy();
    expect(document.querySelector('.graph-canvas')).not.toBeNull();
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

  it('opens the project info card with the path and project details', async () => {
    render(
      <HostProvider host={new FakeHost()}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Project details' }));
    expect(screen.getByRole('dialog', { name: 'project details' })).toBeTruthy();
    // The project directory, moved out of the header, is shown in full here.
    expect(screen.getByText('/fake')).toBeTruthy();
    expect(screen.getByText('demo4f2a')).toBeTruthy();
  });
});
