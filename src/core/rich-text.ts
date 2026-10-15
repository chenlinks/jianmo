import TurndownService from 'turndown';
import { imageDimension, mediaMarkdown } from './media.ts';
import { blockAlignment, tableStyle } from './alignment.ts';
const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', preformattedCode: true });
converter.addRule('sizedImage', {
  filter: node => node.nodeName === 'IMG' && !!(node.getAttribute('data-image-source') || blockAlignment(node.getAttribute('data-block-align')) || imageDimension(node.getAttribute('width')) || imageDimension(node.getAttribute('height'))),
  replacement: (_text, node) => {
    try { return mediaMarkdown({ kind: 'image', value: node.getAttribute('data-image-source') ?? node.getAttribute('src') ?? '', label: node.getAttribute('alt') ?? '', title: node.getAttribute('title') ?? '', width: imageDimension(node.getAttribute('width')), height: imageDimension(node.getAttribute('height')), alignment: blockAlignment(node.getAttribute('data-block-align')) }); }
    catch { return ''; }
  }
});
converter.addRule('math', {
  filter: node => node.classList.contains('math-node') && node.hasAttribute('data-math'),
  replacement: (_text, node) => node.getAttribute('data-display') === 'block' ? `\n\n$$\n${node.getAttribute('data-math')}\n$$\n\n` : `$${node.getAttribute('data-math')}$`
});
converter.addRule('literalCode', {
  filter: 'pre',
  replacement: (_text, node) => {
    const code = node.querySelector('code'); const value = (code ?? node).textContent ?? '';
    const language = /(?:^|\s)language-([\w+#.-]+)/.exec(code?.className ?? '')?.[1] ?? '';
    const fence = '`'.repeat(Math.max(3, ...Array.from(value.matchAll(/`+/g), match => match[0].length + 1)));
    return `\n\n${fence}${language}\n${value.replace(/\n$/, '')}\n${fence}\n\n`;
  }
});
converter.addRule('strike', { filter: node => ['DEL', 'S', 'STRIKE'].includes(node.nodeName), replacement: text => `~~${text}~~` });
converter.addRule('checkbox', {
  filter: node => node.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox',
  replacement: (_text, node) => node.hasAttribute('checked') ? '[x] ' : '[ ] '
});
converter.addRule('table', {
  filter: 'table',
  replacement: (_text, node) => {
    const rows = Array.from(node.querySelectorAll('tr')).map(row => Array.from(row.children).map(cell => converter.turndown(cell.innerHTML).replace(/\|/g, '\\|').replace(/\n+/g, '<br>')));
    if (!rows.length) return '';
    const count = Math.max(...rows.map(row => row.length));
    const line = (row: string[]) => `| ${Array.from({ length: count }, (_, i) => row[i] ?? '').join(' | ')} |`;
    const align = Array.from(node.querySelector('tr')!.children).map(cell => ({ left: ':---', center: ':---:', right: '---:' })[cell.getAttribute('align') as 'left' | 'center' | 'right'] ?? '---');
    const markdown = `${line(rows[0])}\n${line(align)}\n${rows.slice(1).map(line).join('\n')}`;
    const alignment = blockAlignment(node.getAttribute('data-block-align'));
    const style = tableStyle(node.getAttribute('data-table-style'));
    return alignment || style ? `\n\n<div${alignment ? ` align="${alignment}"` : ''}${style ? ` data-table-style="${style}"` : ''}>\n\n${markdown}\n\n</div>\n\n` : `\n\n${markdown}\n\n`;
  }
});
converter.remove(['script', 'style', 'iframe', 'object']);
export function richTextToMarkdown(element: HTMLElement): string {
  return converter.turndown(element).replace(/\u00a0/g, ' ');
}
