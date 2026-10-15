export type Theme = 'light' | 'warm' | 'dark';
export type ViewMode = 'read' | 'edit' | 'split';
export interface Document {
  id: string; name: string; content: string; savedContent: string | null;
  updatedAt: number; starred: boolean; nativeHandle?: string; path?: string; noteLocation?: string; noteName?: string; noteDirectory?: string[];
  trash?: { name: string; parent: string[]; location?: string };
}
export interface Workspace { version: 1; openTabs?: string[]; documents: Document[]; activeId: string; theme: Theme; fontSize: number; defaultView?: ViewMode; spellcheck?: boolean; pageWidth?: 'normal' | 'wide' }
export const STORAGE_KEY = 'jianmo-workspace-v1';
export function newDocument(name = '未命名.md', content = '# 新的篇章\n\n从这里开始书写。\n'): Document {
  return { id: crypto.randomUUID(), name: normalizeName(name), content, savedContent: null, updatedAt: Date.now(), starred: false };
}
export function normalizeName(value: string): string {
  const name = value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/[. ]+$/, '').slice(0, 100) || '未命名';
  return /\.(md|markdown|txt)$/i.test(name) ? name : `${name}.md`;
}
export function isDirty(doc: Document): boolean { return doc.savedContent !== doc.content; }
export function edited(doc: Document, content: string): Document { return { ...doc, content, updatedAt: Date.now() }; }
// Apply the exact snapshot written to disk; typing during an asynchronous save remains dirty.
export function saved(doc: Document, snapshot: string, result: { name?: string; handle?: string; path?: string }): Document {
  return { ...doc, savedContent: snapshot, name: result.name ?? doc.name, nativeHandle: result.handle ?? doc.nativeHandle, path: result.path ?? doc.path };
}
export function initialWorkspace(): Workspace {
  const welcome = newDocument('欢迎使用笺墨.md', '# 让想法，自然成文\n\n一页留白，容得下你的每一种想法。\n\n## 简单书写，自有章法\n\n直接点击正文，开始记录。用 Markdown 组织文字，在菜单中切换源码模式，用 Ctrl / ⌘ S 保存到笔记目录。\n\n> 写下来，让想法变得清晰。\n\n## 今天，从这里开始\n\n- [x] 为想法找到一个安静的地方\n- [ ] 写下今天最重要的一件事\n- [ ] 保存成属于自己的 Markdown 文件\n\n## 熟悉的表达方式\n\n| 内容 | 语法 |\n| --- | --- |\n| 标题 | `## 二级标题` |\n| 强调 | `**重点**` |\n| 待办 | `- [ ] 待完成` |\n\n```typescript\nconst idea = "Start writing";\n```\n\n## 文件与草稿\n\n草稿会自动保存在当前设备。按 Ctrl / ⌘ S 保存到笔记目录，在偏好设置中选择存储位置和页面宽度。\n');
  welcome.starred = true;
  const note = newDocument('日常灵感.md', '# 日常灵感\n\n## 值得记住\n\n把路过的灵感，留在这里。\n');
  return { version: 1, documents: [welcome, note], activeId: welcome.id, theme: 'light', fontSize: 17 };
}
export function serializeWorkspace(state: Workspace): string {
  // Native handles are session-local. Restored drafts use Save As until a file is reopened.
  return JSON.stringify({ ...state, documents: state.documents.map(({ nativeHandle: _h, path: _p, ...doc }) => doc) });
}
export function parseWorkspace(raw: string): Workspace {
  const data = JSON.parse(raw) as Partial<Workspace>;
  if (data.version !== 1 || !Array.isArray(data.documents) || !data.documents.length) throw new Error('草稿格式不受支持');
  const ids = new Set<string>();
  const documents = data.documents.map((doc) => {
    if (!doc || typeof doc.id !== 'string' || ids.has(doc.id) || typeof doc.name !== 'string' || typeof doc.content !== 'string' || !(doc.savedContent === null || typeof doc.savedContent === 'string')) throw new Error('草稿内容损坏');
    ids.add(doc.id);
    if (doc.noteDirectory !== undefined && (!Array.isArray(doc.noteDirectory) || !doc.noteDirectory.every(name => typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name)))) throw new Error('草稿目录信息损坏');
    return { id: doc.id, name: normalizeName(doc.name), content: doc.content, savedContent: doc.savedContent, updatedAt: Number.isFinite(doc.updatedAt) ? doc.updatedAt : Date.now(), starred: doc.starred === true,
      noteLocation: typeof doc.noteLocation === 'string' ? doc.noteLocation : undefined, noteName: typeof doc.noteName === 'string' ? doc.noteName : undefined, noteDirectory: doc.noteDirectory,
      trash: doc.trash && typeof doc.trash.name === 'string' && Array.isArray(doc.trash.parent) && doc.trash.parent.every(part => typeof part === 'string') ? doc.trash : undefined };
  });
  return { version: 1, openTabs: Array.isArray(data.openTabs) ? data.openTabs.filter(id => typeof id === 'string' && documents.some(doc => doc.id === id && !doc.trash)) : undefined, documents, activeId: documents.some(d => d.id === data.activeId) ? data.activeId! : documents[0].id,
    theme: data.theme === 'dark' || data.theme === 'warm' ? data.theme : 'light',
    fontSize: typeof data.fontSize === 'number' && Number.isFinite(data.fontSize) ? Math.min(22, Math.max(14, data.fontSize)) : 17,
    defaultView: data.defaultView === 'edit' || data.defaultView === 'split' ? data.defaultView : 'read', spellcheck: data.spellcheck === true,
    pageWidth: data.pageWidth === 'wide' ? 'wide' : 'normal' };
}
export function migratePrototype(raw: string): Workspace {
  const old = JSON.parse(raw);
  if (!Array.isArray(old.docs) || !old.docs.length) throw new Error('旧版草稿格式不受支持');
  return parseWorkspace(JSON.stringify({ version: 1, documents: old.docs.map((d: { id: string; name?: string; title?: string; body?: string; content?: string; starred?: boolean }) => ({ id: d.id, name: d.name ?? d.title, content: d.body ?? d.content, savedContent: null, updatedAt: Date.now(), starred: d.starred })), activeId: old.activeId, theme: old.theme, fontSize: old.fontSize }));
}
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function loadWorkspace(storage: StoragePort): { state: Workspace; error: string | null; writable: boolean } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return { state: parseWorkspace(raw), error: null, writable: true };
    const legacy = storage.getItem('jianmo-prototype-v1');
    return { state: legacy ? migratePrototype(legacy) : initialWorkspace(), error: null, writable: true };
  } catch {
    return { state: initialWorkspace(), error: '无法读取原有草稿，已保留原始数据。当前编辑请另存为文件。', writable: false };
  }
}
export function wordCount(text: string): number {
  return (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu) ?? []).length;
}
