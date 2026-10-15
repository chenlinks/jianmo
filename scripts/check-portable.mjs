import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
const errors = [];
const console = new VirtualConsole(); console.on('jsdomError', e => errors.push(e));
const dom = new JSDOM(readFileSync(new URL('../jianmo-app-preview.html', import.meta.url), 'utf8'), {
  url: 'http://localhost', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
  beforeParse(window) { window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); }
});
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(errors.length, 0, errors.map(e => e.message).join('\n'));
assert.equal(dom.window.document.querySelector('.markdown-body h1')?.textContent, '让想法，自然成文');
const editor = dom.window.document.querySelector('[contenteditable="true"]');
assert.ok(editor); editor.innerHTML = '<h1>直接编辑验证</h1><p>已输入</p>'; editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(dom.window.document.querySelector('textarea'), null);
assert.ok(dom.window.document.querySelector('[aria-label="工具菜单栏"]'));
assert.ok(dom.window.localStorage.getItem('jianmo-workspace-v1'));
assert.ok(dom.window.localStorage.getItem('jianmo-workspace-v1').includes('直接编辑验证'));
dom.window.close();
process.stdout.write('Portable production bundle: startup, direct editing, menu and draft persistence passed.\n');
