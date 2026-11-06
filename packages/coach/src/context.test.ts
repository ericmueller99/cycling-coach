import type { CalendarEvent, SessionFeedback } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { buildSystemSnapshot, renderAthleteBlock, renderCalendarBlock, renderShortTermBlock, renderTurnContext } from './context';
import { feedbackRollup, formatActivityForModel, formatFeedbackForModel } from './tools';

const ctx = (zwift?: object) =>
  ({
    profile: { ftpZwift: 345, weightKg: 84.3, zwiftWeightKg: 83, weightSource: 'manual', timezone: 'America/Denver', ...(zwift ? { zwift } : {}) },
    powerBests: [],
    goals: [],
    memories: [],
    shortTerm: [],
    workouts: [],
  }) as unknown as Parameters<typeof renderAthleteBlock>[0];

describe('renderAthleteBlock — dates, preference and availability (DECISIONS #86)', () => {
  const withGoals = (goals: object[], profile: object = {}) => {
    const base = ctx();
    return renderAthleteBlock({ ...base, profile: { ...base.profile, ...profile }, goals } as unknown as Parameters<typeof renderAthleteBlock>[0]);
  };
  const long = { horizon: 'long', done: false, primary: false };

  it('gives an event its date and a weight goal its deadline', () => {
    const block = withGoals([
      { ...long, title: 'Get ready for Gran Fondo', event: true, targetDate: '2027-06-12' },
      { ...long, title: 'Race weight', measure: { kind: 'weight' }, target: 72, targetDate: '2027-03-01' },
    ]);
    expect(block).toContain('Get ready for Gran Fondo — event date 2027-06-12');
    expect(block).toContain('reach by 2027-03-01');
  });

  it('leaves out the date and label an older open-ended goal still has', () => {
    const block = withGoals([{ ...long, title: 'Raise my FTP', targetDate: '2027-03-01', targetLabel: 'Sept 2027' }]);
    expect(block).toContain('Raise my FTP');
    expect(block).not.toContain('2027');
  });

  it('shows the preference only once there is one', () => {
    expect(withGoals([], { trainingPreference: 'all_in' })).toContain('Training preference: All in');
    expect(withGoals([])).not.toContain('Training preference');
  });

  it('says how the coach learns availability', () => {
    expect(withGoals([])).toContain('Availability: they tell you as they chat');
    const block = withGoals([], { usualWeek: { days: ['tue', 'thu', 'sat'], hoursPerWeek: 8 } });
    expect(block).toContain('Usual week: Tue, Thu, Sat · about 8 h');
    expect(block).not.toContain('Availability:');
    expect(withGoals([], { usualWeek: { days: [], hoursPerWeek: 8 } })).toContain('Usual week: about 8 h');
  });
});

describe('renderAthleteBlock — Zwift race metrics', () => {
  it('gives zFTP/zMAP W/kg, the category and what A takes, with Racing Score as context only', () => {
    const block = renderAthleteBlock(ctx({ zftp: 330, zmap: 420, category: 'B', racingScore: 512, asOf: '2026-10-28', source: 'zwift' }));
    expect(block).toContain(
      'Zwift race metrics (as of 2026-10-28, synced from Zwift): zFTP 330 W = 3.98 W/kg · zMAP 420 W = 5.06 W/kg on Zwift weight 83 kg → category B. A needs zFTP 4.2 W/kg (349 W) or zMAP 5.1 W/kg (424 W). Racing Score 512 (results-based; not a training target).',
    );
  });

  it('says nothing without zFTP or zMAP', () => {
    expect(renderAthleteBlock(ctx())).not.toContain('Zwift race metrics');
    expect(renderAthleteBlock(ctx({ racingScore: 512, asOf: '2026-10-28', source: 'manual' }))).not.toContain('Zwift race metrics');
  });
});

describe('renderAthleteBlock — name', () => {
  it('opens with the account name, and leaves it out when there is none', () => {
    expect(renderAthleteBlock({ ...ctx(), name: 'Alex Rider' }).split('\n').slice(0, 2)).toEqual(['# Athlete', 'Name: Alex Rider']);
    expect(renderAthleteBlock(ctx())).not.toContain('Name:');
  });
});

