import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { STORAGE_KEY, parseWorkspace } from '../src/core/documents.ts';

test('external files read fresh disk content without draft caching and preserve pending edits', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const win = dom.window;
  for (const [key, value] of Object.entries({ window: win, navigator: win.navigator, document: win.document, localStorage: win.localStorage, Node: win.Node, NodeFilter: win.NodeFilter, HTMLInputElement: win.HTMLInputElement, HTMLElement: win.HTMLElement, HTMLTextAreaElement: win.HTMLTextAreaElement, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0), cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const file = { handle: 'os-file', path: 'C:\\文档\\中文 文件.md', name: '中文 文件.md', content: '# 双击打开' };
  let pending: unknown[] = [{ status: 'opened', value: file }];
  let notify: (() => void) | undefined; let saves = 0; let subscriptions = 0;
  const focusListeners = new Set<() => void>();
  let pendingRead: ((result: typeof file) => void) | undefined; let delayRead = false;
  let other: typeof file | undefined;
  const revealed: string[] = []; let revealError = false;
  Object.defineProperty(win, '__TAURI__', { value: {
    event: { listen: async (event: string, callback: () => void) => {
      if (event === 'tauri://focus') { focusListeners.add(callback); return () => { focusListeners.delete(callback); }; }
      assert.equal(event, 'documents-pending'); subscriptions++; notify = callback; return () => { subscriptions--; };
    } },
    core: { invoke: async (command: string, args: Record<string, string>) => {
      if (command === 'take_pending_documents') { const result = pending; pending = []; return result; }
      if (command === 'get_notebook_location') return { handle: 'root', kind: 'directory', name: '笺墨', locationId: 'root' };
      if (command === 'list_notebook') return [];
      if (command === 'open_document') return { ...file };
      if (command === 'read_document') {
        if (delayRead) return new Promise(resolve => { pendingRead = resolve; });
        return { ...(args.handle === other?.handle ? other : file) };
      }
      if (command === 'save_document') { assert.equal(args.handle, file.handle); assert.equal(args.expected, file.content); file.content = args.content; saves++; return { ...file }; }
      if (command === 'reveal_document') { if (revealError) throw new Error('原文件已移动、删除或无法访问'); revealed.push(args.handle); return; }
      throw new Error(`Unexpected command: ${command}`);
    } }
  } });
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await import('../src/App.tsx');
  let root = createRoot(win.document.getElementById('root')!);
  const workspace = () => parseWorkspace(win.localStorage.getItem(STORAGE_KEY)!);
  const uncached = () => { assert.ok(!win.localStorage.getItem(STORAGE_KEY)!.includes(file.name)); assert.ok(!workspace().documents.some(doc => doc.name === file.name)); };
  const heading = () => win.document.querySelector('.markdown-body h1')?.textContent;
  const edit = async (text: string) => { await act(async () => {
    const editor = win.document.querySelector('.live-editor')!;
    editor.innerHTML = `<h1>${text}</h1>`; editor.dispatchEvent(new win.Event('input', { bubbles: true }));
  }); };
  const listed = (name: string) => [...win.document.querySelectorAll('.document-row')].some(row => row.querySelector('.document-copy > span')?.textContent === name.replace(/\.(md|markdown|txt)$/i, ''));
  const deliver = async (results: unknown[]) => { pending.push(...results); await act(async () => notify!()); };
  const locationItem = async () => {
    await act(async () => win.document.querySelector<HTMLButtonElement>('button[aria-label="文件"]')!.click());
    return [...win.document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent === '打开文件所在位置')!;
  };
  try {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
    assert.equal(subscriptions, 1, 'StrictMode leaves one active subscription');
    assert.equal(win.document.querySelector('.markdown-body h1')?.textContent, '双击打开', win.document.body.innerHTML);
    uncached();
    assert.ok(listed(file.name), 'an open external file appears in the directory');
    const location = await locationItem(); assert.equal(location.disabled, false);
    await act(async () => location.click()); assert.deepEqual(revealed, [file.handle]);
    revealError = true;
    const missingLocation = await locationItem(); await act(async () => missingLocation.click());
    assert.match(win.document.querySelector('.toast')!.textContent!, /原文件已移动/); revealError = false;
    file.content = '# 磁盘新内容';
    await deliver([{ status: 'opened', value: { ...file } }]);
    assert.equal(heading(), '磁盘新内容', 'OS reopen uses the latest disk content');
    file.content = '# 对话框新内容';
    await act(async () => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true })));
    assert.equal(heading(), '对话框新内容', 'the file picker refreshes an existing tab');
    file.content = '# 返回窗口新内容';
    await act(async () => win.dispatchEvent(new win.Event('focus')));
    assert.equal(heading(), '返回窗口新内容');
    assert.equal(focusListeners.size, 1, 'one native focus listener remains after StrictMode setup');
    file.content = '# 原生窗口激活新内容';
    await act(async () => { for (const listener of focusListeners) listener(); });
    assert.equal(heading(), '原生窗口激活新内容', 'native activation refreshes without a DOM focus event');
    const activeTab = () => win.document.querySelector<HTMLButtonElement>('.tabs .tab.active > button')!;
    file.content = '# 当前标签再次激活';
    await act(async () => activeTab().click());
    assert.equal(heading(), '当前标签再次激活', 'clicking the current tab rereads the file');
    file.content = '# 目录中再次激活';
    const row = [...win.document.querySelectorAll<HTMLButtonElement>('.document-row')].find(row => row.textContent?.includes('中文 文件'))!;
    await act(async () => row.click());
    assert.equal(heading(), '目录中再次激活', 'reactivating the current file from the directory rereads it');
    await edit('未保存的修改');
    await deliver([{ status: 'opened', value: file }, { status: 'opened', value: file }]);
    assert.equal(win.document.querySelectorAll(`[aria-label="关闭标签 ${file.name}"]`).length, 1);
    assert.equal(heading(), '未保存的修改'); uncached();
    await act(async () => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })));
    assert.equal(saves, 1); assert.match(file.content, /未保存的修改/);
    delayRead = true;
    await act(async () => win.dispatchEvent(new win.Event('focus')));
    assert.ok(pendingRead);
    await edit('读取期间输入');
    await act(async () => pendingRead!({ ...file, content: '# 过期的读取' }));
    assert.equal(heading(), '读取期间输入', 'a pending disk read cannot overwrite typing');
    delayRead = false;
    while (win.document.querySelector('.tabs .icon-button')) await act(async () => (win.document.querySelector('.tabs .icon-button') as HTMLButtonElement).click());
    assert.ok(win.document.querySelector('.welcome-page'));
    assert.equal((await locationItem()).disabled, true, 'the welcome page has no file location');
    await act(async () => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(listed(file.name), false, 'closing an external file removes it from the directory');
    uncached();
    file.content = '# 关闭后修改';
    await deliver([{ status: 'opened', value: { ...file } }]);
    assert.equal(heading(), '关闭后修改'); assert.ok(win.document.querySelector('.live-editor'));
    assert.ok(listed(file.name), 'reopening an external file shows it again');
    other = { ...file, handle: 'other', path: 'C:\\文档\\第二篇.txt', name: '第二篇.txt', content: '# 第二篇' };
    await deliver([{ status: 'error', value: 'missing.md：文件不存在' }, { status: 'opened', value: other }]);
    assert.equal(win.document.querySelector('.markdown-body h1')?.textContent, '第二篇');
    assert.match(win.document.body.textContent!, /missing.md/);
    assert.ok(!workspace().documents.some(item => item.name === other!.name));
    file.content = '# 切换标签新内容';
    const tab = [...win.document.querySelectorAll<HTMLButtonElement>('.tabs button')].find(button => button.textContent?.includes(file.name.replace('.md', '')) && !button.classList.contains('icon-button'))!;
    await act(async () => tab.click()); assert.equal(heading(), '切换标签新内容');
    const otherTab = [...win.document.querySelectorAll<HTMLButtonElement>('.tabs .tab > button:first-child')].find(button => button.textContent === other!.name)!;
    await act(async () => otherTab.click());
    assert.equal(heading(), '第二篇');
    await act(async () => win.document.querySelector<HTMLButtonElement>(`[aria-label="关闭标签 ${file.name}"]`)!.click());
    assert.equal(listed(file.name), false, 'closing an inactive external tab also removes its directory entry');
    assert.ok(listed(other.name));
    await act(async () => root.unmount());
    root = createRoot(win.document.getElementById('root')!);
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
    assert.equal(listed(file.name), false, 'closed external files stay hidden after restarting');
    assert.equal(listed(other.name), false, 'external tabs and content are not restored from cache');
  } finally { await act(async () => root.unmount()); assert.equal(subscriptions, 0); assert.equal(focusListeners.size, 0); dom.window.close(); }
});
