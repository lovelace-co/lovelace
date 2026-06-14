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
  function renderBriefs() {
    const host = new FakeHost();
    host.files.set(
      '.lovelace/CONTEXT.md',
      '---\nid: context\n---\n\n# Orbit\n\nIntro paragraph.\n',
    );
    const onSaveProperties = vi.fn().mockResolvedValue(undefined);
    const onCreateBrief = vi.fn().mockResolvedValue(undefined);
    render(
      <HostProvider host={host}>
        <Briefs
          snapshot={snapshot}
          onSaveBody={vi.fn().mockResolvedValue(undefined)}
          onSaveProperties={onSaveProperties}
          onCreateBrief={onCreateBrief}
        />
      </HostProvider>,
    );
    return { onSaveProperties, onCreateBrief };
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
