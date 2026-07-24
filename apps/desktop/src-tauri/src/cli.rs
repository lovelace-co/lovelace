//! Registers (and removes) a `lovelace` launcher on the user's PATH, the
//! desktop equivalent of VS Code's "Shell Command: Install 'code' command in
//! PATH". This is a launcher only: it opens or activates the app, never a
//! CLI, and never touches the sidecar binaries (they stay referenced by
//! absolute path by the integrations that already know them). See
//! ADR-0013 for the full rationale.
//!
//! macOS and Linux write a tiny shell script (mode 0755), not a symlink to
//! the app binary: there is no single-instance plugin, so exec'ing the
//! binary directly would start a second app process, whereas `open -b
//! co.lovelace.desktop` on macOS activates the already-running instance. The
//! script carries a marker comment so uninstall only ever removes what this
//! module created, never a `lovelace` the user put there themselves.
//!
//! Windows has no equivalent single-instance concern (the binary is
//! `Lovelace.exe`, and `lovelace` on PATH resolves to it case-insensitively),
//! so installing there just appends the app's install directory to the
//! user-level PATH via PowerShell; nothing is written to disk.
//!
//! No elevation, ever: macOS prefers `/usr/local/bin` only when it exists and
//! is writable by the current user, and falls back to `~/.local/bin`
//! (creating it) rather than prompting. Linux always uses `~/.local/bin`.
//! Windows edits the user (not machine) PATH, which needs no elevation.

use serde::Serialize;
use std::path::Path;

/// Every script this module writes carries this comment so uninstall (and
/// the "is this actually ours" conflict check on install) can tell a
/// Lovelace-managed launcher apart from an unrelated `lovelace` file the user
/// created themselves.
const MARKER: &str = "Lovelace launcher (managed by Lovelace; do not edit)";

fn is_marked(content: &str) -> bool {
    content.contains(MARKER)
}

/// The macOS launcher's exact content. `open -b` activates the app by bundle
/// identifier instead of starting a new process, which is what makes a
/// plain script safe to double-execute (no single-instance handling needed).
#[cfg(any(target_os = "macos", test))]
fn macos_script() -> String {
    format!("#!/bin/sh\n# {MARKER}\nexec open -b co.lovelace.desktop\n")
}

/// The Linux launcher's content. There is no macOS-style `open -b` on Linux,
/// so the script execs the app binary directly at its absolute path; a
/// stale path here (the app moved) is exactly what `current` in
/// `CliStatus` catches, since the script content no longer matches what
/// installing today would write.
#[cfg(any(target_os = "linux", test))]
fn linux_script(exe_path: &str) -> String {
    format!("#!/bin/sh\n# {MARKER}\nexec \"{exe_path}\"\n")
}

/// Windows PATH entries are semicolon separated. This is pure string logic
/// with no OS calls, kept separate from `windows_common`'s PowerShell IO so
/// it can be unit tested on any host, not only when actually compiling for
/// Windows.
#[cfg(any(target_os = "windows", test))]
fn eq_path_entry(a: &str, b: &str) -> bool {
    // Windows paths are case-insensitive and tolerate a trailing separator;
    // normalise both before comparing so "C:\\Lovelace\\" and "C:\\Lovelace"
    // are treated as the same entry.
    a.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(b.trim_end_matches(['\\', '/']))
}

/// Appends `entry` to the semicolon-separated PATH list `existing`, unless it
/// is already present, in which case `None` signals a no-op so the caller
/// can skip writing back an unchanged value (install must be idempotent).
#[cfg(any(target_os = "windows", test))]
fn append_path_entry(existing: &str, entry: &str) -> Option<String> {
    if existing.split(';').any(|e| eq_path_entry(e.trim(), entry)) {
        return None;
    }
    if existing.trim().is_empty() {
        Some(entry.to_string())
    } else if existing.ends_with(';') {
        Some(format!("{existing}{entry}"))
    } else {
        Some(format!("{existing};{entry}"))
    }
}

/// Removes `entry` from the semicolon-separated PATH list `existing`; `None`
/// means it was already absent, so uninstall can treat that as success
/// without writing back an unchanged value.
#[cfg(any(target_os = "windows", test))]
fn remove_path_entry(existing: &str, entry: &str) -> Option<String> {
    let parts: Vec<&str> = existing.split(';').collect();
    if !parts.iter().any(|e| eq_path_entry(e.trim(), entry)) {
        return None;
    }
    let kept: Vec<&str> = parts.into_iter().filter(|e| !eq_path_entry(e.trim(), entry)).collect();
    Some(kept.join(";"))
}

