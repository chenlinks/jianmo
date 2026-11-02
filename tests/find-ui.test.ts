import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { initialWorkspace, newDocument, STORAGE_KEY } from '../src/core/documents.ts';

test('Ctrl+F searches only the active document, navigates, switches modes and closes without editing', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win, 'CSS', { configurable: true, value: { highlights: new Map() } });
  Object.defineProperty(win, 'Highlight', { configurable: true, value: class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges); } } });
  for (const [key, value] of Object.entries({ window: win, navigator: win.navigator, document: win.document, localStorage: win.localStorage, Node: win.Node, NodeFilter: win.NodeFilter, HTMLInputElement: win.HTMLInputElement, HTMLElement: win.HTMLElement, HTMLTextAreaElement: win.HTMLTextAreaElement, requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0), cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const first = newDocument('Alpha.md', '# Alpha\n\nTest **test** 中文\n\nTest\n');
  const second = newDocument('Test-other.md', '# Other\n\nOnly elsewhere\n');
  win.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...initialWorkspace(), documents: [first, second], activeId: first.id, openTabs: [first.id, second.id] }));
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await import('../src/App.tsx');
  const root = createRoot(win.document.getElementById('root')!);
  const key = async (key: string, ctrlKey = false, shiftKey = false, target: EventTarget = win) => { await act(async () => target.dispatchEvent(new win.KeyboardEvent('keydown', { key, ctrlKey, shiftKey, bubbles: true, cancelable: true }))); };
  const input = () => win.document.querySelector<HTMLInputElement>('[aria-label="查找内容"]')!;
  const count = () => win.document.querySelector('.find-count')!.textContent;
  const click = async (label: string) => { await act(async () => win.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); };
  async function search(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
      input().dispatchEvent(new win.Event('input', { bubbles: true }));
    });
  }
  try {
    await act(async () => root.render(React.createElement(App)));
    await key('f', true); assert.equal(win.document.activeElement, input());
    await search('test'); assert.equal(count(), '1 / 3');
    assert.equal(win.CSS.highlights.get('jianmo-find')!.size, 3);
    assert.equal(win.CSS.highlights.get('jianmo-find-active')!.size, 1);
    assert.equal(win.document.querySelector('.live-editor mark'), null, 'highlighting does not modify editable HTML');
    await key('Enter', false, false, input()); assert.equal(count(), '2 / 3');
    await click('下一个匹配'); assert.equal(count(), '3 / 3');
    await key('Enter', false, false, input()); assert.equal(count(), '1 / 3');
    await key('Enter', false, true, input()); assert.equal(count(), '3 / 3');
    await click('区分大小写'); assert.equal(count(), '1 / 1');
    await search('Only elsewhere'); assert.equal(count(), '无匹配结果');
    await search('test'); await click('区分大小写');
    await key('e', true);
    assert.equal(count(), '1 / 3');
    const textarea = win.document.querySelector('textarea')!;
    assert.equal(win.document.querySelectorAll('.source-find-overlay mark').length, 3);
    assert.equal(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd), 'Test');
    await click('下一个匹配'); assert.equal(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd), 'test');
    await key('f', true); assert.equal(win.document.activeElement, input());
    await key('Escape', false, false, input()); assert.equal(input(), null); assert.equal(win.document.activeElement, textarea);
    assert.equal(win.CSS.highlights.size, 0);
    assert.equal(win.document.querySelector('.source-find-overlay'), null);
    const workspace = JSON.parse(win.localStorage.getItem(STORAGE_KEY)!);
    assert.equal(workspace.documents[0].content, first.content);
    await act(async () => win.document.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click());
    await act(async () => [...win.document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent?.includes('查找'))!.click());
    assert.ok(input());
    await act(async () => [...win.document.querySelectorAll<HTMLButtonElement>('.tab > button')].find(button => button.textContent?.includes('Test-other.md'))!.click());
    await search('Test'); assert.equal(count(), '无匹配结果');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
