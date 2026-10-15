use std::{fs, io::Write, path::Path};

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
