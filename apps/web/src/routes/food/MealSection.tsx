import type { FoodLogEntry, Nutrients } from '@cycling-coach/shared';
import { IconButton } from '../../components/AppBar';
import { MoreIcon, PlusIcon } from '../../components/icons';
import { Button } from '../../components/ui';
import { entryPortion, fmtKcal, fmtTime, macroLine } from '../../lib/food';
import { SourceTag } from './SourceTag';

/**
 * A meal slot's entries: header with time and kcal, rows that open the entry, "Save
 * as meal" for 2+ items, and an empty state. On the calendar day view and the phone day timeline.
 */
export function MealSection({
  name,
  time,
  items,
  total,
  onAdd,
  onEntry,
  onSaveMeal,
  subline,
  mobile,
}: {
  name: string;
  time?: string | undefined;
  /** "during Long Z2 ride" — the Workout fuel section names the day's exercise. */
  subline?: string | undefined;
  items: FoodLogEntry[];
  total: Nutrients;
  onAdd: () => void;
  onEntry: (e: FoodLogEntry) => void;
  onSaveMeal: () => void;
  mobile: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className={`flex items-center gap-2.5 border-b border-divider ${mobile ? 'py-1.5 pr-1.5 pl-3.5' : 'px-4 py-3'}`}>
        <h2 className="m-0 flex min-w-0 flex-auto flex-col text-[15px] leading-tight">
          <span>
            {name} {time && !mobile && <span className="text-xs font-normal text-muted">{fmtTime(time)}</span>}
          </span>
          {subline && <span className="truncate text-xs font-normal text-muted">{subline}</span>}
        </h2>
        <span className="font-mono text-[13px] font-semibold">{items.length ? `${fmtKcal(total.kcal)} kcal` : '—'}</span>
        {mobile ? (
          <IconButton aria-label={`Add to ${name}`} onClick={onAdd}>
            <PlusIcon size={20} />
          </IconButton>
        ) : (
          <Button size="sm" onClick={onAdd} aria-label={`Add food to ${name}`}>
            <PlusIcon size={14} /> Add
          </Button>
        )}
      </div>
      {items.map((e) =>
        mobile ? (
          <button
            key={e.id}
            type="button"
            onClick={() => onEntry(e)}
            className="flex min-h-[52px] w-full items-center gap-2.5 border-0 border-b border-[#F1F2F4] bg-surface px-3.5 py-1.5 text-left text-ink last:border-b-0"
          >
            <span className="min-w-0 flex-auto">
              <span className="block truncate font-medium">{e.name}</span>
              <span className="block truncate text-xs text-muted">{entryPortion(e)}</span>
            </span>
            <span className="font-mono text-[13px]">{fmtKcal(e.nutrients.kcal)}</span>
          </button>
        ) : (
          <div key={e.id} className="flex items-center gap-3 border-b border-[#F1F2F4] px-4 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-auto">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{e.name}</span>
                <SourceTag source={e.source} />
              </div>
              <div className="truncate text-xs text-muted">
                {entryPortion(e)} · {macroLine(e.nutrients)}
              </div>
            </div>
            <span className="font-mono text-[13px]">{fmtKcal(e.nutrients.kcal)}</span>
            <button type="button" aria-label={`Edit ${e.name}`} onClick={() => onEntry(e)} className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-2">
              <MoreIcon size={16} />
            </button>
          </div>
        ),
      )}
      {items.length >= 2 && !items.every((e) => e.fromMealId && e.fromMealId === items[0]!.fromMealId) && (
        <div className="flex justify-end border-t border-[#F1F2F4] px-3 py-1">
          <button type="button" onClick={onSaveMeal} className="min-h-9 border-0 bg-transparent px-1 text-[13px] font-medium text-accent-ink">
            Save as meal
          </button>
        </div>
      )}
      {!items.length && (
        <div className="px-4 py-3.5 text-[13px] text-muted">
          Nothing yet.{' '}
          <button type="button" onClick={onAdd} className="border-0 bg-transparent p-0 text-[13px] text-accent-ink underline">
            Add food
          </button>{' '}
          or log a saved meal.
        </div>
      )}
    </section>
  );
}
