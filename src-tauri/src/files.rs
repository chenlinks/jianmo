use std::{fs, io::Write, path::Path};

#[cfg(windows)]
fn explorer_selection(path: &Path) -> String {
    let path = path.to_string_lossy();
    // Explorer expects ordinary drive/UNC paths rather than canonical extended paths.
    let path = if let Some(rest) = path.strip_prefix(r"\\?\UNC\") { format!(r"\\{rest}") }
        else { path.strip_prefix(r"\\?\").unwrap_or(&path).to_string() };
    format!("/select,\"{path}\"")
}

pub fn reveal_document(path: &Path) -> Result<(), String> {
    let actual = path.canonicalize().map_err(|_| "原文件已移动、删除或无法访问")?;
    if actual != path || !actual.is_file() { return Err("文件位置发生变化，请重新打开文件".into()); }
    let mut command = file_manager_command(&actual)?;
    command.spawn().map_err(|e| format!("无法打开文件所在位置：{e}"))?;
    Ok(())
}

fn file_manager_command(path: &Path) -> Result<std::process::Command, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("explorer.exe");
        // Explorer uses its own comma-separated syntax; quote the entire registered path.
        command.raw_arg(explorer_selection(path)).creation_flags(0x08000000);
        Ok(command)
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(path);
        Ok(command)
    }
    #[cfg(target_os = "linux")]
    {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path.parent().ok_or("文件所在目录无效")?);
        Ok(command)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    { let _ = path; Err("当前平台不支持打开文件所在位置".into()) }
}

pub fn read_document(path: &Path) -> Result<String, String> {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !["md", "markdown", "txt"].contains(&extension.as_str()) {
        return Err("请选择 .md、.markdown 或 .txt 文件".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败：{e}"))?;
    String::from_utf8(bytes).map_err(|_| "文件不是有效的 UTF-8 文本，请转换编码后打开".into())
}

pub fn save_document(path: &Path, content: &str, expected: Option<&str>) -> Result<(), String> {
    if let Some(previous) = expected {
        let actual = fs::read_to_string(path).map_err(|_| "原文件已移动、删除或无法访问。请使用另存为。".to_string())?;
        if actual != previous { return Err("文件已被其他程序修改，为避免覆盖，保存已停止。请使用另存为保留当前版本。".into()); }
    }
    let parent = path.parent().ok_or("保存位置无效")?;
    // Write in the same directory, flush, then atomically replace. A failed write leaves the old file intact.
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法创建临时文件：{e}"))?;
    if let Ok(metadata) = fs::metadata(path) {
        temp.as_file().set_permissions(metadata.permissions()).map_err(|e| format!("无法保留文件权限：{e}"))?;
    }
    temp.write_all(content.as_bytes()).map_err(|e| format!("写入失败：{e}"))?;
    temp.as_file().sync_all().map_err(|e| format!("刷新文件失败：{e}"))?;
    temp.persist(path).map_err(|e| format!("替换文件失败，原文件已保留：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revealing_missing_files_or_directories_returns_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(reveal_document(&dir.path().join("missing.md")).is_err());
        assert!(reveal_document(&dir.path().canonicalize().unwrap()).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn explorer_selection_quotes_unicode_spaces_and_commas_and_normalizes_paths() {
        assert_eq!(explorer_selection(Path::new(r"\\?\C:\中文 目录\笔记,一.md")), "/select,\"C:\\中文 目录\\笔记,一.md\"");
        assert_eq!(explorer_selection(Path::new(r"\\?\UNC\server\share\笔记.md")), "/select,\"\\\\server\\share\\笔记.md\"");
        assert_eq!(explorer_selection(Path::new(r"C:\notes\a.md")), "/select,\"C:\\notes\\a.md\"");
    }
    #[test]
    fn saves_and_detects_external_changes() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.md");
        save_document(&path, "first", None).unwrap();
        save_document(&path, "second", Some("first")).unwrap();
        fs::write(&path, "external").unwrap();
        assert!(save_document(&path, "third", Some("second")).is_err());
        assert_eq!(read_document(&path).unwrap(), "external");
    }
    #[test]
    fn large_documents_round_trip_and_keep_conflict_protection() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.md");
        fs::write(&path, "keep me").unwrap();
        let large = "中文".repeat(500_000);
        save_document(&path, &large, Some("keep me")).unwrap();
        assert_eq!(read_document(&path).unwrap(), large);
        fs::write(&path, "external").unwrap();
        assert!(save_document(&path, &large, Some(&large)).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "external");
    }
    #[test]
    fn rejects_non_utf8() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.md");
        fs::write(&path, [0xff, 0xfe]).unwrap(); assert!(read_document(&path).is_err());
    }
}
