import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mediaMarkdown } from '../src/core/media.ts';
import { changeTable } from '../src/core/table.ts';
import { cacheImagePreview, localImageName } from '../src/core/image-assets.ts';
const dom = new JSDOM('<!doctype html>');
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const { renderMarkdown } = await import('../src/core/markdown.ts');
const { richTextToMarkdown } = await import('../src/core/rich-text.ts');
function article(markdown: string) { const el = dom.window.document.createElement('article'); el.innerHTML = renderMarkdown(markdown).html; return el; }

test('local images keep portable paths through loading, resizing and missing attachments', () => {
  const source = '.assets/photo.png';
  const markdown = mediaMarkdown({ kind: 'image', value: source, width: 320 });
  let el = article(markdown);
  assert.equal(el.querySelector('img')!.getAttribute('src'), null);
  assert.match(richTextToMarkdown(el), /\.assets\/photo.png/);
  cacheImagePreview(source, 'blob:http://localhost/preview', 'note');
  el.innerHTML = renderMarkdown(markdown, 'note').html;
  assert.equal(el.querySelector('img')!.getAttribute('src'), 'blob:http://localhost/preview');
  const saved = richTextToMarkdown(el); assert.match(saved, /width="320"/); assert.match(saved, /\.assets\/photo.png/); assert.doesNotMatch(saved, /blob:|base64/);
  for (const path of ['../photo.png', '/.assets/photo.png', '.assets/../photo.png', 'C:\\photo.png']) assert.equal(localImageName(path), undefined);
});
test('managed image references are scoped to application data and survive Markdown round trips', () => {
  const source = 'jianmo-asset://image-123.png';
  cacheImagePreview(source, 'blob:http://localhost/managed', 'managed-note');
  const el = dom.window.document.createElement('article'); el.innerHTML = renderMarkdown(mediaMarkdown({ kind: 'image', value: source, width: 200 }), 'managed-note').html;
  assert.equal(el.querySelector('img')?.getAttribute('src'), 'blob:http://localhost/managed');
  assert.match(richTextToMarkdown(el), /jianmo-asset:\/\/image-123.png/); assert.doesNotMatch(richTextToMarkdown(el), /blob:|base64/);
  assert.equal(article('![bad](jianmo-asset://../outside.png)').querySelector('img')?.getAttribute('src'), null);
});
test('image dimensions survive rich editing and remain safe HTML attributes', () => {
  const draft = { kind: 'image' as const, value: 'https://example.com/a.png?q=1&b=2', label: '\"><img src=x onerror=alert(1)>', width: 400, height: 200 };
  const source = mediaMarkdown(draft);
  const el = article(source); const img = el.querySelector('img')!;
  assert.equal(el.querySelectorAll('img').length, 1); assert.equal(img.getAttribute('onerror'), null);
  assert.equal(img.alt, draft.label); assert.equal(img.getAttribute('width'), '400'); assert.equal(img.getAttribute('height'), '200');
  const restored = article(richTextToMarkdown(el)).querySelector('img')!;
  assert.equal(restored.getAttribute('width'), '400'); assert.equal(restored.getAttribute('height'), '200'); assert.equal(restored.src, draft.value);
  const proportional = article(mediaMarkdown({ ...draft, height: undefined })).querySelector('img')!;
  assert.equal(proportional.getAttribute('height'), null); assert.equal(proportional.getAttribute('width'), '400');
  assert.ok(mediaMarkdown({ ...draft, width: undefined, height: undefined }).startsWith('!['));
  for (const width of [-1, 0, NaN, Infinity, 1.5]) assert.throws(() => mediaMarkdown({ ...draft, width }), /尺寸/);
  const bad = article('<img src="https://example.com/a.png" width="-10" height="50%" onload="alert(1)" style="position:fixed">').querySelector('img')!;
  assert.equal(bad.getAttribute('width'), null); assert.equal(bad.getAttribute('height'), null); assert.equal(bad.getAttribute('style'), null); assert.equal(bad.getAttribute('onload'), null);
});
test('inline and display formulas render offline and round-trip without losing LaTeX', () => {
  const source = 'Area $\\pi r^2$\n\n$$\n\\frac{1}{2} + \\sqrt{x}\n$$';
  const el = article(source);
  assert.equal(el.querySelectorAll('math').length, 2);
  assert.equal(richTextToMarkdown(el), source);
  assert.equal(article('`$x$`\n\n```tex\n$$\nx\n$$\n```').querySelector('math'), null);
  assert.equal(article('cost $5 and $10').querySelector('math'), null);
  assert.doesNotThrow(() => renderMarkdown('$\\invalid{bad}$'));
});
test('formula and image input cannot inject executable HTML or access local paths', () => {
  const result = renderMarkdown('$$\n\\href{javascript:alert(1)}{click}\n$$\n\n<span class="math-node" data-math="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" data-display="inline"></span>');
  const el = dom.window.document.createElement('article'); el.innerHTML = result.html;
  assert.equal(el.querySelector('script,img,[onerror],a[href^="javascript:"]'), null);
  assert.throws(() => mediaMarkdown({ kind: 'image', value: 'file:///C:/private.png' }));
  const image = mediaMarkdown({ kind: 'image', value: 'data:image/png;base64,iVBORw0KGgo=', label: 'a [bracket]' });
  const parsed = article(image); assert.equal(parsed.querySelector('img')?.alt, 'a [bracket]');
  assert.equal(article(richTextToMarkdown(parsed)).querySelector('img')?.getAttribute('src'), 'data:image/png;base64,iVBORw0KGgo=');
});
test('fenced code preserves language, markup, indentation and nested fences across rich editing', () => {
  const value = '<script>danger()</script>\n  const x = `value`;\n```';
  const source = mediaMarkdown({ kind: 'codeblock', value, language: 'typescript' }).trim();
  const el = article(source);
  assert.equal(el.querySelector('script'), null); assert.equal(el.querySelector('code')?.textContent, value + '\n');
  assert.equal(richTextToMarkdown(el), source);
});
test('image and table alignment and table styles survive editing and reopening', () => {
  for (const alignment of ['left', 'center', 'right'] as const) {
    const image = article(mediaMarkdown({ kind: 'image', value: '.assets/photo.png', alignment, width: 320 }));
    const savedImage = richTextToMarkdown(image);
    assert.doesNotMatch(savedImage, /blob:|base64/);
    const restoredImage = article(savedImage).querySelector('img')!;
    assert.equal(restoredImage.dataset.blockAlign, alignment); assert.equal(restoredImage.getAttribute('width'), '320');
    for (const style of ['simple', 'grid', 'striped']) {
      const el = article('| Name | Value |\n| --- | ---: |\n| A | 2 |');
      const table = el.querySelector('table')!; table.dataset.blockAlign = alignment; table.dataset.tableStyle = style;
      changeTable(table.rows[1].cells[0], 'rowBelow');
      const saved = richTextToMarkdown(el); const reopened = article(saved);
      const restored = reopened.querySelector('table')!;
      assert.equal(restored.dataset.blockAlign, alignment); assert.equal(restored.dataset.tableStyle, style);
      assert.equal(restored.rows.length, 3); assert.equal(restored.rows[1].cells[0].textContent, 'A');
      assert.equal(restored.rows[0].cells[1].getAttribute('align'), 'right');
      assert.equal(richTextToMarkdown(reopened), saved);
    }
  }
  const unsafe = article('<table data-block-align="invalid" data-table-style="invalid"><tr><td>X</td></tr></table>');
  assert.equal(unsafe.querySelector('[data-block-align],[data-table-style]'), null);
});
test('custom table headers preserve literal names without adding columns or executable HTML', () => {
  const headers = ['姓名 | 角色', '<img src=x onerror=alert(1)>', '**plain** & [text] `code`', ''];
  const el = article(mediaMarkdown({ kind: 'table', value: '', rows: 2, columns: 5, headers }));
  assert.deepEqual(Array.from(el.querySelectorAll('th'), cell => cell.textContent), [...headers, '列 5']);
  assert.equal(el.querySelector('img,strong,code,a'), null);
  assert.equal(el.querySelectorAll('tbody tr').length, 2);
});
test('table insertion, row/column operations and header promotion preserve cell content', () => {
  const el = article(mediaMarkdown({ kind: 'table', value: '', rows: 2, columns: 2 }));
  const table = el.querySelector('table')!; table.rows[1].cells[0].textContent = 'preserved';
  let cell = changeTable(table.rows[1].cells[0], 'columnRight')!;
  assert.equal(table.rows[0].cells.length, 3); assert.equal(table.rows[1].cells[0].textContent, 'preserved');
  cell = changeTable(cell, 'rowBelow')!;
  assert.equal(table.rows.length, 4); assert.equal(cell.parentElement, table.rows[2]);
  changeTable(table.rows[0].cells[0], 'deleteRow');
  assert.equal(table.rows[0].cells[0].tagName, 'TH'); assert.equal(table.rows[0].cells[0].textContent, 'preserved');
  const restored = article(richTextToMarkdown(el)).querySelector('table')!;
  assert.equal(restored.rows.length, 3); assert.equal(restored.rows[0].cells.length, 3); assert.equal(restored.rows[0].cells[0].textContent, 'preserved');
  changeTable(table.rows[0].cells[1], 'deleteColumn'); assert.equal(table.rows[1].cells.length, 2);
  assert.throws(() => mediaMarkdown({ kind: 'table', value: '', rows: 0, columns: 100 }));
});
