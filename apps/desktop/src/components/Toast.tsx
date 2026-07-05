import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';

interface ToastProps {
  /** Problems stay until dismissed; notices drain away on their own. */
  kind?: 'notice' | 'problem';
  onDismiss?: () => void;
  children: ReactNode;
}

const NOTICE_LIFETIME_MS = 6000;

function toastRoot(): HTMLElement {
  let el = document.getElementById('toast-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-root';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * A floating message in the corner, so the layout never moves. Problems
 * persist until dismissed or resolved; notices show their remaining life
 * as a draining line and dismiss themselves.
 */
export function Toast({ kind = 'problem', onDismiss, children }: ToastProps) {
  useEffect(() => {
    if (kind !== 'notice' || onDismiss === undefined) return;
    const timer = window.setTimeout(onDismiss, NOTICE_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [kind, onDismiss]);

  return createPortal(
    <div className={`toast ${kind}`} role={kind === 'problem' ? 'alert' : 'status'}>
      <span className="toast-body">{children}</span>
      {onDismiss !== undefined && (
        <button className="toast-close" aria-label="dismiss message" onClick={onDismiss}>
          <CloseIcon />
        </button>
      )}
    </div>,
    toastRoot(),
  );
}
