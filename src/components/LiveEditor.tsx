import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../core/markdown.ts';
import { richTextToMarkdown } from '../core/rich-text.ts';
import type { Format } from '../core/format.ts';
import type { ParagraphAction } from '../core/paragraph.ts';
import type { MediaDraft } from '../core/media.ts';
import { imageDimension } from '../core/media.ts';
import { blockAlignment, tableStyle } from '../core/alignment.ts';
import type { BlockAlignment } from '../core/alignment.ts';
import { changeListLevel } from '../core/lists.ts';
import { imagePreview } from '../core/image-assets.ts';
import { changeTable } from '../core/table.ts';
import type { TableAction } from '../core/table.ts';

export interface LiveEditorHandle {
  format(kind: Format): void;
  paragraph(action: ParagraphAction): void;
  command(command: 'undo' | 'redo' | 'selectAll' | 'cut' | 'copy' | 'paste'): Promise<void>;
  insertMarkdown(markdown: string): void;
}
interface Props { content: string; imageContext?: string; imageVersion?: number; spellcheck: boolean; onChange(content: string): void; onContextMenu(event: React.MouseEvent): void; onHeadingChange?(level: number): void; onEditMedia?(draft: MediaDraft): void }
interface Snapshot { html: string; markdown: string; caret: number }
export default forwardRef<LiveEditorHandle, Props>(function LiveEditor({ content, imageContext = '', imageVersion = 0, spellcheck, onChange, onContextMenu, onHeadingChange, onEditMedia }, ref) {
  const root = useRef<HTMLElement>(null);
  const emitted = useRef<string | null>(null);
  const composing = useRef(false);
  const formatting = useRef(false);
  const history = useRef<Snapshot[]>([]);
  const position = useRef(0);
  const selection = useRef<Range | null>(null);
  const tableCell = useRef<HTMLTableCellElement | null>(null);
  const [tableActive, setTableActive] = useState(false);
  const selectedImage = useRef<HTMLImageElement | null>(null);
  const [imageActive, setImageActive] = useState(false);
  const [, refreshMediaTools] = useState(0);
  function alignMedia(alignment: BlockAlignment) {
    const element = imageActive ? selectedImage.current : tableCell.current?.closest('table');
    if (!element || !root.current?.contains(element)) return;
    element.setAttribute('data-block-align', alignment); publish(); refreshMediaTools(value => value + 1);
  }
  function alignmentButtons(kind: '图片' | '表格') {
    const element = kind === '图片' ? selectedImage.current : tableCell.current?.closest('table');
    return (['left', 'center', 'right'] as const).map((alignment, index) => <button type="button" key={alignment} aria-label={`${kind}${['左对齐', '居中', '右对齐'][index]}`} aria-pressed={(blockAlignment(element?.getAttribute('data-block-align')) ?? 'left') === alignment} onMouseDown={event => event.preventDefault()} onClick={() => alignMedia(alignment)}>{['左对齐', '居中', '右对齐'][index]}</button>);
  }
  function resizeImage() {
    const image = selectedImage.current;
    if (!image || !root.current?.contains(image)) { setImageActive(false); return; }
    const range = document.createRange(); range.selectNode(image); const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); selection.current = range.cloneRange();
    onEditMedia?.({ kind: 'image', value: image.dataset.imageSource ?? image.getAttribute('src') ?? '', label: image.alt, title: image.title, alignment: blockAlignment(image.getAttribute('data-block-align')), width: imageDimension(image.getAttribute('width')), height: imageDimension(image.getAttribute('height')) });
  }
  function tableAction(action: TableAction, firstColumn = false) {
    const cell = tableCell.current; if (!cell || !root.current?.contains(cell)) { setTableActive(false); return; }
    let next = changeTable(cell, action);
    if (next && firstColumn) next = (next.parentElement as HTMLTableRowElement).cells[0];
    tableCell.current = next; setTableActive(!!next);
    root.current.focus();
    if (next) { const range = document.createRange(); range.selectNodeContents(next); range.collapse(true); const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); selection.current = range.cloneRange(); }
    else placeCaret(root.current.textContent?.length ?? 0);
    publish(); rememberSelection();
  }
  function caret() {
    const current = window.getSelection(); if (!current?.rangeCount || !root.current?.contains(current.anchorNode)) return 0;
    const range = current.getRangeAt(0).cloneRange(); range.selectNodeContents(root.current); range.setEnd(current.anchorNode!, current.anchorOffset); return range.toString().length;
  }
  function placeCaret(offset: number) {
    const el = root.current!; const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node: Node | null;
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    while ((node = walk.nextNode())) { if (offset <= (node.textContent?.length ?? 0)) { range.setStart(node, offset); range.collapse(true); break; } offset -= node.textContent?.length ?? 0; }
    const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); selection.current = range.cloneRange();
  }
  function rememberSelection() {
    const current = window.getSelection(); if (current?.rangeCount && root.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
    const node = current?.anchorNode;
    if (node && root.current?.contains(node)) {
      const cell = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLTableCellElement>('td,th') ?? null;
      tableCell.current = cell; setTableActive(!!cell);
      const heading = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest('h1,h2,h3,h4,h5,h6');
      onHeadingChange?.(heading ? Number(heading.tagName[1]) : 0);
    }
    const snapshot = history.current[position.current]; if (snapshot) snapshot.caret = caret();
  }
  function restoreSelection() {
    root.current?.focus(); const current = window.getSelection();
    if (selection.current && root.current?.contains(selection.current.startContainer)) { current?.removeAllRanges(); current?.addRange(selection.current); }
    else placeCaret(root.current?.textContent?.length ?? 0);
  }
  function prepare() {
    root.current?.querySelectorAll('td,th').forEach(cell => { if (!cell.hasChildNodes()) cell.append(document.createElement('br')); });
    root.current?.querySelectorAll('input[type=checkbox]').forEach(input => { input.removeAttribute('disabled'); input.setAttribute('contenteditable', 'false'); input.setAttribute('aria-label', '完成待办'); });
    root.current?.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el, i) => { el.id = `heading-${i}`; });
  }
  useLayoutEffect(() => {
    if (content === emitted.current) { root.current?.querySelectorAll<HTMLImageElement>('img[data-image-source]').forEach(img => { const url = imagePreview(img.dataset.imageSource!, imageContext); if (url) img.src = url; }); return; }
    setImageActive(false); selectedImage.current = null;
    const el = root.current!; el.innerHTML = renderMarkdown(content, imageContext).html || '<p><br></p>'; prepare();
    emitted.current = content; history.current = [{ html: el.innerHTML, markdown: content, caret: 0 }]; position.current = 0; selection.current = null;
  }, [content, imageContext, imageVersion]);
  function publish() {
    if (composing.current || formatting.current || !root.current) return;
    const selected = window.getSelection();
    const textNode = selected?.anchorNode;
    if (selected?.isCollapsed && textNode?.nodeType === Node.TEXT_NODE && !textNode.parentElement?.closest('pre,code,a')) {
      const before = textNode.textContent?.slice(0, selected.anchorOffset) ?? '';
      const match = /(\*\*[^*\n]+\*\*|(?<!\*)\*[^*\n]+\*|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))$/.exec(before);
      if (match) {
        formatting.current = true;
        try {
          const range = document.createRange(); range.setStart(textNode, selected.anchorOffset - match[0].length); range.setEnd(textNode, selected.anchorOffset);
          selected.removeAllRanges(); selected.addRange(range);
          const template = document.createElement('template'); template.innerHTML = renderMarkdown(match[0]).html;
          const html = template.content.firstElementChild?.innerHTML ?? '';
          document.execCommand('insertHTML', false, html);
        } finally { formatting.current = false; }
      }
    }
    prepare(); const html = root.current.innerHTML;
    if (history.current[position.current]?.html === html) return;
    const markdown = richTextToMarkdown(root.current); emitted.current = markdown;
    history.current = history.current.slice(0, position.current + 1);
    history.current.push({ html, markdown, caret: caret() });
    if (history.current.length > 60) history.current.shift();
    position.current = history.current.length - 1; onChange(markdown); rememberSelection();
  }
  function execute(command: string, value?: string) {
    restoreSelection(); document.execCommand(command, false, value); publish(); rememberSelection();
  }
  function insertMarkdown(markdown: string) { execute('insertHTML', renderMarkdown(markdown, imageContext).html); }
  function undo(direction: number) {
    const next = position.current + direction; const snapshot = history.current[next]; if (!snapshot) return;
    position.current = next; root.current!.innerHTML = snapshot.html; emitted.current = snapshot.markdown; onChange(snapshot.markdown); root.current!.focus(); placeCaret(snapshot.caret);
  }
  function paragraph(action: ParagraphAction) {
    restoreSelection(); const current = window.getSelection();
    const anchor = current?.anchorNode;
    const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor?.parentElement;
    const block = element?.closest('h1,h2,h3,h4,h5,h6,p,pre,li,blockquote');
    if (/^h[1-6]$/.test(action)) { execute('formatBlock', action); return; }
    if (action === 'paragraph') { execute('formatBlock', 'p'); return; }
    if (action === 'headingUp' || action === 'headingDown') {
      const level = block && /^H[1-6]$/.test(block.tagName) ? Number(block.tagName[1]) : 0;
      execute('formatBlock', `h${action === 'headingUp' ? Math.max(1, level - 1) : Math.min(6, level + 1)}`); return;
    }
    if (action === 'quote') { execute('formatBlock', 'blockquote'); return; }
    if (action === 'codeblock') {
      // Keep literal characters and line breaks; do not parse code as Markdown.
      const pre = document.createElement('pre'); const code = document.createElement('code');
      code.textContent = current?.toString() || block?.textContent || ''; pre.append(code);
      if (current?.isCollapsed && block && root.current?.contains(block)) {
        block.replaceWith(pre); const range = document.createRange(); range.selectNodeContents(code); range.collapse(false);
        current.removeAllRanges(); current.addRange(range); selection.current = range.cloneRange(); publish(); rememberSelection();
      }
      else execute('insertHTML', pre.outerHTML);
      return;
    }
    if (action === 'ordered' || action === 'unordered') {
      execute(action === 'ordered' ? 'insertOrderedList' : 'insertUnorderedList'); return;
    }
    if (action === 'indent' || action === 'outdent') { const li = element?.closest('li'); if (li) moveList(li, action === 'outdent'); return; }
    if (action === 'task' || action === 'checked' || action === 'unchecked') {
      if (action === 'task' && !element?.closest('li')) execute('insertUnorderedList');
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
      const listItems = Array.from(root.current!.querySelectorAll('li')).filter(li => range && (range.collapsed ? li.contains(range.startContainer) : range.intersectsNode(li)));
      for (const li of listItems) {
        // Nested list parents must not be changed just because a child is selected.
        if (listItems.some(other => other !== li && li.contains(other))) continue;
        let input = li.querySelector<HTMLInputElement>(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
        if (!input && action === 'task') { input = document.createElement('input'); input.type = 'checkbox'; li.prepend(input, document.createTextNode(' ')); }
        if (input && action !== 'task') { input.checked = action === 'checked'; input.toggleAttribute('checked', input.checked); }
      }
      publish(); rememberSelection(); return;
    }
    const p = document.createElement('p'); p.append(document.createElement('br'));
    let boundary = block;
    while (boundary?.parentElement && boundary.parentElement !== root.current) boundary = boundary.parentElement;
    if (action === 'before' && boundary) boundary.before(p);
    else if (boundary) boundary.after(p);
    else root.current!.append(p);
    if (action === 'rule') p.before(document.createElement('hr'));
    const range = document.createRange(); range.selectNodeContents(p); range.collapse(true); current?.removeAllRanges(); current?.addRange(range); selection.current = range.cloneRange(); publish(); rememberSelection();
  }
  useImperativeHandle(ref, () => ({
    paragraph,
    format(kind) {
      if (kind === 'bold' || kind === 'italic') execute(kind);
      else if (kind === 'heading') execute('formatBlock', 'h2');
      else if (kind === 'quote') execute('formatBlock', 'blockquote');
      else if (kind === 'list') execute('insertUnorderedList');
      else if (kind === 'task') paragraph('task');
      else if (kind === 'table') insertMarkdown('| 标题 | 内容 |\n| --- | --- |\n| 项目 | 说明 |');
      else if (kind === 'code') {
        restoreSelection(); const text = window.getSelection()?.toString() || 'code';
        const element = document.createElement('code'); element.textContent = text; execute('insertHTML', element.outerHTML);
      } else if (kind === 'link') insertMarkdown('[链接文字](https://example.com)');
    },
    insertMarkdown,
    async command(command) {
      if (command === 'undo') { undo(-1); return; } if (command === 'redo') { undo(1); return; }
      restoreSelection();
      if (command === 'selectAll') { const range = document.createRange(); range.selectNodeContents(root.current!); const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); rememberSelection(); return; }
      if (command === 'paste') { const text = await navigator.clipboard.readText(); insertMarkdown(text); return; }
      const text = window.getSelection()?.toString() ?? ''; if (!text) return;
      await navigator.clipboard.writeText(text); if (command === 'cut') execute('delete');
    }
  }));
  function moveList(item: HTMLLIElement, outdent: boolean) {
    const selected = window.getSelection(); const anchor = selected?.anchorNode; const offset = selected?.anchorOffset ?? 0;
    const next = changeListLevel(item, outdent); if (!next) return;
    const range = document.createRange();
    if (anchor && next.contains(anchor)) range.setStart(anchor, offset); else range.selectNodeContents(next);
    range.collapse(true); selected?.removeAllRanges(); selected?.addRange(range); selection.current = range.cloneRange(); publish(); rememberSelection();
  }
  function shortcut(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    const selected = window.getSelection(); const anchor = selected?.anchorNode;
    const li = (anchor?.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor?.parentElement)?.closest('li');
    if (li && root.current?.contains(li) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === 'Tab') { event.preventDefault(); moveList(li, event.shiftKey); return; }
      if (event.key === 'Enter' && !event.shiftKey && selected?.isCollapsed && !li.textContent?.trim() && !li.querySelector('ul,ol,img,pre')) { event.preventDefault(); moveList(li, true); return; }
    }
    if (event.key === 'Tab' && tableCell.current && root.current?.contains(tableCell.current)) {
      event.preventDefault();
      const cell = tableCell.current; const table = cell.closest('table')!; const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th,td')); const index = cells.indexOf(cell);
      if (!event.shiftKey && index === cells.length - 1) { tableAction('rowBelow', true); return; }
      const next = cells[index + (event.shiftKey ? -1 : 1)];
      if (next) { const range = document.createRange(); range.selectNodeContents(next); range.collapse(true); const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); rememberSelection(); }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); undo(event.key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1); return; }
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const current = window.getSelection(); if (!current?.isCollapsed || !current.anchorNode) return;
    const block = (current.anchorNode.nodeType === Node.ELEMENT_NODE ? current.anchorNode as Element : current.anchorNode.parentElement)?.closest('p,div');
    if (!block || !root.current?.contains(block)) return;
    const text = block.textContent ?? '';
    const heading = /^(#{1,6})$/.exec(text);
    const command = heading ? ['formatBlock', `h${heading[1].length}`] : text === '>' ? ['formatBlock', 'blockquote'] : text === '-' || text === '*' ? ['insertUnorderedList', ''] : text === '1.' ? ['insertOrderedList', ''] : text === '```' && event.key === 'Enter' ? ['formatBlock', 'pre'] : null;
    if (!command || (event.key === 'Enter' && text !== '```')) return;
    event.preventDefault(); const range = document.createRange(); range.selectNodeContents(block); current.removeAllRanges(); current.addRange(range); selection.current = range.cloneRange(); execute('delete'); execute(command[0], command[1]);
  }
  return <>{imageActive && <div className="table-tools"><div className="table-actions" role="toolbar" aria-label="图片工具">{alignmentButtons('图片')}<button type="button" onMouseDown={e => e.preventDefault()} onClick={resizeImage}>调整图片大小</button><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { const image = selectedImage.current; if (image && root.current?.contains(image)) { image.removeAttribute('width'); image.removeAttribute('height'); publish(); } }}>恢复原始尺寸</button></div></div>}{tableActive && !imageActive && <div className="table-tools"><div className="table-actions" role="toolbar" aria-label="表格行列工具">{alignmentButtons('表格')}<select aria-label="表格样式" value={tableStyle(tableCell.current?.closest('table')?.getAttribute('data-table-style')) ?? 'simple'} onChange={event => { const table = tableCell.current?.closest('table'); const style = tableStyle(event.target.value); if (table && style && root.current?.contains(table)) { table.setAttribute('data-table-style', style); publish(); refreshMediaTools(value => value + 1); } }}><option value="simple">简洁</option><option value="grid">网格</option><option value="striped">条纹</option></select>{([
    ['rowAbove', '上方加行'], ['rowBelow', '下方加行'], ['columnLeft', '左侧加列'], ['columnRight', '右侧加列'], ['deleteRow', '删除当前行'], ['deleteColumn', '删除当前列']
  ] as [TableAction, string][]).map(([action, label]) => <button key={action} type="button" onMouseDown={e => e.preventDefault()} onClick={() => tableAction(action)}>{label}</button>)}</div></div>}<article ref={root} className="paper markdown-body live-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="文稿编辑器" spellCheck={spellcheck}
    onInput={publish} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; publish(); }}
    onKeyDown={shortcut} onKeyUp={rememberSelection} onMouseUp={rememberSelection} onBlur={rememberSelection}
    onContextMenu={e => { rememberSelection(); onContextMenu(e); }}
    onDoubleClick={e => {
      const element = (e.target as Element).closest<HTMLElement>('.math-node, pre, img');
      if (!element || !root.current?.contains(element) || !onEditMedia) return;
      e.preventDefault(); const range = document.createRange(); range.selectNode(element);
      const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); selection.current = range.cloneRange();
      if (element.matches('.math-node')) onEditMedia({ kind: 'formula', value: element.dataset.math ?? '', display: element.dataset.display === 'block' });
      else if (element.matches('img')) onEditMedia({ kind: 'image', value: element.dataset.imageSource ?? element.getAttribute('src') ?? '', label: element.getAttribute('alt') ?? '', title: element.getAttribute('title') ?? '', alignment: blockAlignment(element.getAttribute('data-block-align')), width: imageDimension(element.getAttribute('width')), height: imageDimension(element.getAttribute('height')) });
      else { const code = element.querySelector('code'); onEditMedia({ kind: 'codeblock', value: (code ?? element).textContent?.replace(/\n$/, '') ?? '', language: /(?:^|\s)language-([\w+#.-]+)/.exec(code?.className ?? '')?.[1] ?? '' }); }
    }}
    onPaste={e => { e.preventDefault(); rememberSelection(); insertMarkdown(e.clipboardData.getData('text/plain')); }}
    onDrop={e => { e.preventDefault(); }} onClick={e => {
      const target = e.target as HTMLElement;
      const image = target.closest<HTMLImageElement>('img'); selectedImage.current = image; setImageActive(!!image);
      if (target.closest('a')) e.preventDefault();
      if (target instanceof HTMLInputElement && target.type === 'checkbox') { target.toggleAttribute('checked', target.checked); publish(); }
    }} /></>;
});
