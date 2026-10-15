export type ParagraphAction = `h${1 | 2 | 3 | 4 | 5 | 6}` | 'paragraph' | 'headingUp' | 'headingDown' | 'quote' | 'ordered' | 'unordered' | 'task' | 'checked' | 'unchecked' | 'indent' | 'outdent' | 'codeblock' | 'rule' | 'before' | 'after';
export interface ParagraphOption { action: ParagraphAction; label: string; shortcut?: string; separator?: boolean }
export const paragraphOptions: ParagraphOption[] = [
  ...(['一', '二', '三', '四', '五', '六'] as const).map((label, i) => ({ action: `h${i + 1}` as ParagraphAction, label: `${label}级标题`, shortcut: `Ctrl ${i + 1}` })),
  { action: 'paragraph', label: '正文段落', shortcut: 'Ctrl 0', separator: true },
  { action: 'headingUp', label: '提升标题级别', shortcut: 'Ctrl =' },
  { action: 'headingDown', label: '降低标题级别', shortcut: 'Ctrl -' },
  { action: 'codeblock', label: '代码块', shortcut: 'Ctrl Shift K', separator: true },
  { action: 'quote', label: '引用', shortcut: 'Ctrl Shift Q' },
  { action: 'ordered', label: '有序列表', shortcut: 'Ctrl Shift [' , separator: true },
  { action: 'unordered', label: '无序列表', shortcut: 'Ctrl Shift ]' },
  { action: 'task', label: '任务列表', shortcut: 'Ctrl Shift X' },
  { action: 'checked', label: '标记任务完成' }, { action: 'unchecked', label: '标记任务未完成' },
  { action: 'indent', label: '增加列表缩进' }, { action: 'outdent', label: '减少列表缩进' },
  { action: 'before', label: '在上方插入段落', separator: true }, { action: 'after', label: '在下方插入段落' },
  { action: 'rule', label: '水平分割线', separator: true }
];
export function paragraphShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey'>): ParagraphAction | undefined {
  if (event.altKey) return;
  if (!event.shiftKey) {
    if (/^[1-6]$/.test(event.key)) return `h${event.key}` as ParagraphAction;
    if (event.key === '0') return 'paragraph';
    if (event.key === '=') return 'headingUp'; if (event.key === '-') return 'headingDown';
  } else {
    if (event.code === 'BracketLeft' || event.key === '{') return 'ordered';
    if (event.code === 'BracketRight' || event.key === '}') return 'unordered';
    return ({ k: 'codeblock', q: 'quote', x: 'task' } as const)[event.key.toLowerCase() as 'k' | 'q' | 'x'];
  }
}
export function sourceHeadingLevel(text: string, cursor: number): number {
  const start = cursor > 0 ? text.lastIndexOf('\n', cursor - 1) + 1 : 0;
  return /^(#{1,6})\s/.exec(text.slice(start))?.[1].length ?? 0;
}
export function formatParagraph(text: string, from: number, to: number, action: ParagraphAction) {
  const start = from > 0 ? text.lastIndexOf('\n', from - 1) + 1 : 0;
  // A selection ending at the next line's start does not include that next line.
  const last = to > from && text[to - 1] === '\n' ? to - 1 : to;
  const newline = text.indexOf('\n', last); const end = newline < 0 ? text.length : newline;
  const block = text.slice(start, end); let replacement = '';
  if (action === 'before' || action === 'after') {
    const at = action === 'before' ? start : end;
    return { text: text.slice(0, at) + '\n\n' + text.slice(at), start: action === 'before' ? at : at + 2, end: action === 'before' ? at : at + 2 };
  }
  if (action === 'rule') {
    const inserted = '\n\n---\n\n';
    return { text: text.slice(0, end) + inserted + text.slice(end), start: end + inserted.length, end: end + inserted.length };
  }
  if (action === 'codeblock') {
    const fence = '`'.repeat(Math.max(3, ...Array.from(block.matchAll(/`+/g), match => match[0].length + 1)));
    replacement = `${fence}\n${block}\n${fence}`;
  } else {
    let count = 0;
    replacement = block.split('\n').map(line => {
      if (action === 'checked' || action === 'unchecked') return line.replace(/^(\s*(?:[-+*]|\d+[.)])\s+)\[[ xX]\]/, `$1[${action === 'checked' ? 'x' : ' '}]`);
      if (action === 'indent') return /^\s*(?:[-+*]|\d+[.)])\s/.test(line) ? `    ${line}` : line;
      if (action === 'outdent') return /^\s+(?:[-+*]|\d+[.)])\s/.test(line) ? line.replace(/^(?: {1,4}|\t)/, '') : line;
      if (!line.trim() && block.includes('\n')) return line;
      const indent = /^\s*/.exec(line)![0];
      const content = line.slice(indent.length).replace(/^(?:#{1,6}\s+|>\s?|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?)/, '');
      if (action === 'paragraph') return content;
      if (/^h[1-6]$/.test(action)) return `${'#'.repeat(Number(action[1]))} ${content}`;
      if (action === 'headingUp' || action === 'headingDown') {
        const level = /^(#{1,6})\s/.exec(line)?.[1].length ?? 0;
        const next = action === 'headingUp' ? Math.max(1, level - 1) : Math.min(6, level + 1);
        return `${'#'.repeat(next)} ${content}`;
      }
      if (action === 'quote') return `> ${content}`;
      if (action === 'ordered') return `${indent}${++count}. ${content}`;
      if (action === 'unordered') return `${indent}- ${content}`;
      return `${indent}- [${/^\s*[-+*]\s+\[[xX]\]/.test(line) ? 'x' : ' '}] ${content}`;
    }).join('\n');
  }
  return { text: text.slice(0, start) + replacement + text.slice(end), start, end: start + replacement.length };
}
