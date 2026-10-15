import { useEffect, useLayoutEffect, useRef, useState } from 'react';
export interface MenuItem { label: string; shortcut?: string; action(): void; disabled?: boolean; checked?: boolean; separator?: boolean }
export interface MenuGroup { label: string; accessKey?: string; items: MenuItem[] }
export interface ContextMenuState { x: number; y: number; type: 'editor' | 'document' | 'directory' | 'entry' }
interface PopupProps { items: MenuItem[]; close(): void; context?: { x: number; y: number } }
function Popup({ items, close, context }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState(context);
  useLayoutEffect(() => {
    if (!context || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(context.x, window.innerWidth - box.width - 8)), y: Math.max(8, Math.min(context.y, window.innerHeight - box.height - 8)) });
  }, [context?.x, context?.y]);
  return <div ref={ref} className={`menu-popup ${context ? 'context-popup' : ''}`} style={point ? { left: point.x, top: point.y } : undefined} role="menu" onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
  }}>{items.map((item, i) => <div key={`${item.label}-${i}`}>{item.separator && <div className="menu-separator" role="separator" />}<button role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} disabled={item.disabled} onMouseDown={e => e.preventDefault()} onClick={() => { item.action(); close(); }}><span className="menu-check">{item.checked ? '✓' : ''}</span><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button></div>)}</div>;
}
export default function AppMenu({ groups }: { groups: MenuGroup[] }) {
  const [open, setOpen] = useState<string | null>(null); const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: Event) => { if (!bar.current?.contains(event.target as Node)) setOpen(null); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(null); return; }
      if (event.altKey) {
        const group = groups.find(group => group.accessKey?.toLowerCase() === event.key.toLowerCase());
        if (group) { event.preventDefault(); setOpen(group.label); requestAnimationFrame(() => bar.current?.querySelector<HTMLButtonElement>('[role=menu] button')?.focus()); }
      }
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [groups]);
  return <nav ref={bar} className="app-menubar" aria-label="工具菜单栏">{groups.map(group => <div className="menu-group" key={group.label}><button aria-label={group.label} aria-haspopup="menu" aria-expanded={open === group.label} onMouseDown={e => e.preventDefault()} onClick={() => setOpen(open === group.label ? null : group.label)} onMouseEnter={() => { if (open) setOpen(group.label); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(group.label); requestAnimationFrame(() => bar.current?.querySelector<HTMLButtonElement>('[role=menu] button')?.focus()); } }}>{group.label}{group.accessKey && <span className="menu-access-key" aria-hidden="true">({group.accessKey})</span>}</button>{open === group.label && <Popup items={group.items} close={() => setOpen(null)} />}</div>)}</nav>;
}
export function ContextMenu({ state, items, close }: { state: ContextMenuState; items: MenuItem[]; close(): void }) {
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: Event) => { if (!wrapper.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', dismiss); window.addEventListener('resize', close); window.addEventListener('scroll', close, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', key); };
  }, [close]);
  return <div ref={wrapper}><Popup items={items} close={close} context={state} /></div>;
}
