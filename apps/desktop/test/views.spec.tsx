import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../src/components/EmptyState';
import { SessionsModal } from '../src/components/SessionsModal';
import { ProblemsModal } from '../src/components/ProblemsModal';
import { List } from '../src/views/List';
import { Settings } from '../src/views/Settings';
import { ProjectView } from '../src/views/ProjectView';
import { HostProvider } from '../src/state/store';
import type { Snapshot } from '../src/lib/types';
import { FakeHost } from './fakeHost';
import fixture from './fixtures/snapshot.json';

const base = fixture as unknown as Snapshot;

describe('List view', () => {
  function renderList(overrides: Partial<Parameters<typeof List>[0]> = {}) {
    const onOpenTicket = vi.fn();
    const onRequestDelete = vi.fn();
    const onBulkMove = vi.fn().mockResolvedValue(undefined);
    const onBulkDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <List
        snapshot={base}
        onOpenTicket={onOpenTicket}
        onNewTicket={() => undefined}
        onQuickCreate={() => undefined}
        onRequestDelete={onRequestDelete}
        onBulkMove={onBulkMove}
        onBulkDelete={onBulkDelete}
        {...overrides}
      />,
    );
    return { onOpenTicket, onRequestDelete, onBulkMove, onBulkDelete };
  }

  // The bulk bar's count shares digits with the status group counts, so
  // scope count assertions to the bar itself.
  function bulkBar() {
    return document.querySelector('.bulk-bar') as HTMLElement;
  }

  // Each row's checkbox is labelled by ticket id, which sidesteps the
  // ambiguity of E-0001's title ("Public API v1") also appearing as the
  // epic tag on its children's rows.
  function checkbox(id: string) {
    return screen.getByLabelText(`select ${id}`) as HTMLInputElement;
  }

  function listScroll() {
    return document.querySelector('.list-scroll') as HTMLElement;
  }

  it('renders a group for every status, empty ones included, with a quick-add in each', () => {
    renderList();
    for (const label of ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']) {
      expect(screen.getByRole('heading', { name: label })).toBeTruthy();
    }
    const backlogGroup = screen.getByRole('heading', { name: 'Backlog' }).closest('.list-group') as HTMLElement;
    expect(within(backlogGroup).getByText('0')).toBeTruthy();
    expect(screen.getByLabelText('add ticket to backlog')).toBeTruthy();
  });

  it('quick-adds a ticket in an empty status group', () => {
    const onQuickCreate = vi.fn();
    renderList({ onQuickCreate });
    fireEvent.click(screen.getByLabelText('add ticket to backlog'));
    const input = screen.getByLabelText('new ticket title in backlog');
    fireEvent.change(input, { target: { value: 'Spike the parser' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQuickCreate).toHaveBeenCalledWith('backlog', 'Spike the parser');
  });

  it('groups tickets by status and opens one on click', () => {
    const { onOpenTicket } = renderList();
    // Group headers use the status labels; tickets appear as rows.
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Forecast endpoint')).toBeTruthy();
    fireEvent.click(screen.getByText('Forecast endpoint'));
    expect(onOpenTicket).toHaveBeenCalledWith('T-0002');
  });

  it('marks the row of a lit ticket live, leaving other rows untouched', () => {
    renderList({ presence: { awake: true, tickets: new Map([['T-0002', 42]]) } });
    const liveRow = checkbox('T-0002').closest('.list-row') as HTMLElement;
    expect(liveRow.classList.contains('live')).toBe(true);
    expect(liveRow.querySelector('.live-ring')).toBeTruthy();
    for (const id of ['T-0001', 'T-0003', 'T-0004', 'E-0001']) {
      const row = checkbox(id).closest('.list-row') as HTMLElement;
      expect(row.classList.contains('live')).toBe(false);
      expect(row.querySelector('.live-ring')).toBeNull();
    }
  });

  it('filters by type', () => {
    renderList();
    fireEvent.click(screen.getByLabelText('filter type'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'filter type' })).getByText('Bug'));
    expect(screen.getByText('Wind gusts reported as negative values')).toBeTruthy();
    expect(screen.queryByText('Forecast endpoint')).toBeNull();
  });

  it('checking a row selects it into a bulk bar and enters checkbox mode, without opening the ticket', () => {
    const { onOpenTicket } = renderList();
    // Every row renders a checkbox labelled by ticket id.
    expect(checkbox('T-0001')).toBeTruthy();

    fireEvent.click(checkbox('T-0003'));
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(checkbox('T-0003').closest('.list-row')?.classList.contains('selected')).toBe(true);
    expect(within(bulkBar()).getByText('1')).toBeTruthy();
    expect(within(bulkBar()).getByText('selected')).toBeTruthy();
    expect(listScroll().classList.contains('selecting')).toBe(true);

    // Unticking the last selected checkbox drops the bulk bar and checkbox mode.
    fireEvent.click(checkbox('T-0003'));
    expect(screen.queryByText('selected')).toBeNull();
    expect(listScroll().classList.contains('selecting')).toBe(false);
  });

  it('with a row checked, clicking another row body adds it to the selection instead of opening it', () => {
    const { onOpenTicket } = renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(screen.getByText('Atomic cache writes'));
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(checkbox('T-0001').closest('.list-row')?.classList.contains('selected')).toBe(true);
    expect(within(bulkBar()).getByText('2')).toBeTruthy();
  });

  it('clicking a selected row body deselects it, and once empty a row click opens the ticket again', () => {
    const { onOpenTicket } = renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(screen.getByText('Location search endpoint'));
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(checkbox('T-0003').closest('.list-row')?.classList.contains('selected')).toBe(false);
    expect(listScroll().classList.contains('selecting')).toBe(false);

    fireEvent.click(screen.getByText('Location search endpoint'));
    expect(onOpenTicket).toHaveBeenCalledWith('T-0003');
  });

  it('shift-click on a checkbox extends the selection across a range in visible order', () => {
    renderList();
    // Visible order: Location search endpoint, Public API v1, Forecast
    // endpoint, Wind gusts..., Atomic cache writes.
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('T-0004'), { shiftKey: true });
    for (const id of ['T-0003', 'E-0001', 'T-0002', 'T-0004']) {
      expect(checkbox(id).closest('.list-row')?.classList.contains('selected')).toBe(true);
    }
    expect(checkbox('T-0001').closest('.list-row')?.classList.contains('selected')).toBe(false);
    expect(within(bulkBar()).getByText('4')).toBeTruthy();
  });

  it('shift-clicking a row body extends the selection across a range in visible order', () => {
    renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(screen.getByText('Wind gusts reported as negative values'), { shiftKey: true });
    for (const id of ['T-0003', 'E-0001', 'T-0002', 'T-0004']) {
      expect(checkbox(id).closest('.list-row')?.classList.contains('selected')).toBe(true);
    }
    expect(checkbox('T-0001').closest('.list-row')?.classList.contains('selected')).toBe(false);
    expect(within(bulkBar()).getByText('4')).toBeTruthy();
  });

  it('with a row selected, pressing Enter on another row toggles it instead of opening the ticket', () => {
    const { onOpenTicket } = renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.keyDown(screen.getByText('Atomic cache writes').closest('.list-row')!, { key: 'Enter' });
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(checkbox('T-0001').closest('.list-row')?.classList.contains('selected')).toBe(true);
    expect(within(bulkBar()).getByText('2')).toBeTruthy();
  });

  it('choosing a status in the bulk bar moves the selection and clears it', () => {
    const { onBulkMove } = renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('E-0001'));
    fireEvent.click(screen.getByLabelText('move to'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'move to' })).getByText('Done'));
    expect(onBulkMove).toHaveBeenCalledWith(['T-0003', 'E-0001'], 'done');
    expect(screen.queryByText('selected')).toBeNull();
  });

  it('Copy Ticket IDs writes a comma-separated list to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('E-0001'));
    fireEvent.click(screen.getByText('Copy Ticket IDs'));
    expect(writeText).toHaveBeenCalledWith('T-0003, E-0001');
    // The button acknowledges, and the selection stays for further actions.
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(within(bulkBar()).getByText('2')).toBeTruthy();
  });

  it('bulk delete confirms before calling onBulkDelete', () => {
    const { onBulkDelete } = renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('E-0001'));
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete 2 tickets?')).toBeTruthy();
    expect(onBulkDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete 2 tickets?')).toBeNull();
    expect(onBulkDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Delete tickets'));
    expect(onBulkDelete).toHaveBeenCalledWith(['T-0003', 'E-0001']);
    expect(screen.queryByText('selected')).toBeNull();
  });

  it('Escape clears the selection', () => {
    renderList();
    fireEvent.click(checkbox('T-0003'));
    expect(screen.getByText('selected')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('selected')).toBeNull();
    expect(checkbox('T-0003').closest('.list-row')?.classList.contains('selected')).toBe(false);
  });

  it('Escape closes the delete modal first, keeping the selection', () => {
    const { onBulkDelete } = renderList();
    fireEvent.click(checkbox('T-0003'));
    fireEvent.click(checkbox('E-0001'));
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete 2 tickets?')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Delete 2 tickets?')).toBeNull();
    expect(onBulkDelete).not.toHaveBeenCalled();
    expect(within(bulkBar()).getByText('2')).toBeTruthy();
  });
});

