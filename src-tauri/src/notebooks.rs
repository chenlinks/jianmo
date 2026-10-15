use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::{Mutex, atomic::{AtomicU64, Ordering}}};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use crate::{files, FileRegistry, NativeFile, OpenedFile, payload};
use crate::data_store;
static DATA_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
struct Entry { root: PathBuf, path: PathBuf, restore: Option<(PathBuf, PathBuf)> }
#[derive(Default)]
pub struct NotebookRegistry { entries: Mutex<HashMap<String, Entry>>, next_id: AtomicU64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookEntry { handle: String, name: String, kind: String, path: String, location_id: String }
#[derive(Serialize)]
pub struct RenamedFile { handle: String, name: String, path: String }
#[derive(Serialize)]
pub struct RenameResult { name: String, path: String, files: Vec<RenamedFile> }
fn rebase(path: &Path, source: &Path, target: &Path) -> Option<PathBuf> {
    path.strip_prefix(source).ok().map(|suffix| if suffix.as_os_str().is_empty() { target.to_path_buf() } else { target.join(suffix) })
}

fn rename_registered(registry: &NotebookRegistry, files: &FileRegistry, handle: &str, name: &str, document: bool, data: Option<&Path>) -> Result<RenameResult, String> {
    validate_name(name)?;
    // Hold both registries until paths are rebased, so saves cannot use an old path.
    let mut entries = registry.entries.lock().map_err(|_| "目录状态不可用")?;
    let mut opened = files.files.lock().map_err(|_| "文件状态不可用")?;
    let source = if document {
        let file = opened.get(handle).ok_or("文件会话已失效，请重新打开原文件后重命名")?;
        let actual = file.path.canonicalize().map_err(|_| "原文件已移动或删除")?;
        if actual != file.path { return Err("原文件位置发生变化，请重新打开".into()); }
        actual
    } else {
        let entry = entries.get(handle).ok_or("目录连接已失效，请刷新后重试")?;
        let path = checked(entry)?;
        if path == entry.root { return Err("笔记根目录请通过偏好设置更换，不能在文档库中重命名".into()); }
        path
    };
    if source.is_file() && !["md", "markdown", "txt"].contains(&Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str()) { return Err("笔记名称需保留 .md、.markdown 或 .txt 扩展名".into()); }
    let source_parent = source.parent().ok_or("重命名位置无效")?;
    let restore = entries.get(handle).and_then(|entry| entry.restore.clone());
    let deleting = name.starts_with(".jianmo-trash-");
    let parent = if let Some(data) = data {
        if deleting { data_store::ensure(&data_store::scope(data, source_parent)?.join("trash"))? }
        else if let Some((_, parent)) = &restore { parent.canonicalize().map_err(|_| "原笔记目录已移动，无法恢复")? }
        else { source_parent.to_path_buf() }
    } else { source_parent.to_path_buf() };
    let target = parent.join(name);
    if source != target {
        for child in fs::read_dir(&parent).map_err(|_| "无法读取父目录")? {
            let child = child.map_err(|_| "无法读取目录项目")?;
            if child.file_name().to_string_lossy().to_lowercase() == name.to_lowercase() && child.path() != source { return Err("已存在同名文件或目录，请换一个名称".into()); }
        }
        if let Some(data) = data { data_store::rebase_scopes(data, &source, &target)?; }
        if let Err(error) = data_store::move_entry(&source, &target) {
            if let Some(data) = data { let _ = data_store::rebase_scopes(data, &target, &source); }
            return Err(error);
        }
    }
    let mut changed = Vec::new();
    for (id, file) in opened.iter_mut() {
        if let Some(path) = rebase(&file.path, &source, &target) {
            file.path = path;
            changed.push(RenamedFile { handle: id.clone(), name: file.path.file_name().unwrap_or_default().to_string_lossy().into(), path: file.path.to_string_lossy().into() });
        }
    }
    for entry in entries.values_mut() {
        if let Some(path) = rebase(&entry.path, &source, &target) {
            if deleting && data.is_some() { entry.restore = Some((entry.root.clone(), source_parent.into())); entry.root = parent.clone(); }
            else if let Some((root, _)) = &restore { entry.root = root.clone(); entry.restore = None; }
            entry.path = path;
        }
        if let Some(path) = rebase(&entry.root, &source, &target) { entry.root = path; }
    }
    Ok(RenameResult { name: name.into(), path: target.to_string_lossy().into(), files: changed })
}
#[tauri::command]
pub async fn rename_notebook_entry(app: AppHandle, handle: String, name: String) -> Result<RenameResult, String> {
    tauri::async_runtime::spawn_blocking(move || { let _lock = DATA_LOCK.lock().map_err(|_| "数据目录不可用")?; rename_registered(&app.state::<NotebookRegistry>(), &app.state::<FileRegistry>(), &handle, &name, false, Some(&data_location(&app)?)) }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn rename_document(app: AppHandle, handle: String, name: String) -> Result<RenameResult, String> {
    tauri::async_runtime::spawn_blocking(move || { let _lock = DATA_LOCK.lock().map_err(|_| "数据目录不可用")?; rename_registered(&app.state::<NotebookRegistry>(), &app.state::<FileRegistry>(), &handle, &name, true, Some(&data_location(&app)?)) }).await.map_err(|e| e.to_string())?
}

// Paths originate only in the native picker or its directory enumeration.
fn checked(entry: &Entry) -> Result<PathBuf, String> {
    let path = entry.path.canonicalize().map_err(|_| "目录或文件已移动，请重新选择目录".to_string())?;
    if path != entry.path || !path.starts_with(&entry.root) { return Err("目录位置发生变化，请重新选择目录".into()); }
    Ok(path)
}
fn register(registry: &NotebookRegistry, root: &Path, path: PathBuf) -> Result<NotebookEntry, String> {
    let mut entries = registry.entries.lock().map_err(|_| "目录状态不可用")?;
    let handle = entries.iter().find(|(_, entry)| entry.path == path && entry.root == root).map(|(id, _)| id.clone())
        .unwrap_or_else(|| format!("notebook:{}", registry.next_id.fetch_add(1, Ordering::Relaxed)));
    let result = NotebookEntry { handle: handle.clone(), name: path.file_name().unwrap_or_default().to_string_lossy().into(), kind: if path.is_dir() { "directory" } else { "file" }.into(), path: path.to_string_lossy().into(), location_id: root.to_string_lossy().into() };
    entries.insert(handle, Entry { root: root.into(), path, restore: None });
    Ok(result)
}
fn lookup(registry: &NotebookRegistry, handle: &str) -> Result<Entry, String> {
    registry.entries.lock().map_err(|_| "目录状态不可用")?.get(handle).cloned().ok_or_else(|| "目录连接已失效，请重新打开".into())
}
fn validate_name(name: &str) -> Result<(), String> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str()) || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit());
    if name.is_empty() || name.chars().count() > 240 || name != name.trim() || name.ends_with('.') || reserved || name.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c)) {
        return Err("名称无效，请使用普通文件名，不要包含路径或系统保留名称".into());
    }
    Ok(())
}

