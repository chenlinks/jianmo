const paths = {
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  plus: 'M12 5v14 M5 12h14', search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  edit: 'm16 3 5 5-12 12-6 1 1-6z M14 5l5 5', check: 'm5 12 4 4L19 6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2 M7 3v6h10V3 M7 21v-8h10v8',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
  settings: 'M4 7h5 M13 7h7 M4 17h9 M17 17h3 M9 4v6 M13 14v6',
  close: 'm6 6 12 12 M6 18 18 6', menu: 'M4 6h16 M4 12h16 M4 18h16',
  outline: 'M9 5h11 M9 12h11 M9 19h11 M4 5h.01 M4 12h.01 M4 19h.01',
  focus: 'M9 3H3v6 M15 3h6v6 M21 15v6h-6 M3 15v6h6',
  export: 'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6', trash: 'M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
} as const;
export type IconName = keyof typeof paths;
export default function Icon({ name }: { name: IconName }) { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }
