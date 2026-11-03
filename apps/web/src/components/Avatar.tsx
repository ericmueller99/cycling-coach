/** "Ada Lovelace" → "AL", "Ada" → "A". */
export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

const SIZE = { 32: 'h-[32px] w-[32px] text-[13px]', 36: 'h-9 w-9 text-sm', 56: 'h-14 w-14 text-xl', 72: 'h-[72px] w-[72px] text-[26px]' };

/** Dark initials circle: 36px in the sidebar, 32px in the mobile top bar, 56/72px on Account. */
export function Avatar({ name, size = 36 }: { name: string; size?: keyof typeof SIZE }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white ${SIZE[size]}`}>
      {initials(name)}
    </span>
  );
}