fn image_parent(app: &AppHandle, parent: Option<String>, document: Option<String>) -> Result<PathBuf, String> {
    if let Some(id) = document {
        let registry = app.state::<FileRegistry>();
        let opened = registry.files.lock().map_err(|_| "文件状态不可用")?;
        let file = opened.get(&id).ok_or("文件连接已失效")?;
        if file.path.canonicalize().map_err(|_| "原文件已移动")? != file.path { return Err("文件位置发生变化".into()); }
        return file.path.parent().map(Path::to_path_buf).ok_or("图片存储位置不可用".into());
    }
    let entry = lookup(&app.state::<NotebookRegistry>(), &parent.ok_or("请选择笔记目录")?)?;
    let path = checked(&entry)?;
    if !path.is_dir() { return Err("图片存储位置不是目录".into()); }
    Ok(path)
}
fn image_extension(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Ok("png") }
    else if bytes.starts_with(b"\xff\xd8\xff") { Ok("jpg") }
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { Ok("gif") }
    else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { Ok("webp") }
    else { Err("支持 PNG、JPEG、GIF 和 WebP 图片".into()) }
}
fn assets_directory(parent: &Path, create: bool) -> Result<PathBuf, String> {
    let path = parent.join(".assets");
    if create && !path.exists() { fs::create_dir(&path).map_err(|_| "无法创建图片目录")?; }
    let resolved = path.canonicalize().map_err(|_| "图片目录不存在")?;
    if resolved != path || !resolved.is_dir() { return Err("图片目录位置发生变化".into()); }
    Ok(resolved)
}
fn store_image(parent: &Path, bytes: &[u8]) -> Result<String, String> {
    use std::io::Write;
    let extension = image_extension(bytes)?;
    let directory = assets_directory(parent, true)?;
    let mut file = tempfile::Builder::new().prefix("image-").suffix(&format!(".{extension}")).tempfile_in(&directory).map_err(|_| "创建图片文件失败")?;
    file.write_all(bytes).and_then(|_| file.as_file().sync_all()).map_err(|_| "保存图片失败")?;
    let (_, path) = file.keep().map_err(|_| "保存图片失败")?;
    Ok(format!(".assets/{}", path.file_name().unwrap().to_string_lossy()))
}
fn read_image(parent: &Path, name: &str) -> Result<Vec<u8>, String> {
    if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) || !["png", "jpg", "jpeg", "gif", "webp"].contains(&Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str()) { return Err("图片名称无效".into()); }
    let path = assets_directory(parent, false)?.join(name);
    if path.canonicalize().map_err(|_| "图片不存在")? != path { return Err("图片位置发生变化".into()); }
    let bytes = fs::read(path).map_err(|_| "图片读取失败")?;
    image_extension(&bytes)?; Ok(bytes)
}
#[tauri::command]
pub async fn store_notebook_image(app: AppHandle, parent: Option<String>, document: Option<String>, bytes: Vec<u8>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || { image_parent(&app, parent, document)?; Ok(store_image(&data_location(&app)?, &bytes)?.replacen(".assets/", "jianmo-asset://", 1)) }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_notebook_image(app: AppHandle, parent: Option<String>, document: Option<String>, name: String, managed: Option<bool>) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parent = image_parent(&app, parent, document)?;
        let _lock = DATA_LOCK.lock().map_err(|_| "数据目录不可用")?;
        let data = data_location(&app)?;
        if managed.unwrap_or(false) { read_image(&data, &name) }
        else if parent.join(".assets").exists() { read_image(&parent, &name) }
        else { read_image(&data_store::scope(&data, &parent)?, &name) }
    }).await.map_err(|e| e.to_string())?
}

