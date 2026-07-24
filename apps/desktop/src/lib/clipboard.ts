/**
 * Clipboard writes, routed through the Tauri v2 clipboard-manager plugin
 * inside the app shell (bare `navigator.clipboard` does not work reliably in
 * the Tauri webview on every platform); falls back to `navigator.clipboard`
 * outside the shell, for example a plain browser during dev.
 */
export async function copyText(text: string): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
