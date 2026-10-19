import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { STORAGE_KEY, parseWorkspace } from '../src/core/documents.ts';

test('OS file opens load startup files, reopen tabs, preserve edits and save to the original handle', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const win = dom.window;
  for (const [key, value] of Object.entries({ window: win, navigator: win.navigator, document: win.document, localStorage: win.localStorage, Node: win.Node, NodeFilter: win.NodeFilter, HTMLInputElement: win.HTMLInputElement, HTMLElement: win.HTMLElement, HTMLTextAreaElement: win.HTMLTextAreaElement, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0), cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const file = { handle: 'os-file', path: 'C:\\文档\\中文 文件.md', name: '中文 文件.md', content: '# 双击打开' };
  let pending: unknown[] = [{ status: 'opened', value: file }];
  let notify: (() => void) | undefined; let saves = 0; let subscriptions = 0;
  Object.defineProperty(win, '__TAURI__', { value: {
    event: { listen: async (_event: string, callback: () => void) => { subscriptions++; notify = callback; return () => { subscriptions--; }; } },
    core: { invoke: async (command: string, args: Record<string, string>) => {
      if (command === 'take_pending_documents') { const result = pending; pending = []; return result; }
      if (command === 'get_notebook_location') return { handle: 'root', kind: 'directory', name: '笺墨', locationId: 'root' };
      if (command === 'list_notebook') return [];
      if (command === 'save_document') { assert.equal(args.handle, file.handle); file.content = args.content; saves++; return { ...file }; }
      throw new Error(`Unexpected command: ${command}`);
    } }
  } });
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await import('../src/App.tsx');
  const root = createRoot(win.document.getElementById('root')!);
  const workspace = () => parseWorkspace(win.localStorage.getItem(STORAGE_KEY)!);
  const deliver = async (results: unknown[]) => { pending.push(...results); await act(async () => notify!()); };
  try {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
    assert.equal(subscriptions, 1, 'StrictMode leaves one active subscription');
    assert.equal(win.document.querySelector('.markdown-body h1')?.textContent, '双击打开', win.document.body.innerHTML);
    const doc = workspace().documents.find(item => item.name === file.name)!;
    assert.ok(workspace().openTabs?.includes(doc.id));
    const editor = win.document.querySelector('.live-editor')!;
    await act(async () => { editor.innerHTML = '<h1>未保存的修改</h1>'; editor.dispatchEvent(new win.Event('input', { bubbles: true })); });
    await deliver([{ status: 'opened', value: file }, { status: 'opened', value: file }]);
    assert.equal(workspace().documents.filter(item => item.name === file.name).length, 1);
    assert.match(workspace().documents.find(item => item.id === doc.id)!.content, /未保存的修改/);
    await act(async () => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })));
    assert.equal(saves, 1); assert.match(file.content, /未保存的修改/);
    while (win.document.querySelector('.tabs .icon-button')) await act(async () => (win.document.querySelector('.tabs .icon-button') as HTMLButtonElement).click());
    assert.ok(win.document.querySelector('.welcome-page'));
    await deliver([{ status: 'opened', value: file }]);
    assert.ok(workspace().openTabs?.includes(doc.id)); assert.ok(win.document.querySelector('.live-editor'));
    const other = { ...file, handle: 'other', path: 'C:\\文档\\第二篇.txt', name: '第二篇.txt', content: '# 第二篇' };
    await deliver([{ status: 'error', value: 'missing.md：文件不存在' }, { status: 'opened', value: other }]);
    assert.equal(win.document.querySelector('.markdown-body h1')?.textContent, '第二篇');
    assert.match(win.document.body.textContent!, /missing.md/);
    assert.equal(workspace().documents.filter(item => item.name === other.name).length, 1);
  } finally { await act(async () => root.unmount()); assert.equal(subscriptions, 0); dom.window.close(); }
});
