import type { BrowserDirectoryHandle } from './notebooks.ts';
interface Scope { id: string; handle: BrowserDirectoryHandle }
let queue: Promise<unknown> = Promise.resolve();
async function records(value?: Scope[]): Promise<Scope[]> {
  if (!window.indexedDB) throw new Error('浏览器无法持久保存数据索引，原文件已保留，请使用桌面版');
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open('jianmo-data', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('index');
    request.onerror = () => reject(new Error('软件数据索引不可用，原文件已保留'));
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('index', value ? 'readwrite' : 'readonly');
      const action = value ? tx.objectStore('index').put(value, 'scopes') : tx.objectStore('index').get('scopes');
      let result: Scope[] = value ?? [];
      action.onsuccess = () => { if (!value) result = action.result ?? []; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new Error('软件数据索引保存失败')); };
    };
  });
}
function serial<T>(task: () => Promise<T>): Promise<T> { const next = queue.then(task); queue = next.catch(() => {}); return next; }
export async function browserDataRoot(): Promise<BrowserDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new Error('浏览器未提供独立数据存储，请使用桌面版或允许本机存储');
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle('jianmo-data', { create: true }) as unknown as BrowserDirectoryHandle;
}
export function browserDataScope(parent: BrowserDirectoryHandle): Promise<BrowserDirectoryHandle> {
  return serial(async () => {
    const items = await records(); let scope: Scope | undefined;
    for (const item of items) if (await item.handle.isSameEntry(parent)) { scope = item; break; }
    if (!scope) { scope = { id: crypto.randomUUID(), handle: parent }; await records([...items, scope]); }
    return (await browserDataRoot()).getDirectoryHandle(scope.id, { create: true });
  });
}
export function rebindDataScope(from: BrowserDirectoryHandle, to: BrowserDirectoryHandle): Promise<void> {
  return serial(async () => {
    const items = await records(); let changed = false;
    for (const item of items) if (await item.handle.isSameEntry(from)) { item.handle = to; changed = true; }
    if (changed) await records(items);
  });
}
