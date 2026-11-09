import { TRAINING_APPROACH_BLURB, TRAINING_APPROACH_LABEL, trainingApproaches, TRAINING_PREFERENCE_BLURB, TRAINING_PREFERENCE_LABEL, trainingPreferences, WEEKDAY_LABEL, weekdays, type Profile, type UsualWeek } from '@cycling-coach/shared';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNote, SectionLabel } from '../../components/ui';
import { errorMessage, useProfileMutations } from '../../lib/queries';
import { inputCls } from './shared';

const choiceCls = (on: boolean) => `min-h-11 rounded-[10px] border-2 px-3 py-2 text-left text-ink ${on ? 'border-accent-ring bg-accent-tint' : 'border-line bg-surface'}`;

/** How hard they want to go, what kind of training, and when they can ride. All optional (DECISIONS #86, #103). */
export function TrainingCard({ profile }: { profile: Profile }) {
  const { saveProfile } = useProfileMutations();
  const saved = profile.usualWeek;
  const [usual, setUsual] = useState(!!saved);
  const [days, setDays] = useState<UsualWeek['days']>(saved?.days ?? []);
  const [hours, setHours] = useState(saved?.hoursPerWeek?.toString() ?? '');
  useEffect(() => {
    setUsual(!!saved);
    setDays(saved?.days ?? []);
    setHours(saved?.hoursPerWeek?.toString() ?? '');
  }, [saved]);

  const toggleDay = (d: UsualWeek['days'][number]) => setDays(weekdays.filter((w) => (w === d ? !days.includes(d) : days.includes(w))));
  const hoursNum = hours === '' ? undefined : Number(hours);
  const hoursOk = hoursNum === undefined || (hoursNum >= 1 && hoursNum <= 40);
  const dirty = days.join() !== (saved?.days ?? []).join() || hoursNum !== saved?.hoursPerWeek;
  const tellCoach = () => {
    setUsual(false);
    if (saved) saveProfile.mutate({ ...profile, usualWeek: undefined });
  };

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]">
      <h2 className="m-0 text-base">Training</h2>
      <SectionLabel>How hard do you want to go?</SectionLabel>
      <div role="group" aria-label="How hard do you want to go?" className="flex flex-col gap-2">
        {trainingPreferences.map((p) => {
          const on = profile.trainingPreference === p;
          return (
            <button key={p} type="button" aria-pressed={on} disabled={saveProfile.isPending} onClick={() => saveProfile.mutate({ ...profile, trainingPreference: p })} className={choiceCls(on)}>
              <span className="block font-semibold">{TRAINING_PREFERENCE_LABEL[p]}</span>
              <span className="block text-[13px] text-muted">{TRAINING_PREFERENCE_BLURB[p]}</span>
            </button>
          );
        })}
      </div>
      <SectionLabel>What kind of training?</SectionLabel>
      <div role="group" aria-label="What kind of training?" className="flex flex-col gap-2">
        {trainingApproaches.map((a) => {
          const on = (profile.trainingApproach ?? 'auto') === a;
          return (
            <button key={a} type="button" aria-pressed={on} disabled={saveProfile.isPending} onClick={() => saveProfile.mutate({ ...profile, trainingApproach: a })} className={choiceCls(on)}>
              <span className="block font-semibold">{TRAINING_APPROACH_LABEL[a]}</span>
              <span className="block text-[13px] text-muted">{TRAINING_APPROACH_BLURB[a]}</span>
            </button>
          );
        })}
      </div>
      <SectionLabel>When you can ride</SectionLabel>
      <div role="group" aria-label="When you can ride" className="grid grid-cols-2 gap-2">
        <button type="button" aria-pressed={!usual} onClick={tellCoach} className={`${choiceCls(!usual)} font-semibold`}>
          Tell my coach when I chat
        </button>
        <button type="button" aria-pressed={usual} onClick={() => setUsual(true)} className={`${choiceCls(usual)} font-semibold`}>
          Set a usual week
        </button>
      </div>
      {usual ? (
        <div className="flex flex-col gap-2.5">
          <div role="group" aria-label="Days you usually ride" className="flex flex-wrap gap-1.5">
            {weekdays.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={`min-h-10 min-w-11 rounded-lg border-[1.5px] px-2 text-[13px] font-semibold text-ink ${on ? 'border-accent-ring bg-accent-tint' : 'border-line-strong bg-surface'}`}
                >
                  {WEEKDAY_LABEL[d]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Hours a week (optional)
              <input type="number" min={1} max={40} step="any" value={hours} onChange={(e) => setHours(e.target.value)} className={`${inputCls} w-28`} />
            </label>
            <Button
              variant={dirty ? 'primary' : 'neutral'}
              size="sm"
              disabled={!dirty || !hoursOk || (!days.length && hoursNum === undefined) || saveProfile.isPending}
              onClick={() => saveProfile.mutate({ ...profile, usualWeek: { days, ...(hoursNum !== undefined ? { hoursPerWeek: hoursNum } : {}) } })}
            >
              {saveProfile.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </Button>
          </div>
          <div className="text-xs text-muted">Your coach plans from this. Anything you say in chat beats it.</div>
        </div>
      ) : (
        <div className="text-xs text-muted">Your coach asks when it needs to, so your week can change as much as it likes.</div>
      )}
      {saveProfile.error && <ErrorNote>{errorMessage(saveProfile.error)}</ErrorNote>}
    </Card>
  );
}
