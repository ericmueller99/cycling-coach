import { formatLongDay, sumNutrients } from '@cycling-coach/core';
import type { FoodLibrary, IsoDate, Nutrients } from '@cycling-coach/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, ErrorNote, Spinner, errorContent, inputCls } from '../../components/ui';
import { fmtKcal, macroLine, nowTime } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { lineWithFood, linesFrom, parseWords, portionOf, useFind, WordsCard, WordsMissCard, wordsEntries, type Line } from './words';

/**
 * Log with words: the phrase is matched to the user's own foods and usual
 * portions by a small model; they adjust by hand or with another phrase, and nothing is logged until "Log".
 */
export function WordsDialog({
  lib,
  phrase,
  date: viewedDate,
  slot: defaultSlot,
  onClose,
  onEditManually,
  addNew,
}: {
  lib: FoodLibrary;
  phrase: string;
  date: IsoDate;
  slot: string;
  onClose: () => void;
  onEditManually: (slot: string) => void;
  addNew: { photo: () => void; manual: (name: string) => void };
}) {
  const id = useId();
  const m = useFoodMutations();
  const [lines, setLines] = useState<Line[]>([]);
  const [slot, setSlot] = useState(defaultSlot);
  const [date, setDate] = useState(viewedDate);
  // A said time wins, then the slot's usual time ("for breakfast" → 07:30), then now.
  const [pickedTime, setTime] = useState<string | null>(null);
  const time = pickedTime ?? lib.settings.slots.find((x) => x.name === slot)?.time ?? nowTime();
  const [change, setChange] = useState('');
  const [error, setError] = useState<ReactNode>(null);
  const [said, setSaid] = useState<string[]>([phrase]);
  const { find, addFood } = useFind(lib);
  const parse = useMutation({ mutationFn: (body: { phrase: string; draft?: Line[] }) => parseWords({ ...body, date: viewedDate, slot }) });

  const apply = (r: Awaited<ReturnType<typeof parseWords>>) => {
    setLines(linesFrom(r));
    setSlot(r.slot);
    setDate(r.date);
    if (r.time) setTime(r.time);
  };

  // Once, for the phrase the dialog opened with (the ref stops StrictMode's double mount from paying twice).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    parse.mutate({ phrase }, { onSuccess: apply, onError: (e) => setError(errorContent(e)) });
  }, [parse, phrase]);

  const refine = () => {
    if (!change.trim()) return;
    parse.mutate(
      { phrase: change.trim(), draft: lines },
      {
        onSuccess: (r) => {
          apply(r);
          setSaid([...said, change.trim()]);
          setChange('');
        },
        onError: (e) => setError(errorContent(e)),
      },
    );
  };

  const matched = lines.filter((l) => l.match);
  const total = sumNutrients(matched.map((l) => portionOf(lib, find, l).nutrients).filter((n): n is Nutrients => !!n));

  const log = () => m.log.mutate(wordsEntries(lib, matched, { date, slot, time }), { onSuccess: onClose, onError: (e) => setError(errorMessage(e)) });

  return (
    <Dialog
      title="Confirm what to log"
      width={640}
      tall
      onClose={onClose}
      header={<div className="mt-0.5 text-[13px] text-muted">{said.map((s) => `“${s}”`).join(' → ')}</div>}
      footer={
        <div className="flex flex-col gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="font-mono text-lg font-semibold">{fmtKcal(total.kcal)} kcal</div>
              <div className="font-mono text-xs text-muted">{macroLine(total)}</div>
            </div>
            <span className="grow" />
            <Button variant="ghost" onClick={() => onEditManually(slot)}>
              Edit manually
            </Button>
            <Button variant="primary" disabled={!matched.length || m.log.isPending || parse.isPending} onClick={log}>
              Log {matched.length} item{matched.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <label htmlFor={`${id}-slot`} className="text-muted">
          Log to
        </label>
        <select id={`${id}-slot`} value={slot} onChange={(e) => setSlot(e.target.value)} className={`${inputCls} min-h-9`}>
          {[...new Set([...lib.settings.slots.map((s) => s.name), slot])].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label htmlFor={`${id}-date`} className="text-muted">
          Day
        </label>
        <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} min-h-9`} />
        <input aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inputCls} min-h-9 w-36`} />
        <span className="text-xs text-muted">{formatLongDay(date)}</span>
      </div>
      {parse.isPending && <Spinner label="Matching to your foods…" />}
      {!parse.isPending && !lines.length && !error && <div className="text-[13px] text-muted">Nothing to log in that — try naming the foods.</div>}
      {lines.map((l) => {
        const onChange = (next: Line) => setLines((ls) => ls.map((x) => (x.key === l.key ? next : x)));
        const onRemove = () => setLines((ls) => ls.filter((x) => x.key !== l.key));
        return l.match ? (
          <WordsCard key={l.key} lib={lib} find={find} line={l} slot={slot} onChange={onChange} onRemove={onRemove} />
        ) : (
          <WordsMissCard
            key={l.key}
            lib={lib}
            find={find}
            line={l}
            slot={slot}
            staplesOn
            addNew={addNew}
            onChange={onChange}
            onRemove={onRemove}
            onFoodSaved={(food) => {
              addFood(food);
              onChange(lineWithFood(l, food));
            }}
          />
        );
      })}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          refine();
        }}
      >
        <input aria-label="Change something" placeholder="Change something… “make it half a bagel”, “add a latte”" value={change} onChange={(e) => setChange(e.target.value)} className={`${inputCls} flex-auto`} />
        <Button type="submit" disabled={!change.trim() || parse.isPending}>
          Update
        </Button>
      </form>
    </Dialog>
  );
}
