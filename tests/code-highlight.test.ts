import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html>', { url: 'http://localhost' });
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const { renderMarkdown } = await import('../src/core/markdown.ts');
const { richTextToMarkdown } = await import('../src/core/rich-text.ts');
const { mediaMarkdown } = await import('../src/core/media.ts');

function article(source: string) {
  const element = dom.window.document.createElement('article'); element.innerHTML = renderMarkdown(source).html; return element;
}

test('mainstream languages and common aliases highlight without changing code or language', () => {
  const samples: Record<string, string> = {
    javascript: 'const message = "hello"; // comment', js: 'const x = 42;', jsx: 'const App = () => <h1>Hello</h1>;',
    typescript: 'const count: number = 42;', ts: 'interface User { name: string }', tsx: 'const App = () => <h1>Hello</h1>;',
    python: 'def greet(name):\n    return "hello"', py: 'print("hi")', java: 'public class Main { int n = 1; }',
    c: 'int main() { return 0; }', cpp: '#include <iostream>\nint main() { return 0; }',
    csharp: 'public class App { string name = "hello"; }', 'c#': 'public class App {}',
    go: 'package main\nfunc main() { println("hello") }', rust: 'fn main() { let n = 42; }',
    sql: 'SELECT name FROM users WHERE id = 1;', json: '{"name": "office", "enabled": true}',
    yaml: 'name: office\nenabled: true\n# comment', yml: 'name: "office"',
    html: '<div class="hello">Hello</div>', xml: '<root value="yes"/>', css: '.hello { color: red; }',
    bash: 'echo "hello" # comment', sh: 'echo "hello"', powershell: 'Write-Host "hello"',
    php: '<?php echo "hello"; ?>', ruby: 'def greet\n  puts "hello"\nend', swift: 'let name: String = "hello"',
    kotlin: 'fun main() { println("hello") }', dart: 'void main() { print("hello"); }',
    dockerfile: 'FROM node:22\nRUN echo "hello"', toml: '[app]\nname = "office"',
    graphql: 'query { user(id: 1) { name } }', lua: 'local name = "hello"', scala: 'val name: String = "hello"',
    groovy: 'def name = "hello"', protobuf: 'syntax = "proto3";\nmessage User { string name = 1; }',
    cmake: 'cmake_minimum_required(VERSION 3.20)', nginx: 'server { listen 80; }', vue: '<template><h1>Hello</h1></template>'
  };
  for (const [language, value] of Object.entries(samples)) {
    const markdown = mediaMarkdown({ kind: 'codeblock', language, value }).trim(); const element = article(markdown);
    const code = element.querySelector('pre > code')!;
    assert.equal(code.textContent, value + '\n', language);
    assert.ok(code.querySelector('[class^="hljs-"]'), language);
    assert.equal(richTextToMarkdown(element), markdown, language);
  }
});

test('unknown languages and unlabeled code stay literal; highlighted markup remains inert', () => {
  const value = '<script>alert("x")</script>\n<img src=x onerror="alert(1)">\n  **literal**';
  for (const language of ['html', 'javascript', 'unknown-language', '', 'text']) {
    const markdown = mediaMarkdown({ kind: 'codeblock', language, value }).trim(); const element = article(markdown);
    assert.equal(element.querySelector('pre code')!.textContent, value + '\n');
    assert.equal(element.querySelector('script,img,[onerror]'), null);
    assert.equal(richTextToMarkdown(element), markdown);
  }
});

test('skill front matter renders as a highlighted metadata panel instead of a rule and setext heading', () => {
  const metadata = '---\nname: office\ndescription: Create, edit, inspect, or convert Office documents.\n---';
  const source = metadata + '\n\n# Office task routing\n\nCall the `skill` tool.';
  const result = renderMarkdown(source); const element = article(source);
  assert.deepEqual(result.headings.map(h => h.title), ['Office task routing']);
  assert.equal(element.querySelector('hr,h2'), null);
  const panel = element.querySelector('.frontmatter-node')!;
  assert.equal(panel.getAttribute('contenteditable'), 'false');
  assert.equal(panel.querySelector('.hljs-attr')!.textContent, 'name:');
  assert.match(panel.textContent!, /description: Create/);
  assert.equal(richTextToMarkdown(element), source);
  element.querySelector('p')!.textContent = 'Edited body';
  const saved = richTextToMarkdown(element);
  assert.ok(saved.startsWith(metadata + '\n\n'));
  assert.equal(article(saved).querySelectorAll('.frontmatter-node').length, 1);
});

test('front matter preserves nested YAML, literal markup, comments, multiline strings and closing markers', () => {
  const metadata = '---\r\n# comment\r\nname: "<img src=x onerror=alert(1)>"\r\ntags: [a, b]\r\nconfig:\r\n  enabled: true\r\ndescription: |\r\n  # literal heading\r\n  **literal** $x$\r\n...';
  const element = article(metadata + '\r\n\r\n# Body');
  assert.equal(element.querySelector('img,math'), null);
  assert.equal(element.querySelectorAll('h1').length, 1);
  assert.equal(richTextToMarkdown(element), metadata.replace(/\r\n/g, '\n') + '\n\n# Body');
  for (const source of ['# Body\n\n---\nname: office\n---', '---\nname: office', '```yaml\n---\nname: office\n---\n```', '---\n\n# Body']) assert.equal(article(source).querySelector('.frontmatter-node'), null, source);
  assert.ok(article('\uFEFF\n---\nname: office\n---\n\n# Body').querySelector('.frontmatter-node'));
});

test('editing document properties emits front matter rather than a fenced YAML block', () => {
  const source = mediaMarkdown({ kind: 'codeblock', language: 'yaml', frontmatter: true, value: 'name: office\ndescription: updated\n' });
  assert.equal(source, '---\nname: office\ndescription: updated\n---\n');
  assert.ok(article(source).querySelector('.frontmatter-node .hljs-attr'));
  assert.throws(() => mediaMarkdown({ kind: 'codeblock', frontmatter: true, value: 'name: office\n---\n# Body' }), /分隔行/);
});
