import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findInDocument, findText, replaceInDocument, replaceText } from '../src/core/find.ts';

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

test('replacement uses literal strings, Unicode offsets, empty replacements and original non-overlapping matches', () => {
  const text = '😀 Test test .* 中文中文';
  assert.equal(replaceText(text, findText(text, 'test'), '$&'), '😀 $& $& .* 中文中文');
  assert.equal(replaceText(text, findText(text, 'test', true), ''), '😀 Test  .* 中文中文');
  assert.equal(replaceText(text, findText(text, '.*'), '<b>'), '😀 Test test <b> 中文中文');
  assert.equal(replaceText('aaa', findText('aaa', 'a'), 'aa'), 'aaaaaa');
  assert.equal(replaceText('中文中文', findText('中文中文', '中文'), '文'), '文文');
  assert.equal(replaceText(text, findText(text, ''), 'x'), text);
});

test('rich replacement retains inline formatting, links, blocks and literal HTML text', () => {
  const dom = new JSDOM('<article><h1>Title</h1><p><strong>hel</strong><em>lo</em> hello <a href="https://hello.example">hello</a></p><p>hello</p></article>');
  const root = dom.window.document.querySelector('article')!;
  assert.equal(replaceInDocument(root, 'hello', '你好', false, 1), 1);
  assert.equal(root.querySelector('p')!.textContent, 'hello 你好 hello');
  assert.equal(replaceInDocument(root, 'hello', '<b>$&</b>'), 3);
  assert.equal(root.querySelector('strong')!.textContent, '<b>$&</b>');
  assert.equal(root.querySelector('em')!.textContent, '');
  assert.equal(root.querySelector('a')!.getAttribute('href'), 'https://hello.example');
  assert.equal(root.querySelector('a')!.textContent, '<b>$&</b>');
  assert.equal(root.querySelector('b'), null);
  assert.equal(root.querySelectorAll('p').length, 2);
  assert.equal(root.querySelector('h1')!.textContent, 'Title');
  assert.equal(replaceInDocument(root, '<b>$&</b>', ''), 3);
  assert.equal(root.querySelector('p')!.textContent, ' 你好 ');
  dom.window.close();
});

test('replace skips rendered media and does not join text across protected content', () => {
  const dom = new JSDOM('<article><p>Test test <span class="math-node" data-math="test">test</span></p><div contenteditable="false" data-mermaid="test">test</div><p>a<img src="x">b</p><pre><code>test test</code></pre></article>');
  const root = dom.window.document.querySelector('article')!;
  assert.equal(findInDocument(root, 'test', false, true).length, 4);
  assert.equal(replaceInDocument(root, 'test', 'test test', true), 3);
  assert.equal(root.querySelector('code')!.textContent, 'test test test test');
  assert.equal(root.querySelector('[data-mermaid]')!.textContent, 'test');
  assert.equal(root.querySelector('[data-math]')!.textContent, 'test');
  assert.equal(replaceInDocument(root, 'ab', 'x'), 0);
  assert.equal(replaceInDocument(root, '', 'x'), 0);
  dom.window.close();
});