fn data_location(app: &AppHandle) -> Result<PathBuf, String> {
    data_store::ensure(&app.path().app_local_data_dir().map_err(|_| "软件数据目录不可用")?.join("storage"))
}
#[tauri::command]
pub fn get_data_location(app: AppHandle) -> Result<String, String> { Ok(data_location(&app)?.to_string_lossy().into()) }

fn migrate_legacy(registry: &NotebookRegistry, files: &FileRegistry, root: &Path, parent: &Path, data: &Path) -> Result<(), String> {
    if data.starts_with(parent) { return Err("笔记目录不能包含软件数据目录，请选择其他笔记目录".into()); }
    for child in fs::read_dir(parent).map_err(|_| "无法读取旧数据目录")? {
        let child = child.map_err(|_| "无法读取旧数据项目")?; let source = child.path();
        if source.canonicalize().map_err(|_| "旧数据位置不可用")? != source || child.file_type().map_err(|_| "旧数据类型不可用")?.is_symlink() { continue; }
        let name = child.file_name().to_string_lossy().to_string();
        if name == ".assets" && source.is_dir() {
            let target = data_store::scope(data, parent)?.join(".assets");
            if target.exists() {
                if !data_store::same_contents(&source, &target)? { return Err("新旧附件目录有冲突，原附件已保留，请检查数据目录".into()); }
                fs::remove_dir_all(&source).map_err(|_| "附件已迁移，但旧目录无法清理")?;
            } else { data_store::move_entry(&source, &target)?; }
        } else if name.starts_with(".jianmo-trash-") {
            let entry = register(registry, root, source)?;
            rename_registered(registry, files, &entry.handle, &name, false, Some(data))?;
        } else if source.is_dir() { migrate_legacy(registry, files, root, &source, data)?; }
    } Ok(())
}

