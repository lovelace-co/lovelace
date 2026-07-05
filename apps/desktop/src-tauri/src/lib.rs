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

fn is_ignored(path: &Path) -> bool {
    let p = path.to_string_lossy();
    // The live-agent marker is machine-local state the app must react to;
    // everything else under state/ and index/ is derived churn.
    if p.ends_with(".lovelace/state/presence.json") {
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
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if event.paths.iter().any(|p| !is_ignored(p)) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    watchers.insert(root.clone(), WatchEntry { watcher, refs: 1 });

    // Debounce: drain bursts of events, then emit one change notification.
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(Duration::from_millis(250)).is_ok() {}
            let _ = app.emit("lovelace://changed", json!({ "root": root }));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(WatchRegistry(Mutex::new(HashMap::new())))
        .manage(WindowCounter(AtomicU32::new(2)))
        .invoke_handler(tauri::generate_handler![
            core_request,
            watch_project,
            unwatch_project,
            new_window,
            apply_window_theme
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            // Tab and window management live in the web UI; the macOS menu
            // (built below) owns these accelerators and forwards them to the
            // focused window. Binding Cmd+W to "Close Tab" is what stops it
            // ever closing the OS window.
            "new_window" => emit_to_focused(app, "lovelace://new-window"),
            "new_tab" => emit_to_focused(app, "lovelace://new-tab"),
            "close_tab" => emit_to_focused(app, "lovelace://close-tab"),
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

                let app_menu = SubmenuBuilder::new(app, "Lovelace")
                    .about(Some(AboutMetadata::default()))
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

            // Check for updates in the background; failures are silent and
            // never block the app.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_updater::UpdaterExt;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(updater) = handle.updater() {
                        if let Ok(Some(update)) = updater.check().await {
                            let _ = update.download_and_install(|_, _| {}, || {}).await;
                        }
                    }
                });
            }
            #[cfg(debug_assertions)]
            {
                let _ = app;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lovelace");
}
