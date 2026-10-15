use std::{fs, io::{Read, Write}, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Scope { id: String, path: PathBuf }
pub fn ensure(path: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(path).map_err(|_| "无法创建软件数据目录")?;
    let actual = path.canonicalize().map_err(|_| "软件数据目录不可用")?;
    Ok(actual)
}
fn scopes(data: &Path) -> Result<Vec<Scope>, String> {
    let path = data.join("scopes.json");
    if !path.exists() { return Ok(Vec::new()); }
    serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取数据索引")?).map_err(|_| "数据索引损坏，已保留原文件".into())
}
fn save_scopes(data: &Path, items: &[Scope]) -> Result<(), String> {
    let bytes = serde_json::to_vec(items).map_err(|_| "数据索引编码失败")?;
    let mut temp = tempfile::NamedTempFile::new_in(data).map_err(|_| "无法保存数据索引")?;
    temp.write_all(&bytes).and_then(|_| temp.as_file().sync_all()).map_err(|_| "无法保存数据索引")?;
    temp.persist(data.join("scopes.json")).map_err(|_| "无法保存数据索引")?; Ok(())
}
pub fn scope(data: &Path, parent: &Path) -> Result<PathBuf, String> {
    let mut items = scopes(data)?;
    if let Some(item) = items.iter().find(|item| item.path == parent) {
        if !item.id.starts_with("notebook-") || !item.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return Err("数据索引包含无效目录，原文件已保留".into()); }
        return ensure(&data.join(&item.id));
    }
    let dir = tempfile::Builder::new().prefix("notebook-").tempdir_in(data).map_err(|_| "无法创建独立数据目录")?.keep();
    items.push(Scope { id: dir.file_name().unwrap().to_string_lossy().into(), path: parent.into() });
    save_scopes(data, &items)?; Ok(dir)
}
pub fn rebase_scopes(data: &Path, source: &Path, target: &Path) -> Result<(), String> {
    let mut items = scopes(data)?;
    let mut changed = false;
    for item in &mut items { if let Ok(suffix) = item.path.strip_prefix(source) { item.path = target.join(suffix); changed = true; } }
    if changed { save_scopes(data, &items)?; } Ok(())
}
pub fn same_contents(a: &Path, b: &Path) -> Result<bool, String> {
    if fs::symlink_metadata(a).map_err(|_| "无法校验原文件")?.file_type().is_symlink() || a.canonicalize().map_err(|_| "原文件不可用")? != a { return Err("迁移不支持符号链接，原文件已保留".into()); }
    if a.is_file() && b.is_file() {
        let mut a = fs::File::open(a).map_err(|_| "无法读取原文件")?; let mut b = fs::File::open(b).map_err(|_| "无法校验副本")?;
        let mut left = [0u8; 65536]; let mut right = [0u8; 65536];
        loop { let n = a.read(&mut left).map_err(|_| "无法读取原文件")?; let m = b.read(&mut right).map_err(|_| "无法校验副本")?; if n != m || left[..n] != right[..m] { return Ok(false); } if n == 0 { return Ok(true); } }
    }
    if !a.is_dir() || !b.is_dir() { return Ok(false); }
    let entries = fs::read_dir(a).map_err(|_| "无法校验目录")?.collect::<Result<Vec<_>, _>>().map_err(|_| "无法校验目录")?;
    if entries.len() != fs::read_dir(b).map_err(|_| "无法校验目录副本")?.count() { return Ok(false); }
    for child in entries { let target = b.join(child.file_name()); if !target.exists() || !same_contents(&child.path(), &target)? { return Ok(false); } } Ok(true)
}
fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    if fs::symlink_metadata(source).map_err(|_| "原项目不可用")?.file_type().is_symlink() || source.canonicalize().map_err(|_| "原项目不可用")? != source { return Err("迁移不支持符号链接，原文件已保留".into()); }
    if source.is_dir() {
        fs::create_dir(target).map_err(|_| "无法创建数据副本")?;
        for child in fs::read_dir(source).map_err(|_| "无法读取原目录")? { let child = child.map_err(|_| "无法读取目录项目")?; copy_tree(&child.path(), &target.join(child.file_name()))?; }
    } else {
        let mut input = fs::File::open(source).map_err(|_| "无法读取原文件")?;
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|_| "无法创建数据副本")?;
        std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all()).map_err(|_| "复制数据失败，原文件已保留")?;
    } Ok(())
}
pub fn move_entry(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() { return Err("目标已存在同名项目，原文件已保留".into()); }
    if fs::rename(source, target).is_ok() { return Ok(()); }
    copy_tree(source, target)?;
    if !same_contents(source, target)? { return Err("复制校验失败，原文件和副本均已保留".into()); }
    if source.is_dir() { fs::remove_dir_all(source) } else { fs::remove_file(source) }.map_err(|_| "副本已保存，但原项目无法清理，请检查文件占用".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scopes_survive_restart_and_rename_and_copy_preserves_binary_files() {
        let tmp = tempfile::tempdir().unwrap(); let root = tmp.path().canonicalize().unwrap();
        let data = ensure(&root.join("data")).unwrap(); let notes = ensure(&root.join("notes")).unwrap();
        let first = scope(&data, &notes).unwrap(); assert_eq!(scope(&data, &notes).unwrap(), first);
        let renamed = root.join("renamed"); fs::rename(&notes, &renamed).unwrap(); rebase_scopes(&data, &notes, &renamed).unwrap();
        assert_eq!(scope(&data, &renamed).unwrap(), first);
        fs::write(renamed.join("file.bin"), [0, 255, 42]).unwrap(); let copy = root.join("copy"); copy_tree(&renamed, &copy).unwrap(); assert!(same_contents(&renamed, &copy).unwrap());
        assert!(move_entry(&renamed, &copy).is_err()); assert!(renamed.exists());
    }
}
