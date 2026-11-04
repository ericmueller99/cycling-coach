import { sumNutrients } from '@cycling-coach/core';
import type { FoodLibrary, IsoDate, Nutrients } from '@cycling-coach/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CameraIcon, ChevronLeft, SparkleIcon } from '../../components/icons';
import { Button, ErrorNote, Spinner, errorContent } from '../../components/ui';
import { fmtKcal, macroLine, nowTime } from '../../lib/food';
import { useEnergyBudget, useFoodLog, useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { StaplesSwitch } from './staples';
import { lineWithFood, linesFrom, parseWords, portionOf, readRecentPhrases, rememberPhrase, useFind, whenLabel, WordsCard, WordsMissCard, wordsEntries, type Line } from './words';

interface Parsed {
  /** The slot the dialog had when the phrase was sent — the parse returns it unless the phrase named another. */
  askedSlot: string;
  slot: string;
  date: IsoDate;
  time: string | null;
}

/**
 * "Log with AI" inside Log food: a sentence → the small model
 * matches it to the user's foods, recipes and meals → they check every item → nothing is logged until
 * "Log N items". Misses are shown, never guessed; with staples on they offer the top Canadian match,
 * saved to their foods only when they click it.
 */
export function LogFoodAI({
  lib,
  date,
  slot,
  mobile,
  modeSwitch,
  staplesOn,
  onToggleStaples,
  initialPhrase,
  addNew,
  onSearchMode,
  onClose,
}: {
  lib: FoodLibrary;
  date: IsoDate;
  slot: string;
  mobile: boolean;
  modeSwitch: ReactNode;
  staplesOn: boolean;
  onToggleStaples: () => void;
  initialPhrase?: string | undefined;
  addNew: { photo?: (() => void) | undefined; manual: (name: string) => void };
  onSearchMode: () => void;
  onClose: () => void;
}) {
  const m = useFoodMutations();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialPhrase ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [said, setSaid] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [recent] = useState(readRecentPhrases);
  const { find, addFood } = useFind(lib);
  const parse = useMutation({ mutationFn: parseWords });

  const budget = useEnergyBudget(date).data;
  const dayLog = useFoodLog(date).data;

  useEffect(() => {
    if (!mobile) textRef.current?.focus();
  }, [mobile]);

  const run = () => {
    const phrase = text.trim();
    if (phrase.length < 2 || parse.isPending) return;
    setError(null);
    parse.mutate(
      { phrase, date, slot },
      {
        onSuccess: (r) => {
          setLines(linesFrom(r));
          setParsed({ askedSlot: slot, slot: r.slot, date: r.date, time: r.time ?? null });
          setSaid(phrase);
          setReviewing(true);
        },
        onError: (e) => setError(errorContent(e)),
      },
    );
  };

  // A slot said in the phrase wins; otherwise whatever the dialog's slot is now.
  const logSlot = parsed && parsed.slot !== parsed.askedSlot ? parsed.slot : slot;
  const slotPill = logSlot !== slot ? logSlot : undefined;
  const matched = lines.filter((l) => l.match);
  const misses = lines.length - matched.length;
  const total = sumNutrients(matched.map((l) => portionOf(lib, find, l).nutrients).filter((n): n is Nutrients => !!n));
  const eaten = sumNutrients((dayLog?.entries ?? []).map((e) => e.nutrients)).kcal;
  const left = budget?.ready ? Math.round(budget.total - eaten - total.kcal) : null;

  const log = () => {
    if (!parsed) return;
    const time = parsed.time ?? lib.settings.slots.find((s) => s.name === logSlot)?.time ?? nowTime();
    m.log.mutate(wordsEntries(lib, matched, { date: parsed.date, slot: logSlot, time }), {
      onSuccess: () => {
        rememberPhrase(said, total.kcal, new Date());
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  const editText = () => {
    setReviewing(false);
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  const input = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[12px] border border-line-strong bg-surface focus-within:border-accent-ring focus-within:shadow-[0_0_0_3px_rgba(125,163,10,.18)]">
        <textarea
          ref={textRef}
          aria-label="Describe what you ate"
          rows={mobile ? 3 : 4}
          value={text}
          placeholder="Describe what you ate — e.g. “2 eggs on toast with butter and a latte”"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run();
            }
          }}
          className="min-h-20 resize-none rounded-t-[12px] border-0 bg-transparent px-3 py-2.5 text-[15px] text-ink outline-none"
        />
        <div className="flex items-center gap-2 border-t border-divider px-2 py-1.5 mobile:flex-wrap">
          {addNew.photo && (
            <button type="button" aria-label="Add from a label photo" title="Add from a label photo" onClick={addNew.photo} className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-ink hover:bg-surface-2 mobile:h-11 mobile:w-11">
              <CameraIcon size={18} />
            </button>
          )}
          <span className="min-w-0 flex-auto text-xs text-muted mobile:order-first mobile:basis-full mobile:px-1">
            Logs to <strong className="text-ink">{slot}</strong> unless you say otherwise (“…for breakfast”, “at 7am”)
          </span>
          {!mobile && <kbd className="rounded border border-line px-1 font-mono text-[11px] text-muted">⌘↵</kbd>}
          <Button size="sm" variant="primary" className="ml-auto flex-none whitespace-nowrap" disabled={text.trim().length < 2 || parse.isPending} onClick={run}>
            <SparkleIcon size={14} /> {parse.isPending ? 'Matching…' : parsed ? 'Re-check' : 'Log with AI'}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-auto text-xs text-muted">Matches against your foods, recipes and meals{staplesOn ? ' (+ Canadian staples)' : ''} — nothing is guessed.</span>
        <StaplesSwitch on={staplesOn} onToggle={onToggleStaples} />
      </div>
      {error && !reviewing && <ErrorNote>{error}</ErrorNote>}
      {recent.length > 0 && (
        <section aria-label="Recent phrases" className="flex flex-col">
          <div className="mb-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">Recent phrases</div>
          <div className="flex flex-col overflow-hidden rounded-[10px] border border-line">
            {recent.map((r) => (
              <button
                key={r.text}
                type="button"
                onClick={() => {
                  setText(r.text);
                  textRef.current?.focus();
                }}
                className="flex min-h-11 items-center gap-2 border-0 border-b border-divider bg-surface px-3 text-left text-ink last:border-b-0 hover:bg-surface-2"
              >
                <span className="min-w-0 flex-auto truncate">“{r.text}”</span>
                <span className="flex-none text-xs text-muted">{whenLabel(r.at, new Date())}</span>
                <span className="w-12 flex-none text-right font-mono text-[13px]">{fmtKcal(r.kcal)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <button type="button" onClick={onSearchMode} className="self-start border-0 bg-transparent p-0 text-[13px] font-medium text-accent-ink">
        Prefer to pick it yourself? Search my foods
      </button>
    </div>
  );

  const review = (
    <div className="flex min-h-0 flex-auto flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold">Check before logging</div>
        <div className="text-xs text-muted">
          {matched.length} matched{misses ? ` · ${misses} need${misses === 1 ? 's' : ''} you` : ''} · “{said}”
        </div>
      </div>
      {!lines.length && <div className="text-[13px] text-muted">Nothing to log in that — try naming the foods.</div>}
      {lines.map((l) => {
        const onChange = (next: Line) => setLines((ls) => ls.map((x) => (x.key === l.key ? next : x)));
        const onRemove = () => setLines((ls) => ls.filter((x) => x.key !== l.key));
        return l.match ? (
          <WordsCard key={l.key} lib={lib} find={find} line={l} slot={logSlot} slotPill={slotPill} onChange={onChange} onRemove={onRemove} />
        ) : (
          <WordsMissCard
            key={l.key}
            lib={lib}
            find={find}
            line={l}
            slot={logSlot}
            staplesOn={staplesOn}
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
      <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-divider bg-surface-alt pt-3 mobile:bg-surface mobile:pb-1">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <div>
            <div className="font-mono text-lg font-semibold">{fmtKcal(total.kcal)} kcal</div>
            <div className="font-mono text-xs text-muted">{macroLine(total)}</div>
          </div>
          <span className="grow" />
          {left != null && <span className={`text-[13px] ${left >= 0 ? 'text-muted' : 'text-danger'}`}>{left >= 0 ? `${fmtKcal(left)} left after` : `${fmtKcal(-left)} over today`}</span>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={editText}>
            Edit text
          </Button>
          <Button variant="primary" disabled={!matched.length || m.log.isPending || parse.isPending} onClick={log}>
            Log {matched.length} item{matched.length === 1 ? '' : 's'} to {logSlot}
          </Button>
        </div>
      </div>
    </div>
  );

  const empty = (
    <div className="flex flex-auto items-center justify-center p-6 text-center text-[13px] text-muted">
      {parse.isPending ? <Spinner label="Matching to your foods…" /> : 'Describe what you ate, then press Log with AI. You’ll confirm every item here before anything is logged.'}
    </div>
  );

  if (mobile) {
    return reviewing && parsed ? (
      <>
        <button type="button" onClick={editText} className="flex min-h-[44px] items-center gap-1 self-start border-0 bg-transparent p-0 font-medium text-accent-ink">
          <ChevronLeft /> Edit text
        </button>
        {review}
      </>
    ) : (
      <>
        {modeSwitch}
        {input}
        {parse.isPending && <Spinner label="Matching to your foods…" />}
      </>
    );
  }

  return (
    <div className="grid min-h-0 flex-auto grid-cols-[minmax(0,1fr)_380px] grid-rows-[minmax(0,1fr)] gap-5">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {modeSwitch}
        {input}
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto rounded-[12px] border border-line bg-surface-alt p-4">{parsed && !parse.isPending ? review : empty}</div>
    </div>
  );
}
