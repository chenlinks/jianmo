import { normalizeName } from '../core/documents.ts';
import { isDesktop, readBrowserFile } from './files.ts';
import type { NativeFile } from './files.ts';
import { localImageName } from '../core/image-assets.ts';
import { browserDataRoot, browserDataScope, rebindDataScope } from './browser-data.ts';

export interface NotebookEntry { handle: string; name: string; kind: 'directory' | 'file'; path?: string; locationId?: string }
export interface NotebookDirectory extends NotebookEntry { kind: 'directory' }
// Keep browser capabilities in memory, never in draft storage or frontend paths.
export interface BrowserFileHandle {
  kind: 'file'; name: string;
  isSameEntry(other: BrowserHandle): Promise<boolean>;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(content: string | Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  move?(name: string): Promise<void>;
}
export interface BrowserDirectoryHandle {
  kind: 'directory'; name: string;
  isSameEntry(other: BrowserHandle): Promise<boolean>;
  values(): AsyncIterable<BrowserHandle>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<BrowserFileHandle>;
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<BrowserDirectoryHandle>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<string>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
}
type BrowserHandle = BrowserFileHandle | BrowserDirectoryHandle;
declare global { interface Window { showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<BrowserDirectoryHandle> } }
const handles = new Map<string, BrowserHandle>();
const baselines = new Map<string, string>();
const writes = new Set<string>();
const parents = new Map<string, BrowserDirectoryHandle>();
const actualParents = new Map<string, BrowserDirectoryHandle>();
export async function getDataLocation(): Promise<string> {
  return isDesktop() ? invoke('get_data_location') : '浏览器本机存储 / jianmo-data（独立于笔记目录）';
}
// move() is exposed even on picked local files where Chromium rejects it.
// Only use it for handles descended from our origin-private storage root.
const privateHandles = new WeakSet<BrowserHandle>();
let renaming = false;
const invoke = <T,>(command: string, args?: Record<string, unknown>) => window.__TAURI__!.core.invoke<T>(command, args);
export const supportsNotebooks = () => isDesktop() || typeof window.showDirectoryPicker === 'function';
interface SavedDirectory { handle: BrowserDirectoryHandle; locationId: string }
async function storedDirectory(value?: SavedDirectory | null): Promise<SavedDirectory | null> {
  if (!window.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open('jianmo-settings', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('preferences'); };
    request.onerror = () => reject(new Error('无法保存目录设置，请检查浏览器的本机存储权限'));
    request.onsuccess = () => {
      const db = request.result; const transaction = db.transaction('preferences', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('preferences');
      const action = value === undefined ? store.get('directory') : value === null ? store.delete('directory') : store.put(value, 'directory');
      let result: SavedDirectory | null = null;
      action.onsuccess = () => { result = value === undefined ? action.result ?? null : value; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(new Error('目录设置未能保存，请检查浏览器的本机存储权限')); };
      transaction.onabort = transaction.onerror;
    };
  });
}
export async function getNotebookLocation(): Promise<NotebookDirectory> {
  if (isDesktop()) return invoke('get_notebook_location');
  const custom = await storedDirectory();
  if (custom) {
    if (custom.handle.queryPermission && await custom.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('笔记目录需要重新授权，请到设置中重新选择该目录。原有草稿已保留。');
    return { ...await register(custom.handle), locationId: custom.locationId, path: `所选文件夹：${custom.handle.name}` } as NotebookDirectory;
  }
  if (!navigator.storage?.getDirectory) throw new Error('浏览器未提供本机目录存储，请在设置中选择笔记目录，或使用桌面版。');
  const local = await navigator.storage.getDirectory();
  const root = await local.getDirectoryHandle('笺墨', { create: true });
  privateHandles.add(root as unknown as BrowserDirectoryHandle);
  return { ...await register(root as unknown as BrowserDirectoryHandle), locationId: 'browser-default', path: '默认目录 · 浏览器本机存储' } as NotebookDirectory;
}
export async function resetNotebookLocation(): Promise<NotebookDirectory> {
  if (isDesktop()) return invoke('reset_notebook_location');
  await storedDirectory(null); return getNotebookLocation();
}
function cancelled(error: unknown) { return error instanceof Error && error.name === 'AbortError'; }
async function register(handle: BrowserHandle, parent?: BrowserDirectoryHandle): Promise<NotebookEntry> {
  if (parent && privateHandles.has(parent)) privateHandles.add(handle);
  for (const [id, previous] of handles) {
    if (await handle.isSameEntry(previous)) { if (parent) parents.set(id, parent); return { handle: id, name: handle.name, kind: handle.kind }; }
  }
  const id = `browser:${crypto.randomUUID()}`;
  handles.set(id, handle);
  if (parent) parents.set(id, parent);
  return { handle: id, name: handle.name, kind: handle.kind };
}
function directory(id: string): BrowserDirectoryHandle {
  const handle = handles.get(id);
  if (handle?.kind !== 'directory') throw new Error('目录连接已失效，请重新打开笔记目录');
  return handle;
}
export async function pickNotebook(): Promise<NotebookDirectory | null> {
  if (isDesktop()) return invoke('open_notebook');
  if (!window.showDirectoryPicker) throw new Error('此浏览器不支持本机目录，请使用 Chrome、Edge 或桌面版；也可以通过“打开文件”导入笔记');
  try {
    const handle = await window.showDirectoryPicker({ id: 'jianmo-notes', mode: 'readwrite' });
    const previous = await storedDirectory();
    const locationId = previous && await handle.isSameEntry(previous.handle) ? previous.locationId : crypto.randomUUID();
    await storedDirectory({ handle, locationId });
    return { ...await register(handle), locationId, path: `所选文件夹：${handle.name}` } as NotebookDirectory;
  } catch (error) { if (cancelled(error)) return null; throw error; }
}
export async function listNotebook(handle: string): Promise<NotebookEntry[]> {
  if (isDesktop()) return invoke('list_notebook', { handle });
  await migrateBrowserData(directory(handle));
  const entries: NotebookEntry[] = [];
  for await (const child of directory(handle).values()) {
    if (child.kind === 'directory' || /\.(md|markdown|txt)$/i.test(child.name)) entries.push(await register(child, directory(handle)));
  }
  const scope = await browserDataScope(directory(handle));
  for await (const child of scope.values()) if (child.kind === 'directory' && child.name === 'trash') {
    for await (const item of child.values()) {
      if (!originalTrashName(item.name)) continue;
      const entry = await register(item, directory(handle)); actualParents.set(entry.handle, child); entries.push(entry);
    }
  }
  return entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}
// Resolve remembered child names through issued handles; never send a path to native code.
export async function resolveNotebookDirectory(root: NotebookDirectory, names: string[]): Promise<NotebookDirectory> {
  let directory = root;
  for (const name of names) {
    validateEntryName(name);
    const entry = (await listNotebook(directory.handle)).find(child => child.kind === 'directory' && child.name === name);
    if (!entry) throw new Error('原笔记目录已移动或删除，请使用另存为保留当前草稿');
    directory = { ...entry, kind: 'directory' };
  }
  return directory;
}
export async function openNotebookFile(handle: string): Promise<NativeFile> {
  if (isDesktop()) return invoke('open_notebook_file', { handle });
  const file = handles.get(handle);
  if (file?.kind !== 'file') throw new Error('文件连接已失效，请刷新目录后重新打开');
  const data = await readBrowserFile(await file.getFile());
  // Reopening an edited document must not reset its external-change baseline.
  if (!baselines.has(handle)) baselines.set(handle, data.content);
  return { ...data, handle, path: handle };
}
export async function saveNotebookFile(handle: string, content: string): Promise<NativeFile> {
  if (renaming) throw new Error('正在重命名，请稍后保存');
  if (writes.has(handle)) throw new Error('文件正在保存，请稍后再试');
  const file = handles.get(handle);
  if (file?.kind !== 'file' || !baselines.has(handle)) throw new Error('文件连接已失效，请使用另存为');
  writes.add(handle);
  try {
    const actual = await readBrowserFile(await file.getFile());
    if (actual.content !== baselines.get(handle)) throw new Error('文件已被其他程序修改，为避免覆盖，保存已停止。请使用另存为保留当前版本。');
    const stream = await file.createWritable();
    try { await stream.write(content); await stream.close(); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
    baselines.set(handle, content);
    return { handle, path: handle, name: file.name, content };
  } finally { writes.delete(handle); }
}
export function validateEntryName(value: string, maxLength = 100): string {
  const name = value.trim();
  if (!name || name.length > maxLength || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) {
    throw new Error('名称需为 1–100 个字符，不能包含路径、特殊字符或系统保留名称');
  }
  return name;
}
export async function createNotebookEntry(parent: string, value: string, kind: 'directory' | 'file'): Promise<NotebookEntry> {
  if (renaming) throw new Error('正在重命名，请稍后新建');
  const valid = validateEntryName(value);
  const name = kind === 'file' ? normalizeName(valid) : valid;
  if (isDesktop()) return invoke('create_notebook_entry', { parent, name, kind });
  const dir = directory(parent);
  // Do not truncate an existing note, including a name collision with a folder.
  for await (const entry of dir.values()) {
    if (entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()) throw new Error('此目录已存在同名项目，请换一个名称');
  }
  const result = await register(kind === 'directory' ? await dir.getDirectoryHandle(name, { create: true }) : await dir.getFileHandle(name, { create: true }), dir);
  return result;
}
export interface RenameResult { name: string; path?: string; files: { handle: string; name: string; path: string }[] }
export function originalTrashName(name: string): string | undefined { return /^\.jianmo-trash-[a-f0-9]+-[a-f0-9]+-(.+)$/.exec(name)?.[1]; }
export function trashEntryName(name: string): string { return `.jianmo-trash-${Date.now().toString(16)}-${crypto.randomUUID().slice(0, 8)}-${name}`; }
export async function renameNotebookEntry(entry: NotebookEntry, value: string, trash = false, destination?: BrowserDirectoryHandle): Promise<RenameResult> {
  const name = trash ? validateEntryName(value, 240) : entry.kind === 'file' ? normalizeName(validateEntryName(value)) : validateEntryName(value);
  validateEntryName(name, trash ? 240 : 100);
  if (isDesktop()) return invoke('rename_notebook_entry', { handle: entry.handle, name });
  if (renaming || writes.size) throw new Error('文件操作尚未完成，请稍后重试');
  const source = handles.get(entry.handle); const parent = parents.get(entry.handle);
  if (!source || !parent) throw new Error('目录连接已失效，请刷新后重试');
  const sourceParent = actualParents.get(entry.handle) ?? parent;
  const targetParent = destination ?? (trash ? await (await browserDataScope(parent)).getDirectoryHandle('trash', { create: true }) : parent);
  renaming = true;
  try {
    if (source.name !== name || !await sourceParent.isSameEntry(targetParent)) {
      for await (const child of targetParent.values()) if (child.name.toLocaleLowerCase() === name.toLocaleLowerCase() && !await child.isSameEntry(source)) throw new Error('已存在同名文件或目录，请换一个名称');
      let moved = false;
      if (source.kind === 'file' && source.move && privateHandles.has(source) && await sourceParent.isSameEntry(targetParent)) {
        try { await source.move(name); moved = true; }
        catch (error) { if (!(error instanceof Error) || error.name !== 'NotSupportedError') throw error; }
      }
      if (!moved) {
        if (!sourceParent.removeEntry) throw new Error('当前浏览器不支持文件移动，请使用桌面版');
        if (source.name !== name && source.name.toLocaleLowerCase() === name.toLocaleLowerCase()) throw new Error('当前浏览器不支持仅修改大小写，请先改为其他名称');
        // Browsers lack directory rename. Copy every file (including attachments), verify,
        // then remove the old entry. Keep the original and any partial copy on failure.
        const oldName = source.name;
        const bindings: { id: string; next: BrowserHandle; parent: BrowserDirectoryHandle }[] = [];
        const copy = async (from: BrowserHandle, toParent: BrowserDirectoryHandle, newName: string): Promise<BrowserHandle> => {
          const id = (await register(from)).handle;
          if (from.kind === 'file') {
            const next = await toParent.getFileHandle(newName, { create: true });
            if (privateHandles.has(toParent)) privateHandles.add(next);
            const stream = await next.createWritable();
            try { await stream.write(await from.getFile()); await stream.close(); } catch (error) { await stream.abort().catch(() => {}); throw error; }
            bindings.push({ id, next, parent: toParent }); return next;
          }
          const next = await toParent.getDirectoryHandle(newName, { create: true });
          if (privateHandles.has(toParent)) privateHandles.add(next);
          bindings.push({ id, next, parent: toParent });
          for await (const child of from.values()) await copy(child, next, child.name);
          return next;
        };
        const sameContents = async (a: BrowserHandle, b: BrowserHandle): Promise<boolean> => {
          if (a.kind === 'file' && b.kind === 'file') {
            const left = new Uint8Array(await (await a.getFile()).arrayBuffer()); const right = new Uint8Array(await (await b.getFile()).arrayBuffer());
            return left.length === right.length && left.every((byte, index) => byte === right[index]);
          }
          if (a.kind !== 'directory' || b.kind !== 'directory') return false;
          const children = new Map<string, BrowserHandle>(); for await (const child of b.values()) children.set(child.name, child);
          for await (const child of a.values()) { const other = children.get(child.name); if (!other || !await sameContents(child, other)) return false; children.delete(child.name); }
          return children.size === 0;
        };
        try {
          const copied = await copy(source, targetParent, name);
          if (!await sameContents(source, copied)) throw new Error('复制期间内容发生变化');
          // Re-check the parent's entry identity before deleting its old name.
          let sameEntry = false; for await (const child of sourceParent.values()) if (child.name === oldName) sameEntry = await child.isSameEntry(source);
          if (!sameEntry) throw new Error('原项目发生变化');
          const rebound: { from: BrowserDirectoryHandle; to: BrowserDirectoryHandle }[] = [];
          try {
            for (const binding of bindings) {
              const previous = handles.get(binding.id);
              if (previous?.kind === 'directory' && binding.next.kind === 'directory') { await rebindDataScope(previous, binding.next); rebound.push({ from: previous, to: binding.next }); }
            }
            await sourceParent.removeEntry(oldName, { recursive: source.kind === 'directory' });
          } catch (error) {
            for (const binding of rebound.reverse()) await rebindDataScope(binding.to, binding.from);
            throw error;
          }
          for (const binding of bindings) { handles.set(binding.id, binding.next); parents.set(binding.id, binding.id === entry.handle ? parent : binding.parent); }
          if (await targetParent.isSameEntry(parent)) actualParents.delete(entry.handle); else actualParents.set(entry.handle, targetParent);
        } catch { throw new Error('重命名未完成，草稿已保留。请检查原名称与新名称下的文件；新名称下可能留有副本。'); }
      }
    }
    return { name, path: entry.handle, files: [...handles].filter(([, file]) => file.kind === 'file').map(([handle, file]) => ({ handle, name: file.name, path: handle })) };
  } finally { renaming = false; }
}
export async function renameOpenedFile(handle: string, value: string): Promise<RenameResult> {
  const name = normalizeName(validateEntryName(value)); validateEntryName(name);
  if (isDesktop()) return invoke('rename_document', { handle, name });
  const file = handles.get(handle);
  if (!file || file.kind !== 'file') throw new Error('文件连接已失效，请重新打开后重命名');
  return renameNotebookEntry({ handle, name: file.name, kind: 'file' }, name);
}
async function migrateBrowserData(parent: BrowserDirectoryHandle): Promise<void> {
  const children: BrowserHandle[] = []; for await (const child of parent.values()) children.push(child);
  for (const child of children) {
    if (child.kind === 'directory' && child.name === '.assets') {
      const destination = await browserDataScope(parent);
      await renameNotebookEntry(await register(child, parent), child.name, true, destination);
    } else if (originalTrashName(child.name)) {
      await renameNotebookEntry(await register(child, parent), child.name, true);
    } else if (child.kind === 'directory') { await migrateBrowserData(child); }
  }
}
export async function storeNotebookImage(file: File, parent?: string, document?: string): Promise<{ source: string; url: string }> {
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[file.type];
  if (!extension) throw new Error('支持 PNG、JPEG、GIF 和 WebP 图片');
  let source: string;
  if (isDesktop()) source = await invoke<string>('store_notebook_image', { parent: parent ?? null, document: document ?? null, bytes: [...new Uint8Array(await file.arrayBuffer())] });
  else {
    if (renaming) throw new Error('正在重命名，请稍后插入图片');
    directory(parent!);
    const assets = await (await browserDataRoot()).getDirectoryHandle('.assets', { create: true });
    const name = `image-${crypto.randomUUID()}.${extension}`; const target = await assets.getFileHandle(name, { create: true });
    const stream = await target.createWritable();
    try { await stream.write(file); await stream.close(); } catch (error) { await stream.abort().catch(() => {}); throw error; }
    source = `jianmo-asset://${name}`;
  }
  return { source, url: URL.createObjectURL(file) };
}
export async function loadNotebookImage(source: string, parent?: string, document?: string): Promise<string> {
  const name = localImageName(source); if (!name) throw new Error('图片路径无效');
  if (isDesktop()) {
    const bytes = await invoke<number[]>('read_notebook_image', { parent: parent ?? null, document: document ?? null, name, managed: source.startsWith('jianmo-asset://') });
    const extension = name.split('.').at(-1)!.toLowerCase();
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` }));
  }
  const current = directory(parent!);
  let storage = source.startsWith('jianmo-asset://') ? await browserDataRoot() : await browserDataScope(current);
  if (!source.startsWith('jianmo-asset://')) for await (const child of current.values()) if (child.kind === 'directory' && child.name === '.assets') { storage = current; break; }
  const assets = await storage.getDirectoryHandle('.assets');
  return URL.createObjectURL(await (await assets.getFileHandle(name)).getFile());
}
