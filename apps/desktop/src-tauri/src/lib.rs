mod cli;

use cli::{cli_command_install, cli_command_status, cli_command_uninstall};
use notify::{RecursiveMode, Watcher};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

/// One file watcher per project root, reference counted so several windows can
/// watch the same project and only the last one to leave tears it down.
struct WatchEntry {
    // Held purely to keep the watch alive; dropping it stops watching.
    #[allow(dead_code)]
    watcher: notify::RecommendedWatcher,
    refs: usize,
}

struct WatchRegistry(Mutex<HashMap<String, WatchEntry>>);

/// Monotonic source of unique window labels. The first window (from the config)
/// is "main"; windows opened with Cmd+N are "win-2", "win-3", and so on.
struct WindowCounter(AtomicU32);

/// An update that has been checked and downloaded (signature verified) but not
/// yet installed: the plugin's metadata alongside the installer bytes. Staged
/// rather than installed immediately, so the user restarts on their own terms.
struct StagedUpdate(Mutex<Option<(Update, Vec<u8>)>>);

/// Opens another app window, cloning the main window's full configuration
/// (background colour, size, title bar) so it looks identical, with only a
/// fresh label. A secondary window identifies itself by that label (not
/// "main"), so its UI starts on a fresh Welcome tab and leaves the saved
/// session untouched.
fn create_window(app: &AppHandle) -> Result<(), String> {
    let n = app.state::<WindowCounter>().0.fetch_add(1, Ordering::Relaxed);
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "no window configuration to clone".to_string())?;
    config.label = format!("win-{n}");
    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Sends a UI event to the window the user is actually looking at. A menu
/// command is app-global on macOS, so without this every open window would
/// react to one Cmd+T or Cmd+W.
fn emit_to_focused(app: &AppHandle, event: &str) {
    let focused = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false));
    match focused {
        Some(win) => {
            let _ = win.emit(event, ());
        }
        None => {
            let _ = app.emit(event, ());
        }
    }
}

/// Resolves how to run the core host. A bundled sidecar binary sits next to
/// the app executable in production; LOVELACE_HOST_JS points at the built
/// host.js during development.
fn host_command() -> Result<Command, String> {
    if let Ok(js) = std::env::var("LOVELACE_HOST_JS") {
        let node = std::env::var("LOVELACE_NODE").unwrap_or_else(|_| "node".into());
        let mut cmd = Command::new(node);
        cmd.arg(js);
        return Ok(cmd);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("app executable has no parent directory")?;
    let candidates = [
        dir.join("lovelace-host"),
        dir.join("lovelace-host.exe"),
        // macOS bundles sidecars in Contents/MacOS next to the binary, but a
        // dev `cargo run` looks in target/debug; fall back to the repo build.
        dir.join("../Resources/lovelace-host"),
    ];
    for candidate in candidates {
        if candidate.exists() {
            return Ok(Command::new(candidate));
        }
    }
    Err("lovelace-host binary not found next to the app, and LOVELACE_HOST_JS is not set".into())
}

#[tauri::command]
async fn core_request(request: String) -> Result<String, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = host_command()?;
        cmd.arg(&request);
        cmd.output().map_err(|e| format!("failed to run core host: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("core host produced no output: {stderr}"));
    }
    Ok(stdout)
}

/// True for a presence marker: the legacy singleton file, the per-session
/// presence directory, or anything under it. These heartbeat on every agent
/// tool call, so a batch touching only presence paths must not read as a
/// "real" change to the project.
fn is_presence(path: &Path) -> bool {
    let p = path.to_string_lossy();
    p.ends_with(".lovelace/state/presence.json")
        || p.contains("/.lovelace/state/presence/")
        || p.ends_with(".lovelace/state/presence")
}

fn is_ignored(path: &Path) -> bool {
    let p = path.to_string_lossy();
    // The live-agent markers are machine-local state the app must react to;
    // everything else under state/ and index/ is derived churn. The legacy
    // singleton file and the per-session presence directory (and its
    // contents) are both let through.
    if is_presence(path) {
        return false;
    }
    p.contains("/.lovelace/index/")
        || p.contains("/.lovelace/state/")
        || p.contains("/.lovelace/.")
        || p.ends_with(".lovelace/index")
        || p.ends_with(".lovelace/state")
}

#[tauri::command]
fn watch_project(
    app: AppHandle,
    registry: State<'_, WatchRegistry>,
    root: String,
) -> Result<(), String> {
    let mut watchers = registry.0.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = watchers.get_mut(&root) {
        entry.refs += 1;
        return Ok(());
    }
    let dir = PathBuf::from(&root).join(".lovelace");
    if !dir.exists() {
        return Err(format!("{root} has no .lovelace directory"));
    }
    // Each event reports whether it carries a REAL change, i.e. a
    // non-ignored path that is not a presence marker; a batch of only
    // presence writes sends false so the debounce loop can skip the toast.
    let (tx, rx) = mpsc::channel::<bool>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let relevant: Vec<_> = event.paths.iter().filter(|p| !is_ignored(p)).collect();
            if !relevant.is_empty() {
                let real = relevant.iter().any(|p| !is_presence(p));
                let _ = tx.send(real);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    watchers.insert(root.clone(), WatchEntry { watcher, refs: 1 });

    // Debounce: drain bursts of events, OR-ing whether any of them was a
    // real change, then emit one change notification.
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut real = first;
            while let Ok(next) = rx.recv_timeout(Duration::from_millis(250)) {
                real = real || next;
            }
            let _ = app.emit("lovelace://changed", json!({ "root": root, "presenceOnly": !real }));
        }
    });
    Ok(())
}

