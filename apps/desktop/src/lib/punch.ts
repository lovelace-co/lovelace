import type { PointerEvent } from 'react';

/**
 * The press: a quick mechanical depress in discrete steps while the pointer
 * is down. Primary button only, so a right-click (context menu) does not
 * depress the card. The press accompanies the action; it never delays it.
 */
export function punch(event: PointerEvent<HTMLElement>): void {
  if (event.button !== 0) return;
  event.currentTarget.classList.add('pressing');
}

export function release(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.classList.remove('pressing');
}
