import { addDays, slotForTime } from '@cycling-coach/core';
import type { FoodLogEntry, IsoDate, MealItem } from '@cycling-coach/shared';
import { useState, type ReactNode } from 'react';
import { MealEditor } from '../food/MealEditor';
import { dayLabel } from '../food/dayLabel';
import { useFoodFlows } from '../food/flows';
import { feedbackForEvent } from '../../lib/feedback';
import { nowTime } from '../../lib/food';
import type { useDay } from './day';
import { ActivityPanel, AddPanel, DetailPanel, type Selection } from './panels';
import { sessionRides } from './shared';

/**
 * What the day view and the phone day share: the food dialogs for the day, "Save as meal", and the
 * session / ride / add panels as sheets (a drawer on desktop).
 */
export function useDayActions(date: IsoDate, today: IsoDate, d: ReturnType<typeof useDay>) {
  const lib = d.lib.data;
  const slot = lib ? slotForTime(lib.settings.slots, date === today ? nowTime() : '12:00') : 'Breakfast';
  const flows = useFoodFlows({ lib, date, dateLabel: dayLabel(date, today), defaultSlot: slot });
  const [panel, setPanel] = useState<Selection>(null);
  const [saveMeal, setSaveMeal] = useState<{ slot: string; items: MealItem[] } | null>(null);
  const saveAsMeal = (slotName: string, entries: FoodLogEntry[]) =>
    setSaveMeal({ slot: slotName, items: entries.map((e) => ({ kind: e.kind, refId: e.refId, quantity: e.quantity, unit: e.unit })) });

  const event = panel?.type === 'event' ? d.calendar.events.find((e) => e.id === panel.id) : undefined;
  const activity = panel?.type === 'activity' ? d.calendar.activities.find((a) => a.id === panel.id) : undefined;
  const close = () => setPanel(null);
  const elements: ReactNode = (
    <>
      {flows.element}
      {saveMeal && lib && <MealEditor lib={lib} today={today} initialItems={saveMeal.items} initialSlot={saveMeal.slot} onClose={() => setSaveMeal(null)} onSaved={() => setSaveMeal(null)} />}
      {event && (
        <DetailPanel
          key={event.id}
          sheet
          event={event}
          rides={sessionRides(event, d.ridesById)}
          dayRides={d.byDate.get(event.date)?.rides ?? []}
          feedback={feedbackForEvent(d.ratings, event)}
          onClose={close}
        />
      )}
      {activity && (
        <ActivityPanel
          key={activity.id}
          sheet
          activity={activity}
          feedback={d.ratings.byActivity.get(activity.id)}
          sessions={d.byDate.get(activity.startLocal.slice(0, 10))?.events ?? []}
          onAdded={(id) => setPanel({ type: 'event', id })}
          onClose={close}
        />
      )}
      {panel?.type === 'add' && <AddPanel sheet date={panel.date} onClose={close} onAdded={(id) => setPanel({ type: 'event', id })} />}
    </>
  );
  return { flows, slot, setPanel, saveAsMeal, elements, tomorrow: addDays(date, 1) };
}

/** "during Long Z2 ride" / "for VO2 5x4" under the Workout fuel slot. */
export function fuelLine(exercise: { name: string; basis: string }[] | undefined): string | undefined {
  if (!exercise?.length) return undefined;
  return `${exercise.some((e) => e.basis !== 'planned') ? 'during' : 'for'} ${exercise.map((e) => e.name.replace(/^Zwift - /, '')).join(', ')}`;
}
