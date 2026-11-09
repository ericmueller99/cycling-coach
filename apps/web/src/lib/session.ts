import { formatRange, formatShortDate } from '@cycling-coach/core';
import { EVENT_TYPE_SHORT, type EventInfo, type SessionType, type TimeOff, type TimeOffKind, type Workout } from '@cycling-coach/shared';

/** Session-type colours. */
export const SESSION_STYLE: Record<SessionType, { label: string; fg: string; bg: string; dot: string }> = {
  race: { label: 'Race', fg: '#B42318', bg: 'rgba(239,68,68,.12)', dot: '#EF4444' },
  intervals: { label: 'Intervals', fg: '#B54708', bg: 'rgba(245,120,42,.14)', dot: '#F5782A' },
  openers: { label: 'Openers', fg: '#8A6100', bg: 'rgba(233,184,15,.18)', dot: '#E9B80F' },
  endurance: { label: 'Endurance', fg: '#1D5BBF', bg: 'rgba(59,139,246,.12)', dot: '#3B8BF6' },
  recovery: { label: 'Recovery', fg: '#4B5563', bg: 'rgba(122,132,148,.14)', dot: '#7A8494' },
};

/** Time off colours. Apart from `SESSION_STYLE`, which feeds the intensity picker and the legend. */
export const TIME_OFF_STYLE: Record<TimeOffKind, { fg: string; bg: string; dot: string }> = {
  vacation: { fg: '#0E7468', bg: '#E6F6F4', dot: '#14A394' },
  sick: { fg: '#5925DC', bg: '#F4F3FF', dot: '#7A5AF8' },
};

/** "Nov 9", or "Nov 9 – Nov 15". */
export const timeOffDates = (t: Pick<TimeOff, 'startDate' | 'endDate'>) => (t.startDate === t.endDate ? formatShortDate(t.startDate) : formatRange(t.startDate, t.endDate));

/** Tentative events: race colours, dashed border, transparent background. */
export const TENTATIVE = { fg: '#B42318', bg: 'transparent', border: '#E2A3A3' };

export function durationText(e: { durationLabel?: string | undefined; durationMin?: number | undefined }) {
  if (e.durationLabel) return e.durationLabel;
  if (!e.durationMin) return '';
  return e.durationMin >= 90 ? `${Math.round((e.durationMin / 60) * 10) / 10} h` : `${e.durationMin}m`;
}

/**
 * "Zwift workout", "Zwift race · 17:30 · B", "Gran fondo · 07:00 · A", "Ride · 09:00" — what and
 * where. A real-world event goes by its type; an outdoor race without details is an "Outdoor race".
 */
export function kindLabel(e: {
  kind: 'workout' | 'race' | 'ride';
  platform?: 'zwift' | 'garmin' | undefined;
  startTime?: string | undefined;
  priority?: 'A' | 'B' | 'C' | undefined;
  eventInfo?: EventInfo | undefined;
}) {
  const where = e.platform === 'garmin' ? 'Garmin' : 'Zwift';
  const race = e.eventInfo ? EVENT_TYPE_SHORT[e.eventInfo.type] : e.platform === 'garmin' ? 'Outdoor race' : 'Zwift race';
  const parts = e.kind === 'workout' ? [`${where} workout`, e.startTime] : e.kind === 'race' ? [race, e.startTime, e.priority] : ['Ride', e.startTime];
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
