import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html>', { url: 'http://localhost' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, CSSStyleSheet: dom.window.CSSStyleSheet })) Object.defineProperty(globalThis, key, { value, configurable: true });
const { renderMarkdown } = await import('../src/core/markdown.ts');
const { richTextToMarkdown } = await import('../src/core/rich-text.ts');
const diagram = `flowchart TD
  A["Initial catalog: seven Office summaries"]
  A -->|Non-Office task| N["Continue without loading Office instructions"]
  A -->|Office task| B["skill(office): task routing"]
  B -->|Create or edit| C["skill(office-docx / office-pptx / office-xlsx)"]
  C --> D["Author and validate content, structure and data"]
  D -->|No additional operation needed| F["Deliver"]
  B -->|Images, visual inspection, or appearance changes| R["skill(office-render)"]
  D -->|Images, visual inspection, or appearance changes| R
  R --> RC["Shell: render into a private workspace temporary directory"]
  RC -->|Usable preview| V["Inspect requested images"]
  V --> F
  RC -->|Failed or blank preview| L["Report content checks and unfinished visual inspection separately"]
  L --> F
  B -->|Formula recalculation| X["skill(office-recalculate)"]
  D -->|Formula recalculation| X
  X --> XC["Shell: CLI recalculate and verify values"]
  XC --> F
  B -->|PDF export| P["skill(office-export-pdf)"]
  D -->|PDF export| P
  P --> PC["Shell: CLI convert"]
  PC --> F`;

test('Mermaid fences and unlabeled flowcharts retain literal source in an uneditable diagram block', () => {
  for (const language of ['mermaid', '']) {
    const root = document.createElement('article'); root.innerHTML = renderMarkdown('```' + language + '\n' + diagram + '\n```').html;
    const node = root.querySelector<HTMLElement>('.mermaid-node')!;
    assert.ok(node); assert.equal(node.dataset.mermaid, diagram); assert.equal(node.getAttribute('contenteditable'), 'false');
    // Simulate completed rendering: saving must serialize source, never SVG labels.
    node.innerHTML = '<svg><text>Rendered labels</text></svg>';
    const saved = richTextToMarkdown(root);
    assert.match(saved, /```mermaid/); assert.ok(saved.includes(diagram)); assert.doesNotMatch(saved, /Rendered labels|<svg/);
    assert.equal(renderMarkdown(saved).headings.length, 0);
  }
});

test('explicit non-Mermaid code stays code and diagram source cannot inject HTML', () => {
  assert.doesNotMatch(renderMarkdown('```text\n' + diagram + '\n```').html, /mermaid-node/);
  const root = document.createElement('article');
  root.innerHTML = renderMarkdown('```mermaid\nflowchart TD\nA["<img src=x onerror=alert(1)>"]\n```').html;
  assert.equal(root.querySelector('img'), null); assert.equal(root.querySelector('[onerror]'), null);
  assert.ok(root.querySelector<HTMLElement>('.mermaid-node')!.dataset.mermaid!.includes('<img'));
});

test('the Mermaid engine accepts the screenshot routing syntax', async () => {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: false } });
  assert.ok(await mermaid.parse(diagram));
});

test('invalid diagrams retain source with a useful error and leave no render workspace behind', async () => {
  const { renderDiagrams } = await import('../src/core/mermaid.ts');
  const source = 'flowchart TD\nA[unterminated';
  const root = document.createElement('article'); root.innerHTML = renderMarkdown('```mermaid\n' + source + '\n```').html;
  await renderDiagrams(root); await renderDiagrams(root);
  assert.equal(root.querySelectorAll('.mermaid-error').length, 1);
  assert.ok(richTextToMarkdown(root).includes(source));
  assert.equal(document.querySelector('.mermaid-render-workspace'), null);
});

test('the renderer produces SVG and preserves editable source through saving', async () => {
  // jsdom has no text layout; supply SVG measurements while using the real engine.
  Object.defineProperty(dom.window.SVGElement.prototype, 'getBBox', { configurable: true, value() { return { x: 0, y: 0, width: 160, height: 24 }; } });
  Object.defineProperty(dom.window.SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() { return (this.textContent?.length ?? 0) * 8; } });
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
  const { renderDiagrams } = await import('../src/core/mermaid.ts');
  const root = document.createElement('article'); root.innerHTML = renderMarkdown('```mermaid\n' + diagram + '\n```').html;
  document.body.append(root);
  try {
    await Promise.all([renderDiagrams(root), renderDiagrams(root)]);
    assert.equal(root.querySelectorAll('.mermaid-node > svg').length, 1, root.innerHTML);
    assert.equal(root.querySelector('.mermaid-error'), null);
    assert.ok(richTextToMarkdown(root).includes(diagram));
    assert.equal(document.querySelector('.mermaid-render-workspace'), null);
  } finally { root.remove(); }
});
