import { normalizeName } from '../core/documents.ts';
export interface NativeFile { handle: string; path: string; name: string; content: string }
declare global { interface Window { __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> }; event?: { listen(event: string, callback: () => void): Promise<() => void> } } } }
export const isDesktop = () => Boolean(window.__TAURI__?.core);
// Format Windows canonical paths for display only; native paths and identities stay intact.
export function displayFilePath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return '\\\\' + path.slice(8);
  if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4);
  return path;
}
export async function openNativeFile(): Promise<NativeFile | null> {
  return window.__TAURI__!.core.invoke<NativeFile | null>('open_document');
}
export async function readNativeFile(handle: string): Promise<NativeFile> {
  return window.__TAURI__!.core.invoke<NativeFile>('read_document', { handle });
}
export async function revealNativeFile(handle: string): Promise<void> {
  await window.__TAURI__!.core.invoke('reveal_document', { handle });
}
export type NativeOpenResult = { status: 'opened'; value: NativeFile } | { status: 'error'; value: string };
export function watchNativeFiles(onOpen: (results: NativeOpenResult[]) => void, onError: (error: unknown) => void): () => void {
  const tauri = window.__TAURI__;
  if (!tauri?.event) return () => {};
  let stopped = false; let unlisten: (() => void) | undefined;
  let draining = false; let requested = false;
  async function drain() {
    requested = true;
    if (draining || stopped) return;
    draining = true;
    try {
      do {
        requested = false;
        const results = await tauri!.core.invoke<NativeOpenResult[]>('take_pending_documents');
        // A completed drain has consumed the queue, so always deliver its results.
        if (results.length) onOpen(results);
      } while (requested && !stopped);
    } catch (error) { onError(error); }
    finally { draining = false; }
  }
  void tauri.event.listen('documents-pending', () => { void drain(); }).then(stop => {
    if (stopped) { stop(); return; }
    unlisten = stop;
    // Subscribe before draining to cover launches while the webview is loading.
    void drain();
  }).catch(onError);
  return () => { stopped = true; unlisten?.(); };
}
export async function saveNativeFile(content: string, name: string, handle?: string, expected?: string | null): Promise<NativeFile | null> {
  return window.__TAURI__!.core.invoke<NativeFile | null>('save_document', { content, name: normalizeName(name), handle: handle ?? null, ...(expected != null ? { expected } : {}) });
}
export async function readBrowserFile(file: File): Promise<{ name: string; content: string }> {
  if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('请选择 .md、.markdown 或 .txt 文件');
  return { name: file.name, content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) };
}
export function download(content: string, name: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
