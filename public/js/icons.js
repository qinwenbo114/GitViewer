const paths = {
  logo: `
    <circle cx="6" cy="6" r="2.6" />
    <circle cx="6" cy="18" r="2.6" />
    <circle cx="18" cy="7" r="2.6" />
    <path d="M6 8.6v6.8" />
    <path d="M18 9.6c0 4.4-4.2 4.2-7.2 4.8-2.2.4-3.6 1.2-3.6 1.2" />
  `,
  branch: `
    <circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="9" r="2.4" />
    <path d="M6 8.4v7.2" /><path d="M18 11.4c0 4.1-4.2 3.8-7.4 4.4-2 .4-3.2 1-3.2 1" />
  `,
  commit: `<circle cx="12" cy="12" r="3.2" /><path d="M3 12h5.8M15.2 12H21" />`,
  merge: `
    <circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="6" cy="6" r="2.4" />
    <path d="M6 8.4v7.2" /><path d="M8.4 6h7.2" /><path d="M18 8.4v2.1c0 3.2-2.6 5.5-6 5.5H8.4" />
  `,
  rebase: `
    <circle cx="6" cy="18" r="2.4" /><circle cx="6" cy="6" r="2.4" /><path d="M6 8.4v7.2" />
    <path d="M12 6h7M12 12h7M12 18h7" /><path d="m16 3 3 3-3 3M16 15l3 3-3 3" />
  `,
  refresh: `<path d="M20 11a8 8 0 1 0-2.2 5.5" /><path d="M20 5v6h-6" />`,
  fetch: `
    <path d="M12 3v10" /><path d="m8 9 4 4 4-4" />
    <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
  `,
  pull: `<path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" />`,
  push: `<path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M4 3h16" />`,
  search: `<circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" />`,
  settings: `
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.36a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9c.15.38.4.7.74.93.3.2.66.31 1.02.31H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
  `,
  folder: `<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h7A2.5 2.5 0 0 1 20 10.5v6A2.5 2.5 0 0 1 17.5 19h-12A2.5 2.5 0 0 1 3 16.5Z" />`,
  folderOpen: `<path d="M3 8V6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h7A2.5 2.5 0 0 1 20 9.5V10" /><path d="M3.5 10h17l-2 8.2a1.5 1.5 0 0 1-1.46 1.1H4.9a1.5 1.5 0 0 1-1.46-1.1Z" />`,
  file: `<path d="M6 3h7l5 5v13H6z" /><path d="M13 3v5h5" />`,
  tag: `<path d="M4 4h7l9 9-7 7-9-9Z" /><circle cx="8.5" cy="8.5" r="1.3" />`,
  stash: `
    <rect x="3" y="4" width="18" height="4" rx="1.2" />
    <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  `,
  stashApply: `
    <rect x="3" y="4" width="18" height="4" rx="1.2" />
    <path d="M5 8v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M12 17v-5" /><path d="m9.5 14 2.5-2.5L14.5 14" />
  `,
  terminal: `<rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" />`,
  plus: `<path d="M12 5v14M5 12h14" />`,
  minus: `<path d="M5 12h14" />`,
  check: `<path d="m5 12 4.5 4.5L19 7" />`,
  x: `<path d="m6 6 12 12M18 6 6 18" />`,
  chevronDown: `<path d="m6 9 6 6 6-6" />`,
  chevronRight: `<path d="m9 6 6 6-6 6" />`,
  chevronLeft: `<path d="m15 6-6 6 6 6" />`,
  arrowLeft: `<path d="M19 12H5" /><path d="m11 6-6 6 6 6" />`,
  more: `<circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" />`,
  trash: `<path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="m6 7 1 13h10l1-13" /><path d="M10 11v5M14 11v5" />`,
  undo: `<path d="M9 7 4 12l5 5" /><path d="M4 12h9a6 6 0 0 1 6 6v1" />`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />`,
  external: `<path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />`,
  clock: `<circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.2 2" />`,
  user: `<circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.4 3.5-5 7-5s6.2 1.6 7 5" />`,
  users: `<circle cx="9" cy="8" r="3.2" /><path d="M3 19c.7-3 3-4.6 6-4.6s5.3 1.6 6 4.6" /><path d="M16 5.2a3 3 0 0 1 0 5.8M18 14.6c2 .6 3.3 2 3.8 4.4" />`,
  alert: `<path d="M12 3 2.8 20h18.4Z" /><path d="M12 9v5" /><circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none" />`,
  info: `<circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none" />`,
  history: `<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 4.5V9H8" /><path d="M12 7.5V12l3 1.8" />`,
  blame: `<circle cx="9" cy="8" r="3.2" /><path d="M3 19c.7-3 3-4.6 6-4.6 1.4 0 2.8.4 3.9 1.2" /><path d="m14 17 2 2 4-4" />`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" />`,
  upload: `<path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 20h16" />`,
  download: `<path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" />`,
  edit: `<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16Z" /><path d="m13.5 6.5 4 4" />`,
  link: `<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6" /><path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7L12.5 18" />`,
  server: `<rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><circle cx="7" cy="7" r=".9" fill="currentColor" stroke="none" /><circle cx="7" cy="17" r=".9" fill="currentColor" stroke="none" />`,
  sun: `<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />`,
  moon: `<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />`,
  dot: `<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />`,
  filter: `<path d="M3 5h18l-7 8v5l-4 2v-7Z" />`,
  list: `<path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />`,
  columns: `<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" />`,
  rows: `<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" />`,
  play: `<path d="M8 5.5v13l10-6.5Z" />`,
  pause: `<path d="M8 5v14M16 5v14" />`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="1.5" />`,
  warning: `<circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none" />`,
  git: `<circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" />`,
  panel: `<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />`,
  keyboard: `<rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13h.01M9.5 13h.01M13 13h.01M16.5 13h.01M8 16h8" />`,
  archive: `<rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" /><path d="M10 13h4" />`,
  sparkle: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" />`,
  inbox: `<path d="M4 4h16v16H4Z" /><path d="M4 14h4l2 3h4l2-3h4" />`,
  signout: `<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 8l-4 4 4 4M6 12h10" />`,
};

export const iconNames = Object.keys(paths);

export function icon(name, size = 16, cls = '') {
  const body = paths[name] || paths.dot;
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function logo(size = 28) {
  return `<svg class="logo-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><circle cx="18" cy="7" r="2.6" />
    <path d="M6 8.6v6.8" /><path d="M18 9.6c0 4.4-4.2 4.2-7.2 4.8-2.2.4-3.6 1.2-3.6 1.2" />
  </svg>`;
}
