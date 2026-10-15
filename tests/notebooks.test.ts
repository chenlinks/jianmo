import { memoryIndexedDB } from './memory-indexeddb.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookEntry, getNotebookLocation, listNotebook, openNotebookFile, pickNotebook, resetNotebookLocation, resolveNotebookDirectory, saveNotebookFile, validateEntryName, renameNotebookEntry, storeNotebookImage, loadNotebookImage, originalTrashName, trashEntryName } from '../src/platform/notebooks.ts';
import type { BrowserDirectoryHandle, BrowserFileHandle } from '../src/platform/notebooks.ts';
class TestFile implements BrowserFileHandle {
  kind = 'file' as const; aborted = false; denyWrite = false;
  moveCalls = 0;
  async move(_name: string): Promise<void> { this.moveCalls++; throw new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NotAllowedError'); }
  name: string; content: string | Blob;
  constructor(name: string, content: string | Blob = '') { this.name = name; this.content = content; }
  async isSameEntry(other: unknown) { return this === other; }
  async getFile() { return new File([this.content], this.name); }
  async createWritable() {
    let pending = this.content;
    return { write: async (content: string | Blob) => { if (this.denyWrite) throw new Error('permission denied'); pending = content; }, close: async () => { this.content = pending; }, abort: async () => { this.aborted = true; } };
  }
}
class TestDirectory implements BrowserDirectoryHandle {
  kind = 'directory' as const;
  name: string; children: (TestDirectory | TestFile)[];
  constructor(name: string, children: (TestDirectory | TestFile)[] = []) { this.name = name; this.children = children; }
  async isSameEntry(other: unknown) { return this === other; }
  async *values() { yield* this.children; }
  async getFileHandle(name: string) { const existing = this.children.find(c => c.name === name && c.kind === 'file'); if (existing) return existing as TestFile; const file = new TestFile(name); this.children.push(file); return file; }
  async getDirectoryHandle(name: string) { const existing = this.children.find(c => c.name === name && c.kind === 'directory'); if (existing) return existing as TestDirectory; const dir = new TestDirectory(name); this.children.push(dir); return dir; }
  async removeEntry(name: string) { this.children = this.children.filter(child => child.name !== name); }
}
const testStorage = new TestDirectory('origin-data');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => testStorage } } });
test('browser images are binary files in independent data storage and can be reloaded independently', async () => {
  const dir = new TestDirectory('images');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => dir } });
  const root = await pickNotebook(); const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  const result = await storeNotebookImage(new File([bytes], 'photo.png', { type: 'image/png' }), root!.handle);
  assert.match(result.source, /^jianmo-asset:\/\/image-.*\.png$/); assert.equal(dir.children.length, 0); assert.ok(testStorage.children.find(child => child.name === 'jianmo-data'));
  URL.revokeObjectURL(result.url);
  const url = await loadNotebookImage(result.source, root!.handle);
  assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes); URL.revokeObjectURL(url);
  await assert.rejects(loadNotebookImage('../private.png', root!.handle), /路径无效/);
});
test('legacy browser attachments and trash migrate outside notes and survive parent rename and restore', async () => {
  const legacyTrash = trashEntryName('old.md');
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255]);
  const assets = new TestDirectory('.assets', [new TestFile('photo.png', new Blob([bytes]))]);
  const folder = new TestDirectory('before', [assets, new TestFile(legacyTrash, 'old'), new TestFile('note.md', 'current')]);
  const dir = new TestDirectory('migration', [folder]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => dir } });
  const root = (await pickNotebook())!; const parent = (await listNotebook(root.handle))[0];
  assert.deepEqual(folder.children.map(child => child.name), ['note.md']);
  let entries = await listNotebook(parent.handle); assert.ok(entries.some(entry => entry.name === legacyTrash));
  let url = await loadNotebookImage('.assets/photo.png', parent.handle); assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes); URL.revokeObjectURL(url);
  await renameNotebookEntry(parent, 'after');
  await renameNotebookEntry(parent, trashEntryName('after'), true); assert.equal(dir.children.length, 0);
  const trashed = (await listNotebook(root.handle))[0]; await renameNotebookEntry(trashed, 'after');
  const restored = (await listNotebook(root.handle))[0];
  entries = await listNotebook(restored.handle); const old = entries.find(entry => entry.name === legacyTrash)!;
  await renameNotebookEntry(old, 'old.md');
  assert.equal((await openNotebookFile(old.handle)).content, 'old');
  url = await loadNotebookImage('.assets/photo.png', restored.handle); assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes); URL.revokeObjectURL(url);
  assert.deepEqual((dir.children[0] as TestDirectory).children.map(child => child.name).sort(), ['note.md', 'old.md']);
});
test('unavailable independent storage never deletes the original note', async () => {
  const dir = new TestDirectory('unavailable', [new TestFile('note.md', 'keep')]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => dir } });
  const root = (await pickNotebook())!; const note = (await listNotebook(root.handle))[0];
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try { await assert.rejects(renameNotebookEntry(note, trashEntryName(note.name), true), /独立数据/); assert.equal((dir.children[0] as TestFile).content, 'keep'); }
  finally { Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous }); }
  const database = window.indexedDB;
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  try { await assert.rejects(renameNotebookEntry(note, trashEntryName(note.name), true), /持久保存/); assert.equal((dir.children[0] as TestFile).content, 'keep'); }
  finally { Object.defineProperty(window, 'indexedDB', { configurable: true, value: database }); }
});
test('picked directory rename followed by deleting and restoring a child never calls unsupported move', async () => {
  const source = new TestFile('note.md', 'original'); const folder = new TestDirectory('before', [source]); const root = new TestDirectory('picked', [folder]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => root } });
  const picked = (await pickNotebook())!; const directory = (await listNotebook(picked.handle))[0];
  const note = (await listNotebook(directory.handle))[0]; const opened = await openNotebookFile(note.handle);
  await renameNotebookEntry(directory, 'after');
  const movedFolder = root.children.find(child => child.name === 'after') as TestDirectory;
  const movedFile = movedFolder.children[0] as TestFile;
  await saveNotebookFile(opened.handle, 'saved after rename');
  const deletedName = trashEntryName(note.name);
  await renameNotebookEntry(note, deletedName, true);
  assert.equal(movedFile.moveCalls, 0); assert.equal(source.moveCalls, 0);
  assert.equal(movedFolder.children.some(child => child.name === 'note.md'), false);
  const deleted = (await listNotebook(directory.handle))[0];
  assert.equal(originalTrashName(deleted.name), 'note.md');
  await renameNotebookEntry(deleted, originalTrashName(deleted.name)!);
  assert.equal((await openNotebookFile(opened.handle)).content, 'saved after rename');
  const restored = movedFolder.children[0] as TestFile; restored.content = 'external';
  await assert.rejects(saveNotebookFile(opened.handle, 'stale'), /其他程序修改/); assert.equal(restored.content, 'external');
});
test('unconfigured browser uses a stable default local directory without a picker', async () => {
  const origin = new TestDirectory('origin-private');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB() } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => origin } } });
  const first = await getNotebookLocation(); const next = await getNotebookLocation();
  assert.equal(first.name, '笺墨'); assert.equal(first.handle, next.handle); assert.equal(first.locationId, 'browser-default');
  const entry = await createNotebookEntry(first.handle, '自动存储', 'file'); await openNotebookFile(entry.handle); await saveNotebookFile(entry.handle, '# 默认目录的内容');
  assert.equal((await resetNotebookLocation()).handle, first.handle);
  assert.equal((await openNotebookFile((await listNotebook(next.handle))[0].handle)).content, '# 默认目录的内容');
});
test('directory browsing, creation, stable identity, direct save and conflict protection', async () => {
  const file = new TestFile('note.md', '# 原文');
  const dir = new TestDirectory('notes', [file, new TestFile('image.png'), new TestDirectory('子目录')]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => dir } });
  const root = await pickNotebook(); assert.ok(root);
  const entries = await listNotebook(root.handle);
  assert.deepEqual(entries.map(e => e.name), ['子目录', 'note.md']);
  assert.equal((await pickNotebook())?.handle, root.handle);
  assert.equal((await listNotebook(root.handle))[1].handle, entries[1].handle);
  const opened = await openNotebookFile(entries[1].handle);
  await saveNotebookFile(opened.handle, '# 写回'); assert.equal(file.content, '# 写回');
  file.content = '# 外部修改'; await openNotebookFile(opened.handle);
  await assert.rejects(saveNotebookFile(opened.handle, 'must not overwrite'), /其他程序修改/); assert.equal(file.content, '# 外部修改');
  const created = await createNotebookEntry(root.handle, '新笔记', 'file'); assert.equal(created.name, '新笔记.md');
  assert.equal((await openNotebookFile(created.handle)).content, '');
  await assert.rejects(createNotebookEntry(root.handle, 'NOTE.MD', 'file'), /同名/);
  assert.equal((await createNotebookEntry(root.handle, '资料', 'directory')).kind, 'directory');
  await assert.rejects(createNotebookEntry(root.handle, '../escape', 'file'), /名称/);
});
test('cancel and failed writes preserve original files; large notes can be saved', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => { throw new DOMException('cancelled', 'AbortError'); } } }); assert.equal(await pickNotebook(), null);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB() } }); await assert.rejects(pickNotebook(), /不支持/);
  const file = new TestFile('readonly.md', 'original'); const root = new TestDirectory('denied', [file]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => root } });
  const directory = await pickNotebook(); const entry = (await listNotebook(directory!.handle))[0]; await openNotebookFile(entry.handle);
  file.denyWrite = true; await assert.rejects(saveNotebookFile(entry.handle, 'changed'), /permission/); assert.equal(file.aborted, true); assert.equal(file.content, 'original');
  file.denyWrite = false; const large = '中'.repeat(800000);
  await saveNotebookFile(entry.handle, large); assert.equal((await openNotebookFile(entry.handle)).content, large);
  await assert.rejects(saveNotebookFile('unknown', 'draft'), /失效/);
  for (const name of ['..', 'a/b', 'CON.md', 'LPT1', 'a.', 'a\\b']) assert.throws(() => validateEntryName(name));
});
test('nested directories resolve by handles and distinguish same-named notes', async () => {
  const dir = new TestDirectory('notes');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => dir } });
  const root = (await pickNotebook())!;
  const top = await createNotebookEntry(root.handle, 'same', 'file');
  const folder = await createNotebookEntry(root.handle, '工作', 'directory');
  await createNotebookEntry(folder.handle, '项目', 'directory');
  const nested = await resolveNotebookDirectory(root, ['工作', '项目']);
  const note = await createNotebookEntry(nested.handle, 'same', 'file');
  await openNotebookFile(note.handle); await saveNotebookFile(note.handle, '# child');
  assert.equal((await openNotebookFile(top.handle)).content, '');
  assert.equal((await openNotebookFile(note.handle)).content, '# child');
  await assert.rejects(resolveNotebookDirectory(root, ['missing']), /移动或删除/);
  await assert.rejects(resolveNotebookDirectory(root, ['..']), /名称/);
});
test('browser rename preserves nested attachments, handles and external-change protection', async () => {
  const original = new TestFile('note.md', '# saved');
  const binary = new TestFile('image.png', new Blob([new Uint8Array([0, 255, 128, 1])]));
  const folder = new TestDirectory('work', [new TestDirectory('nested', [original, binary])]);
  const rootDir = new TestDirectory('notes', [folder, new TestDirectory('taken')]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => rootDir } });
  const root = (await pickNotebook())!; const folderEntry = (await listNotebook(root.handle)).find(item => item.name === 'work')!;
  const nested = (await listNotebook(folderEntry.handle))[0]; const note = (await listNotebook(nested.handle))[0];
  await openNotebookFile(note.handle);
  await assert.rejects(renameNotebookEntry(folderEntry, 'taken'), /同名/);
  await renameNotebookEntry(note, 'renamed');
  assert.equal((await openNotebookFile(note.handle)).name, 'renamed.md');
  await renameNotebookEntry(folderEntry, 'project');
  assert.deepEqual((await listNotebook(root.handle)).map(item => item.name), ['project', 'taken']);
  assert.equal((await listNotebook(nested.handle))[0].name, 'renamed.md');
  await saveNotebookFile(note.handle, '# after rename');
  const project = rootDir.children.find(item => item.name === 'project') as TestDirectory;
  const children = (project.children[0] as TestDirectory).children;
  assert.deepEqual(new Uint8Array(await (await (children.find(item => item.name === 'image.png') as TestFile).getFile()).arrayBuffer()), new Uint8Array([0, 255, 128, 1]));
  const renamed = children.find(item => item.name === 'renamed.md') as TestFile;
  assert.equal(renamed.content, '# after rename'); renamed.content = '# external';
  await assert.rejects(saveNotebookFile(note.handle, 'stale'), /其他程序修改/);
});
test('failed browser rename keeps the original and does not rebind its open handle', async () => {
  const file = new TestFile('old.md', 'original');
  const rootDir = new TestDirectory('notes', [file]);
  rootDir.getFileHandle = async (name: string) => { const target = new TestFile(name); target.denyWrite = true; rootDir.children.push(target); return target; };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDB(), showDirectoryPicker: async () => rootDir } });
  const root = (await pickNotebook())!; const entry = (await listNotebook(root.handle))[0];
  await openNotebookFile(entry.handle); await assert.rejects(renameNotebookEntry(entry, 'new'), /未完成/);
  assert.equal(rootDir.children.includes(file), true); assert.equal((await openNotebookFile(entry.handle)).name, 'old.md');
  await saveNotebookFile(entry.handle, 'still writable'); assert.equal(file.content, 'still writable');
});
test('desktop directory calls send issued handles, never frontend paths', async () => {
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI__: { core: { invoke: async (command: string, args: unknown) => { calls.push({ command, args }); return null; } } } } });
  await pickNotebook(); await listNotebook('directory-token'); await openNotebookFile('entry-token'); await createNotebookEntry('parent-token', 'note', 'file');
  assert.deepEqual(calls, [{ command: 'open_notebook', args: undefined }, { command: 'list_notebook', args: { handle: 'directory-token' } }, { command: 'open_notebook_file', args: { handle: 'entry-token' } }, { command: 'create_notebook_entry', args: { parent: 'parent-token', name: 'note.md', kind: 'file' } }]);
});
