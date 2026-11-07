import type { IntegrationStatus } from '@cycling-coach/shared';

/** What Coach asks of an athlete without a working intervals.icu connection (DECISIONS #92). */
export interface Nudge {
  kind: 'connect' | 'reconnect';
  /** Another source already brings rides in, so the reason to connect is sending workouts out. */
  hasRides: boolean;
}

/** Undefined when there's nothing to ask, and while either input loads, so the card doesn't flash for someone who is connected. */
export function nudgeFor(status: IntegrationStatus['status'] | undefined, otherSource: boolean | undefined): Nudge | undefined {
  if (status === undefined || otherSource === undefined || status === 'connected') return undefined;
  return { kind: status === 'error' ? 'reconnect' : 'connect', hasRides: otherSource };
}

/** The card's body and the one-line row. */
export function nudgeCopy({ kind, hasRides }: Nudge): { body: string; row: string } {
  if (kind === 'reconnect') {
    return hasRides
      ? { body: 'We can’t reach intervals.icu right now, so your workouts aren’t going on to Zwift.', row: 'Reconnect intervals.icu to send workouts to Zwift' }
      : { body: 'Your coach can’t reach intervals.icu right now, so it’s coaching without your latest rides.', row: 'Reconnect intervals.icu so your coach sees your rides' };
  }
  return hasRides
    ? { body: 'Your coach already sees your rides. Connect intervals.icu to send your workouts to Zwift and other apps.', row: 'Connect intervals.icu to send workouts to Zwift' }
    : {
        body: 'Connect it and your coach sees your rides, fitness and freshness, so it plans around how you’re really doing. Workouts go to your calendar and on to Zwift.',
        row: 'Connect intervals.icu so your coach sees your rides',
      };
}
