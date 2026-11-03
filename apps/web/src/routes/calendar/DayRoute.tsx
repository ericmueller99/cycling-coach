import type { IsoDate } from '@cycling-coach/shared';
import { Spinner } from '../../components/ui';
import { useDashboard } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { DayPage } from './DayPage';
import { MobileDay } from './MobileDay';

/** `/calendar/$date`: the full day view on desktop, the day timeline on phones. */
export function DayRoute({ date }: { date: IsoDate }) {
  const dashboard = useDashboard();
  const mobile = useIsMobile();
  const today = dashboard.data?.today;
  if (!today) return <Spinner />;
  return mobile ? <MobileDay today={today} date={date} /> : <DayPage key={date} today={today} date={date} />;
}