/// What the Command line section in Settings > General shows at rest.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    /// The launcher's file path (macOS/Linux) or PATH entry (Windows), when installed.
    pub location: Option<String>,
    /// Whether the location's directory is on the app process's PATH.
    ///
    /// Note: a GUI app launched from Finder/Dock on macOS can see a shorter
    /// PATH than the user's interactive shell (login items do not source
    /// .zshrc/.bash_profile), so this can read `false` even though a new
    /// terminal would find the command. That only affects which hint copy
    /// the UI shows; it never affects whether install/uninstall themselves
    /// are correct.
    pub on_path: bool,
    /// Whether the installed launcher matches what installing today would
    /// write. False means a stale script (an old app location, on Linux, or
    /// an old script format) that Install/Reinstall repairs.
    pub current: bool,
}

/// What `cli_command_install` reports once it has written (or already found
/// current) the launcher.
#[derive(Serialize)]
pub struct CliInstall {
    pub location: String,
    /// Plain-English follow-up the user should know, such as a fallback
    /// directory not being on PATH yet.
    pub note: Option<String>,
}

/// Shared macOS/Linux filesystem logic: locating the two candidate paths,
/// probing writability without elevation, and the marker-aware read/write/
/// remove operations both platforms build their install/status/uninstall on.
#[cfg(unix)]
mod unix_common {
    use super::is_marked;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    pub fn system_bin() -> PathBuf {
        PathBuf::from("/usr/local/bin/lovelace")
    }

    /// `~/.local/bin/lovelace`, resolved from `HOME` (no other crate for `~`
    /// expansion, per the brief; std only).
    pub fn home_local_bin() -> Result<PathBuf, String> {
        let home = std::env::var("HOME")
            .map_err(|_| "HOME is not set, so ~/.local/bin cannot be resolved".to_string())?;
        Ok(PathBuf::from(home).join(".local").join("bin").join("lovelace"))
    }

    /// Whether `dir` (the launcher's containing directory) shows up in the
    /// running app process's PATH. See `CliStatus::on_path` for the caveat
    /// about GUI apps seeing a shorter PATH than an interactive shell.
    pub fn dir_on_path(dir: &Path) -> bool {
        std::env::var("PATH")
            .map(|path| std::env::split_paths(&path).any(|p| p == dir))
            .unwrap_or(false)
    }

    /// Probes writability the only portable way std allows: attempt a real
    /// write and clean it up. This only ever runs against `/usr/local/bin`,
    /// never a directory holding user data, and never escalates privilege
    /// if the probe fails, it just falls back to `~/.local/bin`.
    pub fn is_writable_dir(dir: &Path) -> bool {
        if !dir.is_dir() {
            return false;
        }
        let probe = dir.join(format!(".lovelace-write-test-{}", std::process::id()));
        match std::fs::write(&probe, b"") {
            Ok(()) => {
                let _ = std::fs::remove_file(&probe);
                true
            }
            Err(_) => false,
        }
    }

    /// Deletes `path` if it exists and carries the Lovelace marker; anything
    /// else (missing, or present but not ours) is left untouched and counts
    /// as success, since removing a stale copy of our own launcher is best
    /// effort cleanup, not the operation the caller is asking for.
    pub fn remove_if_marked(path: &Path) -> Result<(), String> {
        match std::fs::read_to_string(path) {
            Ok(content) if is_marked(&content) => {
                std::fs::remove_file(path).map_err(|e| e.to_string())
            }
            _ => Ok(()),
        }
    }

    /// Writes `content` to `target` (creating its parent directory if
    /// needed) and marks it executable. Refuses to overwrite a file that
    /// already exists there without the Lovelace marker: that is someone
    /// else's `lovelace`, not a stale copy of ours.
    pub fn write_launcher(target: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = std::fs::read_to_string(target) {
            if !is_marked(&existing) {
                return Err(format!(
                    "{} already exists and is not a Lovelace launcher; remove it or move it aside, then try again.",
                    target.display()
                ));
            }
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(target, content).map_err(|e| e.to_string())?;
        let mut perms = std::fs::metadata(target).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(target, perms).map_err(|e| e.to_string())
    }

    /// Shared status check: the two candidate paths are the same on macOS
    /// and Linux, only the expected script content differs (passed in by
    /// the caller, since it depends on the current exe path on Linux).
    pub fn status(expected: &str) -> Result<super::CliStatus, String> {
        for path in [system_bin(), home_local_bin()?] {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if is_marked(&content) {
                    let dir = path.parent().unwrap_or_else(|| Path::new("/"));
                    return Ok(super::CliStatus {
                        installed: true,
                        location: Some(path.display().to_string()),
                        on_path: dir_on_path(dir),
                        current: content == expected,
                    });
                }
            }
        }
        Ok(super::CliStatus { installed: false, location: None, on_path: false, current: false })
    }

