export type Format = 'bold' | 'italic' | 'heading' | 'quote' | 'list' | 'task' | 'link' | 'code' | 'table';
export function formatSelection(text: string, start: number, end: number, kind: Format) {
  const selected = text.slice(start, end);
  let replacement = ''; let offset = 0; let length = selected.length;
  const wrappers = { bold: ['**', '**', '重点文字'], italic: ['*', '*', '强调文字'], link: ['[', '](https://example.com)', '链接文字'], code: ['`', '`', 'code'] };
  if (kind in wrappers) {
    const [before, after, placeholder] = wrappers[kind as keyof typeof wrappers];
    const value = selected || placeholder;
    replacement = before + value + after; offset = before.length; length = value.length;
  } else if (kind === 'table') {
    replacement = '\n\n| 标题 | 内容 |\n| --- | --- |\n| 项目 | 说明 |\n\n'; length = replacement.length;
  } else {
    const prefix = { heading: '## ', quote: '> ', list: '- ', task: '- [ ] ' }[kind as 'heading' | 'quote' | 'list' | 'task'];
    start = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
    const block = text.slice(start, end) || '内容';
    replacement = block.split('\n').map(line => prefix + line).join('\n'); offset = prefix.length; length = replacement.length - offset;
  }
  return { text: text.slice(0, start) + replacement + text.slice(end), start: start + offset, end: start + offset + length };
}
