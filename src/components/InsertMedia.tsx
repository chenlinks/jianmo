import { useMemo, useState } from 'react';
import Modal from './Modal.tsx';
import NumberStepper from './NumberStepper.tsx';
import { mediaMarkdown } from '../core/media.ts';
import type { MediaDraft } from '../core/media.ts';
import { renderMarkdown } from '../core/markdown.ts';

export default function InsertMedia({ initial, imageContext, onImage, onClose, onInsert }: { initial: MediaDraft; imageContext: string; onImage(file: File): Promise<string>; onClose(): void; onInsert(markdown: string): string | undefined }) {
  const [draft, setDraft] = useState(initial);
  const [locked, setLocked] = useState(!initial.height);
  const [natural, setNatural] = useState<{ source: string; width: number; height: number } | null>(null);
  const size = natural?.source === draft.value ? natural : null;
  const proportionalHeight = size ? Math.round(size.height * (draft.width ?? size.width) / size.width) : undefined;
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const preview = useMemo(() => { try { return renderMarkdown(mediaMarkdown(draft), imageContext).html; } catch { return ''; } }, [draft, imageContext]);
  const name = { image: '图片', formula: '公式', codeblock: '代码块', table: '表格' }[draft.kind];
  return <Modal title={`插入 / 编辑${name}`} className={draft.kind === 'table' ? 'table-dialog' : undefined} onClose={onClose}><form className="media-form" onSubmit={e => {
    e.preventDefault(); try { const message = onInsert(mediaMarkdown(draft)); if (message) setError(message); else onClose(); } catch (err) { setError(err instanceof Error ? err.message : '无法插入内容'); }
  }}>
    {draft.kind === 'table' ? <div className="table-dimensions"><NumberStepper id="table-rows" label="数据行数" min={1} max={30} value={draft.rows ?? 3} onChange={rows => setDraft(draft => ({ ...draft, rows }))} /><NumberStepper id="table-columns" label="列数" min={1} max={12} value={draft.columns ?? 3} onChange={columns => setDraft(draft => ({ ...draft, columns }))} /><p className="hint">另含一行表头，插入后仍可随时增减行列。</p></div> : draft.kind === 'image' ? <>
      <label htmlFor="image-file">本机图片</label><input id="image-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={loading} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        setError('');
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { setError('支持 PNG、JPEG、GIF 和 WebP 图片'); return; }
        setLoading(true);
        try {
          const value = await onImage(file);
          setDraft(d => ({ ...d, value, label: d.label || file.name.replace(/\.[^.]+$/, '') }));
        } catch (error) { setError(error instanceof Error ? error.message : '图片保存失败，请重试'); } finally { setLoading(false); }
      }} />
      <p className="hint">图片保存在独立的软件数据目录，文稿只保存附件引用。可在偏好设置查看数据位置。</p>
      <label htmlFor="media-url">或使用图片地址</label><input id="media-url" type="text" value={draft.value.startsWith('data:') ? '' : draft.value} placeholder="https://example.com/image.png" onChange={e => setDraft({ ...draft, value: e.target.value })} />
      <label htmlFor="media-label">图片说明</label><input id="media-label" value={draft.label ?? ''} onChange={e => setDraft({ ...draft, label: e.target.value })} />
      <fieldset className="image-size"><legend>图片尺寸</legend><div className="image-dimensions"><label htmlFor="image-width">宽度（px）<input id="image-width" type="number" min="1" step="1" placeholder="自动" value={draft.width ?? ''} onChange={e => setDraft({ ...draft, width: e.target.value === '' ? undefined : Number(e.target.value), ...(locked ? { height: undefined } : {}) })} /></label><label htmlFor="image-height">高度（px）<input id="image-height" type="number" min="1" step="1" placeholder={locked ? '按比例自动计算' : '自动'} disabled={locked} value={(locked ? proportionalHeight : draft.height) ?? ''} onChange={e => setDraft({ ...draft, height: e.target.value === '' ? undefined : Number(e.target.value) })} /></label></div>
      <label className="image-ratio" htmlFor="image-ratio"><input id="image-ratio" type="checkbox" checked={locked} onChange={e => { setLocked(e.target.checked); if (e.target.checked) setDraft({ ...draft, height: undefined }); }} />保持宽高比例</label>
      <div className="image-size-presets">{[25, 50, 75].map(percent => <button type="button" key={percent} disabled={!size} onClick={() => { setLocked(true); setDraft({ ...draft, width: Math.max(1, Math.round(size!.width * percent / 100)), height: undefined }); }}>{percent}%</button>)}<button type="button" onClick={() => { setLocked(true); setDraft({ ...draft, width: undefined, height: undefined }); }}>原始尺寸</button></div>
      <p className="hint">{size ? `原图 ${size.width} × ${size.height} px。` : ''}默认等比缩放，显示宽度不超过页面；取消勾选可分别设置宽高。</p></fieldset>
    </> : <>
      {draft.kind === 'formula' ? <label className="settings-row" htmlFor="formula-display"><span>显示方式</span><select id="formula-display" value={draft.display ? 'block' : 'inline'} onChange={e => setDraft({ ...draft, display: e.target.value === 'block' })}><option value="block">独立公式</option><option value="inline">行内公式</option></select></label> : <><label htmlFor="code-language">代码语言</label><input id="code-language" list="code-languages" placeholder="例如 javascript、python、java" value={draft.language ?? ''} onChange={e => setDraft({ ...draft, language: e.target.value })} /><datalist id="code-languages">{['javascript', 'typescript', 'python', 'java', 'sql', 'json', 'html', 'css', 'bash', 'rust', 'text'].map(language => <option key={language} value={language} />)}</datalist></>}
      <label htmlFor="media-source">{draft.kind === 'formula' ? 'LaTeX 公式' : '代码内容'}</label><textarea id="media-source" autoFocus spellCheck={false} rows={draft.kind === 'formula' ? 4 : 8} value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} />
    </>}
    {draft.kind === 'table' ? <div className="media-preview markdown-body table-insert-preview" aria-label="表格预览"><table style={{ minWidth: `${(draft.columns ?? 3) * 104}px` }}><thead><tr>{Array.from({ length: draft.columns ?? 3 }, (_, index) => <th key={index}><input className="table-header-input" aria-label={`第 ${index + 1} 列表头`} value={draft.headers?.[index] ?? `列 ${index + 1}`} onFocus={event => event.currentTarget.select()} onChange={event => { const value = event.target.value; setDraft(draft => { const headers = Array.from({ length: Math.max(draft.headers?.length ?? 0, draft.columns ?? 3) }, (_, i) => draft.headers?.[i] ?? `列 ${i + 1}`); headers[index] = value; return { ...draft, headers }; }); }} /></th>)}</tr></thead><tbody>{Array.from({ length: draft.rows ?? 3 }, (_, row) => <tr key={row}>{Array.from({ length: draft.columns ?? 3 }, (_, column) => <td key={column}>&nbsp;</td>)}</tr>)}</tbody></table></div> : preview && <div className="media-preview markdown-body" aria-label={`${name}预览`} onLoadCapture={e => { const target = e.target as HTMLImageElement; if (draft.kind === 'image' && target.tagName === 'IMG' && target.naturalWidth) setNatural({ source: draft.value, width: target.naturalWidth, height: target.naturalHeight }); }} dangerouslySetInnerHTML={{ __html: preview }} />}
    {error && <p role="alert" className="status-error">{error}</p>}
    <p className="hint">{draft.kind === 'table' ? '点击上方表头直接改名，按 Tab 切换。插入后点击单元格可增减行列。' : `插入后可双击${name}重新编辑，也可切换源码模式修改。`}</p>
    <div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={loading}>插入内容</button></div>
  </form></Modal>;
}
