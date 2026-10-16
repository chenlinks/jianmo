import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { edited, isDirty, loadWorkspace, newDocument, normalizeName, saved, serializeWorkspace, STORAGE_KEY, wordCount } from './core/documents.ts';
import type { Document, ViewMode, Workspace } from './core/documents.ts';
import { formatSelection } from './core/format.ts';
import type { Format } from './core/format.ts';
import { formatParagraph, paragraphOptions, paragraphShortcut, sourceHeadingLevel } from './core/paragraph.ts';
import type { ParagraphAction } from './core/paragraph.ts';
import { cacheImagePreview, imagePreview } from './core/image-assets.ts';
import { listKey } from './core/lists.ts';
import { renderMarkdown } from './core/markdown.ts';
import { download, isDesktop, openNativeFile, readBrowserFile, saveNativeFile } from './platform/files.ts';
import Icon from './components/Icon.tsx';
import Logo from './components/Logo.tsx';
import { useNotebookLocation } from './components/useNotebookLocation.ts';
import { createNotebookEntry, getNotebookLocation, listNotebook, openNotebookFile, pickNotebook, resetNotebookLocation, resolveNotebookDirectory, saveNotebookFile, renameNotebookEntry, renameOpenedFile, validateEntryName, originalTrashName, trashEntryName, storeNotebookImage, loadNotebookImage } from './platform/notebooks.ts';
import type { RenameResult } from './platform/notebooks.ts';
import type { NotebookEntry } from './platform/notebooks.ts';
import AppSettings from './components/AppSettings.tsx';
import LiveEditor from './components/LiveEditor.tsx';
import type { LiveEditorHandle } from './components/LiveEditor.tsx';
import AppMenu, { ContextMenu } from './components/AppMenu.tsx';
import type { ContextMenuState, MenuGroup, MenuItem } from './components/AppMenu.tsx';
import Modal from './components/Modal.tsx';
import InsertMedia from './components/InsertMedia.tsx';
import type { MediaDraft, MediaKind } from './core/media.ts';
import tokenCss from './styles/tokens.css?raw';
import articleCss from './styles/article.css?raw';

const formats: { kind: Format; label: string; symbol: string }[] = [
  { kind: 'heading', label: '二级标题', symbol: 'H₂' }, { kind: 'bold', label: '加粗', symbol: 'B' },
  { kind: 'italic', label: '斜体', symbol: 'I' }, { kind: 'quote', label: '引用', symbol: '“' },
  { kind: 'list', label: '无序列表', symbol: '☷' }, { kind: 'task', label: '待办事项', symbol: '☑' },
  { kind: 'link', label: '链接', symbol: '↗' }, { kind: 'code', label: '行内代码', symbol: '</>' }, { kind: 'table', label: '表格', symbol: '▦' }
];
type Dialog = 'about' | 'versions' | 'settings' | 'new' | 'newFolder' | 'rename' | 'delete' | 'trash' | 'export' | 'outline' | 'library' | null;

