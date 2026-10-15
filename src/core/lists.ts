/** Move an item without flattening its children or reversing following siblings. */
export function changeListLevel(item: HTMLLIElement, outdent: boolean): HTMLElement | null {
  const list = item.parentElement;
  if (!list?.matches('ul,ol')) return null;
  if (!outdent) {
    const previous = item.previousElementSibling;
    if (!previous?.matches('li')) return null;
    let nested = Array.from(previous.children).find(child => child.tagName === list.tagName);
    if (!nested) { nested = item.ownerDocument.createElement(list.tagName.toLowerCase()); previous.append(nested); }
    nested.append(item); return item;
  }
  const parent = list.parentElement?.closest('li');
  if (parent) {
    const following = Array.from(list.children).slice(Array.from(list.children).indexOf(item) + 1);
    if (following.length) { const nested = item.ownerDocument.createElement(list.tagName.toLowerCase()); nested.append(...following); item.append(nested); }
    parent.after(item); if (!list.children.length) list.remove(); return item;
  }
  const after = list.cloneNode(false) as HTMLElement;
  while (item.nextElementSibling) after.append(item.nextElementSibling);
  const paragraph = item.ownerDocument.createElement('p');
  paragraph.append(...Array.from(item.childNodes).filter(node => !(node instanceof item.ownerDocument.defaultView!.HTMLInputElement)));
  if (!paragraph.childNodes.length) paragraph.append(item.ownerDocument.createElement('br'));
  list.after(paragraph); if (after.children.length) paragraph.after(after);
  item.remove(); if (!list.children.length) list.remove(); return paragraph;
}

export function listKey(text: string, start: number, end: number, key: string, shift = false): { text: string; start: number; end: number } | undefined {
  const from = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  const newline = text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end); const to = newline < 0 ? text.length : newline;
  const line = text.slice(from, to); const match = /^([ \t]*)([-+*]|\d+[.)]) (\[[ xX]\] )?(.*)$/m.exec(line);
  if (!match) return;
  if (key === 'Tab') {
    const lines = line.split('\n');
    const transformed = lines.map(line => shift ? (/^(?: {1,4}|\t)/.test(line) ? line.replace(/^(?: {1,4}|\t)/, '') : line.replace(/^(?:[-+*]|\d+[.)]) (?:\[[ xX]\] )?/, '')) : '    ' + line).join('\n');
    const delta = transformed.length - line.length;
    return { text: text.slice(0, from) + transformed + text.slice(to), start: start === end ? Math.max(from, start + delta) : from, end: start === end ? Math.max(from, start + delta) : from + transformed.length };
  }
  if (key !== 'Enter' || shift || start !== end) return;
  if (!match[4].trim()) {
    const replacement = match[1] ? line.replace(/^(?: {1,4}|\t)/, '') : '';
    return { text: text.slice(0, from) + replacement + text.slice(to), start: from + replacement.length, end: from + replacement.length };
  }
  if (start < from + match[1].length + match[2].length + 1) return;
  const marker = /^\d/.test(match[2]) ? `${Number.parseInt(match[2]) + 1}${match[2].slice(-1)}` : match[2];
  const insert = `\n${match[1]}${marker} ${match[3] ? '[ ] ' : ''}`;
  return { text: text.slice(0, start) + insert + text.slice(end), start: start + insert.length, end: start + insert.length };
}
