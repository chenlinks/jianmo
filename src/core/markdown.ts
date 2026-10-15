import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { imageDimension } from './media.ts';
import { blockAlignment, tableStyle } from './alignment.ts';
import { imagePreview, localImageName } from './image-assets.ts';
const parser = new Marked({ gfm: true, breaks: false });
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
parser.use({ extensions: [
  { name: 'blockMath', level: 'block', start: source => source.indexOf('$$'),
    tokenizer(source) { const match = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(source); if (match) return { type: 'blockMath', raw: match[0], text: match[1] }; },
    renderer(token) { return `<div class="math-node" data-math="${escapeAttribute(token.text)}" data-display="block"></div>\n`; } },
  { name: 'inlineMath', level: 'inline', start: source => source.indexOf('$'),
    tokenizer(source) { const match = /^\$(?!\$|\s)((?:\\[^\n]|[^$\\\n])+?)(?<!\s)\$(?!\d)/.exec(source); if (match) return { type: 'inlineMath', raw: match[0], text: match[1] }; },
    renderer(token) { return `<span class="math-node" data-math="${escapeAttribute(token.text)}" data-display="inline"></span>`; } }
] });
export interface Heading { id: string; title: string; level: number }
export function renderMarkdown(source: string, imageContext = ''): { html: string; headings: Heading[] } {
  const parsed = document.createElement('template'); parsed.innerHTML = parser.parse(source, { async: false });
  parsed.content.querySelectorAll('[data-managed-image]').forEach(el => el.removeAttribute('data-managed-image'));
  parsed.content.querySelectorAll('img').forEach(el => {
    const src = el.getAttribute('src') ?? '';
    if (src.startsWith('jianmo-asset://') && localImageName(src)) { el.setAttribute('data-managed-image', localImageName(src)!); el.removeAttribute('src'); }
  });
  const html = DOMPurify.sanitize(parsed.innerHTML, {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'video', 'audio'],
    FORBID_ATTR: ['style', 'srcset'], ALLOW_DATA_ATTR: false, ADD_ATTR: ['data-math', 'data-display', 'data-block-align', 'data-table-style', 'data-managed-image']
  });
  const template = document.createElement('template'); template.innerHTML = html;
  template.content.querySelectorAll('div[align],div[data-table-style]').forEach(wrapper => {
    const alignment = blockAlignment(wrapper.getAttribute('align'));
    const style = tableStyle(wrapper.getAttribute('data-table-style'));
    const child = wrapper.firstElementChild;
    if ((alignment || style) && child?.matches('table,img') && wrapper.children.length === 1 && Array.from(wrapper.childNodes).every(node => node === child || !node.textContent?.trim())) {
      if (alignment) child.setAttribute('data-block-align', alignment);
      if (style && child.matches('table')) child.setAttribute('data-table-style', style);
      wrapper.replaceWith(child);
    }
  });
  template.content.querySelectorAll('[data-block-align]').forEach(el => {
    if (!el.matches('table,img') || !blockAlignment(el.getAttribute('data-block-align'))) el.removeAttribute('data-block-align');
  });
  template.content.querySelectorAll('[data-table-style]').forEach(el => {
    if (!el.matches('table') || !tableStyle(el.getAttribute('data-table-style'))) el.removeAttribute('data-table-style');
  });
  template.content.querySelectorAll<HTMLElement>('.math-node[data-math]').forEach(el => {
    const source = el.getAttribute('data-math') ?? '';
    // Native MathML keeps formulas portable, offline and font-independent.
    el.innerHTML = DOMPurify.sanitize(katex.renderToString(source, { displayMode: el.dataset.display === 'block', output: 'mathml', throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }), { USE_PROFILES: { html: true, mathMl: true } });
    el.contentEditable = 'false'; el.title = '双击编辑公式';
  });
  const headings: Heading[] = [];
  template.content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el, i) => {
    const id = `heading-${i}`; el.id = id;
    headings.push({ id, title: el.textContent || '无标题', level: Number(el.tagName[1]) });
  });
  template.content.querySelectorAll('a').forEach(el => {
    const href = el.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    else if (!href.startsWith('#') && !href.startsWith('mailto:')) el.removeAttribute('href');
  });
  // Remote and data images only. Local file permissions are never inferred from Markdown.
  template.content.querySelectorAll('img').forEach(el => {
    const managed = el.getAttribute('data-managed-image');
    const source = managed ? `jianmo-asset://${managed}` : el.getAttribute('src') ?? ''; el.removeAttribute('data-managed-image');
    for (const name of ['width', 'height']) if (imageDimension(el.getAttribute(name)) === undefined) el.removeAttribute(name);
    if (localImageName(source)) { el.setAttribute('data-image-source', source); const url = imagePreview(source, imageContext); if (url) el.setAttribute('src', url); else el.removeAttribute('src'); }
    else if (!/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(source)) el.removeAttribute('src');
    el.setAttribute('loading', 'lazy'); el.setAttribute('referrerpolicy', 'no-referrer');
  });
  return { html: template.innerHTML, headings };
}
