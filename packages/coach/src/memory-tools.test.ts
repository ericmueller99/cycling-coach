import { describe, expect, it, vi } from 'vitest';
import { runTool, type CoachPorts } from './tools';

const memory = { id: 'm1', text: 'Away Wed Nov 11', source: 'coach', createdAt: '' } as const;
const ctx = (ports: Partial<CoachPorts>) => ({ toolUseId: 't1', today: '2026-11-04', ports: ports as CoachPorts });

describe('remember', () => {
  it('saves a dated note as short-term and shows the date on the chip', async () => {
    const remember = vi.fn(async () => ({ ...memory, until: '2026-11-11' }));
    const out = await runTool('remember', { text: 'Away Wed Nov 11', until: '2026-11-11' }, ctx({ remember }));
    expect(remember).toHaveBeenCalledWith({ text: 'Away Wed Nov 11', until: '2026-11-11' });
    expect(out.content).toContain('short-term note until 2026-11-11');
    expect(out.ui).toMatchObject({ type: 'memory', action: 'remember', until: '2026-11-11' });
  });

  it('saves a null date as long-term', async () => {
    const remember = vi.fn(async () => memory);
    const out = await runTool('remember', { text: 'Rides indoors on weekdays', until: null }, ctx({ remember }));
    expect(remember).toHaveBeenCalledWith({ text: 'Rides indoors on weekdays' });
    expect(out.content).toContain('long-term');
    expect(out.ui).not.toHaveProperty('until');
  });

  it('makes the coach choose a list: a call with no until is refused, not saved as permanent', async () => {
    const remember = vi.fn(async () => memory);
    const out = await runTool('remember', { text: 'Away Wed Nov 11' }, ctx({ remember }));
    expect(out.isError).toBe(true);
    expect(remember).not.toHaveBeenCalled();
  });

  it('hands a refused date back to the coach', async () => {
    const out = await runTool('remember', { text: 'x', until: '2026-01-01' }, ctx({ remember: async () => ({ error: '2026-01-01 has already passed.' }) }));
    expect(out).toMatchObject({ isError: true, content: '2026-01-01 has already passed.' });
  });
});

describe('update_memory', () => {
  const updated = { memory: { ...memory, text: 'Away Thu Nov 12', until: '2026-11-12' }, previous: { ...memory, until: '2026-11-11' } };

  it('keeps what the chip needs to undo it', async () => {
    const updateMemory = vi.fn(async () => updated);
    const out = await runTool('update_memory', { memory_id: 'm1', text: 'Away Thu Nov 12', until: '2026-11-12' }, ctx({ updateMemory }));
    expect(updateMemory).toHaveBeenCalledWith('m1', { text: 'Away Thu Nov 12', until: '2026-11-12' });
    expect(out.ui).toMatchObject({ action: 'update', until: '2026-11-12', previous: { text: 'Away Wed Nov 11', until: '2026-11-11' } });
  });

  it('turns a null date into long-term and leaves a missing one alone', async () => {
    const updateMemory = vi.fn(async () => updated);
    await runTool('update_memory', { memory_id: 'm1', until: null }, ctx({ updateMemory }));
    expect(updateMemory).toHaveBeenLastCalledWith('m1', { unset: ['until'] });
    await runTool('update_memory', { memory_id: 'm1', text: 'New words' }, ctx({ updateMemory }));
    expect(updateMemory).toHaveBeenLastCalledWith('m1', { text: 'New words' });
  });

  it('refuses a call that changes nothing, and an unknown id', async () => {
    const updateMemory = vi.fn(async () => null);
    expect((await runTool('update_memory', { memory_id: 'm1' }, ctx({ updateMemory }))).isError).toBe(true);
    expect(updateMemory).not.toHaveBeenCalled();
    expect(await runTool('update_memory', { memory_id: 'nope', text: 'x' }, ctx({ updateMemory }))).toMatchObject({ isError: true, content: 'No memory with id nope.' });
  });
});
