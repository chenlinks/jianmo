import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { initialWorkspace, newDocument, STORAGE_KEY } from '../src/core/documents.ts';

test('document properties can be edited and formatted without becoming a code block or losing the body', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const win = dom.window;
  for (const [key, value] of Object.entries({ window: win, navigator: win.navigator, document: win.document, localStorage: win.localStorage, Node: win.Node, NodeFilter: win.NodeFilter, HTMLInputElement: win.HTMLInputElement, HTMLElement: win.HTMLElement, HTMLTextAreaElement: win.HTMLTextAreaElement, requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0), cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  win.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  win.HTMLDialogElement.prototype.close = function() { this.open = false; };
  // Model the browser's insertion into the saved selection after the modal closes.
  Object.defineProperty(win.document, 'execCommand', { value: (command: string, _ui: boolean, html: string) => {
    assert.equal(command, 'insertHTML');
    const range = win.getSelection()!.getRangeAt(0); range.deleteContents();
    range.insertNode(range.createContextualFragment(html)); return true;
  } });
  const doc = newDocument('SKILL.md', '---\nname: office\ndescription: Original description\n---\n\n# Office task routing\n\nKeep this body.');
  win.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...initialWorkspace(), documents: [doc], activeId: doc.id, openTabs: [doc.id] }));
  const { createRoot } = await import('react-dom/client'); const { default: App } = await import('../src/App.tsx');
  const root = createRoot(win.document.getElementById('root')!);
  const content = () => JSON.parse(win.localStorage.getItem(STORAGE_KEY)!).documents[0].content as string;
  const click = async (text: string) => { const button = [...win.document.querySelectorAll('button')].find(button => button.textContent === text)!; assert.ok(button, text); await act(async () => button.click()); };
  try {
    await act(async () => root.render(React.createElement(App)));
    const panel = win.document.querySelector('.live-editor .frontmatter-node')!;
    assert.ok(panel.querySelector('.hljs-attr'));
    await act(async () => panel.querySelector('code span')!.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true })));
    assert.match(win.document.querySelector('dialog')!.textContent!, /编辑文档属性/);
    assert.equal(win.document.querySelector('#code-language'), null);
    const field = win.document.querySelector<HTMLTextAreaElement>('#media-source')!;
    assert.equal(field.value, 'name: office\ndescription: Original description\n');
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'name: office\ndescription: Updated description\nconfig:\n    enabled: true');
      field.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    await click('格式化 YAML');
    for (let i = 0; i < 100 && field.disabled; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.match(field.value, /config:\n  enabled: true/);
    assert.ok(win.document.querySelector('.media-preview .frontmatter-node .hljs-attr'));
    await click('插入内容');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    assert.equal(win.document.querySelectorAll('.live-editor .frontmatter-node').length, 1);
    assert.match(content(), /^---\nname: office\ndescription: Updated description\nconfig:\n  enabled: true\n---\n\n# Office task routing\n\nKeep this body\.$/);
    assert.doesNotMatch(content(), /```/);
    // Reload the rendered editor from the serialized source.
    await act(async () => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true })));
    await act(async () => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true })));
    assert.equal(win.document.querySelectorAll('.live-editor .frontmatter-node').length, 1);
    assert.match(win.document.querySelector('.frontmatter-node')!.textContent!, /Updated description/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
