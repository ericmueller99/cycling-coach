import { todayIn } from '@cycling-coach/core';
import { getProfile, setSyncedZwift, type Collections } from '@cycling-coach/db';
import { profileSchema, zwiftMetricsSchema, type ZwiftMetrics, type ZwiftStatus } from '@cycling-coach/shared';
import { localLock, type IntegrationResolver, type Lock } from '../integrations';

async function record(c: Collections, userId: string, now: Date, error?: string) {
  await c.integrations.updateOne(
    { userId, provider: 'zwift' },
    error ? { $set: { lastError: error, updatedAt: now } } : { $set: { lastSyncAt: now, updatedAt: now }, $unset: { lastError: '' } },
    { upsert: true },
  );
}

/** A value Zwift sent, if our schema would accept it — anything odd is skipped, not saved. */
const valid = <T>(schema: { safeParse(v: unknown): { success: boolean } }, v: T | undefined) =>
  v !== undefined && schema.safeParse(v).success ? v : undefined;

/**
 * Zwift's own numbers into the profile (DECISIONS #23): zFTP, zMAP, category, Racing Score, and the
 * weight and FTP set in Zwift. Separate from the intervals.icu sync so a Zwift outage never holds
 * up the calendar. A field Zwift didn't send keeps its stored value.
 */
export class ZwiftSync {
  constructor(
    private readonly c: Collections,
    private readonly integrations: Pick<IntegrationResolver, 'zwiftFor'>,
    /** Shared with the events service, so the metrics sync never runs beside an events walk (#56). */
    private readonly zwiftLock: Lock = localLock(),
  ) {}

  /** Whether this athlete has a Zwift login (their own on hosted, the server's for the self-host owner). */
  async connected(userId: string): Promise<boolean> {
    return !!(await this.integrations.zwiftFor(userId));
  }

  async run(userId: string, now: Date, opts: { manual?: boolean } = {}) {
    const client = await this.integrations.zwiftFor(userId);
    if (!client) return null;
    if (opts.manual) client.reset();
    const profile = await getProfile(this.c, userId);
    if (!profile) return null;
    try {
      const s = await this.zwiftLock(() => client.metrics());
      const prev = profile.zwift;
      const metric = (key: 'zftp' | 'zmap' | 'racingScore') => valid(zwiftMetricsSchema.shape[key], s[key]) ?? prev?.[key];
      const zwift: ZwiftMetrics = {
        ...(metric('zftp') !== undefined ? { zftp: metric('zftp') } : {}),
        ...(metric('zmap') !== undefined ? { zmap: metric('zmap') } : {}),
        ...((s.category ?? prev?.category) ? { category: s.category ?? prev?.category } : {}),
        ...(metric('racingScore') !== undefined ? { racingScore: metric('racingScore') } : {}),
        asOf: todayIn(profile.timezone, s.metricsAt ? new Date(s.metricsAt) : now),
        source: 'zwift',
      };
      await setSyncedZwift(
        this.c,
        userId,
        {
          zwift,
          zwiftWeightKg: valid(profileSchema.shape.zwiftWeightKg, s.weightKg),
          ftpZwift: valid(profileSchema.shape.ftpZwift, s.ftp) ?? profile.ftpZwift,
          zwiftId: s.zwiftId,
        },
        now,
      );
      await record(this.c, userId, now);
      return zwift;
    } catch (err) {
      await record(this.c, userId, now, (err as Error).message);
      throw err;
    }
  }

  async status(userId: string): Promise<ZwiftStatus> {
    if (!(await this.connected(userId))) return { status: 'not_configured' };
    const [doc, profile] = await Promise.all([this.c.integrations.findOne({ userId, provider: 'zwift' }), getProfile(this.c, userId)]);
    return {
      status: doc?.lastError ? 'error' : 'connected',
      ...(profile?.zwiftId ? { zwiftId: profile.zwiftId } : {}),
      ...(doc?.lastSyncAt ? { lastSyncAt: doc.lastSyncAt.toISOString() } : {}),
      ...(doc?.lastError ? { lastError: doc.lastError } : {}),
    };
  }
}
