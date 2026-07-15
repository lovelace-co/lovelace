/**
 * OS-level actions on files, via tauri-plugin-opener. Mirrors the dynamic-import
 * pattern used by host.pickDirectory: the plugin is called straight from the
 * frontend, gated by a capability permission. Outside the app shell (a plain
 * browser during dev) these are no-ops rather than errors. Paths are absolute.
 */

function inShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Highlight a file in Finder / Explorer. */
export async function revealInFinder(absPath: string): Promise<void> {
  if (!inShell()) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(absPath);
}

/** Open a file with the operating system's default application. */
export async function openExternally(absPath: string): Promise<void> {
  if (!inShell()) return;
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(absPath);
}

/** Open a URL (including mailto: links) with the system's default handler. */
export async function openUrl(url: string): Promise<void> {
  if (!inShell()) return;
  const { openUrl: tauriOpenUrl } = await import('@tauri-apps/plugin-opener');
  await tauriOpenUrl(url);
}
