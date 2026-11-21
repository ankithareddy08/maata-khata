// One consistent 24px stroke icon set (no emoji), so every glyph has the same weight.
const paths = {
  mic: <><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5 10.5v1a7 7 0 0 0 14 0v-1M12 18.5V21.5" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  speaker: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  received: <><path d="M17 7 7 17" /><path d="M16 17H7V8" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" /></>,
  device: <><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M11 18h2" /></>,
  sparkle: <path d="M12 3.5 13.8 9a2 2 0 0 0 1.3 1.3L20.5 12l-5.4 1.8a2 2 0 0 0-1.3 1.3L12 20.5l-1.8-5.4a2 2 0 0 0-1.3-1.3L3.5 12l5.4-1.8A2 2 0 0 0 10.2 9L12 3.5Z" />,
  whatsapp: <><path d="M4 20l1.2-4.1A8.5 8.5 0 1 1 8.4 19L4 20Z" /><path d="M9 8.8c0 3.3 2.9 6.2 6.2 6.2l1.3-1.6-2-1-1 .9c-1.2-.5-2.3-1.6-2.8-2.8l.9-1-1-2L9 8.8Z" fill="currentColor" stroke="none" /></>,
  ledger: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5v-16Z" /><path d="M5 20.5A1.5 1.5 0 0 0 6.5 22H19M9 8h6M9 12h4" /></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