#[tauri::command]
fn unwatch_project(registry: State<'_, WatchRegistry>, root: String) -> Result<(), String> {
    let mut watchers = registry.0.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = watchers.get_mut(&root) {
        entry.refs = entry.refs.saturating_sub(1);
        if entry.refs == 0 {
            watchers.remove(&root);
        }
    }
    Ok(())
}

#[tauri::command]
fn new_window(app: AppHandle) -> Result<(), String> {
    create_window(&app)
}

/// Matches the native window chrome (title bar) to the app theme. Done on the
/// Rust side so it needs no frontend permission, and logs the outcome so the
/// behaviour can be verified.
#[tauri::command]
fn apply_window_theme(window: tauri::WebviewWindow, dark: bool) {
    use std::io::Write;
    use tauri::window::Color;
    let theme = if dark {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    };
    let bg = if dark {
        Color(0x14, 0x18, 0x1d, 0xff)
    } else {
        Color(0xed, 0xf1, 0xf6, 0xff)
    };
    let t = window.set_theme(Some(theme));
    let b = window.set_background_color(Some(bg));
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/lovelace-theme.log")
    {
        let _ = writeln!(
            f,
            "label={} dark={} set_theme={:?} set_bg={:?}",
            window.label(),
            dark,
            t,
            b
        );
    }
}

/// Shows a native "Ok" message dialog titled for the update feature. Used for
/// every outcome a manual check can surface (up to date, or the check failed);
/// background checks never call this, so they stay silent.
fn show_update_dialog(handle: &AppHandle, message: &str) {
    handle
        .dialog()
        .message(message)
        .title("Software Update")
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

/// Checks the configured update endpoint once. Both the silent 24-hour
/// background cadence and the "Check for Updates…" menu item call this, with
/// `manual` set only for the latter: it controls whether the outcome (no
/// update available, or the check failing) surfaces to the user through a
/// dialog. An available update is only ever downloaded and staged here, never
/// installed, so the user restarts on their own terms via `install_update`.
async fn check_for_updates(handle: AppHandle, manual: bool) {
    let mut builder = handle.updater_builder();
    // LOVELACE_UPDATE_ENDPOINT lets a build point at a staging feed instead of
    // the production one; signature verification against the committed pubkey
    // still applies regardless of which endpoint served the manifest, which is
    // what makes this override safe. When the variable is set but not a valid
    // URL the check refuses to run rather than silently falling back to the
    // production feed, since whoever set it plainly meant to point elsewhere.
    if let Ok(endpoint) = std::env::var("LOVELACE_UPDATE_ENDPOINT") {
        let url: tauri::Url = match endpoint.parse() {
            Ok(url) => url,
            Err(_) => {
                if manual {
                    show_update_dialog(
                        &handle,
                        "LOVELACE_UPDATE_ENDPOINT is set but is not a valid URL; the update check did not run.",
                    );
                }
                return;
            }
        };
        match builder.endpoints(vec![url]) {
            Ok(overridden) => builder = overridden,
            Err(e) => {
                if manual {
                    show_update_dialog(&handle, &format!("Checking for updates failed: {e}"));
                }
                return;
            }
        }
    }
    let updater = match builder.build() {
        Ok(updater) => updater,
        Err(e) => {
            if manual {
                show_update_dialog(&handle, &format!("Checking for updates failed: {e}"));
            }
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let already_staged = handle
                .state::<StagedUpdate>()
                .0
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|(staged, _)| staged.version == update.version);
            if already_staged {
                // Nothing changed since the last check; re-announce the same
                // staged update rather than downloading it again.
                let _ = handle.emit(
                    "lovelace://update-ready",
                    json!({ "version": update.version, "notes": update.body }),
                );
                return;
            }
            match update.download(|_, _| {}, || {}).await {
                Ok(bytes) => {
                    let version = update.version.clone();
                    let notes = update.body.clone();
                    *handle.state::<StagedUpdate>().0.lock().unwrap() = Some((update, bytes));
                    let _ = handle.emit(
                        "lovelace://update-ready",
                        json!({ "version": version, "notes": notes }),
                    );
                }
                Err(e) => {
                    if manual {
                        show_update_dialog(&handle, &format!("Checking for updates failed: {e}"));
                    }
                }
            }
        }
        Ok(None) => {
            if manual {
                let version = handle.package_info().version.to_string();
                show_update_dialog(&handle, &format!("Lovelace {version} is up to date."));
            }
        }
        Err(e) => {
            if manual {
                show_update_dialog(&handle, &format!("Checking for updates failed: {e}"));
            }
        }
    }
}

