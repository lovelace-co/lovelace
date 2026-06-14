import type { PointerEvent } from 'react';

/**
 * The punch: clicks feel like a card passing through the machine.
 * On pointerdown the element depresses in discrete steps and an 8px
 * signal-ringed hole appears at the contact point, then heals. The punch
 * accompanies the action; it never delays it.
 */
export function punch(event: PointerEvent<HTMLElement>): void {
  const el = event.currentTarget;
  el.classList.add('pressing');
  const mark = document.createElement('span');
  mark.className = 'punch-mark';
  const rect = el.getBoundingClientRect();
  mark.style.left = `${event.clientX - rect.left}px`;
  mark.style.top = `${event.clientY - rect.top}px`;
  el.appendChild(mark);
  mark.addEventListener('animationend', () => mark.remove());
}

export function release(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.classList.remove('pressing');
}
