import { localImageName } from './image-assets.ts';
import { blockAlignment } from './alignment.ts';
import type { BlockAlignment } from './alignment.ts';
export type MediaKind = 'image' | 'formula' | 'codeblock' | 'table';
export interface MediaDraft { kind: MediaKind; value: string; label?: string; language?: string; display?: boolean; rows?: number; columns?: number; headers?: string[]; width?: number; height?: number; title?: string; alignment?: BlockAlignment }
export function imageDimension(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return;
  const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
export function mediaMarkdown(draft: MediaDraft): string {
  if (draft.kind === 'table') {
    const rows = draft.rows ?? 3; const columns = draft.columns ?? 3;
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 30 || columns < 1 || columns > 12) throw new Error('请选择 1–30 行、1–12 列');
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
    const header = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '\\\\').replace(/[|`*_\[\]~]/g, '\\$&').replace(/[\r\n]+/g, ' ');
    return '\n\n' + [line(Array.from({ length: columns }, (_, i) => header(draft.headers?.[i] ?? `列 ${i + 1}`))), line(Array(columns).fill('---')), ...Array.from({ length: rows }, () => line(Array(columns).fill('')))].join('\n') + '\n\n';
  }
  if (draft.kind === 'image') {
    const url = draft.value.trim();
    if (!localImageName(url) && !/^(https?:\/\/[^\s<>]+|data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+)$/i.test(url)) throw new Error('请选择本机图片，或输入有效的 http / https 图片地址');
    for (const value of [draft.width, draft.height]) if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('图片尺寸必须为大于 0 的整数，留空使用自动尺寸');
    if (draft.width || draft.height || blockAlignment(draft.alignment)) {
      const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ');
      return `<img src="${escape(url)}" alt="${escape(draft.label ?? '')}"${draft.width ? ` width="${draft.width}"` : ''}${draft.height ? ` height="${draft.height}"` : ''}${draft.title ? ` title="${escape(draft.title)}"` : ''}${blockAlignment(draft.alignment) ? ` data-block-align="${draft.alignment}"` : ''}>`;
    }
    const alt = (draft.label ?? '').replace(/\\/g, '\\\\').replace(/[\[\]]/g, '\\$&').replace(/\n/g, ' ');
    return `![${alt}](<${url}>)`;
  }
  if (draft.kind === 'formula') {
    const value = draft.value.trim();
    if (!value) throw new Error('请输入 LaTeX 公式');
    if (draft.display) {
      if (/^\s*\$\$\s*$/m.test(value)) throw new Error('只需填写公式，不要包含独立的 $$ 分隔行');
      return `\n\n$$\n${value}\n$$\n\n`;
    }
    if (/\n|(?<!\\)\$/.test(value)) throw new Error('行内公式不能包含换行或未转义的 $，可改用独立公式');
    return `$${value}$`;
  }
  const language = (draft.language ?? '').trim();
  if (!/^[\w+#.-]*$/.test(language)) throw new Error('语言名称只能包含字母、数字和 + # . -');
  const fence = '`'.repeat(Math.max(3, ...Array.from(draft.value.matchAll(/`+/g), match => match[0].length + 1)));
  return `\n\n${fence}${language}\n${draft.value.replace(/\n$/, '')}\n${fence}\n\n`;
}
