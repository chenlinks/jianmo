mod files;
mod notebooks;
mod data_store;
mod launch;
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf, sync::{Mutex, atomic::{AtomicU64, Ordering}}};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

struct OpenedFile { path: PathBuf, baseline: String }
#[derive(Default)]
struct FileRegistry { files: Mutex<HashMap<String, OpenedFile>>, next_id: AtomicU64 }
#[derive(Serialize)]
struct NativeFile { handle: String, path: String, name: String, content: String }
fn payload(handle: String, path: &std::path::Path, content: String) -> NativeFile {
    NativeFile { handle, path: path.to_string_lossy().into(), name: path.file_name().unwrap_or_default().to_string_lossy().into(), content }
}

fn open_path(registry: &FileRegistry, path: &std::path::Path) -> Result<NativeFile, String> {
    let path = path.canonicalize().map_err(|e| format!("无法打开 {}：{e}", path.display()))?;
    let content = files::read_document(&path)?;
    let mut opened = registry.files.lock().map_err(|_| "文件状态不可用".to_string())?;
    if let Some((id, _)) = opened.iter().find(|(_, file)| file.path == path) {
        // Reopening must not reset the baseline used to detect external edits.
        return Ok(payload(id.clone(), &path, content));
    }
    let handle = registry.next_id.fetch_add(1, Ordering::Relaxed).to_string();
    opened.insert(handle.clone(), OpenedFile { path: path.clone(), baseline: content.clone() });
    Ok(payload(handle, &path, content))
}

fn read_opened_file(registry: &FileRegistry, handle: String) -> Result<NativeFile, String> {
    let path = registry.files.lock().map_err(|_| "文件状态不可用")?
        .get(&handle).ok_or("文件会话已失效，请重新打开文件")?.path.clone();
    if path.canonicalize().map_err(|_| "原文件已移动、删除或无法访问")? != path {
        return Err("文件位置发生变化，请重新打开文件".into());
    }
    let content = files::read_document(&path)?;
    Ok(payload(handle, &path, content))
}

fn save_opened_file(registry: &FileRegistry, id: String, content: String, expected: Option<&str>) -> Result<NativeFile, String> {
    let mut opened = registry.files.lock().map_err(|_| "文件状态不可用".to_string())?;
    let entry = opened.get_mut(&id).ok_or("文件会话已失效，请使用另存为")?;
    if entry.path.canonicalize().map_err(|_| "原文件已移动，请使用另存为")? != entry.path {
        return Err("文件位置发生变化，请使用另存为".into());
    }
    files::save_document(&entry.path, &content, Some(expected.unwrap_or(&entry.baseline)))?;
    entry.baseline = content.clone();
    Ok(payload(id, &entry.path, content))
}

#[tauri::command]
async fn open_document(app: AppHandle) -> Result<Option<NativeFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().add_filter("Markdown", &["md", "markdown", "txt"]).blocking_pick_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        open_path(&app.state::<FileRegistry>(), &path).map(Some)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_document(app: AppHandle, handle: String) -> Result<NativeFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_opened_file(&app.state::<FileRegistry>(), handle)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn reveal_document(app: AppHandle, handle: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<FileRegistry>();
        let path = registry.files.lock().map_err(|_| "文件状态不可用")?
            .get(&handle).ok_or("文件会话已失效，请重新打开文件")?.path.clone();
        files::reveal_document(&path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_document(app: AppHandle, handle: Option<String>, name: String, content: String, expected: Option<String>) -> Result<Option<NativeFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<FileRegistry>();
        if let Some(id) = handle {
            return save_opened_file(&registry, id, content, expected.as_deref()).map(Some);
        }
        // The frontend never supplies an arbitrary path; every new destination comes from this dialog.
        let safe_name = std::path::Path::new(&name).file_name().and_then(|v| v.to_str()).unwrap_or("未命名.md");
        let selected = app.dialog().file().set_file_name(safe_name).add_filter("Markdown", &["md", "markdown", "txt"]).blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let path = if path.exists() { path.canonicalize().map_err(|e| e.to_string())? } else { path };
        let mut opened = registry.files.lock().map_err(|_| "文件状态不可用".to_string())?;
        if opened.values().any(|entry| entry.path == path) { return Err("此文件已在当前会话中打开。请返回原文档保存，或选择不同文件名。".into()); }
        files::save_document(&path, &content, None)?;
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let handle = registry.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        opened.insert(handle.clone(), OpenedFile { path: path.clone(), baseline: content.clone() });
        Ok(Some(payload(handle, &path, content)))
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(launch::PendingDocuments::from_args(std::env::args_os(), &std::env::current_dir().unwrap_or_default()));
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        launch::enqueue(app, args.into_iter().map(std::ffi::OsString::from), std::path::Path::new(&cwd));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(FileRegistry::default())
        .manage(notebooks::NotebookRegistry::default())
        .invoke_handler(tauri::generate_handler![open_document, read_document, reveal_document, save_document, launch::take_pending_documents, notebooks::open_notebook, notebooks::list_notebook, notebooks::open_notebook_file, notebooks::create_notebook_entry, notebooks::get_notebook_location, notebooks::reset_notebook_location, notebooks::rename_notebook_entry, notebooks::rename_document, notebooks::store_notebook_image, notebooks::read_notebook_image, notebooks::get_data_location])
        .run(tauri::generate_context!())
        .expect("启动笺墨失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rereads_disk_and_saves_against_the_version_shown_in_the_editor() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external.md");
        std::fs::write(&path, "first").unwrap();
        let registry = FileRegistry::default();
        let first = open_path(&registry, &path).unwrap();
        std::fs::write(&path, "second").unwrap();
        let fresh = read_opened_file(&registry, first.handle.clone()).unwrap();
        assert_eq!(fresh.content, "second");
        // A refresh must not authorize overwriting an older, dirty editor snapshot.
        assert!(save_opened_file(&registry, first.handle.clone(), "old draft".into(), Some("first")).is_err());
        save_opened_file(&registry, fresh.handle.clone(), "edited second".into(), Some(&fresh.content)).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edited second");
        std::fs::write(&path, "third").unwrap();
        assert!(save_opened_file(&registry, fresh.handle.clone(), "conflict".into(), Some("edited second")).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "third");
        std::fs::remove_file(&path).unwrap();
        assert!(read_opened_file(&registry, fresh.handle).is_err());
        assert!(read_opened_file(&registry, "unknown".into()).is_err());
    }
}
