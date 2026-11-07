import { todayIn } from '@cycling-coach/core';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppBar } from '../../components/AppBar';
import { SectionTabs } from '../../components/SectionTabs';
import { ErrorNote, Spinner } from '../../components/ui';
import { useExtensions } from '../../extensions';
import { errorMessage, useDashboard, useIntervals, useProfile } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { BudgetSection } from './BudgetSection';
import { ConnectionsSection } from './connections';
import { EnergySection } from './EnergySection';
import { FtpCard } from './ftp';
import { GoalsSection } from './goals';
import { MemorySection } from './memory';
import { TrainingCard } from './training';
import { PowerCurveCard } from './powerCurve';
import { Snapshot } from './Snapshot';
import { WeightSection } from './weight';
import { ZwiftSection } from './zwift';

export const ATHLETE_TABS = ['performance', 'body', 'goals'] as const;
export type AthleteTab = (typeof ATHLETE_TABS)[number];
const TABS = [
  { key: 'performance' as const, label: 'Performance' },
  { key: 'body' as const, label: 'Body & energy' },
  { key: 'goals' as const, label: 'Goals & coach' },
];

/** Two balanced columns, stacked below 1100 px. */
function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 px-7 pt-5 pb-9 min-[1100px]:grid-cols-[1.35fr_1fr] mobile:gap-3.5 mobile:px-4 mobile:pt-3 mobile:pb-5">
      <div className="flex min-w-0 flex-col gap-5 mobile:gap-3.5">{left}</div>
      <div className="flex min-w-0 flex-col gap-5 mobile:gap-3.5">{right}</div>
    </div>
  );
}

/**
 * Athlete: a snapshot strip and three tabs — Performance, Body & energy, Goals &
 * coach. Everything here is context the coach gets with every message.
 */
export function AthletePage({ tab, addWeightGoal }: { tab: AthleteTab; addWeightGoal: boolean }) {
  const { data, isPending, error } = useProfile();
  const dashboard = useDashboard();
  const intervals = useIntervals();
  const { athleteBodyCards } = useExtensions();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  if (isPending) return <Spinner />;
  if (error || !data) return <ErrorNote>{error ? errorMessage(error) : 'No profile'}</ErrorNote>;
  const today = todayIn(data.profile.timezone, new Date());
  const mainGoal = dashboard.data?.mainGoal;
  const goalDurations = data.goals.flatMap((g) => (g.measure?.kind === 'power_best' && !g.done ? [g.measure.durationSec] : []));
  const tabs = <SectionTabs label="Athlete sections" base="/athlete/$tab" tabs={TABS} active={tab} mobile={mobile} />;
  const snapshot = <Snapshot profile={data.profile} mainGoal={mainGoal} today={today} />;

  let body: ReactNode;
  if (tab === 'performance') {
    body = (
      <Columns
        left={
          <>
            <FtpCard profile={data.profile} intervals={intervals.data} />
            <PowerCurveCard bests={data.powerBests} weightKg={data.profile.weightKg} ftp={data.profile.ftpZwift} goalDurations={goalDurations} />
          </>
        }
        right={<ZwiftSection profile={data.profile} />}
      />
    );
  } else if (tab === 'body') {
    body = (
      <Columns
        left={
          <>
            <WeightSection profile={data.profile} />
            <EnergySection today={today} />
          </>
        }
        right={
          <>
            {athleteBodyCards}
            <BudgetSection today={today} onAddWeightGoal={() => void navigate({ to: '/athlete/$tab', params: { tab: 'goals' }, search: { addWeightGoal: true } })} />
          </>
        }
      />
    );
  } else {
    body = (
      <Columns
        left={
          <>
            <GoalsSection
              goals={data.goals}
              mainId={mainGoal?.id}
              today={today}
              trendKg={data.profile.weightKg}
              addWeightGoal={addWeightGoal}
              onAddedWeightGoal={() => addWeightGoal && void navigate({ to: '/athlete/$tab', params: { tab: 'goals' }, search: {}, replace: true })}
            />
            <TrainingCard profile={data.profile} />
          </>
        }
        right={
          <>
            <MemorySection memories={data.memories} today={today} />
            <ConnectionsSection />
            <div className="text-xs text-muted">Timezone is on your Account page.</div>
          </>
        }
      />
    );
  }

  return (
    <>
      {mobile ? (
        <>
          <AppBar title="Athlete">{tabs}</AppBar>
          <div className="pt-3">{snapshot}</div>
        </>
      ) : (
        <header className="flex flex-col gap-3 border-b border-line px-7 pt-[18px]">
          <div>
            <h1 className="m-0 text-xl font-bold">Athlete</h1>
            <div className="text-[13px] text-muted">Everything here is sent to the coach as context with every message.</div>
          </div>
          {snapshot}
          {tabs}
        </header>
      )}
      {body}
    </>
  );
}
