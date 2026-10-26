/** Icon paths from the design showcase (shell.js), 24×24 stroke icons. */
const ICON_PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  paperclip: 'M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l7.6-7.6a3.3 3.3 0 0 1 4.7 4.7l-7.6 7.6a1.7 1.7 0 0 1-2.4-2.4L14.7 7.2',
  plus: 'M12 5v14M5 12h14',
  gauge: 'M4.6 18A9 9 0 1 1 19.4 18M12 14l4-4M12 14h.01',
  quote: 'M5 11h5v6H5zM5 11c0-3 1.5-5 4-6M14 11h5v6h-5zM14 11c0-3 1.5-5 4-6',
  minus: 'M5 12h14',
  flow: 'M3 3h7v6H3zM14 15h7v6h-7zM6.5 9v2.5A3.5 3.5 0 0 0 10 15h4',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  inbox: 'M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1.5 2.5h5L16 13h5',
  server: 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01',
  tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3.6 17.4a2 2 0 0 0 2.8 2.8l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  users:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c.7-3.6 3.6-6 7-6s6.3 2.4 7 6M16 3.5a4 4 0 0 1 0 7.5M18.5 14.5c1.8.9 3 2.9 3.5 6',
  team: 'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 20c.5-3 3-5 6-5s5.5 2 6 5M5.5 11a2.5 2.5 0 1 1 0-5M18.5 11a2.5 2.5 0 1 0 0-5M2 18c.3-2 1.4-3.4 3-4M22 18c-.3-2-1.4-3.4-3-4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  chevRight: 'M9 6l6 6-6 6',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  git: 'M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 9v6',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  sparkle: 'M12 3l1.8 5.6L19.5 10l-5.7 1.6L12 17l-1.8-5.4L4.5 10l5.7-1.4z',
  // The app icon's rising flow (apps/desktop/build/icon.svg): three linked nodes.
  logo: 'M5 19.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM12 15.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM19 8.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM6.9 15.9l3.2-1.8M13.6 11.4l3.6-3.6',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l13 8-13 8z',
  skip: 'M5 5l10 7-10 7zM19 5v14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  stop: 'M6 6h12v12H6z',
  chart: 'M3 3v18h18M8 16v-5M13 16V7M18 16v-8',
  book: 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  slides: 'M3 4h18v12H3zM12 16v4M8 20h8M7 8h6M7 11h10',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  split: 'M6 3v6a6 6 0 0 0 6 6h6M6 21v-6M15 12l3 3-3 3',
  chevLeft: 'M15 6l-6 6 6 6',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  chevDown: 'M6 9l6 6 6-6',
  merge: 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21V9a9 9 0 0 0 9 9',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  chevron: 'M9 6l6 6-6 6',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
} as const;
export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size }: { name: IconName; size?: 'sm' | 'lg' }) {
  return (
    <svg className={size === undefined ? 'i' : `i ${size}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
