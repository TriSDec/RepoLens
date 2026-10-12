const PATHS = {
    folder: 'M3 7.5A1.5 1.5 0 014.5 6h4.2l1.6 2H19.5A1.5 1.5 0 0121 9.5v8a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z',
    zip: 'M6 3h9l4 4v14H6zM14 3v5h5M10 8h2M10 11h2M10 14h2M10 17h2',
    file: 'M7 3h7l4 4v14H7zM14 3v5h4',
    report: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
    search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8',
    close: 'M6 6l12 12M18 6L6 18',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    down: 'M12 5v12M6 12l6 6 6-6',
    sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
    moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
    warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
    check: 'M5 12.5l4.5 4.5L19 7',
    cycle: 'M4 12a8 8 0 0113.6-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.6 5.7L4 15.5M4 20v-4.5h4.5',
    key: 'M14.5 9.5a4 4 0 11-1.2 2.9L4 12.5V15H2v-2.5l10-1.5',
    layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
    target: 'M12 20a8 8 0 100-16 8 8 0 000 16zM12 15a3 3 0 100-6 3 3 0 000 6z',
    box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
    help: 'M12 20a8 8 0 100-16 8 8 0 000 16zM9.7 9.5a2.4 2.4 0 114 1.7c-.8.7-1.7 1.2-1.7 2.3M12 16.5v.5',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    reset: 'M4 12a8 8 0 108-8H8M8 1l-3 3 3 3',
    image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9.5a.5.5 0 100-1 .5.5 0 000 1',
    menu: 'M4 7h16M4 12h16M4 17h16',
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={PATHS[name]} />
        </svg>
    );
}

/** The RepoLens mark: a lens ring with an orbiting node. */
export function Mark({ size = 26 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.4" />
            <ellipse cx="16" cy="16" rx="11" ry="4.6" stroke="currentColor" strokeWidth="1" opacity="0.55" transform="rotate(-24 16 16)" />
            <circle cx="24.4" cy="11.4" r="2.2" fill="var(--accent)" />
            <circle cx="16" cy="16" r="1.5" fill="currentColor" />
        </svg>
    );
}
