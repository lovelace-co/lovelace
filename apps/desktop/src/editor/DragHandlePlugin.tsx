import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin';
import { useRef } from 'react';

const MENU_CLASS = 'drag-handle';

/** The playground's block drag handle, in the v4 voice. */
export function DragHandlePlugin({ anchorElem }: { anchorElem: HTMLElement | null }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetLineRef = useRef<HTMLDivElement | null>(null);

  if (!anchorElem) return null;

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef}
      targetLineRef={targetLineRef}
      menuComponent={
        <div ref={menuRef} className={MENU_CLASS} title="Drag to move this block" aria-hidden>
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="2.5" r="1.2" />
            <circle cx="7.5" cy="2.5" r="1.2" />
            <circle cx="2.5" cy="7" r="1.2" />
            <circle cx="7.5" cy="7" r="1.2" />
            <circle cx="2.5" cy="11.5" r="1.2" />
            <circle cx="7.5" cy="11.5" r="1.2" />
          </svg>
        </div>
      }
      targetLineComponent={<div ref={targetLineRef} className="drag-target-line" />}
      isOnMenu={(el) => !!el.closest(`.${MENU_CLASS}`)}
    />
  );
}
