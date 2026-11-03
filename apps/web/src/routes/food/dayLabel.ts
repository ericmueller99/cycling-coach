import { addDays, formatLongDay } from '@cycling-coach/core';
import type { IsoDate } from '@cycling-coach/shared';

/** "Today · Sun Nov 1", "Yesterday · …", else the long day — the food dialogs' date line. */
export const dayLabel = (date: IsoDate, today: IsoDate) =>
  date === today ? `Today · ${formatLongDay(date)}` : date === addDays(today, -1) ? `Yesterday · ${formatLongDay(date)}` : formatLongDay(date);
