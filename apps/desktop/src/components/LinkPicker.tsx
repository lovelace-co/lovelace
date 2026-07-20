import { useEffect, useRef, useState } from 'react';

interface LinkPickerProps {
  initialUrl: string;
  onSubmit: (url: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}

/**
 * The in-app replacement for the browser's native URL prompt: Tauri's webview
 * does not reliably show native JS dialogs, so both linking a new URL and
 * editing an existing one go through this modal, mirroring ReferencePicker.
 */
export function LinkPicker({ initialUrl, onSubmit, onRemove, onClose }: LinkPickerProps) {
  const [url, setUrl] = useState(initialUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = url.trim();
    if (trimmed === '') return;
    onSubmit(trimmed);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ref-picker" role="dialog" aria-label="Link a URL" onClick={(e) => e.stopPropagation()}>
        <h2>Link a URL</h2>
        <input
          ref={inputRef}
          className="form-input"
          aria-label="link url"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="comment-actions">
          {/* pointerdown+preventDefault, like ReferencePicker's list items, so
              the button click does not steal the editor's DOM selection first. */}
          {onRemove ? (
            <button
              type="button"
              className="btn btn-danger"
              onPointerDown={(e) => {
                e.preventDefault();
                onRemove();
              }}
            >
              Remove link
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="btn btn-primary"
            onPointerDown={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
