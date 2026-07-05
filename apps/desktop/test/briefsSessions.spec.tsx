import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Briefs } from '../src/views/Briefs';
import { Sessions } from '../src/views/Sessions';
import { HostProvider } from '../src/state/store';
import type { Snapshot } from '../src/lib/types';
import { FakeHost } from './fakeHost';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;

describe('Briefs view', () => {
  // The fixture's briefs all carry fixed names; one renamable brief joins
  // them so the title-as-filename behaviour is testable.
  const withPricing: Snapshot = {
    ...snapshot,
    index: {
      ...snapshot.index,
      briefs: [
        ...snapshot.index.briefs,
        { id: 'pricing', summary: 'How pricing works.', path: '.lovelace/briefs/domain/pricing.md' },
      ],
    },
  };

  function renderBriefs(snap: Snapshot = snapshot) {
    const host = new FakeHost();
    host.files.set(
      '.lovelace/CONTEXT.md',
      '---\nid: context\n---\n\n# Orbit\n\nIntro paragraph.\n',
    );
    const onSaveBody = vi.fn().mockResolvedValue(undefined);
    const onSaveProperties = vi.fn().mockResolvedValue(undefined);
    const onCreateBrief = vi.fn().mockResolvedValue(undefined);
    const onRenameBrief = vi.fn().mockResolvedValue(undefined);
    render(
      <HostProvider host={host}>
        <Briefs
          snapshot={snap}
          onSaveBody={onSaveBody}
          onSaveProperties={onSaveProperties}
          onCreateBrief={onCreateBrief}
          onRenameBrief={onRenameBrief}
        />
      </HostProvider>,
    );
    return { onSaveBody, onSaveProperties, onCreateBrief, onRenameBrief };
  }

  it('shows the tree with stale badges and edits frontmatter through the properties panel only', async () => {
    const { onSaveProperties } = renderBriefs();
    expect(screen.getAllByText('stale').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Intro paragraph.')).toBeTruthy());
    // Frontmatter is never shown raw in the editor.
    expect(screen.queryByText(/^id: context/m)).toBeNull();
    const summary = screen.getByLabelText('brief summary') as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: 'A fresh summary.' } });
    fireEvent.blur(summary);
    expect(onSaveProperties).toHaveBeenCalledWith(
      '.lovelace/CONTEXT.md',
      'A fresh summary.',
      null,
    );
  });

  it('renders the body read-only and only writes on an explicit Save', async () => {
    const { onSaveBody } = renderBriefs();
    await waitFor(() => expect(screen.getByText('Intro paragraph.')).toBeTruthy());
    // Viewing (and typing in a live editor) never saves on its own.
    expect(screen.queryByTestId('block-editor')).toBeNull();
    expect(onSaveBody).not.toHaveBeenCalled();
    // Edit reveals the editor with an explicit Save/Cancel bar.
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByTestId('block-editor')).toBeTruthy();
    expect(onSaveBody).not.toHaveBeenCalled();
    // Save writes once, for the selected document, then returns to the view.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaveBody).toHaveBeenCalledTimes(1));
    expect(onSaveBody.mock.calls[0]![0]).toBe('.lovelace/CONTEXT.md');
    await waitFor(() => expect(screen.queryByTestId('block-editor')).toBeNull());
  });

  it('discards an edit on Cancel without saving', async () => {
    const { onSaveBody } = renderBriefs();
    await waitFor(() => expect(screen.getByText('Intro paragraph.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('block-editor')).toBeNull();
    expect(onSaveBody).not.toHaveBeenCalled();
  });

  it('shows the filename as the title, locked and explained for fixed names', async () => {
    renderBriefs();
    const title = screen.getByLabelText('document filename') as HTMLInputElement;
    expect(title.value).toBe('CONTEXT');
    expect(title.disabled).toBe(true);
    expect(screen.getByText('Fixed name')).toBeTruthy();
  });

  it('does not mark editable briefs as fixed', async () => {
    renderBriefs(withPricing);
    fireEvent.click(screen.getByText('pricing'));
    expect((screen.getByLabelText('document filename') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText('Fixed name')).toBeNull();
  });

  it('renames a brief through its title and follows the new path', async () => {
    const { onRenameBrief } = renderBriefs(withPricing);
    fireEvent.click(screen.getByText('pricing'));
    const title = screen.getByLabelText('document filename') as HTMLInputElement;
    expect(title.disabled).toBe(false);
    fireEvent.change(title, { target: { value: 'pricing-model' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(onRenameBrief).toHaveBeenCalledWith('.lovelace/briefs/domain/pricing.md', 'pricing-model'),
    );
  });

  it('rejects an invalid filename with a clear error and resets the title', async () => {
    const { onRenameBrief } = renderBriefs(withPricing);
    fireEvent.click(screen.getByText('pricing'));
    const title = screen.getByLabelText('document filename') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'bad name!' } });
    fireEvent.blur(title);
    expect(onRenameBrief).not.toHaveBeenCalled();
    expect(screen.getByText(/letters, digits and hyphens/)).toBeTruthy();
    expect(title.value).toBe('pricing');
  });

  it('saves a review date picked in the datepicker', async () => {
    const { onSaveProperties } = renderBriefs(withPricing);
    fireEvent.click(screen.getByText('pricing'));
    fireEvent.click(screen.getByLabelText('review by'));
    const dialog = screen.getByRole('dialog', { name: 'review by' });
    fireEvent.click(within(dialog).getByText('21'));
    await waitFor(() => expect(onSaveProperties).toHaveBeenCalled());
    const [path, summary, reviewBy] = onSaveProperties.mock.calls[0] as [string, string, string];
    expect(path).toBe('.lovelace/briefs/domain/pricing.md');
    expect(summary).toBe('How pricing works.');
    expect(reviewBy).toMatch(/^\d{4}-\d{2}-21$/);
  });

  it('creates a brief in a new directory, offering its OVERVIEW.md', async () => {
    const { onCreateBrief } = renderBriefs();
    fireEvent.click(screen.getByText('New brief'));
    fireEvent.click(screen.getByLabelText('brief directory'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'brief directory' })).getByText('new directory...'));
    fireEvent.change(screen.getByLabelText('new directory path'), {
      target: { value: '.lovelace/briefs/operations' },
    });
    fireEvent.change(screen.getByLabelText('brief filename'), { target: { value: 'runbooks' } });
    fireEvent.change(screen.getByLabelText('new brief summary'), { target: { value: 'How we operate.' } });
    expect(screen.getByText(/OVERVIEW\.md will be created/)).toBeTruthy();
    fireEvent.click(screen.getByText('Create brief'));
    await waitFor(() =>
      expect(onCreateBrief).toHaveBeenCalledWith('.lovelace/briefs/operations', 'runbooks', 'How we operate.', true),
    );
  });
});

describe('Sessions view', () => {
  it('lists session records reverse-chronologically with outcome and commits', () => {
    render(
      <HostProvider host={new FakeHost()}>
        <Sessions snapshot={snapshot} onOpenTicket={vi.fn()} />
      </HostProvider>,
    );
    const ids = screen.getAllByText(/^S-\d+$/).map((el) => el.textContent);
    expect(ids).toEqual(['S-0002', 'S-0001']);
    expect(screen.getByText('partial')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText(/9c41f2a/)).toBeTruthy();
  });
});
