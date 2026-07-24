/**
 * Thin wrappers over the Rust `cli_command_*` Tauri commands that register a
 * `lovelace` launcher on the user's PATH (Settings > General > Command line).
 * Mirrors the dynamic-import invoke pattern used elsewhere (see
 * UpdatePill.tsx) so these modules load only when actually called, and stay
 * inert outside the app shell.
 */

/** What `cli_command_status` reports about the launcher. */
export interface CliStatus {
  /** A Lovelace-marked launcher exists at a candidate PATH location. */
  installed: boolean;
  /** The launcher's file path (macOS/Linux) or PATH entry (Windows), when installed. */
  location: string | null;
  /** Whether the location's directory is on the app process's PATH. */
  onPath: boolean;
  /** Whether the installed launcher matches what installing today would write; false means it is stale (an old location or format) and Install repairs it. */
  current: boolean;
}

/** What `cli_command_install` reports after (re)installing the launcher. */
export interface CliInstall {
  location: string;
  /** A plain-English note when something needs the user's attention, such as a fallback directory not being on PATH. */
  note: string | null;
}

/** True when running inside the Tauri app shell; the Command line section hides itself otherwise. */
export function isShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function cliStatus(): Promise<CliStatus> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CliStatus>('cli_command_status');
}

export async function cliInstall(): Promise<CliInstall> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CliInstall>('cli_command_install');
}

export async function cliUninstall(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cli_command_uninstall');
}
