import { checkUntil, isExpired, todayIn } from '@cycling-coach/core';
import {
  createMemory,
  forgetMemory,
  getMemory,
  getProfile,
  restoreMemory,
  reviewMemory,
  revertMemory,
  updateMemory,
  type Collections,
} from '@cycling-coach/db';
import type { Memory, MemoryInput, MemoryPatch, MemoryRevert, MemoryUpdate } from '@cycling-coach/shared';

/**
 * Coach memory writes, from the athlete's panel and the coach's tools alike, so both follow the same
 * rules (DECISIONS #79). Dates are checked against the athlete's local day.
 */
export class MemoryService {
  constructor(
    private readonly c: Collections,
    private readonly now: () => Date,
  ) {}

  private async today(userId: string) {
    const profile = await getProfile(this.c, userId);
    return todayIn(profile?.timezone ?? 'UTC', this.now());
  }

  async create(userId: string, input: MemoryInput, source: 'user' | 'coach'): Promise<Memory | { error: string }> {
    const error = input.until ? checkUntil(input.until, await this.today(userId)) : null;
    if (error) return { error };
    return createMemory(this.c, userId, input.text, source, this.now(), input.until);
  }

  async update(userId: string, id: string, patch: MemoryPatch): Promise<MemoryUpdate | { error: string } | null> {
    const previous = await getMemory(this.c, userId, id);
    if (!previous) return null;
    const today = await this.today(userId);
    const keepsDate = patch.until === undefined && !patch.unset?.includes('until');
    if (keepsDate && isExpired(previous, today)) return { error: 'That note has expired. Give it a new date to keep it.' };
    // The same date back is fine even once it has passed: the note is on its last day, and only the text changed.
    const error = patch.until && patch.until !== previous.until ? checkUntil(patch.until, today) : null;
    if (error) return { error };
    const memory = await updateMemory(this.c, userId, id, patch, this.now());
    return memory ? { memory, previous } : null;
  }

  remove(userId: string, id: string) {
    return forgetMemory(this.c, userId, id, this.now());
  }

  restore(userId: string, id: string) {
    return restoreMemory(this.c, userId, id);
  }

  review(userId: string, id: string) {
    return reviewMemory(this.c, userId, id, this.now());
  }

  revert(userId: string, id: string, input: MemoryRevert) {
    return revertMemory(this.c, userId, id, input);
  }
}
