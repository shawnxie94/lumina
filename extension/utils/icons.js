const svg = (paths) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  settings: svg('<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.04.04a2 2 0 0 1-1.42 3.42h-.1a1.7 1.7 0 0 0-1.66 1.18l-.02.07a2 2 0 0 1-3.83 0l-.02-.07a1.7 1.7 0 0 0-1.66-1.18h-.1a2 2 0 0 1-1.42-3.42l.04-.04A1.7 1.7 0 0 0 4.6 15a2 2 0 0 1 0-6 1.7 1.7 0 0 0-.34-1.87l-.04-.04A2 2 0 0 1 5.64 3.67h.1a1.7 1.7 0 0 0 1.66-1.18l.02-.07a2 2 0 0 1 3.83 0l.02.07a1.7 1.7 0 0 0 1.66 1.18h.1a2 2 0 0 1 1.42 3.42l-.04.04A1.7 1.7 0 0 0 19.4 9a2 2 0 0 1 0 6Z" />'),
  lock: svg('<rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />'),
  refresh: svg('<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4" /><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4" /><path d="M3 5v4h4" /><path d="M21 19v-4h-4" />'),
  doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" />'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 1 0-7.07-7.07L10 5" /><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L14 19" />'),
  clock: svg('<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />'),
  pen: svg('<path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />'),
  warning: svg('<path d="M10.3 3.2 1.9 17a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" />'),
  tag: svg('<path d="M20 10V6a2 2 0 0 0-2-2h-4l-8 8a2 2 0 0 0 0 2.83l3.17 3.17a2 2 0 0 0 2.83 0l8-8Z" /><circle cx="15" cy="7" r="1.5" />'),
  list: svg('<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />'),
  book: svg('<path d="M4 5a3 3 0 0 1 3-3h13v18H7a3 3 0 0 0-3 3V5Z" /><path d="M7 2v18" />'),
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 4h14l3 8v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7Z" />'),
};
