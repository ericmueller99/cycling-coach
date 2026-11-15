import type { UiBlock } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { dropCall } from './turnBlocks';

const t = (text: string): UiBlock => ({ type: 'text', text });
const chip = (id: string): UiBlock => ({ type: 'tool', toolUseId: id, name: 'get_calendar', status: 'running', summary: 'Checking', source: 'app' });
const marker: UiBlock = { type: 'handoff', model: 'claude-opus-5-5', tool: 'propose_plan' };

describe('dropCall', () => {
  it('takes back a dropped call: its text and its chips', () => {
    expect(dropCall([t('earlier'), chip('old'), t('draft'), chip('c1')], ['c1'])).toEqual([t('earlier'), chip('old')]);
  });

  it('keeps the words at a handoff and takes back only the chips (DECISIONS #110)', () => {
    expect(dropCall([t('Good call.'), chip('c1')], ['c1'], true)).toEqual([t('Good call.')]);
  });

  it('takes back the marker too when the build model cannot run, but keeps the words before it', () => {
    expect(dropCall([t('Good call.'), marker, t('Here is'), chip('c2')], ['c2'])).toEqual([t('Good call.')]);
  });
});
