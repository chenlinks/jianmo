import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findInDocument, findText } from '../src/core/find.ts';

test('find uses literal text, keeps Unicode offsets and supports case sensitivity', () => {
  assert.deepEqual(findText('İ Test test .* 中文中文', 'test'), [{ start: 2, end: 6 }, { start: 7, end: 11 }]);
  assert.deepEqual(findText('Test test', 'test', true), [{ start: 5, end: 9 }]);
  assert.deepEqual(findText('a.*b', '.*'), [{ start: 1, end: 3 }]);
  assert.equal(findText('中文中文', '中文').length, 2);
  assert.deepEqual(findText('abc', ''), []);
});

test('find spans inline formatting but separates blocks and excludes SVG styles and other documents', () => {
  const dom = new JSDOM('<aside>hello world</aside><article><p>hello <strong>world</strong></p><p>hello</p><p>world</p><svg><style>.world{}</style><text>Diagram</text></svg></article>');
  const root = dom.window.document.querySelector('article')!;
  const matches = findInDocument(root, 'hello world');
  assert.equal(matches.length, 1); assert.equal(matches[0].range?.toString(), 'hello world');
  assert.equal(findInDocument(root, 'world').length, 2);
  assert.equal(findInDocument(root, '.world').length, 0);
  assert.equal(findInDocument(root, 'Diagram')[0].range?.toString(), 'Diagram');
  dom.window.close();
});
