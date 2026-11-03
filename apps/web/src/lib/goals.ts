import type { GoalMeasure } from '@cycling-coach/shared';

const PERIOD: Record<'90d' | 'season' | 'allTime', string> = { '90d': '90 days', season: 'season', allTime: 'all-time' };

/** "W/kg on Zwift weight", "5 min best (90 days)" — what a goal is measured by, in words. */
export function describeMeasure(m: GoalMeasure): string {
  switch (m.kind) {
    case 'wkg':
      return m.weight === 'zwift' ? 'W/kg on Zwift weight' : 'W/kg on trend weight';
    case 'zwift_wkg':
      return m.metric === 'zftp' ? 'zFTP W/kg on Zwift weight' : 'zMAP W/kg on Zwift weight';
    case 'ftp':
      return 'FTP';
    case 'power_best':
      return `${m.durationSec < 60 ? `${m.durationSec} s` : `${m.durationSec / 60} min`} best (${PERIOD[m.period]})`;
    case 'weight':
      return 'Trend weight';
    case 'fitness':
      return 'Fitness (CTL)';
    case 'manual':
      return `${m.unit} (tracked by hand)`;
  }
}

export function measureUnit(m: GoalMeasure): string {
  switch (m.kind) {
    case 'wkg':
    case 'zwift_wkg':
      return 'W/kg';
    case 'ftp':
    case 'power_best':
      return 'W';
    case 'weight':
      return 'kg';
    case 'fitness':
      return 'CTL';
    case 'manual':
      return m.unit;
  }
}
