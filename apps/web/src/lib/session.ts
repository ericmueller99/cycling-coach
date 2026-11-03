import type { SessionType, Workout } from '@cycling-coach/shared';

/** Session-type colours. */
export const SESSION_STYLE: Record<SessionType, { label: string; fg: string; bg: string; dot: string }> = {
  race: { label: 'Race', fg: '#B42318', bg: 'rgba(239,68,68,.12)', dot: '#EF4444' },
  intervals: { label: 'Intervals', fg: '#B54708', bg: 'rgba(245,120,42,.14)', dot: '#F5782A' },
  openers: { label: 'Openers', fg: '#8A6100', bg: 'rgba(233,184,15,.18)', dot: '#E9B80F' },
  endurance: { label: 'Endurance', fg: '#1D5BBF', bg: 'rgba(59,139,246,.12)', dot: '#3B8BF6' },
  recovery: { label: 'Recovery', fg: '#4B5563', bg: 'rgba(122,132,148,.14)', dot: '#7A8494' },
};

/** Tentative events: race colours, dashed border, transparent background. */
export const TENTATIVE = { fg: '#B42318', bg: 'transparent', border: '#E2A3A3' };

export function durationText(e: { durationLabel?: string | undefined; durationMin?: number | undefined }) {
  if (e.durationLabel) return e.durationLabel;
  if (!e.durationMin) return '';
  return e.durationMin >= 90 ? `${Math.round((e.durationMin / 60) * 10) / 10} h` : `${e.durationMin}m`;
}

/** "Zwift workout", "Zwift race · 17:30 · B", "Ride · 09:00" — what and where. */
export function kindLabel(e: {
  kind: 'workout' | 'race' | 'ride';
  platform?: 'zwift' | 'garmin' | undefined;
  startTime?: string | undefined;
  priority?: 'A' | 'B' | 'C' | undefined;
}) {
  const where = e.platform === 'garmin' ? 'Garmin' : 'Zwift';
  const parts =
    e.kind === 'workout' ? [`${where} workout`, e.startTime] : e.kind === 'race' ? [`${where} race`, e.startTime, e.priority] : ['Ride', e.startTime];
  return parts.filter(Boolean).join(' · ');
}

export function hoursLabel(minutes: number) {
  return minutes ? `${(minutes / 60).toFixed(1)} h` : '—';
}

/** The calendar colour for a library workout, from its category. */
export function sessionTypeFor(workout: Workout): SessionType {
  if (workout.category === 'Endurance') return 'endurance';
  if (workout.category === 'Recovery') return 'recovery';
  if (workout.category === 'Openers') return 'openers';
  return 'intervals';
}
