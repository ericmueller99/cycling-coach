/** "claude-opus-5-5" → "Opus 5.5". Anything else is shown as it is. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  const [, family = '', major, minor] = m;
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
}