const rating = (over: Partial<SessionFeedback> = {}): SessionFeedback => ({
  id: 'f1',
  eventId: 'e1',
  activityId: 'i9',
  date: '2026-10-31',
  title: 'VO2 5x4',
  workoutId: 'w1',
  rpe: 4,
  note: 'First two felt easy.',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('renderCalendarBlock — ride ratings', () => {
  const done = { id: 'e1', date: '2026-10-31', kind: 'workout', type: 'intervals', title: 'VO2 5x4', durationMin: 64, tentative: false, status: 'done', source: 'coach', intervals: { eventId: 1 } } as CalendarEvent;

  it('adds how a rated session felt, and nothing for unrated ones', () => {
    const rated = renderCalendarBlock([done], '2026-10-24', '2026-11-14', [rating()]);
    expect(rated).toContain('VO2 5x4 · 64 min · done, on intervals.icu · felt: RPE 4/10 (Easy) · "First two felt easy."');
    expect(renderCalendarBlock([done], '2026-10-24', '2026-11-14')).not.toContain('felt:');
    // A rating of an unplanned ride isn't a calendar session.
    expect(renderCalendarBlock([done], '2026-10-24', '2026-11-14', [rating({ eventId: undefined })])).not.toContain('felt:');
  });

  it('says when a session was ridden in pieces', () => {
    const grouped = { ...done, activityId: 'i1', extraActivityIds: ['i2'] } as CalendarEvent;
    expect(renderCalendarBlock([grouped], '2026-10-24', '2026-11-14')).toContain('· done (2 rides), on intervals.icu');
  });
});

describe('ride ratings in tool output', () => {
  it('puts the rating on the activity line', () => {
    const line = formatActivityForModel(
      { id: 'i9', name: 'Zwift - VO2 5x4', type: 'VirtualRide', startLocal: '2026-10-31T07:00:00', distanceM: 30000, movingSec: 4320, elapsedSec: 4320, trainingLoad: 86 },
      rating({ rpe: 7, note: undefined }),
    );
    expect(line).toBe('i9 · 2026-10-31 07:00 · VirtualRide · Zwift - VO2 5x4 · 1:12:00 moving · 30.0 km · load 86 · felt: RPE 7/10 (Hard)');
  });

  it('rolls ratings up per library workout, newest first', () => {
    const ratings = [rating({ rpe: 4 }), rating({ id: 'f2', rpe: 5, eventId: 'e0' }), rating({ id: 'f3', title: 'Z2 spin', workoutId: undefined, eventId: undefined, rpe: 2 })];
    expect(feedbackRollup(ratings)).toEqual(['- VO2 5x4 (workout w1): 2 rated, RPE 4, 5 (newest first)', '- Z2 spin: 1 rated, RPE 2']);
    expect(formatFeedbackForModel(ratings[2]!)).toBe('2026-10-31 · Z2 spin · RPE 2/10 (Very easy) · "First two felt easy." · unplanned ride, activity i9');
  });
});

describe('renderAthleteBlock — FTP not known yet (DECISIONS #62)', () => {
  it('tells the coach to prescribe by feel and lists workout targets as % of FTP', () => {
    const base = ctx() as unknown as { profile: Record<string, unknown>; workouts: unknown[] };
    const { ftpZwift: _f, ...profile } = base.profile;
    const block = renderAthleteBlock({
      ...base,
      profile,
      workouts: [{ id: 'w1', name: 'Steady', category: 'Endurance', inZwift: false, segments: [{ kind: 'steady', durSec: 1200, pct: 70 }] }],
    } as unknown as Parameters<typeof renderAthleteBlock>[0]);
    expect(block).toContain('FTP: not known yet');
    expect(block).not.toContain('Zones at Zwift FTP');
    expect(block).toContain('70%');
    expect(block).not.toMatch(/\d+ W\b.*Steady|Steady.* \d+ W/);
  });
});

describe('renderTurnContext calendar', () => {
  const base = { today: '2026-11-03', localTime: '9:14 PM', timezone: 'UTC', training: 'connected', athleteBlock: 'athlete', shortTermBlock: '' } as const;
  const calendar = (from: string, to: string, body: string) => `# Calendar ${from} → ${to} (id · date)\n${body}`;

  it('calls the calendar unchanged when only the window moved', () => {
    const text = renderTurnContext({
      ...base,
      calendarBlock: calendar('2026-10-27', '2026-11-17', '- e1 · Tue'),
      seen: { athlete: 'athlete', calendar: calendar('2026-10-26', '2026-11-16', '- e1 · Tue') },
    });
    expect(text).toContain('Calendar: unchanged');
  });

  it('repeats it when a session changed', () => {
    const block = calendar('2026-10-27', '2026-11-17', '- e2 · Wed');
    const text = renderTurnContext({ ...base, calendarBlock: block, seen: { athlete: 'athlete', calendar: calendar('2026-10-27', '2026-11-17', '- e1 · Tue') } });
    expect(text).toContain(block);
  });

  it('shows it the first time', () => {
    const block = calendar('2026-10-27', '2026-11-17', 'Nothing scheduled.');
    expect(renderTurnContext({ ...base, calendarBlock: block, seen: { athlete: 'athlete' } })).toContain(block);
  });

  it('adds the deployment’s context, but only when it changed', () => {
    const block = calendar('2026-10-27', '2026-11-17', '- e1');
    expect(renderTurnContext({ ...base, calendarBlock: block, seen: { athlete: 'athlete' }, extra: 'Readiness: HRV 52 ms.' })).toContain('Readiness: HRV 52 ms.');
    expect(renderTurnContext({ ...base, calendarBlock: block, seen: { athlete: 'athlete', extra: 'Readiness: HRV 52 ms.' }, extra: 'Readiness: HRV 52 ms.' })).not.toContain('HRV');
    expect(renderTurnContext({ ...base, calendarBlock: block, seen: { athlete: 'athlete', extra: 'Readiness: HRV 52 ms.' }, extra: 'Readiness: HRV 40 ms.' })).toContain('HRV 40 ms');
  });

  it('adds a note from the deployment', () => {
    const block = calendar('2026-10-27', '2026-11-17', '- e1');
    expect(renderTurnContext({ ...base, calendarBlock: block, seen: { athlete: 'athlete' }, coachNote: 'Allowance used up.' })).toContain('Allowance used up.');
  });
});

describe('short-term notes (DECISIONS #79)', () => {
  const base = { today: '2026-11-04', localTime: '9:14 PM', timezone: 'UTC', training: 'connected', athleteBlock: 'athlete', calendarBlock: '# Calendar\n- e1' } as const;
  const note = { id: 'm1', text: "Away for work Wed Nov 11, can't train", until: '2026-11-11', source: 'coach', createdAt: '' } as const;
  const block = renderShortTermBlock([note]);

  it('gives each note its id and date and says the list is complete', () => {
    expect(block).toContain("- m1 (until Wed Nov 11): Away for work Wed Nov 11, can't train");
    expect(block).toContain('full current list');
  });

  it('is empty with no notes', () => {
    expect(renderShortTermBlock([])).toBe('');
  });

  it('sends the list when the coach has not seen it, then leaves it out', () => {
    expect(renderTurnContext({ ...base, shortTermBlock: block, seen: { athlete: 'athlete' } })).toContain(block);
    expect(renderTurnContext({ ...base, shortTermBlock: block, seen: { athlete: 'athlete', shortTerm: block } })).not.toContain('Short-term');
  });

  it('sends it again when a note is added or changes', () => {
    const changed = renderShortTermBlock([{ ...note, until: '2026-11-12' }]);
    expect(renderTurnContext({ ...base, shortTermBlock: changed, seen: { athlete: 'athlete', shortTerm: block } })).toContain('until Thu Nov 12');
  });

  it('says so when the last note has gone', () => {
    expect(renderTurnContext({ ...base, shortTermBlock: '', seen: { athlete: 'athlete', shortTerm: block } })).toContain('Short-term notes: none current');
  });

  it('says nothing to a thread that never had any', () => {
    expect(renderTurnContext({ ...base, shortTermBlock: '', seen: { athlete: 'athlete' } })).not.toContain('Short-term');
    expect(renderTurnContext({ ...base, shortTermBlock: '', seen: { athlete: 'athlete', shortTerm: '' } })).not.toContain('Short-term');
  });

  it('never reaches the block a thread freezes', () => {
    const athlete = { ...ctx(), shortTerm: [note] };
    expect(buildSystemSnapshot(athlete).join('\n')).not.toContain('Away for work');
  });
});

describe('the athlete block stays the same when only the trend weight moves', () => {
  const bests = [{ durationSec: 300, period: '90d', watts: 405, date: '2026-04-01', source: 'intervals.icu' }];
  const weightGoal = { id: 'g1', horizon: 'long', title: 'Race weight', measure: { kind: 'weight' }, target: 72, progress: { current: 84.3, target: 72, unit: 'kg', fraction: 0.8, label: 'Trend weight', onTrendWeight: true } };
  const athlete = (kg: number) => {
    const base = ctx() as unknown as { profile: object };
    return {
      ...base,
      powerBests: bests,
      goals: [{ ...weightGoal, progress: { ...weightGoal.progress, current: kg } }],
      profile: { ...base.profile, weightKg: kg },
    } as unknown as Parameters<typeof renderAthleteBlock>[0];
  };

  it('renders identical text at two trend weights', () => {
    expect(renderAthleteBlock(athlete(84.3))).toBe(renderAthleteBlock(athlete(83.9)));
  });

  it('prints power bests as watts and date', () => {
    expect(renderAthleteBlock(athlete(84.3))).toContain('5 min 405 W (Apr 1)');
  });

  it('keeps the target of a goal on trend weight and points at the context message', () => {
    expect(renderAthleteBlock(athlete(84.3))).toContain('Trend weight target 72 kg, current value from the weight in the context message');
  });

  it('still shows the current value of a goal that does not follow the trend', () => {
    const ftp = { ...weightGoal, measure: { kind: 'ftp' }, progress: { current: 345, target: 360, unit: 'W', fraction: 0.95, label: 'FTP' } };
    expect(renderAthleteBlock({ ...athlete(84.3), goals: [ftp] } as unknown as Parameters<typeof renderAthleteBlock>[0])).toContain('FTP now 345 W, target 360');
  });
});
