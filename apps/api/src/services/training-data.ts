import type { TrainingDataPort } from '@cycling-coach/coach';
import { fitnessDays, stepDays, weighInsFrom, type WeighIn } from '@cycling-coach/core';
import {
  getStoredActivity,
  latestFitnessDay,
  listActivities,
  listWellness,
  saveActivityCurve,
  saveActivityDetail,
  searchActivities,
  type Collections,
} from '@cycling-coach/db';
import type { Activity, ActivityDetail, FitnessDay, IsoDate, PowerCurve, PowerCurvePeriod, StepDay } from '@cycling-coach/shared';
import type { IntegrationResolver } from '../integrations';

/**
 * Training data as the app and the coach read it: from our own copy, which the intervals.icu sync
 * keeps (DECISIONS #49). Nothing here calls intervals.icu, except to fill in one ride's detail the
 * first time it's needed before the sync got to it.
 */
export class TrainingData {
  constructor(
    private readonly c: Collections,
    private readonly integrations: Pick<IntegrationResolver, 'intervalsFor'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  activities(userId: string, from: IsoDate, to: IsoDate): Promise<Activity[]> {
    return listActivities(this.c, userId, from, to);
  }

  /**
   * One ride with its detected intervals (and its power curve if asked). Normally all stored; a
   * ride the sync hasn't fetched detail for yet is fetched now, once, and kept.
   */
  async detail(userId: string, id: string, opts: { powerCurve?: boolean } = {}): Promise<ActivityDetail | null> {
    const stored = await getStoredActivity(this.c, userId, id);
    if (!stored) return null;
    let { activity, intervals, powerCurve } = stored;
    const icu = !stored.hasDetail || (opts.powerCurve && !powerCurve) ? await this.integrations.intervalsFor(userId) : null;
    if (!stored.hasDetail && icu) {
      try {
        const fresh = await icu.activityDetail(id);
        await saveActivityDetail(this.c, userId, fresh.activity, fresh.intervals, this.now());
        ({ activity, intervals } = fresh);
      } catch (err) {
        console.warn('intervals.icu ride detail failed', id, (err as Error).message);
      }
    }
    if (opts.powerCurve && !powerCurve && icu) {
      try {
        powerCurve = await icu.activityPowerCurve(id);
        await saveActivityCurve(this.c, userId, id, powerCurve);
      } catch (err) {
        console.warn('intervals.icu ride power curve failed', id, (err as Error).message);
      }
    }
    return { activity, intervals: intervals ?? [], ...(opts.powerCurve && powerCurve?.length ? { powerCurve } : {}) };
  }

  async fitness(userId: string, from: IsoDate, to: IsoDate): Promise<FitnessDay[]> {
    return fitnessDays(await listWellness(this.c, userId, from, to));
  }

  /** Today's fitness, or the latest day before it (today's row lands once intervals.icu computes it). */
  async fitnessOn(userId: string, date: IsoDate): Promise<FitnessDay | undefined> {
    const day = await latestFitnessDay(this.c, userId, date);
    const fitness = day ? fitnessDays([day])[0] : undefined;
    return fitness ? { ...fitness, date } : undefined;
  }

  async steps(userId: string, from: IsoDate, to: IsoDate): Promise<StepDay[]> {
    return stepDays(await listWellness(this.c, userId, from, to));
  }

  async weighIns(userId: string, from: IsoDate, to: IsoDate): Promise<WeighIn[]> {
    return weighInsFrom(await listWellness(this.c, userId, from, to));
  }

  async powerCurves(userId: string, periods: readonly PowerCurvePeriod[]): Promise<PowerCurve[]> {
    const doc = await this.c.integrations.findOne({ userId, provider: 'intervals_icu' }, { projection: { curves: 1 } });
    return (doc?.curves ?? []).filter((c) => periods.includes(c.period));
  }

  /** The coach's training tools, over the stored copy. */
  port(userId: string): TrainingDataPort {
    return {
      listActivities: ({ start, end }) => this.activities(userId, start, end),
      searchActivities: (query) => searchActivities(this.c, userId, query),
      getActivityDetail: async (id, { powerCurve }) => {
        const d = await this.detail(userId, id, { powerCurve });
        if (!d) throw new Error(`No ride ${id} — use an id from get_recent_activities or search_activities.`);
        return d;
      },
      getPowerCurves: (periods) => this.powerCurves(userId, periods),
      getFitness: ({ start, end }) => this.fitness(userId, start, end),
    };
  }
}
