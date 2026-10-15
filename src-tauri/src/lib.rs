mod files;
mod notebooks;
mod data_store;
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

#[tauri::command]
async fn open_document(app: AppHandle) -> Result<Option<NativeFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().add_filter("Markdown", &["md", "markdown", "txt"]).blocking_pick_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let content = files::read_document(&path)?;
        let registry = app.state::<FileRegistry>();
        let mut opened = registry.files.lock().map_err(|_| "文件状态不可用".to_string())?;
        if let Some((id, _)) = opened.iter().find(|(_, file)| file.path == path) {
            return Ok(Some(payload(id.clone(), &path, content)));
        }
        let handle = registry.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        opened.insert(handle.clone(), OpenedFile { path: path.clone(), baseline: content.clone() });
        Ok(Some(payload(handle, &path, content)))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_document(app: AppHandle, handle: Option<String>, name: String, content: String) -> Result<Option<NativeFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<FileRegistry>();
        if let Some(id) = handle {
            let mut opened = registry.files.lock().map_err(|_| "文件状态不可用".to_string())?;
            let entry = opened.get_mut(&id).ok_or("文件会话已失效，请使用另存为")?;
            if entry.path.canonicalize().map_err(|_| "原文件已移动，请使用另存为")? != entry.path {
                return Err("文件位置发生变化，请使用另存为".into());
            }
            files::save_document(&entry.path, &content, Some(&entry.baseline))?;
            entry.baseline = content.clone();
            return Ok(Some(payload(id, &entry.path, content)));
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(FileRegistry::default())
        .manage(notebooks::NotebookRegistry::default())
        .invoke_handler(tauri::generate_handler![open_document, save_document, notebooks::open_notebook, notebooks::list_notebook, notebooks::open_notebook_file, notebooks::create_notebook_entry, notebooks::get_notebook_location, notebooks::reset_notebook_location, notebooks::rename_notebook_entry, notebooks::rename_document, notebooks::store_notebook_image, notebooks::read_notebook_image, notebooks::get_data_location])
        .run(tauri::generate_context!())
        .expect("启动笺墨失败");
}
