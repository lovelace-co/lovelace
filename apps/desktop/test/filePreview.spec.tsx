import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilePreviewModal } from '../src/components/FilePreviewModal';
import { HostProvider } from '../src/state/store';
import { FakeHost } from './fakeHost';

function renderPreview(host: FakeHost, path: string, onClose = vi.fn()) {
  return render(
    <HostProvider host={host}>
      <FilePreviewModal root="/repo" path={path} onClose={onClose} />
    </HostProvider>,
  );
}

describe('FilePreviewModal', () => {
  it('shows text contents, the path and an Open action', async () => {
    const host = new FakeHost();
    host.files.set('src/cache/store.ts', 'export const cache = new Map();\n');
    renderPreview(host, 'src/cache/store.ts');
    await waitFor(() => expect(screen.getByText(/export const cache/)).toBeTruthy());
    expect(screen.getByText('store.ts')).toBeTruthy();
    expect(screen.getByText('src/cache/store.ts')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('renders an image reference inline', async () => {
    const host = new FakeHost();
    host.sourceFiles.set('assets/logo.png', { kind: 'image', mime: 'image/png', base64: 'aGVsbG8=', size: 5 });
    renderPreview(host, 'assets/logo.png');
    const img = await screen.findByRole('img', { name: 'logo.png' });
    expect(img.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('renders a pdf reference inline', async () => {
    const host = new FakeHost();
    host.sourceFiles.set('docs/spec.pdf', { kind: 'pdf', mime: 'application/pdf', base64: 'JVBERi0x', size: 6 });
    renderPreview(host, 'docs/spec.pdf');
    await waitFor(() => expect(document.querySelector('iframe.file-preview-pdf')).not.toBeNull());
  });

  it('prompts to open a non-previewable binary file externally', async () => {
    const host = new FakeHost();
    host.sourceFiles.set('bin/app', { kind: 'binary', size: 2048 });
    renderPreview(host, 'bin/app');
    await waitFor(() => expect(screen.getByText(/can't be previewed/)).toBeTruthy());
  });

  it('closes on Escape', async () => {
    const host = new FakeHost();
    host.files.set('a.txt', 'hello');
    const onClose = vi.fn();
    renderPreview(host, 'a.txt', onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