export default function App() {
  const [boot] = useState(() => {
    // Accessing localStorage itself may throw in restricted browsers.
    try { return loadWorkspace(window.localStorage); }
    catch { return loadWorkspace({ getItem() { throw new Error('unavailable'); }, setItem() {} }); }
  });
  const [state, setState] = useState<Workspace>(boot.state);
  const [view, setView] = useState<ViewMode>(boot.state.defaultView === 'edit' ? 'edit' : 'read'); const [dialog, setDialog] = useState<Dialog>(null);
  const [query, setQuery] = useState(''); const [starredOnly, setStarredOnly] = useState(false);
  const [tabs, setTabs] = useState(boot.state.openTabs ?? [boot.state.activeId]); const [focus, setFocus] = useState(false);
  const [notice, setNotice] = useState(''); const [cacheError, setCacheError] = useState(boot.error);
  const [busy, setBusy] = useState(false); const operation = useRef(false);
  const [draggingFiles, setDraggingFiles] = useState(false); const dragDepth = useRef(0);
  const [formName, setFormName] = useState(''); const [template, setTemplate] = useState('blank');
  const [folderError, setFolderError] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ docId: string } | { entry: NotebookEntry; directory: string[]; location?: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [contextEntry, setContextEntry] = useState<NotebookEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ docId: string } | { entry: NotebookEntry } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const notebook = useNotebookLocation();
  const richEditor = useRef<LiveEditorHandle>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const sourceSelection = useRef({ start: 0, end: 0 });
  const [headingLevel, setHeadingLevel] = useState(0);
  const [media, setMedia] = useState<MediaDraft | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null); const importer = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLElement>(null);
  const [activeHeading, setActiveHeading] = useState('');
  const latest = useRef(state); latest.current = state;
  const current = state.documents.find(d => d.id === state.activeId)!;
  const hasDocument = tabs.includes(current.id) && !current.trash;
  const [imageVersion, setImageVersion] = useState(0);
  const imageContext = current.id + ':' + JSON.stringify([current.noteLocation, current.noteDirectory]);
  const deferredContent = useDeferredValue(current.content);
  const rendered = useMemo(() => renderMarkdown(deferredContent, imageContext), [deferredContent, imageContext, imageVersion]);
  const directoryNames = notebook.trail.slice(1).map(entry => entry.name);
  const directoryKey = JSON.stringify(directoryNames);
  const inDirectory = (doc: Document) => JSON.stringify(doc.noteDirectory ?? []) === directoryKey && (!doc.noteLocation || doc.noteLocation === notebook.trail[0]?.locationId);
  const visible = state.documents.filter(d => !d.trash && (starredOnly ? d.starred : inDirectory(d)) && `${d.name}\n${d.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const folders = starredOnly ? [] : notebook.entries.filter(entry => entry.kind === 'directory' && entry.name !== '.assets' && !originalTrashName(entry.name) && entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const unopened = starredOnly ? [] : notebook.entries.filter(entry => entry.kind === 'file' && !originalTrashName(entry.name) && entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && !state.documents.some(doc => !doc.trash && (doc.nativeHandle === entry.handle || (inDirectory(doc) && doc.noteLocation === notebook.trail[0]?.locationId && doc.noteName === entry.name))));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const root = await getNotebookLocation(); const entries = await listNotebook(root.handle);
        if (!cancelled) { notebook.setTrail([root]); notebook.setEntries(entries); notebook.setError(''); }
      } catch (error) { if (!cancelled) notebook.setError(error instanceof Error ? error.message : String(error)); }
    })();
    return () => { cancelled = true; };
  }, []);
  async function imageStorage() {
    if (isDesktop() && current.nativeHandle) return { document: current.nativeHandle };
    const root = notebook.trail[0] ?? await getNotebookLocation();
    if (current.noteLocation && current.noteLocation !== root.locationId) throw new Error('请先切换回这篇笔记的存储目录');
    const parent = await resolveNotebookDirectory(root, current.noteDirectory ?? []);
    return { parent: parent.handle };
  }
  async function storeImage(file: File) {
    const target = await imageStorage(); const result = await storeNotebookImage(file, target.parent, target.document);
    cacheImagePreview(result.source, result.url, imageContext); setImageVersion(value => value + 1); return result.source;
  }
  useEffect(() => {
    let cancelled = false;
    const template = document.createElement('template'); template.innerHTML = rendered.html;
    const sources = [...new Set(Array.from(template.content.querySelectorAll<HTMLElement>('img[data-image-source]')).map(img => img.dataset.imageSource!))].filter(source => !imagePreview(source, imageContext));
    if (sources.length) void (async () => {
      try {
        const target = await imageStorage(); let changed = false;
        for (const source of sources) try {
          const url = await loadNotebookImage(source, target.parent, target.document);
          if (cancelled) URL.revokeObjectURL(url); else { cacheImagePreview(source, url, imageContext); changed = true; }
        } catch { /* Missing attachments keep their alt text and source reference. */ }
        if (changed && !cancelled) setImageVersion(value => value + 1);
      } catch { /* A disconnected notebook can be reconnected from preferences. */ }
    })();
    return () => { cancelled = true; };
  }, [current.id, current.content, imageContext, notebook.trail[0]?.locationId]);
  function closeTab(id: string) {
    const next = tabs.filter(tab => tab !== id); setTabs(next);
    if (id === current.id && next.length) setState(state => ({ ...state, activeId: next[next.length - 1] }));
    setMedia(null); setContextMenu(null);
  }
  function syncOutline() {
    const panel = preview.current; if (!panel) return;
    const headings = Array.from(panel.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
    const top = panel.getBoundingClientRect().top + 40;
    let active = headings[0]?.id ?? '';
    for (const heading of headings) { if (heading.getBoundingClientRect().top <= top) active = heading.id; else break; }
    setActiveHeading(active);
  }
  useEffect(() => { const frame = requestAnimationFrame(syncOutline); return () => cancelAnimationFrame(frame); }, [current.id, view, rendered.html, state.fontSize, state.pageWidth]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.title = hasDocument ? `${current.name} · 笺墨` : '笺墨 · 留住每一个想法';
    if (!boot.writable) return;
    try { localStorage.setItem(STORAGE_KEY, serializeWorkspace({ ...state, openTabs: tabs })); setCacheError(null); }
    catch { setCacheError('草稿未能自动保存。请立即按 Ctrl/⌘ S 保存文件以保留内容。'); }
  }, [state, tabs, boot.writable, current.name, hasDocument]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 2000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) { if (cacheError) { e.preventDefault(); e.returnValue = ''; } }
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [cacheError]);
  useEffect(() => {
    const m = matchMedia('(max-width: 760px)');
    const handle = () => { if (m.matches) setView(v => v === 'split' ? 'read' : v); };
    handle(); m.addEventListener('change', handle); return () => m.removeEventListener('change', handle);
  }, []);
  function update(id: string, fn: (doc: Document) => Document) { setState(s => ({ ...s, documents: s.documents.map(d => d.id === id ? fn(d) : d) })); }
  function activate(id: string) { setState(s => ({ ...s, activeId: id })); setTabs(t => t.includes(id) ? t : [...t, id]); setDialog(null); }
  function add(doc: Document) { setState(s => ({ ...s, documents: [...s.documents, doc], activeId: doc.id })); setTabs(t => [...t, doc.id]); setDialog(null); }
  function openNew() { if (operation.current) return; setFormName(''); setTemplate('blank'); setDialog('new'); }
  function openNewFolder() { if (operation.current) return; setFormName(''); setFolderError(''); setDialog('newFolder'); }
  function openRename(doc = current) {
    if (operation.current) return;
    setRenameTarget({ docId: doc.id }); setFormName(doc.name); setRenameError(''); setDialog('rename');
  }
  function openEntryRename(entry: NotebookEntry) {
    if (operation.current) return;
    setRenameTarget({ entry, directory: directoryNames, location: notebook.trail[0]?.locationId }); setFormName(entry.name); setRenameError(''); setDialog('rename');
  }
  function entryContext(event: React.MouseEvent, entry: NotebookEntry) { setContextEntry(entry); context(event, 'entry'); }
  function openDelete(target: { docId: string } | { entry: NotebookEntry }) { if (busy) return; setDeleteTarget(target); setDeleteError(''); setDialog('delete'); }
  function commitDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    void run(async () => {
      try {
        const root = notebook.trail[0] ?? await getNotebookLocation();
        let parentNames = directoryNames; let entry: NotebookEntry | undefined;
        const doc = 'docId' in target ? latest.current.documents.find(item => item.id === target.docId) : undefined;
        if ('entry' in target) entry = target.entry;
        else if (doc?.noteLocation && doc.noteName) {
          if (doc.noteLocation !== root.locationId) throw new Error('请切换回笔记所在目录后删除');
          parentNames = doc.noteDirectory ?? [];
          const parent = await resolveNotebookDirectory(root, parentNames);
          entry = (await listNotebook(parent.handle)).find(item => item.kind === 'file' && item.name === doc.noteName);
          if (!entry) throw new Error('原文件已移动或删除，请刷新目录');
        } else if (doc?.nativeHandle) throw new Error('此文件不在笔记目录中，请在系统文件管理器中删除');
        const name = trashEntryName(entry?.name ?? doc?.name ?? '未命名.md');
        if (entry) await renameNotebookEntry(entry, name, true);
        const deleted = latest.current.documents.filter(item => {
          if (item.trash) return false;
          if ('docId' in target && item.id === target.docId) return true;
          if (!entry || item.noteLocation !== root.locationId) return false;
          if (entry.kind === 'file') return JSON.stringify(item.noteDirectory ?? []) === JSON.stringify(parentNames) && item.noteName === entry.name;
          return [...parentNames, entry.name].every((part, index) => part === item.noteDirectory?.[index]);
        }).map(item => item.id);
        const remaining = tabs.filter(id => !deleted.includes(id)); setTabs(remaining);
        setState(state => ({ ...state, documents: state.documents.map(item => deleted.includes(item.id) ? { ...item, trash: { name, parent: parentNames, location: root.locationId } } : item), activeId: deleted.includes(state.activeId) && remaining.length ? remaining[remaining.length - 1] : state.activeId }));
        setDialog(null); setNotice('已移入回收站');
        if (notebook.trail.length) try { notebook.setEntries(await listNotebook(notebook.trail.at(-1)!.handle)); } catch { setNotice('已移入回收站，请刷新目录查看'); }
      } catch (error) { setDeleteError(error instanceof Error ? error.message : '删除失败'); }
    });
  }
  function restoreTrash(entry?: NotebookEntry, draftTrashName?: string) {
    void run(async () => {
      const name = entry?.name ?? draftTrashName!;
      const original = originalTrashName(name); if (!original) return;
      if (entry) await renameNotebookEntry(entry, original);
      setState(state => ({ ...state, documents: state.documents.map(doc => doc.trash?.name === name && doc.trash.location === notebook.trail[0]?.locationId ? { ...doc, trash: undefined, nativeHandle: undefined, path: undefined } : doc) }));
      notebook.setEntries(await listNotebook(notebook.trail.at(-1)!.handle)); setNotice('已恢复');
    });
  }
  function commitRename() {
    const target = renameTarget; if (!target) return;
    void run(async () => {
      setRenameError('');
      try {
        const valid = validateEntryName(formName);
        const snapshot = 'docId' in target ? latest.current.documents.find(doc => doc.id === target.docId) : undefined;
        const name = 'entry' in target && target.entry.kind === 'directory' ? valid : normalizeName(valid);
        validateEntryName(name);
        let result: RenameResult = { name, files: [] };
        if ('entry' in target) result = await renameNotebookEntry(target.entry, name);
        else if (snapshot?.nativeHandle) result = await renameOpenedFile(snapshot.nativeHandle, name);
        else if (snapshot?.noteLocation && snapshot.noteName) {
          const root = notebook.trail[0] ?? await getNotebookLocation();
          if (root.locationId !== snapshot.noteLocation) throw new Error('请先切换回该笔记的存储目录再重命名');
          const parent = await resolveNotebookDirectory(root, snapshot.noteDirectory ?? []);
          const entry = (await listNotebook(parent.handle)).find(item => item.kind === 'file' && item.name === snapshot.noteName);
          if (!entry) throw new Error('原笔记已移动或删除，请刷新目录后重试');
          result = await renameNotebookEntry(entry, name);
        }
        setState(state => ({ ...state, documents: state.documents.map(doc => {
          const changed = result.files.find(file => file.handle === doc.nativeHandle);
          let updated = changed ? { ...doc, path: changed.path, name: changed.name } : doc;
          if ('docId' in target && doc.id === target.docId) return { ...updated, name: result.name, ...(doc.noteName ? { noteName: result.name } : {}) };
          if ('entry' in target && doc.noteLocation === target.location) {
            const path = doc.noteDirectory ?? [];
            if (target.entry.kind === 'directory') {
              const prefix = [...target.directory, target.entry.name];
              if (doc.trash && prefix.every((part, i) => part === doc.trash!.parent[i])) updated = { ...updated, trash: { ...doc.trash, parent: [...target.directory, result.name, ...doc.trash.parent.slice(prefix.length)] } };
              if (prefix.every((part, i) => part === path[i])) updated = { ...updated, noteDirectory: [...target.directory, result.name, ...path.slice(prefix.length)] };
            } else if (JSON.stringify(path) === JSON.stringify(target.directory) && doc.noteName === target.entry.name) updated = { ...updated, name: result.name, noteName: result.name };
          }
          return updated;
        }) }));
        setDialog(null); setRenameTarget(null); setQuery(''); setNotice('已重命名');
        // The rename already succeeded; a refresh failure must not invite a second rename.
        if (notebook.trail.length) try { notebook.setEntries(await listNotebook(notebook.trail.at(-1)!.handle)); } catch { setNotice('已重命名，请刷新目录查看'); }
      } catch (error) { setRenameError(error instanceof Error ? error.message : '重命名失败，名称未更新'); }
    });
  }
  async function enterDirectory(entry: NotebookEntry) {
    const entries = await listNotebook(entry.handle);
    notebook.setTrail(trail => [...trail, { ...entry, kind: 'directory' }]); notebook.setEntries(entries); setQuery('');
  }
  function navigateDirectory(index: number) {
    void run(async () => { const trail = notebook.trail.slice(0, index + 1); const entries = await listNotebook(trail[index].handle); notebook.setTrail(trail); notebook.setEntries(entries); setQuery(''); });
  }
  function createFolder() {
    void run(async () => {
      setFolderError('');
      try {
        const parent = notebook.trail.at(-1) ?? await getNotebookLocation();
        await createNotebookEntry(parent.handle, formName, 'directory');
        if (!notebook.trail.length) notebook.setTrail([parent]);
        notebook.setEntries(await listNotebook(parent.handle)); setQuery(''); setDialog(null); setNotice('目录已创建');
      } catch (error) { setFolderError(error instanceof Error ? error.message : '创建目录失败'); }
    });
  }
  async function run(task: () => Promise<void>) {
    if (operation.current) return; operation.current = true; setBusy(true);
    try { await task(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { operation.current = false; setBusy(false); }
  }
  function openFile() {
    if (!isDesktop()) { importer.current?.click(); return; }
    void run(async () => {
      const file = await openNativeFile(); if (!file) return;
      const existing = latest.current.documents.find(d => d.path === file.path);
      if (existing) { activate(existing.id); setNotice('文件已在文档库中，保留当前编辑内容'); return; }
      add({ ...newDocument(file.name, file.content), savedContent: file.content, nativeHandle: file.handle, path: file.path });
      setNotice('文件已打开');
    });
  }
  function importFiles(files: File[], read = false) {
    if (operation.current) { setNotice('正在处理文件，请稍后再拖入'); return; }
    void run(async () => {
      let imported = 0; const errors: string[] = [];
      for (const file of files) {
        try {
          const data = await readBrowserFile(file);
          add({ ...newDocument(data.name, data.content), savedContent: data.content }); imported++;
        } catch (error) { errors.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`); }
      }
      if (imported && read) { setView('read'); setMedia(null); setContextMenu(null); }
      setNotice([imported ? `已导入 ${imported} 个文件` : '', ...errors].filter(Boolean).join('；'));
    });
  }
  function isFileDrag(event: React.DragEvent) { return Array.from(event.dataTransfer.types).includes('Files'); }
  function clearFileDrag() { dragDepth.current = 0; setDraggingFiles(false); }
  function openDirectory(useDefault = false) {
    void run(async () => {
      const root = useDefault ? await resetNotebookLocation() : await pickNotebook(); if (!root) return;
      const entries = await listNotebook(root.handle);
      notebook.setTrail([root]); notebook.setEntries(entries); notebook.setError('');
      setNotice('笔记目录已设置，新文档将保存到此目录');
    });
  }
  async function openNote(entry: NotebookEntry) {
    const file = await openNotebookFile(entry.handle);
    const noteLocation = notebook.trail[0]?.locationId;
    const existing = latest.current.documents.find(d => d.nativeHandle === file.handle || d.path === file.path || (noteLocation && d.noteLocation === noteLocation && d.noteName === file.name && inDirectory(d)));
    if (existing) {
      activate(existing.id);
      if (existing.nativeHandle) { setNotice('已打开笔记，保留当前编辑内容'); return; }
      if (isDirty(existing) && existing.savedContent !== file.content) { setNotice('文件已被其他程序修改。已保留当前草稿，请另存为后重新打开原文件。'); return; }
      update(existing.id, doc => ({ ...doc, content: isDirty(doc) ? doc.content : file.content, savedContent: file.content, nativeHandle: file.handle, path: file.path }));
      return;
    }
    add({ ...newDocument(file.name, file.content), savedContent: file.content, nativeHandle: file.handle, path: file.path, noteLocation, noteName: file.name, noteDirectory: directoryNames });
  }
  function context(event: React.MouseEvent, type: ContextMenuState['type']) { event.preventDefault(); event.stopPropagation(); if (dialog === 'library') setDialog(null); setContextMenu({ x: event.clientX, y: event.clientY, type }); }
  function saveFile(asNew = false, document?: Document) {
    const snapshot = document ?? latest.current.documents.find(d => d.id === latest.current.activeId)!;
    void run(async () => {
      if (!asNew && !snapshot.nativeHandle) {
        const root = notebook.trail[0] ?? await getNotebookLocation();
        if (snapshot.noteLocation && snapshot.noteLocation !== root.locationId) throw new Error('原笔记位于其他笔记目录，请切换回原目录或使用另存为');
        const noteDirectory = snapshot.noteDirectory ?? (snapshot.noteLocation ? [] : directoryNames);
        const parent = await resolveNotebookDirectory(root, noteDirectory);
        const entries = await listNotebook(parent.handle);
        if (snapshot.noteLocation && snapshot.noteLocation === root.locationId && snapshot.noteName) {
          const existing = entries.find(e => e.kind === 'file' && e.name === snapshot.noteName);
          if (!existing) throw new Error('原笔记已移动或删除，请使用另存为保留当前草稿');
          const opened = await openNotebookFile(existing.handle);
          if (opened.content !== snapshot.savedContent) throw new Error('原笔记已被其他程序修改，请使用另存为保留当前草稿');
          const result = isDesktop() ? await saveNativeFile(snapshot.content, opened.name, opened.handle) : await saveNotebookFile(opened.handle, snapshot.content);
          if (result) update(snapshot.id, doc => saved(doc, snapshot.content, result));
          setNotice('已保存到笔记目录'); return;
        }
        const names = new Set(entries.map(e => e.name.toLocaleLowerCase()));
        let name = snapshot.name; let suffix = 2;
        while (names.has(name.toLocaleLowerCase())) name = snapshot.name.replace(/(\.[^.]+)$/, ` (${suffix++})$1`);
        const entry = await createNotebookEntry(parent.handle, name, 'file');
        const opened = await openNotebookFile(entry.handle);
        if (opened.content !== '') throw new Error('同名文件已由其他程序创建，请再次保存以使用新名称');
        update(snapshot.id, doc => ({ ...saved(doc, '', opened), noteLocation: root.locationId, noteName: name, noteDirectory }));
        const result = isDesktop() ? await saveNativeFile(snapshot.content, name, opened.handle) : await saveNotebookFile(opened.handle, snapshot.content);
        if (result) update(snapshot.id, doc => saved(doc, snapshot.content, result));
        if (!notebook.trail.length) notebook.setTrail([root]);
        if (JSON.stringify(noteDirectory) === directoryKey) notebook.setEntries(await listNotebook(parent.handle));
        notebook.setError(''); setNotice('已保存到笔记目录'); return;
      }
      if (isDesktop()) {
        const result = await saveNativeFile(snapshot.content, snapshot.name, asNew ? undefined : snapshot.nativeHandle);
        if (!result) return;
        update(snapshot.id, doc => ({ ...saved(doc, snapshot.content, result), ...(asNew ? { noteLocation: undefined, noteName: undefined, noteDirectory: undefined } : {}) })); setNotice('已保存到文件');
      } else if (!asNew && snapshot.nativeHandle) {
        const result = await saveNotebookFile(snapshot.nativeHandle, snapshot.content);
        update(snapshot.id, doc => saved(doc, snapshot.content, result)); setNotice('已保存到笔记文件');
      } else {
        download(snapshot.content, snapshot.name); update(snapshot.id, doc => saved(doc, snapshot.content, {})); setNotice('已发起 Markdown 下载，请查看浏览器下载记录');
      }
    });
  }
  function format(kind: Format) {
    if (kind === 'table') { openMedia('table'); return; }
    if (view !== 'edit') { richEditor.current?.format(kind); return; }
    const el = editor.current; if (!el) return;
    const result = formatSelection(current.content, sourceSelection.current.start, sourceSelection.current.end, kind);
    update(current.id, d => edited(d, result.text));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(result.start, result.end); });
  }
  function paragraph(action: ParagraphAction) {
    if (view !== 'edit') { richEditor.current?.paragraph(action); return; }
    const el = editor.current; if (!el) return;
    const result = formatParagraph(current.content, sourceSelection.current.start, sourceSelection.current.end, action);
    sourceSelection.current = { start: result.start, end: result.end };
    setHeadingLevel(sourceHeadingLevel(result.text, result.start));
    update(current.id, doc => edited(doc, result.text));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(result.start, result.end); });
  }
  function openMedia(kind: MediaKind) {
    const selected = view === 'edit' ? current.content.slice(sourceSelection.current.start, sourceSelection.current.end) : window.getSelection()?.toString() ?? '';
    setMedia({ kind, value: kind === 'image' ? '' : selected || (kind === 'formula' ? 'E = mc^2' : ''), display: true, language: '' });
  }
  function insertMedia(markdown: string): string | undefined {
    // A modal makes the editor inert; restore the saved range only after it closes.
    if (view !== 'edit') { requestAnimationFrame(() => richEditor.current?.insertMarkdown(markdown)); return; }
    const { start, end } = sourceSelection.current;
    update(current.id, doc => edited(doc, doc.content.slice(0, start) + markdown + doc.content.slice(end)));
    const next = start + markdown.length; sourceSelection.current = { start: next, end: next };
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(next, next); });
  }
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if (e.isComposing || dialog || media) return;
      if (!(e.ctrlKey || e.metaKey)) { if (e.key === 'Escape') setFocus(false); return; }
      if (document.activeElement === editor.current || (document.activeElement as HTMLElement)?.isContentEditable) {
        const action = paragraphShortcut(e);
        if (action) { e.preventDefault(); paragraph(action); return; }
      }
      switch (e.key.toLowerCase()) {
        case 's': e.preventDefault(); if (hasDocument) saveFile(e.shiftKey); break;
        case 'w': e.preventDefault(); if (hasDocument) closeTab(current.id); break;
        case 'o': e.preventDefault(); openFile(); break;
        case 'n': e.preventDefault(); openNew(); break;
        case 'e': e.preventDefault(); setView(v => v === 'read' ? 'edit' : 'read'); break;
        case 'b': if (document.activeElement === editor.current || (document.activeElement as HTMLElement)?.isContentEditable) { e.preventDefault(); format('bold'); } break;
        case 'i': if (document.activeElement === editor.current || (document.activeElement as HTMLElement)?.isContentEditable) { e.preventDefault(); format('italic'); } break;
      }
    }
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys);
  });
  function editCommand(command: 'undo' | 'redo' | 'selectAll' | 'copy' | 'cut' | 'paste') {
    void (async () => {
      try {
        if (view !== 'edit') { await richEditor.current?.command(command); return; }
        const el = editor.current; if (!el) return;
        el.focus(); el.setSelectionRange(sourceSelection.current.start, sourceSelection.current.end);
        if (command === 'selectAll') { el.select(); sourceSelection.current = { start: 0, end: el.value.length }; return; }
        if (command === 'undo' || command === 'redo') { document.execCommand(command); return; }
        if (command === 'paste') {
          const text = await navigator.clipboard.readText(); const { start, end } = sourceSelection.current;
          update(current.id, d => edited(d, d.content.slice(0, start) + text + d.content.slice(end))); return;
        }
        await navigator.clipboard.writeText(el.value.slice(el.selectionStart, el.selectionEnd));
        if (command === 'cut') { const { start, end } = sourceSelection.current; update(current.id, d => edited(d, d.content.slice(0, start) + d.content.slice(end))); }
      } catch { setNotice('浏览器未允许剪贴板访问，请使用 Ctrl/⌘ C、X、V'); }
    })();
  }
  const editItems: MenuItem[] = [
    { label: '撤销', shortcut: 'Ctrl Z', action: () => editCommand('undo') },
    { label: '重做', shortcut: 'Ctrl Shift Z', action: () => editCommand('redo') },
    { label: '剪切', shortcut: 'Ctrl X', separator: true, action: () => editCommand('cut') },
    { label: '复制', shortcut: 'Ctrl C', action: () => editCommand('copy') },
    { label: '粘贴', shortcut: 'Ctrl V', action: () => editCommand('paste') },
    { label: '全选', shortcut: 'Ctrl A', action: () => editCommand('selectAll') }
  ];
  const formatItems: MenuItem[] = formats.map(f => ({ label: f.label, action: () => format(f.kind), shortcut: f.kind === 'bold' ? 'Ctrl B' : f.kind === 'italic' ? 'Ctrl I' : undefined }));
  const mediaItems: MenuItem[] = [
    { label: '图片', action: () => openMedia('image'), separator: true },
    { label: '公式', action: () => openMedia('formula') },
    { label: '插入代码块', action: () => openMedia('codeblock') }
  ];
  const documentItems: MenuItem[] = [
    { label: '重命名', shortcut: 'F2', disabled: busy, action: () => openRename() },
    { label: '删除笔记', disabled: busy, action: () => openDelete({ docId: current.id }) },
    { label: current.starred ? '取消收藏' : '收藏文档', action: () => update(current.id, d => ({ ...d, starred: !d.starred })) },

  ];
  const menuGroups: MenuGroup[] = [
    { label: '文件', accessKey: 'F', items: [
      { label: '新建文档', shortcut: 'Ctrl N', action: openNew },
      { label: '打开文件', shortcut: 'Ctrl O', action: openFile, disabled: busy },
      { label: '笔记存储位置', action: () => setDialog('settings') },
      { label: '关闭文档', shortcut: 'Ctrl W', disabled: !hasDocument, action: () => closeTab(current.id) },
      { label: '另存为 Markdown', shortcut: 'Ctrl Shift S', action: () => saveFile(true), disabled: busy || !hasDocument, separator: true },
      { label: '导出与打印', disabled: !hasDocument, action: () => setDialog('export') }
    ] },
    { label: '编辑', accessKey: 'E', items: editItems },
    { label: '段落', accessKey: 'P', items: [...paragraphOptions.map(option => ({ ...option, action: () => paragraph(option.action), checked: /^h[1-6]$/.test(option.action) ? headingLevel === Number(option.action[1]) : option.action === 'paragraph' ? headingLevel === 0 : undefined })), { label: '插入表格', action: () => format('table'), separator: true }] },
    { label: '格式', accessKey: 'O', items: [...formatItems.filter(item => ['加粗', '斜体', '链接', '行内代码'].includes(item.label)), ...mediaItems] },
    { label: '视图', accessKey: 'V', items: [
      { label: '源码模式', shortcut: 'Ctrl E', checked: view === 'edit', action: () => setView(v => v === 'edit' ? 'read' : 'edit') },
      { label: '专注模式', checked: focus, action: () => setFocus(!focus) },
      { label: '文稿大纲', action: () => setDialog('outline') }
    ] },
    { label: '主题', accessKey: 'T', items: (['light', 'warm', 'dark'] as const).map(theme => ({ label: { light: '晴昼', warm: '纸页', dark: '深夜' }[theme], checked: state.theme === theme, action: () => setState(s => ({ ...s, theme })) })) },
    { label: '工具', accessKey: 'S', items: [{ label: '偏好设置', action: () => setDialog('settings') }, { label: '回收站', action: () => { setDialog('trash'); void run(async () => notebook.setEntries(await listNotebook(notebook.trail.at(-1)!.handle))); } }] },
    { label: '帮助', accessKey: 'H', items: [{ label: '关于笺墨', action: () => setDialog('about') }, { label: '版本说明', action: () => setDialog('versions') }] }
  ];
  function jump(id: string) { if (view === 'edit') setView('read'); setActiveHeading(id); setDialog(null); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  const outline = <nav className="outline-list" aria-label="文稿大纲">{rendered.headings.length ? rendered.headings.map(h => <button key={h.id} className={`level-${h.level}`} aria-current={h.id === activeHeading ? 'location' : undefined} onClick={() => jump(h.id)}>{h.title}</button>) : <p className="hint">添加标题后，会在这里显示文稿结构。</p>}</nav>;
  const library = <>
    <div className="brand"><Logo /><span>笺墨<small>留住每一个想法</small></span></div>
    <label className="search"><Icon name="search" /><input aria-label="搜索文档" placeholder="搜索文档与内容" value={query} onChange={e => setQuery(e.target.value)} /><kbd>⌕</kbd></label>
    <nav className="library-nav" aria-label="文档筛选"><button aria-label="我的收藏" aria-pressed={starredOnly} onClick={() => setStarredOnly(value => !value)}><Icon name="star" />我的收藏<span>{state.documents.filter(d => !d.trash && d.starred).length}</span></button></nav>
    {!starredOnly && notebook.trail.length > 1 && <nav className="directory-breadcrumbs" aria-label="目录路径" onContextMenu={e => context(e, 'directory')}>{notebook.trail.map((entry, index) => <button key={entry.handle} disabled={busy || index === notebook.trail.length - 1} aria-current={index === notebook.trail.length - 1 ? 'location' : undefined} onClick={() => navigateDirectory(index)}>{index === 0 ? '根目录' : entry.name}{index < notebook.trail.length - 1 && <span aria-hidden="true"> / </span>}</button>)}</nav>}
    <div className="document-list" onContextMenu={e => context(e, 'directory')}>{folders.map(entry => <button className="notebook-entry directory-entry" key={entry.handle} disabled={busy} aria-label={`打开目录 ${entry.name}`} onClick={() => void run(() => enterDirectory(entry))} onContextMenu={e => entryContext(e, entry)} onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); openEntryRename(entry); } }}><Icon name="folder" /><span>{entry.name}</span><span aria-hidden="true">›</span></button>)}{visible.map(d => <button className="document-row" key={d.id} aria-current={hasDocument && d.id === current.id ? 'page' : undefined} onContextMenu={e => { activate(d.id); context(e, 'document'); }} onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); openRename(d); } }} onClick={() => activate(d.id)}><Icon name="file" /><span className="document-copy"><span>{d.name.replace(/\.(md|markdown|txt)$/i, '')}</span><small>{d.content.split('\n').find(l => l.trim() && !/^#/.test(l))?.replace(/[*_`>]/g, '') || '写下第一个想法'}</small></span>{d.starred && <span className="star-dot" aria-label="已收藏">•</span>}</button>)}{unopened.map(entry => <button className="notebook-entry" key={entry.handle} disabled={busy} title={entry.name} onContextMenu={e => entryContext(e, entry)} onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); openEntryRename(entry); } }} onClick={() => void run(() => openNote(entry))}><Icon name="file" /><span>{entry.name}</span></button>)}{!visible.length && !unopened.length && !folders.length && <div className="empty-library">{query || starredOnly ? <><p>没有符合筛选的笔记</p><button onClick={() => { setQuery(''); setStarredOnly(false); }}>清除筛选</button></> : <><p>当前目录为空</p><p className="hint">在此处右键新建笔记或目录</p></>}</div>}</div>
    <div className="library-bottom"><button className="preferences-entry" aria-label="偏好设置" onClick={() => setDialog('settings')}><Icon name="settings" /><span>偏好设置</span></button></div>
  </>;
  return <div className={`app-shell ${focus ? 'is-focused' : ''} page-${state.pageWidth ?? 'normal'}`} style={{ '--reading-scale': state.fontSize / 17 } as CSSProperties}
    onDragEnterCapture={e => { if (isFileDrag(e)) { e.preventDefault(); dragDepth.current++; setDraggingFiles(true); } }}
    onDragOverCapture={e => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }}
    onDragLeaveCapture={e => { if (isFileDrag(e) && --dragDepth.current <= 0) clearFileDrag(); }}
    onDragEndCapture={clearFileDrag}
    onDropCapture={e => {
      if (!isFileDrag(e)) return;
      e.preventDefault(); e.stopPropagation(); clearFileDrag();
      const files = Array.from(e.dataTransfer.files);
      if (files.length) importFiles(files, true);
      else setNotice('请拖入 .md、.markdown 或 .txt 文件，不支持文件夹');
    }}>
    <AppMenu groups={menuGroups.map(group => ['编辑', '段落', '格式'].includes(group.label) && !hasDocument ? { ...group, items: group.items.map(item => ({ ...item, disabled: true })) } : group)} />
    <div className="app-body">
    <a className="skip-link" href="#document-content">跳到文稿</a>
    <aside className="sidebar" aria-label="文档库">{library}</aside>
    <main className="workspace">
      <header className="topbar"><button className="icon-button library-toggle" aria-label="打开文档库" onClick={() => setDialog('library')}><Icon name="menu" /></button><div className="breadcrumb">{hasDocument ? <><span>我的文档</span><span>/</span><button onClick={() => openRename()}>{current.name}</button></> : <span>笺墨</span>}</div><span className="editing-status">{!hasDocument ? '欢迎回来' : view === 'edit' ? '源码模式' : '即写即阅'}</span></header>
      {hasDocument && <div className="tabs" aria-label="已打开文档">{tabs.map(id => { const d = state.documents.find(item => item.id === id); return d && <div className={`tab ${id === current.id ? 'active' : ''}`} key={id}><button aria-current={id === current.id ? 'page' : undefined} onClick={() => activate(id)}><Icon name="file" />{d.name}{isDirty(d) && <span aria-label="尚未保存到文件" className="dirty-dot" />}</button>{<button className="icon-button" aria-label={`关闭标签 ${d.name}`} onClick={() => closeTab(id)}><Icon name="close" /></button>}</div>; })}</div>}
      {cacheError && <div className="error-banner" role="alert">{cacheError}</div>}
      {!hasDocument ? <section className="welcome-page" id="document-content" tabIndex={-1} aria-label="笺墨欢迎页"><div className="welcome-content"><div className="welcome-hero"><div className="welcome-brand"><Logo /><p className="welcome-name">笺墨 · JIANMO</p></div><div className="welcome-copy"><h1>一页空白<br />容得下每一种想法</h1><p className="welcome-description">专注书写，自然成文。<br />让灵感、记录与思考，在这里慢慢生长。</p></div></div><div className="welcome-footer"><div className="welcome-features"><span>即写即阅</span><span>本机存储</span><span>自由表达</span></div><p className="welcome-hint">打开一篇笔记，或从目录中开始书写。</p></div></div></section> : <><div className={`writing-area mode-${view}`} id="document-content" tabIndex={-1}>
        {view !== 'read' && <section className="source-panel" aria-label="Markdown 源码"><div className="pane-caption">MARKDOWN<span>{current.content.split('\n').length} 行</span></div><textarea key={current.id} ref={editor} aria-label="Markdown 编辑器" spellCheck={state.spellcheck ?? false} onSelect={e => { sourceSelection.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; setHeadingLevel(sourceHeadingLevel(current.content, e.currentTarget.selectionStart)); }} onContextMenu={e => context(e, 'editor')} value={current.content} onChange={e => update(current.id, d => edited(d, e.target.value))} onKeyDown={e => {
          if (e.nativeEvent.isComposing || !['Tab', 'Enter'].includes(e.key)) return;
          const el = e.currentTarget; const result = listKey(current.content, el.selectionStart, el.selectionEnd, e.key, e.shiftKey);
          if (result) { e.preventDefault(); update(current.id, d => edited(d, result.text)); sourceSelection.current = result; requestAnimationFrame(() => el.setSelectionRange(result.start, result.end)); }
          else if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) return; const start = el.selectionStart; update(current.id, d => edited(d, d.content.slice(0, start) + '  ' + d.content.slice(el.selectionEnd))); requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2)); }
        }} /></section>}
        {view !== 'edit' && <section ref={preview} className="preview-panel" aria-label="即时编辑" onScroll={syncOutline}><LiveEditor key={current.id} ref={richEditor} content={current.content} imageContext={imageContext} imageVersion={imageVersion} spellcheck={state.spellcheck ?? false} onChange={content => update(current.id, d => edited(d, content))} onHeadingChange={setHeadingLevel} onEditMedia={setMedia} onContextMenu={e => context(e, 'editor')} /></section>}
        <aside className="inspector"><div className="section-label">文稿大纲</div>{outline}<div className="document-info"><span>文档信息</span><dl><div><dt>字数</dt><dd>{wordCount(current.content).toLocaleString()}</dd></div><div><dt>阅读时间</dt><dd>约 {Math.max(1, Math.ceil(wordCount(current.content) / 300))} 分钟</dd></div><div><dt>格式</dt><dd>Markdown</dd></div></dl></div></aside>
      </div>
      <footer className="statusbar"><span className="status-spacer" /><span>{wordCount(current.content)} 字</span><span>UTF-8</span><button onClick={() => setDialog('settings')}>{state.fontSize}px</button></footer></>}
      <nav className="mobile-nav" aria-label="快捷操作"><button onClick={() => setDialog('library')}><Icon name="folder" />文档</button><button onClick={() => setDialog('outline')}><Icon name="outline" />大纲</button><button onClick={() => setDialog('settings')}><Icon name="settings" />设置</button></nav>
    </main>
    </div>
    {draggingFiles && <div className="file-drop-overlay" role="status"><div><Icon name="file" /><strong>{busy ? '正在处理文件，请稍候' : '松开即可阅读'}</strong><span>支持 .md、.markdown、.txt，可同时拖入多个文件</span></div></div>}
    <input ref={importer} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden aria-label="导入 Markdown 文件" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) importFiles(files); }} />
    {contextMenu && <ContextMenu state={contextMenu} items={contextMenu.type === 'entry' && contextEntry ? [{ label: contextEntry.kind === 'directory' ? '打开目录' : '打开笔记', disabled: busy, action: () => void run(() => contextEntry.kind === 'directory' ? enterDirectory(contextEntry) : openNote(contextEntry)) }, { label: '重命名', shortcut: 'F2', disabled: busy, action: () => openEntryRename(contextEntry) }, { label: contextEntry.kind === 'directory' ? '删除目录' : '删除笔记', disabled: busy, action: () => openDelete({ entry: contextEntry }) }] : contextMenu.type === 'directory' ? [{ label: '新建目录', action: openNewFolder, disabled: busy }, { label: '新建笔记', action: openNew, disabled: busy }, { label: '刷新目录', separator: true, disabled: busy || !notebook.trail.length, action: () => void run(async () => notebook.setEntries(await listNotebook(notebook.trail.at(-1)!.handle))) }] : contextMenu.type === 'document' ? documentItems : [...editItems, ...formatItems.map((item, i) => ({ ...item, separator: i === 0 })), ...mediaItems]} close={() => setContextMenu(null)} />}
    {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" /></button></div>}
    {media && <InsertMedia initial={media} imageContext={imageContext} onImage={storeImage} onClose={() => setMedia(null)} onInsert={insertMedia} />}
    {dialog === 'delete' && deleteTarget && <Modal title={'entry' in deleteTarget && deleteTarget.entry.kind === 'directory' ? '删除目录' : '删除笔记'} onClose={() => { if (!busy) setDialog(null); }}><p>将“{'entry' in deleteTarget ? deleteTarget.entry.name : state.documents.find(doc => doc.id === deleteTarget.docId)?.name}”移入回收站？</p><p className="hint">{'entry' in deleteTarget && deleteTarget.entry.kind === 'directory' ? '目录中的所有子目录和文件会一起移入回收站。' : ''}未保存的草稿会保留，可在当前目录的“工具 → 回收站”中恢复。</p>{deleteError && <p role="alert" className="status-error">{deleteError}</p>}<div className="dialog-actions"><button disabled={busy} onClick={() => setDialog(null)}>取消</button><button disabled={busy} className="primary" onClick={commitDelete}>移入回收站</button></div></Modal>}
    {dialog === 'trash' && <Modal title="回收站" onClose={() => setDialog(null)}><p className="hint">当前目录中已删除的笔记和文件夹。恢复时会保留原来的层级和草稿。</p>{notebook.entries.filter(entry => originalTrashName(entry.name)).map(entry => <div className="trash-row" key={entry.handle}><span>{originalTrashName(entry.name)}</span><button disabled={busy} aria-label={`恢复 ${originalTrashName(entry.name)}`} onClick={() => restoreTrash(entry)}>恢复</button></div>)}{state.documents.filter(doc => doc.trash && JSON.stringify(doc.trash.parent) === directoryKey && doc.trash.location === notebook.trail[0]?.locationId && !notebook.entries.some(entry => entry.name === doc.trash!.name)).filter((doc, index, all) => all.findIndex(other => other.trash!.name === doc.trash!.name) === index).map(doc => <div className="trash-row" key={doc.id}><span>{originalTrashName(doc.trash!.name)} · 草稿</span><button disabled={busy} onClick={() => restoreTrash(undefined, doc.trash!.name)}>恢复</button></div>)}{!notebook.entries.some(entry => originalTrashName(entry.name)) && !state.documents.some(doc => doc.trash && JSON.stringify(doc.trash.parent) === directoryKey && doc.trash.location === notebook.trail[0]?.locationId) && <p className="empty-library">回收站为空</p>}</Modal>}
    {dialog === 'rename' && <Modal title={renameTarget && 'entry' in renameTarget && renameTarget.entry.kind === 'directory' ? '重命名目录' : '重命名笔记'} onClose={() => { if (!busy) setDialog(null); }}><form onSubmit={e => { e.preventDefault(); commitRename(); }}><label htmlFor="doc-name">新名称</label><input id="doc-name" autoFocus required maxLength={100} value={formName} onChange={e => setFormName(e.target.value)} disabled={busy} />{renameError && <p role="alert" className="status-error">{renameError}</p>}<div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button type="submit" disabled={busy} className="primary">保存名称</button></div></form></Modal>}
    {dialog === 'newFolder' && <Modal title="新建目录" onClose={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); createFolder(); }}><p className="hint">创建位置：{['笔记目录', ...directoryNames].join(' / ')}</p><label htmlFor="folder-name">目录名称</label><input id="folder-name" autoFocus required maxLength={100} placeholder="例如：工作笔记" value={formName} onChange={e => setFormName(e.target.value)} />{folderError && <p role="alert" className="status-error">{folderError}</p>}<div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" type="submit" disabled={busy}>创建目录</button></div></form></Modal>}
    {dialog === 'library' && <Modal title="文档库" onClose={() => setDialog(null)}><div className="mobile-library">{library}</div></Modal>}
    {dialog === 'outline' && <Modal title="文稿大纲" onClose={() => setDialog(null)}>{outline}</Modal>}
    {(dialog === 'settings' || dialog === 'about' || dialog === 'versions') && <Modal title={dialog === 'settings' ? '设置' : dialog === 'about' ? '关于笺墨' : '版本说明'} onClose={() => setDialog(null)}><AppSettings page={dialog} onPage={setDialog} state={state} setState={setState} location={notebook.trail[0]?.path} locationError={notebook.error} busy={busy} onChooseLocation={() => openDirectory()} onDefaultLocation={() => openDirectory(true)} /></Modal>}
    {dialog === 'new' && <Modal title="开始一篇新文稿" onClose={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); { const content = template === 'meeting' ? '# 会议记录\n\n## 议题\n\n## 讨论与决定\n\n## 待办事项\n\n- [ ] \n' : template === 'plan' ? '# 本周计划\n\n## 本周重点\n\n- [ ] \n\n## 每日记录\n' : '# 新的篇章\n\n'; const doc = { ...newDocument(formName || '未命名.md', content), noteDirectory: directoryNames }; setQuery(''); setStarredOnly(false); add(doc); setView('read'); saveFile(false, doc); } }}><label htmlFor="doc-name">文档名称</label><input id="doc-name" autoFocus value={formName} placeholder="未命名.md" maxLength={100} onChange={e => setFormName(e.target.value)} />{dialog === 'new' && <><label htmlFor="template">起始模板</label><select id="template" value={template} onChange={e => setTemplate(e.target.value)}><option value="blank">空白文稿</option><option value="meeting">会议记录</option><option value="plan">每周计划</option></select></>}<div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" type="submit" disabled={busy}>创建文档</button></div></form></Modal>}
    {dialog === 'export' && <Modal title="保存与导出" onClose={() => setDialog(null)}><div className="export-options"><button disabled={busy} onClick={() => { setDialog(null); saveFile(true); }}><Icon name="file" /><span>另存为 Markdown<small>保留 Markdown 源码</small></span></button><button onClick={() => { const safeTitle = current.name.replace(/[&<>"']/g, ''); const html = renderMarkdown(current.content).html; download(`<!doctype html><html lang="zh-CN" data-theme="${state.theme}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>${tokenCss}\n${articleCss}\nbody{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-ui)}article{max-width:736px;margin:auto;padding:48px 24px}</style></head><body><article class="markdown-body">${html}</article></body></html>`, current.name.replace(/\.[^.]+$/, '') + '.html', 'text/html;charset=utf-8'); setNotice('已发起 HTML 下载'); setDialog(null); }}><Icon name="export" /><span>导出 HTML<small>包含排版样式，可在浏览器阅读</small></span></button><button onClick={() => { setDialog(null); setView('read'); setTimeout(() => window.print(), 100); }}><Icon name="file" /><span>打印 / 保存 PDF<small>使用系统打印对话框</small></span></button></div></Modal>}
  </div>;
}