    /// Shared uninstall: remove a marked launcher at both candidate
    /// locations so a stale copy left behind by an old install never
    /// lingers. A `lovelace` file without the marker is not ours, so it is
    /// skipped silently rather than treated as an error; erroring there
    /// would strand our own launcher at the other candidate location. A
    /// missing file is success, which keeps uninstall idempotent.
    pub fn uninstall() -> Result<(), String> {
        remove_if_marked(&system_bin())?;
        remove_if_marked(&home_local_bin()?)?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn macos_status() -> Result<CliStatus, String> {
    unix_common::status(&macos_script())
}

#[cfg(target_os = "macos")]
fn macos_install() -> Result<CliInstall, String> {
    use unix_common::*;
    let content = macos_script();
    let system = system_bin();
    let fallback = home_local_bin()?;

    if is_writable_dir(Path::new("/usr/local/bin")) {
        // A stale copy from a previous fallback install is removed so
        // exactly one registration exists after this call.
        remove_if_marked(&fallback)?;
        write_launcher(&system, &content)?;
        return Ok(CliInstall { location: system.display().to_string(), note: None });
    }

    remove_if_marked(&system)?;
    write_launcher(&fallback, &content)?;
    let dir = fallback.parent().unwrap_or_else(|| Path::new("/"));
    let note = if dir_on_path(dir) {
        format!(
            "/usr/local/bin isn't available, so the command was written to {} instead.",
            fallback.display()
        )
    } else {
        format!(
            "/usr/local/bin isn't available, so the command was written to {} instead. Add {} to your PATH to use it from a terminal.",
            fallback.display(),
            dir.display()
        )
    };
    Ok(CliInstall { location: fallback.display().to_string(), note: Some(note) })
}

#[cfg(target_os = "linux")]
fn linux_status() -> Result<CliStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    unix_common::status(&linux_script(&exe.to_string_lossy()))
}

#[cfg(target_os = "linux")]
fn linux_install() -> Result<CliInstall, String> {
    use unix_common::*;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let content = linux_script(&exe.to_string_lossy());
    let fallback = home_local_bin()?;

    // Linux always targets ~/.local/bin; a marked copy left in
    // /usr/local/bin by, say, a script copied over from a macOS machine is
    // still cleaned up so exactly one registration exists.
    remove_if_marked(&system_bin())?;
    write_launcher(&fallback, &content)?;
    let dir = fallback.parent().unwrap_or_else(|| Path::new("/"));
    let note = if dir_on_path(dir) {
        None
    } else {
        Some(format!("Add {} to your PATH to use the command from a terminal.", dir.display()))
    };
    Ok(CliInstall { location: fallback.display().to_string(), note })
}

/// Windows PowerShell IO: reading and writing the user-level PATH registry
/// value. `CREATE_NO_WINDOW` stops a console flashing up behind the app for
/// every call.
#[cfg(target_os = "windows")]
mod windows_common {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn run(script: &str) -> Result<String, String> {
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("failed to run PowerShell: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "PowerShell exited with {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
    }

    pub fn get_user_path() -> Result<String, String> {
        run("[Environment]::GetEnvironmentVariable('Path','User')")
    }

    /// Single-quotes `value` for PowerShell, doubling any embedded single
    /// quotes, and writes it back as the user PATH; this persists to the
    /// registry and broadcasts the environment change, all without
    /// elevation since it is the user (not machine) variable.
    pub fn set_user_path(value: &str) -> Result<(), String> {
        let escaped = value.replace('\'', "''");
        run(&format!("[Environment]::SetEnvironmentVariable('Path', '{escaped}', 'User')")).map(|_| ())
    }
}

#[cfg(target_os = "windows")]
fn windows_status() -> Result<CliStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "the app executable has no parent directory".to_string())?
        .to_string_lossy()
        .to_string();
    let path = windows_common::get_user_path()?;
    let present = path.split(';').any(|e| eq_path_entry(e.trim(), &dir));
    // Windows has no separate script to go stale: the "install" is the PATH
    // entry itself, so `installed`, `onPath` and `current` all collapse to
    // whether that entry is present.
    Ok(CliStatus {
        installed: present,
        location: if present { Some(dir) } else { None },
        on_path: present,
        current: present,
    })
}

#[cfg(target_os = "windows")]
fn windows_install() -> Result<CliInstall, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "the app executable has no parent directory".to_string())?
        .to_string_lossy()
        .to_string();
    let existing = windows_common::get_user_path()?;
    if let Some(updated) = append_path_entry(&existing, &dir) {
        windows_common::set_user_path(&updated)?;
    }
    // else: already present, nothing to write back; install stays idempotent.
    Ok(CliInstall {
        location: dir,
        note: Some("Open a new terminal window for the change to take effect.".to_string()),
    })
}

