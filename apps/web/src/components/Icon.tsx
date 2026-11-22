/** Square-capped line icons, as drawn in the UI preview. */
const PATHS = {
  board: <><rect x="3" y="3" width="18" height="18" /><path d="M9 3v18M15 3v18" /></>,
  days: <><rect x="3" y="5" width="18" height="16" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  projects: <><rect x="9" y="2" width="6" height="5" /><rect x="2" y="17" width="6" height="5" /><rect x="16" y="17" width="6" height="5" /><path d="M12 7v5M5 17v-5h14v5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  edit: <path d="M16 3l5 5L8 21H3v-5z" />,
  triage: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5 2 12v8h20v-8l-3.5-7z" /></>,
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" /></>,
  in_progress: <><path d="M21 12a9 9 0 1 1-6.2-8.6" /><path d="M12 7v5l3 2" /></>,
  review: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  blocked: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  done: <><rect x="3" y="3" width="18" height="18" /><path d="m8 12 3 3 5-6" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" /><path d="m22 6-10 7L2 6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  external: <><path d="M14 3h7v7M21 3l-9 9" /><path d="M19 14v7H3V5h7" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  work: <><rect x="2" y="7" width="20" height="14" /><path d="M8 7V3h8v4M2 13h20" /></>,
  pause: <path d="M9 5v14M15 5v14" />,
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9z" />,
  play: <path d="M7 4l12 8-12 8z" />,
  terminal: <><rect x="2" y="4" width="20" height="16" /><path d="m6 9 4 3-4 3M12 15h6" /></>,
  pr: <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h5v9M6 9v12" /></>,
  folder: <path d="M2 4h7l2 3h11v13H2z" />,
  branch: <><circle cx="6" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="8" r="3" /><path d="M6 9v6M18 11a6 6 0 0 1-6 6H9" /></>,
  trash: <path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15" />,
  prev: <path d="m15 18-6-6 6-6" />,
  next: <path d="m9 18 6-6-6-6" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className ? `icon ${className}` : 'icon'}
    >
      {PATHS[name]}
    </svg>
  );
}