#[tauri::command]
pub async fn open_notebook(app: AppHandle) -> Result<Option<NotebookEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app.dialog().file().blocking_pick_folder() else { return Ok(None); };
        let root = selected.into_path().map_err(|e| e.to_string())?.canonicalize().map_err(|e| e.to_string())?;
        let result = register(&app.state::<NotebookRegistry>(), &root, root.clone())?;
        remember_location(&app, &root)?;
        Ok(Some(result))
    }).await.map_err(|e| e.to_string())?
}
fn remember_location(app: &AppHandle, root: &Path) -> Result<(), String> {
    use std::io::Write;
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|_| "无法创建设置目录")?;
    let mut temp = tempfile::NamedTempFile::new_in(&directory).map_err(|_| "无法保存目录设置")?;
    temp.write_all(root.to_string_lossy().as_bytes()).map_err(|_| "无法保存目录设置")?;
    temp.as_file().sync_all().map_err(|_| "无法保存目录设置")?;
    temp.persist(directory.join("notebook-directory.txt")).map_err(|_| "无法保存目录设置")?;
    Ok(())
}
fn default_location(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().document_dir().map_err(|_| "系统文档目录不可用，请在设置中选择笔记目录")?.join("笺墨");
    fs::create_dir_all(&root).map_err(|_| "无法创建默认笔记目录，请在设置中选择其他目录")?;
    root.canonicalize().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn get_notebook_location(app: AppHandle) -> Result<NotebookEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?.join("notebook-directory.txt");
        let root = if config.exists() {
            PathBuf::from(fs::read_to_string(config).map_err(|_| "无法读取笔记目录设置")?).canonicalize().map_err(|_| "已设置的笔记目录不可用，请在设置中重新选择；草稿仍保留")?
        } else { default_location(&app)? };
        if !root.is_dir() { return Err("笔记目录不可用，请重新设置".into()); }
        register(&app.state::<NotebookRegistry>(), &root, root.clone())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn reset_notebook_location(app: AppHandle) -> Result<NotebookEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = default_location(&app)?; remember_location(&app, &root)?;
        register(&app.state::<NotebookRegistry>(), &root, root.clone())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn list_notebook(app: AppHandle, handle: String) -> Result<Vec<NotebookEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DATA_LOCK.lock().map_err(|_| "数据目录不可用")?;
        let registry = app.state::<NotebookRegistry>();
        let entry = lookup(&registry, &handle)?;
        let path = checked(&entry)?;
        let data = data_location(&app)?;
        migrate_legacy(&registry, &app.state::<FileRegistry>(), &entry.root, &path, &data)?;
        let mut result = Vec::new();
        for child in fs::read_dir(&path).map_err(|_| "无法读取目录，请检查访问权限")? {
            let child = child.map_err(|_| "无法读取目录项目")?;
            let kind = child.file_type().map_err(|_| "无法读取文件类型")?;
            // Do not traverse symbolic links/junctions or escape the selected root.
            if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) { continue; }
            let path = child.path();
            let canonical = path.canonicalize().map_err(|_| "目录发生变化，请刷新")?;
            if canonical != path || !canonical.starts_with(&entry.root) { continue; }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if kind.is_dir() || ["md", "markdown", "txt"].contains(&ext.as_str()) { result.push(register(&registry, &entry.root, canonical)?); }
        }
        let trash = data_store::scope(&data, &path)?.join("trash");
        if trash.exists() {
            for child in fs::read_dir(&trash).map_err(|_| "无法读取回收站")? {
                let child = child.map_err(|_| "无法读取回收站项目")?; let item_path = child.path();
                if item_path.canonicalize().map_err(|_| "回收站项目不可用")? != item_path || !child.file_name().to_string_lossy().starts_with(".jianmo-trash-") { continue; }
                let item = register(&registry, &trash, item_path)?;
                registry.entries.lock().map_err(|_| "目录状态不可用")?.get_mut(&item.handle).unwrap().restore = Some((entry.root.clone(), path.clone()));
                result.push(item);
            }
        }
        result.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn open_notebook_file(app: AppHandle, handle: String) -> Result<NativeFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = lookup(&app.state::<NotebookRegistry>(), &handle)?;
        let path = checked(&entry)?;
        let content = files::read_document(&path)?;
        let registry = app.state::<FileRegistry>();
        let mut opened = registry.files.lock().map_err(|_| "文件状态不可用")?;
        if let Some((id, _)) = opened.iter().find(|(_, file)| file.path == path) { return Ok(payload(id.clone(), &path, content)); }
        let id = registry.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        opened.insert(id.clone(), OpenedFile { path: path.clone(), baseline: content.clone() });
        Ok(payload(id, &path, content))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn create_notebook_entry(app: AppHandle, parent: String, name: String, kind: String) -> Result<NotebookEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_name(&name)?;
        let registry = app.state::<NotebookRegistry>();
        let entry = lookup(&registry, &parent)?;
        let path = checked(&entry)?.join(&name);
        match kind.as_str() {
            "directory" => fs::create_dir(&path).map_err(|_| "创建目录失败：同名项目已存在或没有写入权限")?,
            "file" => {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
                if !["md", "markdown", "txt"].contains(&ext.as_str()) { return Err("仅支持 Markdown 和文本文件".into()); }
                fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_| "创建笔记失败：同名项目已存在或没有写入权限")?.sync_all().map_err(|_| "文件写入失败")?;
            },
            _ => return Err("不支持的项目类型".into())
        }
        register(&registry, &entry.root, path)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_data_migrates_legacy_assets_and_trash_and_survives_folder_changes() {
        let temp = tempfile::tempdir().unwrap(); let base = temp.path().canonicalize().unwrap();
        let root = data_store::ensure(&base.join("notes")).unwrap(); let data = data_store::ensure(&base.join("data")).unwrap();
        let folder = data_store::ensure(&root.join("work")).unwrap(); let bytes = b"\x89PNG\r\n\x1a\n\x00\xff";
        let source = store_image(&folder, bytes).unwrap(); let filename = source.strip_prefix(".assets/").unwrap();
        fs::write(folder.join("note.md"), "saved").unwrap();
        fs::write(folder.join(".jianmo-trash-123-abcd-old.md"), "old").unwrap();
        let registry = NotebookRegistry::default(); let files = FileRegistry::default();
        let parent = register(&registry, &root, folder.clone()).unwrap(); let note = register(&registry, &root, folder.join("note.md")).unwrap();
        migrate_legacy(&registry, &files, &root, &root, &data).unwrap();
        assert!(!folder.join(".assets").exists()); assert!(!folder.join(".jianmo-trash-123-abcd-old.md").exists());
        let scope = data_store::scope(&data, &folder).unwrap(); assert_eq!(read_image(&scope, filename).unwrap(), bytes);
        assert_eq!(fs::read_to_string(scope.join("trash/.jianmo-trash-123-abcd-old.md")).unwrap(), "old");
        rename_registered(&registry, &files, &parent.handle, "renamed", false, Some(&data)).unwrap();
        assert_eq!(data_store::scope(&data, &root.join("renamed")).unwrap(), scope);
        rename_registered(&registry, &files, &note.handle, ".jianmo-trash-456-abcd-note.md", false, Some(&data)).unwrap();
        assert!(!root.join("renamed/note.md").exists());
        rename_registered(&registry, &files, &note.handle, "note.md", false, Some(&data)).unwrap();
        assert_eq!(fs::read_to_string(root.join("renamed/note.md")).unwrap(), "saved");
        rename_registered(&registry, &files, &parent.handle, ".jianmo-trash-789-abcd-renamed", false, Some(&data)).unwrap();
        rename_registered(&registry, &files, &parent.handle, "renamed", false, Some(&data)).unwrap();
        assert_eq!(data_store::scope(&data, &root.join("renamed")).unwrap(), scope);
        assert_eq!(read_image(&scope, filename).unwrap(), bytes);
    }
    #[test]
    fn image_files_are_persistent_scoped_and_binary() {
        let temp = tempfile::tempdir().unwrap(); let root = temp.path().canonicalize().unwrap();
        let bytes = b"\x89PNG\r\n\x1a\n\x00\xff";
        let source = store_image(&root, bytes).unwrap();
        assert!(source.starts_with(".assets/image-"));
        assert_eq!(read_image(&root, source.strip_prefix(".assets/").unwrap()).unwrap(), bytes);
        assert!(read_image(&root, "../outside.png").is_err());
        assert!(read_image(&root, "C:\\outside.png").is_err());
        assert!(store_image(&root, b"<svg onload='bad'>").is_err());
    }
    #[test]
    fn rename_files_and_directories_keeps_handles_and_external_change_baseline() {
        let temp = tempfile::tempdir().unwrap(); let root = temp.path().canonicalize().unwrap();
        let dir = root.join("work"); fs::create_dir(&dir).unwrap();
        let path = dir.join("note.md"); fs::write(&path, "saved").unwrap();
        let registry = NotebookRegistry::default(); let files = FileRegistry::default();
        let folder = register(&registry, &root, dir.clone()).unwrap();
        let note = register(&registry, &root, path.clone()).unwrap();
        files.files.lock().unwrap().insert("open".into(), OpenedFile { path: path.clone(), baseline: "saved".into() });
        let result = rename_registered(&registry, &files, &note.handle, "renamed.md", false, None).unwrap();
        assert!(!path.exists()); assert_eq!(fs::read_to_string(&result.path).unwrap(), "saved");
        assert_eq!(lookup(&registry, &note.handle).unwrap().path, dir.join("renamed.md"));
        rename_registered(&registry, &files, &folder.handle, "project", false, None).unwrap();
        let moved = root.join("project").join("renamed.md");
        let opened = files.files.lock().unwrap(); let entry = opened.get("open").unwrap();
        assert_eq!(entry.path, moved); assert_eq!(entry.baseline, "saved");
        files::save_document(&entry.path, "draft after rename", Some(&entry.baseline)).unwrap();
        assert!(files::save_document(&entry.path, "stale draft", Some(&entry.baseline)).is_err());
        assert_eq!(fs::read_to_string(moved).unwrap(), "draft after rename");
    }
    #[test]
    fn rename_rejects_collisions_paths_and_root_without_changing_files() {
        let temp = tempfile::tempdir().unwrap(); let root = temp.path().canonicalize().unwrap();
        let path = root.join("one.md"); fs::write(&path, "one").unwrap(); fs::write(root.join("two.md"), "two").unwrap();
        let registry = NotebookRegistry::default(); let files = FileRegistry::default();
        let note = register(&registry, &root, path.clone()).unwrap(); let folder = register(&registry, &root, root.clone()).unwrap();
        for name in ["two.md", "TWO.md", "../escape.md", "CON.md", "script.exe"] { assert!(rename_registered(&registry, &files, &note.handle, name, false, None).is_err()); }
        assert!(rename_registered(&registry, &files, &folder.handle, "root-new", false, None).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "one"); assert_eq!(fs::read_to_string(root.join("two.md")).unwrap(), "two");
        files.files.lock().unwrap().insert("dialog".into(), OpenedFile { path, baseline: "one".into() });
        rename_registered(&registry, &files, "dialog", "three.md", true, None).unwrap();
        assert_eq!(files.files.lock().unwrap().get("dialog").unwrap().path, root.join("three.md"));
    }
    #[test]
    fn rejects_paths_and_reserved_names() {
        for name in ["", ".", "..", "../escape.md", "C:\\note.md", "CON.md", "note.", "LPT1", "a/b"] { assert!(validate_name(name).is_err(), "{name}"); }
        assert!(validate_name("读书笔记.md").is_ok());
    }
    #[test]
    fn checks_scope_and_missing_entries() {
        let root = tempfile::tempdir().unwrap(); let outside = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        assert!(checked(&Entry { root: root.clone(), path: outside.path().canonicalize().unwrap(), restore: None }).is_err());
        assert!(checked(&Entry { root: root.clone(), path: root.join("missing.md"), restore: None }).is_err());
        assert!(checked(&Entry { root: root.clone(), path: root, restore: None }).is_ok());
        assert!(lookup(&NotebookRegistry::default(), "arbitrary-path").is_err());
    }
}