#[cfg(target_os = "windows")]
fn windows_uninstall() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "the app executable has no parent directory".to_string())?
        .to_string_lossy()
        .to_string();
    let existing = windows_common::get_user_path()?;
    if let Some(updated) = remove_path_entry(&existing, &dir) {
        windows_common::set_user_path(&updated)?;
    }
    // else: the entry was already absent, which is success.
    Ok(())
}

#[tauri::command]
pub fn cli_command_status() -> Result<CliStatus, String> {
    #[cfg(target_os = "macos")]
    {
        macos_status()
    }
    #[cfg(target_os = "linux")]
    {
        linux_status()
    }
    #[cfg(target_os = "windows")]
    {
        windows_status()
    }
}

#[tauri::command]
pub fn cli_command_install() -> Result<CliInstall, String> {
    #[cfg(target_os = "macos")]
    {
        macos_install()
    }
    #[cfg(target_os = "linux")]
    {
        linux_install()
    }
    #[cfg(target_os = "windows")]
    {
        windows_install()
    }
}

#[tauri::command]
pub fn cli_command_uninstall() -> Result<(), String> {
    #[cfg(unix)]
    {
        unix_common::uninstall()
    }
    #[cfg(target_os = "windows")]
    {
        windows_uninstall()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_script_carries_the_marker_and_activates_by_bundle_id() {
        let script = macos_script();
        assert!(script.contains(MARKER));
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains("exec open -b co.lovelace.desktop\n"));
    }

    #[test]
    fn linux_script_execs_the_given_absolute_path() {
        let script = linux_script("/opt/Lovelace/lovelace-desktop");
        assert!(script.contains(MARKER));
        assert!(script.contains("exec \"/opt/Lovelace/lovelace-desktop\"\n"));
    }

    #[test]
    fn is_marked_detects_the_lovelace_comment_and_nothing_else() {
        assert!(is_marked(&macos_script()));
        assert!(is_marked(&linux_script("/x")));
        assert!(!is_marked("#!/bin/sh\necho hi\n"));
        assert!(!is_marked(""));
    }

    #[test]
    fn append_path_entry_is_a_noop_when_already_present() {
        assert_eq!(append_path_entry("C:\\a;C:\\b", "C:\\a"), None);
        // Case-insensitive and trailing-separator tolerant, like Windows paths.
        assert_eq!(append_path_entry("C:\\a;C:\\b", "c:\\A"), None);
        assert_eq!(append_path_entry("C:\\a;C:\\b\\", "C:\\b"), None);
    }

    #[test]
    fn append_path_entry_appends_when_absent() {
        assert_eq!(append_path_entry("C:\\a;C:\\b", "C:\\c"), Some("C:\\a;C:\\b;C:\\c".to_string()));
        assert_eq!(append_path_entry("", "C:\\c"), Some("C:\\c".to_string()));
        assert_eq!(append_path_entry("C:\\a;", "C:\\c"), Some("C:\\a;C:\\c".to_string()));
    }

    #[test]
    fn append_then_append_again_is_idempotent() {
        let once = append_path_entry("C:\\a", "C:\\Lovelace").unwrap();
        assert_eq!(append_path_entry(&once, "C:\\Lovelace"), None);
    }

    #[test]
    fn remove_path_entry_is_a_noop_when_absent() {
        assert_eq!(remove_path_entry("C:\\a;C:\\b", "C:\\c"), None);
        assert_eq!(remove_path_entry("", "C:\\c"), None);
    }

    #[test]
    fn remove_path_entry_removes_a_case_insensitive_match() {
        assert_eq!(remove_path_entry("C:\\a;C:\\Lovelace;C:\\b", "c:\\lovelace"), Some("C:\\a;C:\\b".to_string()));
    }

    #[test]
    fn remove_then_remove_again_is_idempotent() {
        let once = remove_path_entry("C:\\a;C:\\Lovelace;C:\\b", "C:\\Lovelace").unwrap();
        assert_eq!(remove_path_entry(&once, "C:\\Lovelace"), None);
    }
}
