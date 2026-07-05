import { useEffect, useState } from 'react';
import { CloseIcon } from './icons';
import type { SourceFile } from '../lib/host';
import { basename } from '../lib/links';
import { revealInFinder } from '../lib/os';
import { useHost } from '../state/store';

interface FilePreviewModalProps {
  root: string;
  /** Repository-relative path of the referenced file. */
  path: string;
  onClose: () => void;
}

/**
 * A read-only preview of a referenced file, read through the core host and
 * dispatched on its kind: text as code, images and PDFs rendered inline
 * (base64 from the host), anything else with a prompt to open it externally.
 * Mirrors the digest modal's shell; the Open button reveals the file in the OS.
 */
export function FilePreviewModal({ root, path, onClose }: FilePreviewModalProps) {
  const host = useHost();
  const [file, setFile] = useState<SourceFile | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const abs = `${root.replace(/\/$/, '')}/${path}`;

  useEffect(() => {
    setFile(null);
    void host.readSourceFile(root, path).then(setFile, () => setFile({ kind: 'missing' }));
  }, [host, root, path]);

  // PDFs render from a blob URL (more reliable in the webview than a data: URL).
  useEffect(() => {
    if (file?.kind === 'pdf' && file.base64 && typeof URL.createObjectURL === 'function') {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      setPdfUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPdfUrl(null);
    return undefined;
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const body = () => {
    if (file === null) return <p className="label">loading...</p>;
    if (file.kind === 'missing')
      return (
        <p className="subtle">
          This file no longer exists at <span className="mono">{path}</span>.
        </p>
      );
    if (file.truncated)
      return <p className="subtle">This file is too large to preview here. Open it to view.</p>;
    if (file.kind === 'image')
      return (
        <img className="file-preview-image" src={`data:${file.mime};base64,${file.base64}`} alt={basename(path)} />
      );
    if (file.kind === 'pdf')
      return pdfUrl ? (
        <iframe className="file-preview-pdf" src={pdfUrl} title={basename(path)} />
      ) : (
        <p className="label">loading...</p>
      );
    if (file.kind === 'binary')
      return <p className="subtle">This file can't be previewed here. Open it to view.</p>;
    return <pre className="file-preview-pre mono">{file.content}</pre>;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close preview" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="file-preview-card" role="dialog" aria-label="file preview">
          <div className="file-preview-head">
            <div className="file-preview-titles">
              <span className="file-preview-name">{basename(path)}</span>
              <span className="file-preview-path mono">{path}</span>
            </div>
            <div className="file-preview-actions">
              <button
                className="btn btn-primary"
                title="Show the file in Finder / Explorer"
                onClick={() => void revealInFinder(abs)}
              >
                Open
              </button>
            </div>
          </div>
          <div className="file-preview-well">{body()}</div>
        </div>
      </div>
    </div>
  );
}
