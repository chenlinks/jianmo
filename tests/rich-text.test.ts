import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { richTextToMarkdown } from '../src/core/rich-text.ts';
test('rich editing serializes headings, nested lists, tasks, tables and fenced code', () => {
  const dom = new JSDOM('<article><h2>标题</h2><p><strong>重点</strong>和<em>强调</em>与<del>删除</del></p><ul><li><input type="checkbox" checked>完成</li><li>父项<ul><li>子项</li></ul></li></ul><table><thead><tr><th align="center">名称</th><th>值</th></tr></thead><tbody><tr><td>a|b</td><td><strong>加粗</strong></td></tr></tbody></table><pre><code class="language-js">const a = 1;\n</code></pre></article>');
  const markdown = richTextToMarkdown(dom.window.document.querySelector('article')!);
  assert.match(markdown, /## 标题/); assert.match(markdown, /\*\*重点\*\*/); assert.match(markdown, /\*强调\*/); assert.match(markdown, /~~删除~~/);
  assert.match(markdown, /\[x\] 完成/); assert.match(markdown, /父项\n\s+-\s+子项/);
  assert.match(markdown, /\| :---: \| --- \|/); assert.match(markdown, /a\\\|b/); assert.match(markdown, /```js\nconst a = 1;\n```/); dom.window.close();
});
