import { describe, expect, it } from 'vitest';
import { RequestGate } from './gate';

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => (t += ms),
    sleeps,
  };
}

describe('RequestGate', () => {
  it('spaces request starts by the interval, in order', async () => {
    const clock = fakeClock();
    const gate = new RequestGate({ minIntervalMs: 2000, now: clock.now, sleep: clock.sleep });
    const starts: [string, number][] = [];
    const call = (name: string) => gate.run(async () => void starts.push([name, clock.now()]));
    await Promise.all([call('a'), call('b'), call('c')]);
    expect(starts).toEqual([
      ['a', 0],
      ['b', 2000],
      ['c', 4000],
    ]);
  });

  it('runs one request at a time', async () => {
    const clock = fakeClock();
    const gate = new RequestGate({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    let inFlight = 0;
    let most = 0;
    const call = () =>
      gate.run(async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await Promise.resolve();
        inFlight--;
      });
    await Promise.all([call(), call(), call(), call()]);
    expect(most).toBe(1);
  });

  it('does not wait when the last request was long enough ago', async () => {
    const clock = fakeClock();
    const gate = new RequestGate({ minIntervalMs: 2000, now: clock.now, sleep: clock.sleep });
    await gate.run(async () => {});
    clock.advance(5000);
    await gate.run(async () => {});
    expect(clock.sleeps).toEqual([]);
  });

  it('keeps going after a failed request', async () => {
    const clock = fakeClock();
    const gate = new RequestGate({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    const failed = gate.run(async () => {
      throw new Error('429');
    });
    const next = gate.run(async () => 'ok');
    await expect(failed).rejects.toThrow('429');
    await expect(next).resolves.toBe('ok');
    expect(clock.sleeps).toEqual([1000]);
  });
});

describe('RequestGate pause', () => {
  it('holds queued requests until a rate limit has passed', async () => {
    const clock = fakeClock();
    const gate = new RequestGate({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    await gate.run(async () => {});
    gate.pause(60_000);
    expect(gate.resumesAt()).toBe(60_000);
    const started: number[] = [];
    await gate.run(async () => void started.push(clock.now()));
    expect(started).toEqual([60_000]);
    expect(gate.resumesAt()).toBeUndefined();
  });
});