describe('Settings view', () => {
  function renderSettings(claudeStatus?: { installed: boolean; mcp?: boolean; hooks?: boolean; commands?: boolean }) {
    const status = {
      installed: claudeStatus?.installed ?? false,
      agentsMd: false,
      claudeMd: false,
      mcp: claudeStatus?.mcp ?? claudeStatus?.installed ?? false,
      hooks: claudeStatus?.hooks ?? claudeStatus?.installed ?? false,
      commands: claudeStatus?.commands ?? claudeStatus?.installed ?? false,
      gitHook: false,
    };
    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue(status),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(<Settings snapshot={base} {...props} />);
    return props;
  }

  it('opens on General with the editable name and every tab present, with no Automations tab', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    for (const label of ['General', 'Statuses', 'Types', 'Team', 'Integrations']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('tab', { name: 'Automations' })).toBeNull();
    expect((screen.getByLabelText('project name') as HTMLInputElement).value).toBe(base.manifest.name);
  });

  it('renames the project on blur', async () => {
    const props = renderSettings();
    const input = screen.getByLabelText('project name');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);
    await waitFor(() => expect(props.onRenameProject).toHaveBeenCalledWith('Renamed'));
  });

  it('saves a status rename through the shared schema draft', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveSchema).toHaveBeenCalled());
    expect(props.onSaveSchema.mock.calls[0][0].renames.statuses).toMatchObject({ backlog: 'inbox' });
  });

  it('enforces one status per agent role: selecting Ready on a second row clears the first', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    // 'todo' (index 1) already carries Ready in the fixture.
    expect((screen.getByLabelText('status 1 agent role Ready') as HTMLInputElement).checked).toBe(true);
    // Selecting Ready on 'in_review' (index 3) clears it from todo.
    fireEvent.click(screen.getByLabelText('status 3 agent role Ready'));
    expect((screen.getByLabelText('status 1 agent role Ready') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('status 3 agent role Ready') as HTMLInputElement).checked).toBe(true);
  });

  it('shares one draft and Save bar across Statuses and Types', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 label'), { target: { value: 'Inbox' } });
    expect(screen.getByText('Save changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    // The Save bar follows to the other schema tab.
    expect(screen.getByText('Save changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    expect((screen.getByLabelText('status 0 label') as HTMLInputElement).value).toBe('Inbox');
  });

  it('switches type tabs and adds a field scoped to that type only', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    // Epic is the first tab; switch to Bug before adding a field.
    fireEvent.click(screen.getByRole('tab', { name: 'Bug' }));
    fireEvent.click(screen.getByText('Add field'));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveSchema).toHaveBeenCalled());
    const saved = props.onSaveSchema.mock.calls[0][0];
    const epicBefore = base.schema.types.find((t) => t.name === 'epic')!.fields.length;
    const bugBefore = base.schema.types.find((t) => t.name === 'bug')!.fields.length;
    const epicAfter = saved.types.find((t: { name: string }) => t.name === 'epic').fields.length;
    const bugAfter = saved.types.find((t: { name: string }) => t.name === 'bug').fields.length;
    expect(bugAfter).toBe(bugBefore + 1);
    expect(epicAfter).toBe(epicBefore);
  });

  it('fields render as read-only summaries at rest, with no inputs until a row is clicked', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    // Epic (the first tab) carries an Assignee reference and a Priority enum
    // sourced from Priorities, alongside the built-in Title and Body.
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByText('Assignee')).toBeTruthy();
    expect(screen.getByText('reference to Actor')).toBeTruthy();
    expect(screen.getByText('Priority')).toBeTruthy();
    expect(screen.getByText('enum, from Priorities')).toBeTruthy();
    expect(screen.queryByLabelText('field 1 label')).toBeNull();
    expect(screen.queryByLabelText('field 2 label')).toBeNull();
  });

  it('clicking a field row reveals its editor, and clicking another collapses the first', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByText('Assignee'));
    expect(screen.getByLabelText('field 1 type')).toBeTruthy();
    fireEvent.click(screen.getByText('Priority'));
    expect(screen.queryByLabelText('field 1 type')).toBeNull();
    expect(screen.getByLabelText('field 2 type')).toBeTruthy();
  });

  it('"Add field" appends a field and opens it for editing immediately', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByText('Add field'));
    // Epic already carries title, assignee and priority; the new field lands at index 3.
    expect(screen.getByLabelText('field 3 label')).toBeTruthy();
  });

  it('the built-in Title row is not expandable', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByText('Title'));
    expect(document.querySelectorAll('.field-row-open').length).toBe(0);
  });

  it('the type identity shows no editing controls or ID example at rest', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    expect(screen.queryByLabelText('type name')).toBeNull();
    expect(screen.queryByLabelText('type machine')).toBeNull();
    // The numbering example lives in the Edit type modal, not on the page.
    expect(document.querySelector('.type-id-example')).toBeNull();
  });

  it('shows a field count note on each type tab', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    const tabs = screen.getByRole('tablist', { name: 'ticket types' });
    expect(within(tabs).getByRole('tab', { name: 'Epic' }).textContent).toContain('3 fields');
    expect(within(tabs).getByRole('tab', { name: 'Bug' }).textContent).toContain('6 fields');
  });

  it('the edit pencil renders only on the active type tab, and opens the Edit type modal', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    const tabs = screen.getByRole('tablist', { name: 'ticket types' });
    expect(within(tabs).getAllByRole('button', { name: 'edit type' }).length).toBe(1);
    fireEvent.click(within(tabs).getByRole('button', { name: 'edit type' }));
    expect(screen.getByRole('heading', { name: 'Edit type' })).toBeTruthy();
    expect((screen.getByLabelText('type name') as HTMLInputElement).value).toBe('Epic');
    fireEvent.click(screen.getByText('Cancel'));
    // Switching the active tab moves the pencil with it.
    fireEvent.click(screen.getByRole('tab', { name: 'Bug' }));
    expect(within(tabs).getAllByRole('button', { name: 'edit type' }).length).toBe(1);
    fireEvent.click(within(tabs).getByRole('button', { name: 'edit type' }));
    expect((screen.getByLabelText('type name') as HTMLInputElement).value).toBe('Bug');
  });

  it('editing the wells and saving commits the identity to the shared draft', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    fireEvent.change(screen.getByLabelText('type id prefix'), { target: { value: 'z' } });
    fireEvent.click(screen.getByText('Save type'));
    expect(screen.queryByRole('heading', { name: 'Edit type' })).toBeNull();
    // Reopening shows the committed prefix, not the seeded one.
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    expect((screen.getByLabelText('type id prefix') as HTMLInputElement).value).toBe('Z');
  });

  it('Cancel discards local edits made in the modal', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    fireEvent.change(screen.getByLabelText('type id prefix'), { target: { value: 'z' } });
    fireEvent.click(screen.getByText('Cancel'));
    // Reopening starts again from the committed row, not the discarded edit.
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    expect((screen.getByLabelText('type id prefix') as HTMLInputElement).value).toBe('E');
  });

  it('keeps label -> machine and label -> plural derivation coupled inside the modal, and prefix follows the machine name', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    fireEvent.change(screen.getByLabelText('type name'), { target: { value: 'Story' } });
    expect((screen.getByLabelText('type machine') as HTMLInputElement).value).toBe('story');
    expect((screen.getByLabelText('type plural') as HTMLInputElement).value).toBe('Storys');
    // Prefix follows the machine name directly, not the label.
    fireEvent.change(screen.getByLabelText('type machine'), { target: { value: 'narrative' } });
    expect((screen.getByLabelText('type id prefix') as HTMLInputElement).value).toBe('N');
    // Touching plural directly stops it following further label edits.
    fireEvent.change(screen.getByLabelText('type plural'), { target: { value: 'Narratives' } });
    fireEvent.change(screen.getByLabelText('type name'), { target: { value: 'Narr' } });
    expect((screen.getByLabelText('type plural') as HTMLInputElement).value).toBe('Narratives');
  });

  it('preserves untouched-field derivation across the save round trip', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    fireEvent.change(screen.getByLabelText('type name'), { target: { value: 'Story' } });
    fireEvent.click(screen.getByText('Save type'));
    // Reopening and editing the label again should still cascade to machine
    // and plural: saving must not have marked either as hand-touched.
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    fireEvent.change(screen.getByLabelText('type name'), { target: { value: 'Chronicle' } });
    expect((screen.getByLabelText('type machine') as HTMLInputElement).value).toBe('chronicle');
    expect((screen.getByLabelText('type plural') as HTMLInputElement).value).toBe('Chronicles');
  });

  it('Remove type is disabled when it is the only type', () => {
    const oneType: Snapshot = { ...base, schema: { ...base.schema, types: [base.schema.types[0]!] } };
    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false }),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(<Settings snapshot={oneType} {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    expect((screen.getByText('Remove type') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Remove type removes the type, closes the modal and steps the active tab back', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Bug' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit type' }));
    expect((screen.getByText('Remove type') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Remove type'));
    expect(screen.queryByRole('heading', { name: 'Edit type' })).toBeNull();
    const tabs = screen.getByRole('tablist', { name: 'ticket types' });
    expect(within(tabs).queryByRole('tab', { name: 'Bug' })).toBeNull();
    expect(within(tabs).getByRole('tab', { name: 'Task' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens the Priorities modal from Types and saves an edited list', async () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    fireEvent.click(screen.getByText('Priorities'));
    expect(screen.getByRole('heading', { name: 'Priorities' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('priority 0'), { target: { value: 'critical' } });
    fireEvent.click(screen.getByText('Save priorities'));
    expect(screen.queryByRole('heading', { name: 'Priorities' })).toBeNull();
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveSchema).toHaveBeenCalled());
    expect(props.onSaveSchema.mock.calls[0][0].priorities[0]).toBe('critical');
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
    await waitFor(() => expect(screen.getByText('Install Claude Code assets')).toBeTruthy());
    fireEvent.click(screen.getByText('Install Claude Code assets'));
    await waitFor(() => expect(props.onInstallClaude).toHaveBeenCalledWith(true));
  });

  it('shows "not installed" when no assets are present', async () => {
    renderSettings({ installed: false });
    fireEvent.click(screen.getByRole('tab', { name: 'Integrations' }));
    await waitFor(() =>
      expect(screen.getByText('Claude Code assets are not installed in this project.')).toBeTruthy(),
    );
    expect(screen.getByText('Install Claude Code assets')).toBeTruthy();
  });

  it('shows "installed" and the Reinstall button when all assets are present', async () => {
    renderSettings({ installed: true });
    fireEvent.click(screen.getByRole('tab', { name: 'Integrations' }));
    await waitFor(() =>
      expect(screen.getByText('Claude Code assets are installed in this project.')).toBeTruthy(),
    );
    expect(screen.getByText('Reinstall Claude Code assets')).toBeTruthy();
  });

  it('shows "partially installed" with missing pieces when some core assets are absent', async () => {
    renderSettings({ installed: false, mcp: true, hooks: false, commands: false });
    fireEvent.click(screen.getByRole('tab', { name: 'Integrations' }));
    await waitFor(() =>
      expect(screen.getByText('Claude Code assets are partially installed.')).toBeTruthy(),
    );
    expect(screen.getByText(/Missing:/)).toBeTruthy();
    expect(screen.getByText('Install Claude Code assets')).toBeTruthy();
  });

  it('refreshes status after a successful install', async () => {
    const installedStatus = {
      installed: true,
      agentsMd: true,
      claudeMd: true,
      mcp: true,
      hooks: true,
      commands: true,
      gitHook: false,
    };
    const props = renderSettings({ installed: false });
    // After install, the mock returns the installed status.
    props.onClaudeStatus.mockResolvedValueOnce({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false })
      .mockResolvedValue(installedStatus);
    fireEvent.click(screen.getByRole('tab', { name: 'Integrations' }));
    await waitFor(() => expect(screen.getByText('Install Claude Code assets')).toBeTruthy());
    fireEvent.click(screen.getByText('Install Claude Code assets'));
    await waitFor(() =>
      expect(screen.getByText('Claude Code assets are installed in this project.')).toBeTruthy(),
    );
    expect(screen.getByText('Reinstall Claude Code assets')).toBeTruthy();
  });

  it('reports its dirty state so navigation can be guarded', () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    expect(props.onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('does not report a hand-authored non-enum default, redundant label or required: false as dirty on open, and a later save reproduces them untouched', async () => {
    // task's "estimate" field authored with all three fidelity traps at
    // once: a default on a non-enum field, a label equal to Title
    // Case(name), and an explicit required: false.
    const authoredEstimate = { name: 'estimate', type: 'number' as const, label: 'Estimate', required: false, default: 3 };
    const withAuthoredField: Snapshot = {
      ...base,
      schema: {
        ...base.schema,
        types: base.schema.types.map((t) =>
          t.name === 'task'
            ? { ...t, fields: t.fields.map((f) => (f.name === 'estimate' ? authoredEstimate : f)) }
            : t,
        ),
      },
    };
    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false }),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(<Settings snapshot={withAuthoredField} {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    // Opening on Types (which seeds the shared schema draft) reports clean.
    expect(screen.queryByText('Save changes')).toBeNull();
    expect(props.onDirtyChange).toHaveBeenCalledWith(false);

    // An unrelated edit (a status rename) forces a save; the untouched
    // estimate field must still carry its authored default, label and
    // required: false afterwards.
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveSchema).toHaveBeenCalled());
    const saved = props.onSaveSchema.mock.calls[0][0];
    const task = saved.types.find((t: { name: string }) => t.name === 'task');
    const estimate = task.fields.find((f: { name: string }) => f.name === 'estimate');
    expect(estimate).toEqual(authoredEstimate);
  });

  it('does not report a hand-authored redundant plural as dirty on open, and a later save reproduces it untouched', async () => {
    // task's plural authored explicitly even though it equals the derived default.
    const withAuthoredPlural: Snapshot = {
      ...base,
      schema: {
        ...base.schema,
        types: base.schema.types.map((t) => (t.name === 'task' ? { ...t, plural: 'Tasks' } : t)),
      },
    };
    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false }),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(<Settings snapshot={withAuthoredPlural} {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    expect(screen.queryByText('Save changes')).toBeNull();
    expect(props.onDirtyChange).toHaveBeenCalledWith(false);

    // An unrelated edit (a status rename) forces a save; the untouched
    // plural must still be carried, byte-for-byte, in the saved edit.
    fireEvent.click(screen.getByRole('tab', { name: 'Statuses' }));
    fireEvent.change(screen.getByLabelText('status 0 machine'), { target: { value: 'inbox' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(props.onSaveSchema).toHaveBeenCalled());
    const saved = props.onSaveSchema.mock.calls[0][0];
    const task = saved.types.find((t: { name: string }) => t.name === 'task');
    expect(task.plural).toBe('Tasks');
  });

  it('does not report a hand-authored unknown field key as dirty on open, but a real edit still flips it', () => {
    // An unmodelled key (`unit`) the editor never carries through its rows,
    // but which the merge layer preserves on save (ADR-0011).
    const withUnknownKey: Snapshot = JSON.parse(JSON.stringify(base));
    const task = withUnknownKey.schema.types.find((t) => t.name === 'task')!;
    const estimate = task.fields.find((f) => f.name === 'estimate')! as { unit?: string };
    estimate.unit = 'points';

    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false }),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(<Settings snapshot={withUnknownKey} {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    expect(screen.queryByText('Save changes')).toBeNull();
    expect(props.onDirtyChange).toHaveBeenCalledWith(false);

    // A real edit on the same field still flips dirty.
    fireEvent.click(screen.getByText('Assignee'));
    fireEvent.change(screen.getByLabelText('field 1 label'), { target: { value: 'Owner' } });
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  it('a field renamed to the locked title machine name stays visible; the pinned locked row stays hidden', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Types' }));
    // Epic's Assignee field (row index 1) renamed to the colliding name "title".
    fireEvent.click(screen.getByText('Assignee'));
    fireEvent.change(screen.getByLabelText('field 1 machine'), { target: { value: 'title' } });
    expect((screen.getByLabelText('field 1 machine') as HTMLInputElement).value).toBe('title');
    // The pinned, locked Title/Body pair still renders as the static read-only rows.
    expect(document.querySelectorAll('.field-row-locked').length).toBe(2);
  });

  it('General shows both View sessions and View problems, and View problems opens a dialog listing issues with a count note', () => {
    const withIssue: Snapshot = {
      ...base,
      issues: [{ severity: 'error', file: 'x.md', rule: 'r', message: 'broken' }],
    };
    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false }),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(<Settings snapshot={withIssue} {...props} />);
    expect(screen.getByText('View sessions')).toBeTruthy();
    const problemsButton = screen.getByText('View problems').closest('button')!;
    expect(within(problemsButton).getByText('1')).toBeTruthy();
    fireEvent.click(problemsButton);
    expect(screen.getByRole('dialog', { name: 'problems' })).toBeTruthy();
    expect(screen.getByText('broken')).toBeTruthy();
  });

  it('opens the sessions dialog from General, and clicking a session ticket calls onOpenTicket and closes it', () => {
    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false }),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(
      <HostProvider host={new FakeHost()}>
        <Settings snapshot={base} {...props} />
      </HostProvider>,
    );
    fireEvent.click(screen.getByText('View sessions'));
    expect(screen.getByRole('dialog', { name: 'sessions' })).toBeTruthy();
    // S-0002 sorts first (reverse-chronological) and belongs to T-0002.
    fireEvent.click(screen.getByText('T-0002'));
    expect(props.onOpenTicket).toHaveBeenCalledWith('T-0002');
    expect(screen.queryByRole('dialog', { name: 'sessions' })).toBeNull();
  });

  it('Escape closes an open modal', () => {
    const props = {
      onSaveSchema: vi.fn().mockResolvedValue(undefined),
      onRenameProject: vi.fn().mockResolvedValue(undefined),
      onSavePresenceTimeout: vi.fn().mockResolvedValue(undefined),
      onOpenProject: vi.fn(),
      onSaveActors: vi.fn().mockResolvedValue(undefined),
      onInstallClaude: vi.fn().mockResolvedValue({ written: ['CLAUDE.md'], manual: [] }),
      onClaudeStatus: vi.fn().mockResolvedValue({ installed: false, agentsMd: false, claudeMd: false, mcp: false, hooks: false, commands: false, gitHook: false }),
      onDirtyChange: vi.fn(),
      onOpenTicket: vi.fn(),
    };
    render(<Settings snapshot={base} {...props} />);
    fireEvent.click(screen.getByText('View problems'));
    expect(screen.getByRole('dialog', { name: 'problems' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'problems' })).toBeNull();
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
        <SessionsModal snapshot={empty} onClose={vi.fn()} onOpenTicket={vi.fn()} />
      </HostProvider>,
    );
    expect(screen.getByText('No sessions yet')).toBeTruthy();
    expect(document.querySelector('.empty-state')).toBeTruthy();

    render(<ProblemsModal issues={[]} onClose={vi.fn()} />);
    expect(screen.getByText('Everything validates')).toBeTruthy();
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
    // The regrouped nav: configuration lives under one Settings home, and
    // Sessions and Problems have moved off the sidebar into Settings > General.
    for (const label of ['Board', 'List', 'Documentation', 'Graph', 'Settings', 'Search']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /^Workflow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Automations/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Runs/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sessions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Problems/ })).toBeNull();
    // Settings (pinned in the footer) is the configuration home.
    fireEvent.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Automations' })).toBeNull();
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

describe('ProjectView needs-migration screen', () => {
  function renderNeedsMigration() {
    const host = new FakeHost();
    host.snapshotError = {
      message: 'this project uses spec version 2.1.0, which is older than the supported 3.x',
      code: 'spec-needs-migration',
      declared: '2.1.0',
      supported: '3.1.0',
    };
    render(
      <HostProvider host={host}>
        <ProjectView root="/fake" />
      </HostProvider>,
    );
    return host;
  }

  it('fetches and renders the plan, then migrates and reloads on click', async () => {
    const host = renderNeedsMigration();
    expect(await screen.findByRole('heading', { name: 'This project uses an older format' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('nest 4 fields under their types')).toBeTruthy());
    expect(host.calls.some((c) => c.method === 'migrationPlan')).toBe(true);

    const button = screen.getByRole('button', { name: 'Update project' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    // The board (the normal workbench) appears once migrateProject clears
    // the simulated failure and the store reloads.
    await waitFor(() => expect(screen.getByText('Forecast endpoint')).toBeTruthy());
    expect(host.calls.some((c) => c.method === 'migrateProject')).toBe(true);
  });

  it('surfaces a migration failure through the problem-note pattern', async () => {
    const host = renderNeedsMigration();
    await waitFor(() => expect(screen.getByText('nest 4 fields under their types')).toBeTruthy());
    host.migrateProject = async () => {
      throw new Error('migration failed: could not write schema.yaml');
    };
    fireEvent.click(screen.getByRole('button', { name: 'Update project' }));
    await waitFor(() =>
      expect(screen.getByText('migration failed: could not write schema.yaml')).toBeTruthy(),
    );
    // Still on the gate: the workbench never appeared.
    expect(screen.queryByText('Forecast endpoint')).toBeNull();
  });
});
