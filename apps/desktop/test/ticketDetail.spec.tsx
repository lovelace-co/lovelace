import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TicketDetail } from '../src/views/TicketDetail';
import { HostProvider } from '../src/state/store';
import type { ProjectPresence } from '../src/state/store';
import type { Snapshot } from '../src/lib/types';
import { FakeHost } from './fakeHost';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;

function renderDetail(ticketId: string, presence?: ProjectPresence) {
  const host = new FakeHost();
  host.files.set(
    '.lovelace/tickets/T-0002.md',
    '---\nid: T-0002\n---\n\n## Description\n\nServe the forecast.\n\n## Acceptance criteria\n\n- [ ] Serves from cache.\n',
  );
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onOpenTicket = vi.fn();
  render(
    <HostProvider host={host}>
      <TicketDetail
        snapshot={snapshot}
        presence={presence}
        ticketId={ticketId}
        onBack={() => undefined}
        onOpenTicket={onOpenTicket}
        onUpdate={onUpdate}
        onComment={vi.fn().mockResolvedValue(undefined)}
      />
    </HostProvider>,
  );
  return { host, onUpdate, onOpenTicket };
}

describe('TicketDetail', () => {
  it('shows locked core fields as read-only text with capitalised labels', () => {
    renderDetail('T-0002');
    // Core fields render as plain values, not editable controls, and the
    // label reads "ID" (acronym), not "id".
    const idLabel = screen.getByText('ID', { selector: '.prop-label' });
    const row = idLabel.closest('.prop')!;
    expect(row.querySelector('input')).toBeNull();
    expect(row.querySelector('.prop-value')?.textContent).toBe('T-0002');
    expect(screen.getByText('Type', { selector: '.prop-label' })).toBeTruthy();
    expect(screen.getByText('Created', { selector: '.prop-label' })).toBeTruthy();
  });

  it('generates the form from field definitions including custom fields', () => {
    renderDetail('T-0002');
    // estimate applies to tasks and was never hard-coded anywhere in the app.
    expect(screen.getByLabelText('estimate')).toBeTruthy();
    expect((screen.getByLabelText('estimate') as HTMLInputElement).type).toBe('number');
    // Title is edited in the header, not the properties form.
    expect(screen.getByLabelText('ticket title')).toBeTruthy();
    expect(screen.queryByText('title', { selector: '.prop-label' })).toBeNull();
  });

  it('capitalises every property label and never shows raw underscores', () => {
    renderDetail('T-0002');
    const labels = Array.from(document.querySelectorAll('.prop-label')).map((el) => el.textContent ?? '');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toContain('_');
      const first = label.charAt(0);
      expect(first).toBe(first.toUpperCase());
    }
  });

  it('renders comment markdown as elements, not raw syntax', async () => {
    const host = new FakeHost();
    const commentPath = snapshot.index.comments.find((c) => c.ticket === 'T-0002')!.path;
    host.files.set(
      commentPath,
      '---\nticket: T-0002\nactor: ada\ncreated: 2026-06-08T14:30:00Z\n---\n\n# Heading\n\n- first item\n',
    );
    render(
      <HostProvider host={host}>
        <TicketDetail
          snapshot={snapshot}
          ticketId="T-0002"
          onBack={() => undefined}
          onOpenTicket={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onComment={vi.fn().mockResolvedValue(undefined)}
        />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText('Heading')).toBeTruthy());
    const heading = screen.getByText('Heading');
    expect(heading.tagName).toBe('H1');
    expect(heading.closest('.thread-body.is-rich')).toBeTruthy();
    expect(screen.getByText('first item').closest('li')).toBeTruthy();
    // The raw markdown markers must not survive as literal text.
    expect(screen.queryByText('# Heading')).toBeNull();
  });

  it('edits the title inline from the header', () => {
    const { onUpdate } = renderDetail('T-0002');
    const input = screen.getByLabelText('ticket title') as HTMLTextAreaElement;
    expect(input.value).toBe('Forecast endpoint');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Forecast endpoint v2' } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith('T-0002', { title: 'Forecast endpoint v2' });
  });

  it('reverts an emptied title instead of saving it', () => {
    const { onUpdate } = renderDetail('T-0002');
    const input = screen.getByLabelText('ticket title') as HTMLTextAreaElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(input.value).toBe('Forecast endpoint');
  });

  it('commits the title on Enter and prevents the newline the browser would otherwise insert', () => {
    const { onUpdate } = renderDetail('T-0002');
    const input = screen.getByLabelText('ticket title') as HTMLTextAreaElement;
    // Real focus (not just a dispatched event) so the handler's own
    // currentTarget.blur() call below actually fires a blur event.
    input.focus();
    fireEvent.change(input, { target: { value: 'Forecast endpoint v2' } });
    // fireEvent returns false when the event was cancelled: proof the handler
    // called preventDefault, so no browser would insert a newline here.
    const notCancelled = fireEvent.keyDown(input, { key: 'Enter' });
    expect(notCancelled).toBe(false);
    expect(onUpdate).toHaveBeenCalledWith('T-0002', { title: 'Forecast endpoint v2' });
  });

  it('renders the ticket body Markdown from the file', async () => {
    renderDetail('T-0002');
    await waitFor(() => expect(screen.getByText('Serve the forecast.')).toBeTruthy());
    expect(screen.getByText('Acceptance criteria')).toBeTruthy();
  });

  it('toggles a task checkbox from the rendered body and saves the flipped line', async () => {
    const host = new FakeHost();
    host.files.set(
      '.lovelace/tickets/T-0002.md',
      '---\nid: T-0002\n---\n\n## Acceptance criteria\n\n- [ ] Serves from cache.\n',
    );
    const onSaveBody = vi.fn().mockResolvedValue(undefined);
    render(
      <HostProvider host={host}>
        <TicketDetail
          snapshot={snapshot}
          ticketId="T-0002"
          onBack={() => undefined}
          onOpenTicket={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onComment={vi.fn().mockResolvedValue(undefined)}
          onSaveBody={onSaveBody}
        />
      </HostProvider>,
    );
    // The checkbox is interactive in the rendered view (no need to open the editor).
    const box = await screen.findByRole('checkbox');
    expect((box as HTMLInputElement).checked).toBe(false);
    expect((box as HTMLInputElement).disabled).toBe(false);
    // The task item has no bullet marker.
    expect(box.closest('li')?.classList.contains('task-item')).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(onSaveBody).toHaveBeenCalled());
    // Only the checkbox char flips; the rest of the line is preserved.
    expect(onSaveBody.mock.calls[0][1]).toContain('- [x] Serves from cache.');
  });

  it('shows linked sessions and comments in the activity timeline', () => {
    renderDetail('T-0002');
    expect(screen.getByText(/S-0002: Partial/)).toBeTruthy();
    const comments = screen.getAllByText('Comment');
    expect(comments.length).toBe(2);
  });

  it('reveals the comment editor progressively from a collapsed stub', () => {
    const { container } = render(
      <HostProvider host={new FakeHost()}>
        <TicketDetail
          snapshot={snapshot}
          ticketId="T-0002"
          onBack={() => undefined}
          onOpenTicket={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onComment={vi.fn().mockResolvedValue(undefined)}
        />
      </HostProvider>,
    );
    // Collapsed by default: a quiet "Add a comment" stub, no composer editor yet.
    const compose = container.querySelector('.comment-compose')!;
    const stub = screen.getByText('Add a comment');
    expect(stub).toBeTruthy();
    expect(compose.querySelector('.comment-editor')).toBeNull();
    expect(compose.querySelector('[data-testid="block-editor"]')).toBeNull();
    // Activating the stub expands the composer: stub gone, composer present.
    fireEvent.click(stub);
    expect(screen.queryByText('Add a comment')).toBeNull();
    expect(compose.querySelector('.comment-editor')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
  });

  it('lists the direct children of a parent ticket and navigates on click', () => {
    // E-0001 is the parent of T-0001, T-0002 and T-0003 in the fixture.
    const { onOpenTicket } = renderDetail('E-0001');
    const heading = screen.getByText('Children', { selector: '.panel-heading' });
    const panel = heading.closest('.props-panel')!;
    const rows = Array.from(panel.querySelectorAll('.child-row'));
    expect(rows.map((r) => r.querySelector('.id-chip')?.textContent)).toEqual([
      'T-0001',
      'T-0002',
      'T-0003',
    ]);
    expect(rows.map((r) => r.querySelector('.child-title')?.textContent)).toEqual([
      'Atomic cache writes',
      'Forecast endpoint',
      'Location search endpoint',
    ]);
    fireEvent.click(rows[1]);
    expect(onOpenTicket).toHaveBeenCalledWith('T-0002');
  });

  it('shows no Children section for a ticket without children', () => {
    // T-0002 is a leaf task; nothing references it as a parent.
    renderDetail('T-0002');
    expect(screen.queryByText('Children', { selector: '.panel-heading' })).toBeNull();
  });

  it('renders comment bodies, not their file paths', async () => {
    const host = new FakeHost();
    const commentPath = snapshot.index.comments.find((c) => c.ticket === 'T-0002')!.path;
    host.files.set(
      commentPath,
      '---\nticket: T-0002\nactor: ada\ncreated: 2026-06-08T14:30:00Z\n---\n\nThe retry logic belongs in core.\n',
    );
    render(
      <HostProvider host={host}>
        <TicketDetail
          snapshot={snapshot}
          ticketId="T-0002"
          onBack={() => undefined}
          onOpenTicket={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onComment={vi.fn().mockResolvedValue(undefined)}
        />
      </HostProvider>,
    );
    await waitFor(() => expect(screen.getByText(/The retry logic belongs in core\./)).toBeTruthy());
    // The raw path must not be shown.
    expect(screen.queryByText(new RegExp(commentPath.replace(/[.]/g, '\\.')))).toBeNull();
  });

  it('shows the status as a dropdown displaying the current status by its human label', () => {
    // T-0002 is in_progress in the fixture; the status has no explicit label.
    renderDetail('T-0002');
    const trigger = screen.getByLabelText('Status');
    expect(trigger.textContent).toContain('In Progress');
  });

  it('lists every schema status by label with no empty choice', () => {
    renderDetail('T-0002');
    fireEvent.click(screen.getByLabelText('Status'));
    const listbox = screen.getByRole('listbox', { name: 'Status' });
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']);
  });

  it('picking a different status saves it through onUpdate', () => {
    const { onUpdate } = renderDetail('T-0002');
    fireEvent.click(screen.getByLabelText('Status'));
    const listbox = screen.getByRole('listbox', { name: 'Status' });
    fireEvent.click(within(listbox).getByText('Done'));
    expect(onUpdate).toHaveBeenCalledWith('T-0002', { status: 'done' });
  });

  it('picking the currently selected status does not call onUpdate', () => {
    const { onUpdate } = renderDetail('T-0002');
    fireEvent.click(screen.getByLabelText('Status'));
    const listbox = screen.getByRole('listbox', { name: 'Status' });
    fireEvent.click(within(listbox).getByText('In Progress'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('renders a status outside the schema as its title-cased value and keeps it selected', () => {
    const withUnknownStatus: Snapshot = {
      ...snapshot,
      index: {
        ...snapshot.index,
        tickets: snapshot.index.tickets.map((t) => (t.id === 'T-0002' ? { ...t, status: 'blocked' } : t)),
      },
    };
    render(
      <HostProvider host={new FakeHost()}>
        <TicketDetail
          snapshot={withUnknownStatus}
          ticketId="T-0002"
          onBack={() => undefined}
          onOpenTicket={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onComment={vi.fn().mockResolvedValue(undefined)}
        />
      </HostProvider>,
    );
    const trigger = screen.getByLabelText('Status');
    expect(trigger.textContent).toContain('Blocked');
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Status' });
    const option = within(listbox).getByText('Blocked');
    expect(option.getAttribute('aria-selected')).toBe('true');
  });

  it('shows a header delete button when onRequestDelete is provided and calls it with the ticket', () => {
    const host = new FakeHost();
    const onRequestDelete = vi.fn();
    render(
      <HostProvider host={host}>
        <TicketDetail
          snapshot={snapshot}
          ticketId="T-0002"
          onBack={() => undefined}
          onOpenTicket={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onComment={vi.fn().mockResolvedValue(undefined)}
          onRequestDelete={onRequestDelete}
        />
      </HostProvider>,
    );
    const button = screen.getByRole('button', { name: 'Delete ticket' });
    fireEvent.click(button);
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect((onRequestDelete.mock.calls[0]![0] as { id: string }).id).toBe('T-0002');
  });

  it('shows no header delete button when onRequestDelete is not provided', () => {
    renderDetail('T-0002');
    expect(screen.queryByRole('button', { name: 'Delete ticket' })).toBeNull();
  });

  it('shows the live-work readout in the header when presence lights the open ticket', () => {
    renderDetail('T-0002', { awake: true, tickets: new Map([['T-0002', 42]]) });
    const readout = document.querySelector('.view-header .id.live');
    expect(readout).toBeTruthy();
    expect(readout?.textContent).toBe('42s · T-0002');
  });

  it('shows no live-work readout in the header without presence for the open ticket', () => {
    renderDetail('T-0002');
    expect(document.querySelector('.view-header .id.live')).toBeNull();
  });
});
