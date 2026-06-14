import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A right-click menu rendered with the app's dropdown panel design. Closes
 * on selection, on Escape, on an outside click, and on scroll. Kept inside
 * the viewport from the click point.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const width = 184;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - (items.length * 38 + 16));

  return createPortal(
    <div
      ref={ref}
      className="dropdown-panel context-menu"
      style={{ position: 'fixed', left, top, minWidth: width }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`dropdown-option${item.danger ? ' danger' : ''}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