/// Returns the currently staged update, in the same shape as the
/// "lovelace://update-ready" event payload, or `None` if nothing is staged.
/// Lets a webview learn about an update it missed: a window opened after
/// staging (Cmd+N), or one whose listener registered after the event already
/// fired.
#[tauri::command]
fn staged_update(staged: State<'_, StagedUpdate>) -> Result<Option<serde_json::Value>, String> {
    let staged = staged.0.lock().map_err(|e| e.to_string())?;
    Ok(staged
        .as_ref()
        .map(|(update, _)| json!({ "version": update.version, "notes": update.body })))
}

/// Installs the update staged by `check_for_updates` and restarts. Installing
/// moves files on disk and is a blocking call, so it runs off the main thread;
/// that lets the webview stay responsive and show its own "Restarting" state
/// while it waits on this command.
#[tauri::command]
async fn install_update(app: AppHandle, staged: State<'_, StagedUpdate>) -> Result<(), String> {
    let taken = staged.0.lock().map_err(|e| e.to_string())?.take();
    let (update, bytes) = taken.ok_or_else(|| "no update is staged".to_string())?;
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())?;
    if let Err(e) = installed {
        // Installing consumed the staged download, so a retry now could only
        // fail with "no update is staged". Kick off a background check to
        // download and stage afresh, then report the failure.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            check_for_updates(handle, false).await;
        });
        return Err(e.to_string());
    }
    // On Windows the installer relaunches the app itself, so this may never
    // return; that is the plugin's documented behaviour.
    app.restart()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(WatchRegistry(Mutex::new(HashMap::new())))
        .manage(WindowCounter(AtomicU32::new(2)))
        .manage(StagedUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            core_request,
            watch_project,
            unwatch_project,
            new_window,
            apply_window_theme,
            install_update,
            staged_update,
            cli_command_status,
            cli_command_install,
            cli_command_uninstall
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            // Tab and window management live in the web UI; the macOS menu
            // (built below) owns these accelerators and forwards them to the
            // focused window. Binding Cmd+W to "Close Tab" is what stops it
            // ever closing the OS window.
            "new_window" => emit_to_focused(app, "lovelace://new-window"),
            "new_tab" => emit_to_focused(app, "lovelace://new-tab"),
            "close_tab" => emit_to_focused(app, "lovelace://close-tab"),
            "check_updates" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    check_for_updates(handle, true).await;
                });
            }
            _ => {}
        })
        .setup(|app| {
            // macOS auto-builds a default menu whose Window > Close item is
            // bound to Cmd+W and closes the window. Replace that menu so the
            // accelerator belongs to a custom "Close Tab" item instead; the OS
            // window can then only be closed deliberately (red button, Cmd+Q).
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

                let new_window = MenuItemBuilder::with_id("new_window", "New Window")
                    .accelerator("CmdOrCtrl+N")
                    .build(app)?;
                let new_tab = MenuItemBuilder::with_id("new_tab", "New Tab")
                    .accelerator("CmdOrCtrl+T")
                    .build(app)?;
                let close_tab = MenuItemBuilder::with_id("close_tab", "Close Tab")
                    .accelerator("CmdOrCtrl+W")
                    .build(app)?;
                let check_updates =
                    MenuItemBuilder::with_id("check_updates", "Check for Updates…").build(app)?;

                let app_menu = SubmenuBuilder::new(app, "Lovelace")
                    .about(Some(AboutMetadata::default()))
                    .separator()
                    .item(&check_updates)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let file_menu = SubmenuBuilder::new(app, "File")
                    .item(&new_window)
                    .item(&new_tab)
                    .separator()
                    .item(&close_tab)
                    .build()?;

                // Keep native text editing working in the block editor.
                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let window_menu = SubmenuBuilder::new(app, "Window").minimize().build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
                    .build()?;
                app.set_menu(menu)?;
            }

            // Check for updates in the background on a 24-hour cadence, first
            // run immediate; downloads stage silently and never install or
            // block the app on their own (see check_for_updates). A debug
            // build only runs this loop when pointed at a staging feed via
            // LOVELACE_UPDATE_ENDPOINT, so day-to-day development never talks
            // to the production endpoint.
            let auto_check = !cfg!(debug_assertions) || std::env::var("LOVELACE_UPDATE_ENDPOINT").is_ok();
            if auto_check {
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        check_for_updates(handle, false).await;
                    });
                    std::thread::sleep(Duration::from_secs(24 * 60 * 60));
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lovelace");
}
