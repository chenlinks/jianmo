import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findInDocument, findText } from '../core/find.ts';
import type { TextMatch } from '../core/find.ts';
import Icon from './Icon.tsx';

interface Props {
  documentId: string; content: string; sourceMode: boolean; focusRequest: number; initialQuery: string;
  getTarget(): HTMLElement | null; onClose(): void;
}

export default function FindBar({ documentId, content, sourceMode, focusRequest, initialQuery, getTarget, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<TextMatch[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const targetRef = useRef(getTarget); targetRef.current = getTarget;
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRequest]);
  useEffect(() => {
    const target = targetRef.current();
    const refresh = () => {
      setMatches(target ? sourceMode ? findText((target as HTMLTextAreaElement).value, query, caseSensitive) : findInDocument(target, query, caseSensitive) : []);
      setActive(0);
    };
    refresh();
    if (!target || sourceMode) return;
    const observer = new window.MutationObserver(refresh);
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [query, caseSensitive, content, documentId, sourceMode]);
  useEffect(() => {
    let cleanupSource: (() => void) | undefined;
    const ranges = matches.flatMap(match => match.range ? [match.range] : []);
    if (window.CSS?.highlights && typeof window.Highlight !== 'undefined') {
      window.CSS.highlights.set('jianmo-find', new window.Highlight(...ranges));
      window.CSS.highlights.set('jianmo-find-active', new window.Highlight(...(matches[active]?.range ? [matches[active].range!] : [])));
    }
    const match = matches[active]; const target = targetRef.current();
    if (match && target) {
      if (sourceMode) {
        const textarea = target as HTMLTextAreaElement;
        textarea.setSelectionRange(match.start, match.end);
        // A textarea does not paint its selection while the find input has focus.
        // Mirror only the highlights behind it, using the same wrapping and scrolling.
        const overlay = document.createElement('div'); overlay.className = 'source-find-overlay'; overlay.setAttribute('aria-hidden', 'true');
        const mirror = document.createElement('div'); overlay.append(mirror);
        const markers: HTMLElement[] = []; let offset = 0;
        for (const result of matches) {
          mirror.append(document.createTextNode(textarea.value.slice(offset, result.start)));
          const marker = document.createElement('mark'); marker.textContent = textarea.value.slice(result.start, result.end);
          if (markers.length === active) marker.className = 'find-active';
          markers.push(marker); mirror.append(marker); offset = result.end;
        }
        mirror.append(document.createTextNode(textarea.value.slice(offset) + '\n'));
        textarea.parentElement?.append(overlay);
        function syncSize() {
          const style = window.getComputedStyle(textarea);
          for (const property of ['font', 'line-height', 'letter-spacing', 'padding', 'box-sizing', 'word-break', 'overflow-wrap', 'tab-size']) mirror.style.setProperty(property, style.getPropertyValue(property));
          overlay.style.top = `${textarea.offsetTop}px`; overlay.style.left = `${textarea.offsetLeft}px`;
          overlay.style.width = `${textarea.clientWidth}px`; overlay.style.height = `${textarea.clientHeight}px`;
          mirror.style.width = `${textarea.clientWidth}px`;
        }
        const syncScroll = () => { overlay.scrollTop = textarea.scrollTop; overlay.scrollLeft = textarea.scrollLeft; };
        syncSize(); textarea.scrollTop = Math.max(0, markers[active].offsetTop - textarea.clientHeight / 2); syncScroll();
        textarea.addEventListener('scroll', syncScroll);
        const resize = typeof window.ResizeObserver !== 'undefined' ? new window.ResizeObserver(() => { syncSize(); syncScroll(); }) : null;
        resize?.observe(textarea);
        cleanupSource = () => { textarea.removeEventListener('scroll', syncScroll); resize?.disconnect(); overlay.remove(); };
      } else if (match.range) {
        const element = match.range.startContainer.parentElement;
        const panel = target.closest<HTMLElement>('.preview-panel');
        const bounds = match.range.getBoundingClientRect?.();
        if (panel && bounds && (bounds.width || bounds.height)) panel.scrollTop += bounds.top - panel.getBoundingClientRect().top - panel.clientHeight / 2;
        else element?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
        if (!window.CSS?.highlights) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(match.range); }
      }
    }
    return () => { cleanupSource?.(); window.CSS?.highlights?.delete('jianmo-find'); window.CSS?.highlights?.delete('jianmo-find-active'); };
  }, [matches, active, sourceMode]);
  function move(direction: number) { if (matches.length) setActive(index => (index + direction + matches.length) % matches.length); }
  return <div className="find-bar" role="search" aria-label="文稿查找" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
  }}>
    <Icon name="search" /><input ref={input} aria-label="查找内容" placeholder="在当前文稿中查找" value={query} onChange={event => setQuery(event.target.value)} />
    <span className="find-count" role="status" aria-live="polite">{!query ? '输入查找内容' : matches.length ? `${active + 1} / ${matches.length}` : '无匹配结果'}</span>
    <button type="button" aria-label="区分大小写" aria-pressed={caseSensitive} title="区分大小写" onClick={() => setCaseSensitive(value => !value)}>Aa</button>
    <button type="button" aria-label="上一个匹配" title="上一个（Shift+Enter）" disabled={!matches.length} onClick={() => move(-1)}>↑</button>
    <button type="button" aria-label="下一个匹配" title="下一个（Enter）" disabled={!matches.length} onClick={() => move(1)}>↓</button>
    <button type="button" className="icon-button" aria-label="关闭查找" title="关闭（Esc）" onClick={onClose}><Icon name="close" /></button>
  </div>;
}
