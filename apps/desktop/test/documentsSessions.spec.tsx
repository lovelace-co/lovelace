import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Documents } from '../src/views/Documents';
import { Sessions } from '../src/views/Sessions';
import { HostProvider } from '../src/state/store';
import type { Snapshot } from '../src/lib/types';
import { FakeHost } from './fakeHost';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;

describe('Documents view', () => {
  // A second document in a subfolder, so the title-as-filename behaviour is
  // testable away from the root index.md.
  const withPricing: Snapshot = {
    ...snapshot,
    index: {
      ...snapshot.index,
      documents: [
        ...snapshot.index.documents,
        { id: 'pricing', summary: 'How pricing works.', path: '.lovelace/documentation/domain/pricing.md' },
      ],
    },
  };

  function renderDocuments(snap: Snapshot = snapshot) {
    const host = new FakeHost();
    host.files.set(
      '.lovelace/documentation/index.md',
      '---\nid: context\n---\n\n# Orbit\n\nIntro paragraph.\n',
    );
    const onSaveBody = vi.fn().mockResolvedValue(undefined);
    const onSaveProperties = vi.fn().mockResolvedValue(undefined);
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    const onRenameDocument = vi.fn().mockResolvedValue(undefined);
    const onDeleteDocument = vi.fn().mockResolvedValue(undefined);
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    const onFixDocument = vi.fn().mockResolvedValue(undefined);
    render(
      <HostProvider host={host}>
        <Documents
          snapshot={snap}
          onSaveBody={onSaveBody}
          onSaveProperties={onSaveProperties}
          onCreateDocument={onCreateDocument}
          onCreateFolder={onCreateFolder}
          onRenameDocument={onRenameDocument}
          onDeleteDocument={onDeleteDocument}
          onDeleteFolder={onDeleteFolder}
          onFixDocument={onFixDocument}
        />
      </HostProvider>,
    );
    return {
      onSaveBody,
      onSaveProperties,
      onCreateDocument,
      onCreateFolder,
      onRenameDocument,
      onDeleteDocument,
      onDeleteFolder,
      onFixDocument,
    };
  }

  it('shows the tree with stale badges and edits frontmatter through the properties panel only', async () => {
    const { onSaveProperties } = renderDocuments();
    expect(screen.getAllByText('stale').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Intro paragraph.')).toBeTruthy());
    // Frontmatter is never shown raw in the editor.
    expect(screen.queryByText(/^id: context/m)).toBeNull();
    const summary = screen.getByLabelText('document summary') as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: 'A fresh summary.' } });
    fireEvent.blur(summary);
    expect(onSaveProperties).toHaveBeenCalledWith(
      '.lovelace/documentation/index.md',
      'A fresh summary.',
      null,
    );
  });

  it('renders the body read-only and only writes on an explicit Save', async () => {
    const { onSaveBody } = renderDocuments();
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
    expect(onSaveBody.mock.calls[0]![0]).toBe('.lovelace/documentation/index.md');
    await waitFor(() => expect(screen.queryByTestId('block-editor')).toBeNull());
  });

  it('discards an edit on Cancel without saving', async () => {
    const { onSaveBody } = renderDocuments();
    await waitFor(() => expect(screen.getByText('Intro paragraph.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('block-editor')).toBeNull();
    expect(onSaveBody).not.toHaveBeenCalled();
  });

  it('shows the root index.md as an editable title', async () => {
    renderDocuments();
    const title = screen.getByLabelText('document filename') as HTMLInputElement;
    expect(title.value).toBe('index');
    expect(title.disabled).toBe(false);
  });

  it('renames a document through its title and follows the new path', async () => {
    const { onRenameDocument } = renderDocuments(withPricing);
    fireEvent.click(screen.getByText('pricing'));
    const title = screen.getByLabelText('document filename') as HTMLInputElement;
    expect(title.disabled).toBe(false);
    fireEvent.change(title, { target: { value: 'pricing-model' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(onRenameDocument).toHaveBeenCalledWith('.lovelace/documentation/domain/pricing.md', 'pricing-model'),
    );
  });

  it('rejects a filename with a slash with a clear error and resets the title', async () => {
    const { onRenameDocument } = renderDocuments(withPricing);
    fireEvent.click(screen.getByText('pricing'));
    const title = screen.getByLabelText('document filename') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'bad/name' } });
    fireEvent.blur(title);
    expect(onRenameDocument).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be empty or contain a slash/)).toBeTruthy();
    expect(title.value).toBe('pricing');
  });

  it('saves a review date picked in the datepicker', async () => {
    const { onSaveProperties } = renderDocuments(withPricing);
    fireEvent.click(screen.getByText('pricing'));
    fireEvent.click(screen.getByLabelText('review by'));
    const dialog = screen.getByRole('dialog', { name: 'review by' });
    fireEvent.click(within(dialog).getByText('21'));
    await waitFor(() => expect(onSaveProperties).toHaveBeenCalled());
    const [path, summary, reviewBy] = onSaveProperties.mock.calls[0] as [string, string, string];
    expect(path).toBe('.lovelace/documentation/domain/pricing.md');
    expect(summary).toBe('How pricing works.');
    expect(reviewBy).toMatch(/^\d{4}-\d{2}-21$/);
  });

  it('shows the "/" root and no longer offers a New document button', () => {
    renderDocuments();
    expect(screen.queryByText('New document')).toBeNull();
    // The documents root is a folder you can create into.
    expect(screen.getByRole('button', { name: 'new folder in /' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'new file in /' })).toBeTruthy();
  });

  it('renders index.md as a real node, by its filename (not a hardcoded label)', () => {
    renderDocuments();
    // Every node shows its real filename; index.md is no exception.
    expect(screen.getByText('index')).toBeTruthy();
    // It selects like any other document.
    fireEvent.click(screen.getByText('index'));
    expect((screen.getByLabelText('document filename') as HTMLInputElement).value).toBe('index');
  });

  it('creates a folder inline under the hovered folder', async () => {
    const { onCreateFolder } = renderDocuments();
    fireEvent.click(screen.getByRole('button', { name: 'new folder in /' }));
    const input = screen.getByLabelText('new folder name');
    fireEvent.change(input, { target: { value: 'operations' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onCreateFolder).toHaveBeenCalledWith('.lovelace/documentation', 'operations'),
    );
  });

  it('creates a file through the modal, a child of the hovered folder', async () => {
    const { onCreateDocument } = renderDocuments();
    fireEvent.click(screen.getByRole('button', { name: 'new file in architecture' }));
    fireEvent.change(screen.getByLabelText('new document filename'), { target: { value: 'runbooks' } });
    fireEvent.change(screen.getByLabelText('new document summary'), { target: { value: 'How we operate.' } });
    fireEvent.click(screen.getByText('Create document'));
    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith('.lovelace/documentation/architecture', 'runbooks', 'How we operate.'),
    );
  });

  it('deletes a document only after the warning modal is confirmed', async () => {
    const { onDeleteDocument } = renderDocuments(withPricing);
    fireEvent.click(screen.getByRole('button', { name: 'delete document pricing' }));
    // The warning modal opens; nothing is deleted yet.
    expect(screen.getByText('Delete this document?')).toBeTruthy();
    expect(onDeleteDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete document'));
    await waitFor(() =>
      expect(onDeleteDocument).toHaveBeenCalledWith('.lovelace/documentation/domain/pricing.md'),
    );
    expect(screen.queryByText('Delete this document?')).toBeNull();
  });

  it('cancels a document delete without deleting', () => {
    const { onDeleteDocument } = renderDocuments(withPricing);
    fireEvent.click(screen.getByRole('button', { name: 'delete document pricing' }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDeleteDocument).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this document?')).toBeNull();
  });

  it('deletes a folder after a warning that counts the documents inside it', async () => {
    const { onDeleteFolder } = renderDocuments(withPricing);
    fireEvent.click(screen.getByRole('button', { name: 'delete folder domain' }));
    expect(screen.getByText('Delete this folder?')).toBeTruthy();
    expect(screen.getByText(/permanently deletes the folder and the 2 documents inside it/)).toBeTruthy();
    expect(onDeleteFolder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete folder'));
    await waitFor(() => expect(onDeleteFolder).toHaveBeenCalledWith('.lovelace/documentation/domain'));
  });

  it('does not offer a delete on the documentation root', () => {
    renderDocuments();
    expect(screen.queryByRole('button', { name: 'delete folder /' })).toBeNull();
  });

  describe('corrupt files', () => {
    const withBroken: Snapshot = {
      ...snapshot,
      issues: [
        ...snapshot.issues,
        {
          severity: 'error',
          file: '.lovelace/documentation/domain/broken.md',
          line: 1,
          rule: 'parse',
          message: 'file must start with a --- frontmatter block',
        },
      ],
    };

    it('shows a corrupt badge in the tree for a file that failed frontmatter parsing', () => {
      renderDocuments(withBroken);
      expect(screen.getByText('broken')).toBeTruthy();
      expect(screen.getByText('corrupt')).toBeTruthy();
    });

    it('offers Fix Corrupt File instead of Edit when a corrupt file is selected, and wires the callback', async () => {
      const { onFixDocument } = renderDocuments(withBroken);
      fireEvent.click(screen.getByText('broken'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Fix Corrupt File' })).toBeTruthy());
      expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Fix Corrupt File' }));
      await waitFor(() =>
        expect(onFixDocument).toHaveBeenCalledWith('.lovelace/documentation/domain/broken.md'),
      );
    });

    it('still shows Edit and no Fix Corrupt File button for a valid selected document', async () => {
      renderDocuments(withBroken);
      await waitFor(() => expect(screen.getByText('Intro paragraph.')).toBeTruthy());
      expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Fix Corrupt File' })).toBeNull();
    });
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
    // Outcomes are machine values in the file; the view Title Cases them.
    expect(screen.getByText('Partial')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText(/9c41f2a/)).toBeTruthy();
  });
});
