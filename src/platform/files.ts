import { normalizeName } from '../core/documents.ts';
export interface NativeFile { handle: string; path: string; name: string; content: string }
declare global { interface Window { __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } } } }
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
export async function saveNativeFile(content: string, name: string, handle?: string): Promise<NativeFile | null> {
  return window.__TAURI__!.core.invoke<NativeFile | null>('save_document', { content, name: normalizeName(name), handle: handle ?? null });
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
