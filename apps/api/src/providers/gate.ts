export interface RequestGateOptions {
  /** Minimum time between the starts of two requests. */
  minIntervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Every request to Zwift (DECISIONS #29) and to intervals.icu (#49) goes through one of these: one
 * at a time, first come first served, at least `minIntervalMs` apart. A failed request doesn't
 * stall the queue. It's the only thing between a bug and hundreds of calls on the athlete's account, so
 * nothing bypasses it. `pause` holds every queued request until a rate limit has passed.
 */
export class RequestGate {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  private pausedUntil = -Infinity;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: RequestGateOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = Math.max(this.lastStart + this.opts.minIntervalMs, this.pausedUntil) - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      return fn();
    });
    this.tail = result.catch(() => {});
    return result;
  }

  /** No request starts for `ms` from now (a 429's Retry-After). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  /** When requests may start again, if a pause is in force. */
  resumesAt(): number | undefined {
    return this.pausedUntil > this.now() ? this.pausedUntil : undefined;
  }
}
