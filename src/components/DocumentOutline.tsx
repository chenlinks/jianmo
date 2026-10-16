import { useEffect, useRef, useState } from 'react';
import type { Heading } from '../core/markdown.ts';

export default function DocumentOutline({ headings, activeId, onJump }: { headings: Heading[]; activeId: string; onJump: (id: string) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });
  function measure() {
    const element = viewport.current;
    if (!element) return;
    const above = element.scrollTop > 1;
    const below = element.scrollHeight - element.clientHeight - element.scrollTop > 1;
    setEdges(previous => previous.above === above && previous.below === below ? previous : { above, below });
  }
  useEffect(() => {
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (viewport.current) observer?.observe(viewport.current);
    if (list.current) observer?.observe(list.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [headings]);
  useEffect(() => {
    const element = viewport.current;
    const active = list.current?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!element || !active) return;
    const bounds = element.getBoundingClientRect(); const item = active.getBoundingClientRect();
    // Keep the current heading visible without scrolling the surrounding page or dialog.
    if (item.top < bounds.top) element.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) element.scrollTop += item.bottom - bounds.bottom;
    measure();
  }, [activeId]);
  return <div className={`outline-browser${edges.above ? ' has-content-above' : ''}${edges.below ? ' has-content-below' : ''}`}>
    <div ref={viewport} className="outline-scroll" tabIndex={0} role="region" aria-label="文稿大纲滚动区域" onScroll={measure}>
      <nav ref={list} className="outline-list" aria-label="文稿大纲">{headings.length ? headings.map(heading => <button key={heading.id} title={heading.title} className={`level-${heading.level}`} aria-current={heading.id === activeId ? 'location' : undefined} onClick={() => onJump(heading.id)}>{heading.title}</button>) : <p className="hint">添加标题后，会在这里显示文稿结构。</p>}</nav>
    </div>
  </div>;
}
