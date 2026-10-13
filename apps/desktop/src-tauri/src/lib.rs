// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Lapin desktop: the viewer in a native window, plus what a browser cannot
//! give it — native Open / Save dialogs, reading and writing the picked file
//! in place, and `.lapin` files opened from Finder (or passed on the command
//! line) handed to the page. The page talks to these commands through
//! `window.__TAURI__` (`apps/viewer/src/lib/desktop/desktop-host.ts`).

use std::path::PathBuf;
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;

/// Event telling the page project files are waiting (`take_opened_files`).
const OPEN_FILE_EVENT: &str = "lapin://open-file";
const PACKAGE_EXTENSIONS: [&str; 2] = ["lapin", "bvproj"];

/// Files opened from outside (Finder, the command line) the page has not taken yet.
#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[derive(Deserialize)]
struct Filter {
    name: String,
    extensions: Vec<String>,
}

fn with_filters<R: tauri::Runtime>(
    mut dialog: tauri_plugin_dialog::FileDialogBuilder<R>,
    filters: &[Filter],
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    for f in filters {
        let exts: Vec<&str> = f.extensions.iter().map(|e| e.trim_start_matches('.')).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    dialog
}

fn path_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

/// The native Open panel; the picked path, or none when cancelled.
#[tauri::command]
async fn pick_open_file(app: AppHandle, filters: Vec<Filter>) -> Option<String> {
    with_filters(app.dialog().file(), &filters).blocking_pick_file().and_then(path_string)
}

/// The native Save panel, proposing `default_name`; the chosen path, or none when cancelled.
#[tauri::command]
async fn pick_save_file(app: AppHandle, default_name: String, filters: Vec<Filter>) -> Option<String> {
    with_filters(app.dialog().file(), &filters)
        .set_file_name(default_name)
        .blocking_save_file()
        .and_then(path_string)
}

/// A file's bytes, sent back raw (no JSON number arrays).
#[tauri::command]
async fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

/// Write the raw request body to the file named by the `x-path` header (percent-encoded):
/// first to a sibling temporary file, then renamed over it, so a failed write never
/// leaves half a project behind.
#[tauri::command]
async fn write_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_file expects the file's bytes as the request body".into());
    };
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("write_file needs an x-path header")?;
    let path = PathBuf::from(percent_decode_str(encoded).decode_utf8_lossy().into_owned());
    let mut tmp = path.clone().into_os_string();
    tmp.push(".lapin-tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

/// The project files opened from outside since the last call (each handed over once).
#[tauri::command]
fn take_opened_files(state: State<'_, OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

fn is_package(path: &str) -> bool {
    let lower = path.to_lowercase();
    PACKAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

fn queue_opened(app: &AppHandle, paths: Vec<String>) {
    let paths: Vec<String> = paths.into_iter().filter(|p| is_package(p)).collect();
    if paths.is_empty() {
        return;
    }
    app.state::<OpenedFiles>().0.lock().unwrap().extend(paths);
    let _ = app.emit(OPEN_FILE_EVENT, ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenedFiles::default())
        .invoke_handler(tauri::generate_handler![
            pick_open_file,
            pick_save_file,
            read_file,
            write_file,
            take_opened_files,
        ])
        .setup(|app| {
            // Windows / Linux pass a double-clicked file as an argument.
            let args: Vec<String> = std::env::args().skip(1).collect();
            queue_opened(app.handle(), args);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Lapin window");

    app.run(|handle, event| {
        // macOS hands files opened from Finder as an event, at launch or later.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = &event {
            let paths = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            queue_opened(handle, paths);
        }
        let _ = (handle, event);
    });
}
