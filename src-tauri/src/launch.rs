use std::{ffi::OsString, path::{Path, PathBuf}, sync::Mutex};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use crate::{FileRegistry, NativeFile, open_path};

pub struct PendingDocuments(Mutex<Vec<PathBuf>>);

fn document_paths(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<PathBuf> {
    let mut positional = false;
    args.into_iter().skip(1).filter_map(|arg| {
        if !positional && arg == "--" { positional = true; return None; }
        if arg.is_empty() || (!positional && arg.to_string_lossy().starts_with('-')) { return None; }
        let path = PathBuf::from(arg);
        Some(if path.is_absolute() { path } else { cwd.join(path) })
    }).collect()
}

impl PendingDocuments {
    pub fn from_args(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Self {
        Self(Mutex::new(document_paths(args, cwd)))
    }
}

pub fn enqueue(app: &AppHandle, args: impl IntoIterator<Item = OsString>, cwd: &Path) {
    if let Ok(mut pending) = app.state::<PendingDocuments>().0.lock() {
        pending.extend(document_paths(args, cwd));
    }
    // Paths stay queued until the frontend is ready, even if this event arrives during startup.
    let _ = app.emit("documents-pending", ());
}

#[derive(Serialize)]
#[serde(tag = "status", content = "value", rename_all = "camelCase")]
pub enum OpenResult { Opened(NativeFile), Error(String) }

#[tauri::command]
pub async fn take_pending_documents(app: AppHandle) -> Result<Vec<OpenResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = std::mem::take(&mut *app.state::<PendingDocuments>().0.lock().map_err(|_| "文件队列不可用")?);
        let registry = app.state::<FileRegistry>();
        Ok(paths.into_iter().map(|path| match open_path(&registry, &path) {
            Ok(file) => OpenResult::Opened(file),
            Err(error) => OpenResult::Error(format!("{}：{error}", path.display())),
        }).collect())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_launch_paths_without_splitting_spaces_or_unicode() {
        let cwd = std::env::current_dir().unwrap();
        let absolute = cwd.join("绝对路径.txt");
        let args = vec!["jianmo.exe".into(), "中文 文件.MD".into(), absolute.clone().into_os_string(), "--".into(), "-note.markdown".into()];
        assert_eq!(document_paths(args, &cwd), vec![cwd.join("中文 文件.MD"), absolute, cwd.join("-note.markdown")]);
        assert!(document_paths(vec!["jianmo.exe".into(), "--flag".into()], &cwd).is_empty());
    }

    #[test]
    fn opens_launch_files_with_save_handles_and_preserves_conflict_baselines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文 文件.md");
        std::fs::write(&path, "# 原文").unwrap();
        let registry = FileRegistry::default();
        let first = open_path(&registry, &path).unwrap();
        assert_eq!(first.content, "# 原文");
        assert_eq!(first.name, "中文 文件.md");
        std::fs::write(&path, "external").unwrap();
        assert_eq!(open_path(&registry, &path).unwrap().handle, first.handle);
        let opened = registry.files.lock().unwrap();
        let entry = &opened[&first.handle];
        assert!(crate::files::save_document(&entry.path, "draft", Some(&entry.baseline)).is_err());
        assert!(open_path(&FileRegistry::default(), &dir.path().join("missing.md")).is_err());
        std::fs::write(dir.path().join("bad.pdf"), "text").unwrap();
        assert!(open_path(&FileRegistry::default(), &dir.path().join("bad.pdf")).is_err());
    }
}
