import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html>', { url: 'http://localhost' });
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const { renderMarkdown } = await import('../src/core/markdown.ts');
test('GFM tables, task lists and nested lists render', () => {
  const result = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- first\n  - nested\n\n~~removed~~');
  assert.match(result.html, /<table>/); assert.match(result.html, /type="checkbox"/); assert.match(result.html, /<del>removed<\/del>/); assert.match(result.html, /nested/);
});
test('outline is derived from parsed headings, ignoring code fences', () => {
  const result = renderMarkdown('# 一级\n\n## 同名\n\n## 同名\n\n```md\n# not a heading\n```');
  assert.equal(result.headings.length, 3); assert.equal(new Set(result.headings.map(h => h.id)).size, 3);
  assert.equal(result.headings[1].title, '同名'); assert.match(result.html, /id="heading-2"/);
});
test('scripts, event handlers, unsafe URLs and forms never enter preview', () => {
  const result = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">bad</a><iframe src="https://bad.test"></iframe><form><input></form>');
  assert.doesNotMatch(result.html, /<script|onerror|javascript:|<iframe|<form/);
});
test('remote links have isolation, local filesystem links are disabled', () => {
  const result = renderMarkdown('[site](https://example.com) [local](file:///C:/secret) [relative](../secret.md)');
  assert.match(result.html, /rel="noopener noreferrer"/); assert.doesNotMatch(result.html, /href="file:|href="\.\./);
});
test('images cannot trigger arbitrary local file access', () => {
  const result = renderMarkdown('![private](file:///C:/secret.png)\n![relative](./image.png)\n![remote](https://example.com/image.png)');
  assert.doesNotMatch(result.html, /src="file:|src="\.\//); assert.match(result.html, /referrerpolicy="no-referrer"/);
});
