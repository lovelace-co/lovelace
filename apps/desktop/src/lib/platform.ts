/**
 * Platform detection for keyboard-shortcut labels. Guarded so it is safe
 * under both a real webview and jsdom, where `navigator` may be absent or
 * incomplete.
 */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Mac') || false;
}

/** The label for the app's search shortcut, matching the host platform. */
export const searchShortcutLabel: string = isMac() ? '⌘K' : 'ctrl+K';
