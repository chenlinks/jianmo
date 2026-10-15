import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import { getDataLocation } from '../platform/notebooks.ts';
import type { Theme, ViewMode, Workspace } from '../core/documents.ts';
import { APP_VERSION, releases } from '../core/releases.ts';
import { displayFilePath, isDesktop } from '../platform/files.ts';
import Logo from './Logo.tsx';

export type SettingsPage = 'settings' | 'about' | 'versions';
interface Props { page: SettingsPage; onPage(page: SettingsPage): void; state: Workspace; setState: Dispatch<SetStateAction<Workspace>>; location?: string; locationError: string; busy: boolean; onChooseLocation(): void; onDefaultLocation(): void }
const themes: { id: Theme; label: string }[] = [{ id: 'light', label: '晴昼' }, { id: 'warm', label: '纸页' }, { id: 'dark', label: '深夜' }];
export default function AppSettings({ page, onPage, state, setState, location, locationError, busy, onChooseLocation, onDefaultLocation }: Props) {
  const [dataLocation, setDataLocation] = useState('正在读取…');
  useEffect(() => { let active = true; void getDataLocation().then(value => { if (active) setDataLocation(value); }).catch(() => { if (active) setDataLocation('软件数据目录暂不可用'); }); return () => { active = false; }; }, []);
  return <><nav className="settings-nav" aria-label="设置页面">{([{ id: 'settings', label: '偏好设置' }, { id: 'about', label: '关于笺墨' }, { id: 'versions', label: '版本说明' }] as const).map(item => <button key={item.id} aria-pressed={page === item.id} onClick={() => onPage(item.id)}>{item.label}</button>)}</nav>
    {page === 'settings' && <>
      <fieldset className="storage-settings"><legend>笔记存储位置</legend><p className="storage-location">{displayFilePath(location ?? '默认目录')}</p><p className="hint">{isDesktop() ? '未设置时使用系统“文档”下的“笺墨”目录。' : '未设置时使用浏览器本机存储。选择磁盘文件夹后会记住此目录，权限失效时需重新授权。'}新文档按 Ctrl/⌘ S 保存到这里，已打开的文件继续保存到原位置。</p>{locationError && <p className="notebook-error" role="alert">{locationError}</p>}<div className="storage-setting-actions"><button className="secondary" disabled={busy} onClick={onChooseLocation}>选择目录</button><button disabled={busy} onClick={onDefaultLocation}>使用默认目录</button></div></fieldset>
      <fieldset className="storage-settings"><legend>软件数据目录</legend><p className="storage-location">{displayFilePath(dataLocation)}</p><p className="hint">图片附件和回收站独立存放，笔记目录只保留文档与文件夹。备份时请同时备份文档和软件数据。{!isDesktop() && '清除浏览器站点数据也会清除附件与回收站。'}</p></fieldset>
      <fieldset><legend>外观主题</legend><div className="theme-options">{themes.map(t => <button key={t.id} className={`theme-option theme-${t.id}`} aria-pressed={state.theme === t.id} onClick={() => setState(s => ({ ...s, theme: t.id }))}><span className="theme-sample">Aa</span>{t.label}</button>)}</div></fieldset>
      <label className="range-label" htmlFor="font-size">阅读字号<span>{state.fontSize}px</span></label><input id="font-size" type="range" min="14" max="22" value={state.fontSize} onChange={e => setState(s => ({ ...s, fontSize: Number(e.target.value) }))} /><p className="hint">仅调整文稿字号，界面控件保持固定尺寸。</p>
      <fieldset><legend>页面宽度</legend><div className="page-width-options"><button className="secondary" aria-pressed={state.pageWidth !== 'wide'} onClick={() => setState(s => ({ ...s, pageWidth: 'normal' }))}><span className="page-width-preview normal-width" aria-hidden="true" />正常页</button><button className="secondary" aria-pressed={state.pageWidth === 'wide'} onClick={() => setState(s => ({ ...s, pageWidth: 'wide' }))}><span className="page-width-preview wide-width" aria-hidden="true" />宽页</button></div><p className="hint">正常页居中显示，适合阅读；宽页使用全部可用宽度，适合表格与长篇编辑。</p></fieldset>
      <label className="settings-row" htmlFor="default-view"><span>启动视图<small>下次打开笺墨时使用</small></span><select id="default-view" value={state.defaultView === 'edit' ? 'edit' : 'read'} onChange={e => setState(s => ({ ...s, defaultView: e.target.value as ViewMode }))}><option value="read">即写即阅</option><option value="edit">源码模式</option></select></label>
      <label className="settings-row" htmlFor="spellcheck"><span>拼写检查<small>在编辑器中标记拼写问题</small></span><input id="spellcheck" type="checkbox" checked={state.spellcheck ?? false} onChange={e => setState(s => ({ ...s, spellcheck: e.target.checked }))} /></label>
      <p className="hint">设置自动保存在本机。恢复默认设置会保留所有文稿与存储目录。</p><button className="secondary" onClick={() => setState(s => ({ ...s, theme: 'light', fontSize: 17, defaultView: 'read', spellcheck: false, pageWidth: 'normal' }))}>恢复默认设置</button>
      <div className="shortcut-list"><span>保存文件 <kbd>Ctrl / ⌘ S</kbd></span><span>另存为 <kbd>Ctrl / ⌘ Shift S</kbd></span><span>打开文件 <kbd>Ctrl / ⌘ O</kbd></span><span>源码模式 <kbd>Ctrl / ⌘ E</kbd></span></div>
    </>}
    {page === 'about' && <div className="about-content"><div className="about-brand"><Logo /><div><strong>笺墨 Jianmo</strong><span>版本 {APP_VERSION}</span></div></div><p>留住每一个想法。</p><p className="hint">一款以文稿为中心的 Markdown 编辑器。直接在文稿中书写，也可切换源码模式，让想法自然成文。</p><dl className="about-details"><div><dt>开发者</dt><dd>陈领</dd></div><div><dt>运行方式</dt><dd>{isDesktop() ? '桌面应用' : '浏览器'}</dd></div><div><dt>文件格式</dt><dd>Markdown / 文本 · UTF-8</dd></div></dl><h3>文稿与本机数据</h3><p className="hint">草稿和偏好保存在当前设备。草稿自动保存不等于写入原文件，请按 Ctrl/⌘ S 保存到笔记目录。网页版“另存为”会下载 Markdown 文件。</p><p className="hint">笔记目录设置会保留；浏览器权限失效时需重新授权。原有草稿仍会保留。清除浏览器或应用数据会清除草稿和设置，请先保存重要文稿。</p><button className="secondary" onClick={() => onPage('versions')}>查看版本说明</button></div>}
    {page === 'versions' && <div className="release-notes"><p className="hint">当前版本 {APP_VERSION} · 本机版本记录</p>{releases.map(release => <article key={release.version}><h3>v{release.version}{release.version === APP_VERSION && <span>当前版本</span>}</h3><time dateTime={release.date}>{release.date}</time><ul>{release.items.map(item => <li key={item}>{item}</li>)}</ul></article>)}</div>}
  </>;
}
