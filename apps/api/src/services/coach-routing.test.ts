import { describe, expect, it } from 'vitest';
import { routeStartOf, warmFollowUp } from './coach';

const start = new Date('2026-11-03T10:00:00Z');
const after = (ms: number) => new Date(start.getTime() + ms);

describe('warmFollowUp', () => {
  it('is true just after a build, while its cache is warm', () => {
    expect(warmFollowUp({ lastBuildStartedAt: start }, after(4 * 60_000))).toBe(true);
  });

  it('counts from when the call started, and stops at five minutes', () => {
    expect(warmFollowUp({ lastBuildStartedAt: start }, after(5 * 60_000))).toBe(false);
  });

  it('allows one follow-up, so chat can\'t drift onto the build model', () => {
    expect(warmFollowUp({ lastBuildStartedAt: start, buildFollowUpUsed: true }, after(60_000))).toBe(false);
  });

  it('is false on a thread that never built anything', () => {
    expect(warmFollowUp({}, start)).toBe(false);
  });
});

describe('routeStartOf', () => {
  it('says why a turn started on the build model', () => {
    expect(routeStartOf('build', true, true)).toBe('toggle');
    expect(routeStartOf('build', false, true)).toBe('retry');
    expect(routeStartOf('build', false, false)).toBe('follow_up');
  });

  it('is normal on the chat model, whatever was asked', () => {
    expect(routeStartOf('chat', true, true)).toBe('normal');
  });
});
