/** "claude-opus-5-5" → "Opus 5.5". Anything else is shown as it is. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  const [, family = '', major, minor] = m;
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
}

/** What the build model is doing after a handoff, by the tool that moved the turn there (DECISIONS #110). */
const HANDOFF_WORK: Record<string, string> = {
  propose_plan: 'planning your week',
  propose_calendar_changes: 'working out the changes',
  create_workout: 'building the workout',
};

/** "planning your week", or a generic phrase for a tool without its own. */
export const handoffWork = (tool: string | undefined): string => (tool && HANDOFF_WORK[tool]) || 'taking it from here';
