import { applyEstimateAnswers, estimateTotals, sumNutrients } from '@cycling-coach/core';
import type { EstimateItem, EstimateKind, EstimatePhotoKind, EstimateQuestion, EstimateResult, FoodLibrary, IsoDate } from '@cycling-coach/shared';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { CameraIcon, ChevronLeft, XIcon } from '../../components/icons';
import { Button, Chip, ErrorNote, Segmented, Spinner, errorContent, inputCls } from '../../components/ui';
import { fmtKcal, nowTime } from '../../lib/food';
import { useAdjustEstimate, useEnergyBudget, useEstimateMeal, useFoodLog, useFoodMutations } from '../../lib/foodQueries';
import { preparePhoto, type PreparedPhoto } from '../../lib/photo';
import { errorMessage } from '../../lib/queries';
import { EstimateHeader, EstimateItems } from './EstimateReview';

const MAX_PHOTOS = 4;
const KIND_KEY = 'food.estimate.kind';

function readKind(): EstimateKind {
  try {
    return localStorage.getItem(KIND_KEY) === 'home' ? 'home' : 'restaurant';
  } catch {
    return 'restaurant';
  }
}

interface TaggedPhoto extends PreparedPhoto {
  kind: EstimatePhotoKind;
}

type Stage = 'capture' | 'questions' | 'review';

/**
 * Everything the tab holds, kept by the dialog so moving between tabs can't lose an estimate that's
 * been paid for. The photos stay here until Log: they're sent to estimate, then again to keep.
 */
export function useEstimateFood() {
  const [kind, setKindState] = useState<EstimateKind>(readKind);
  const setKind = (next: EstimateKind) => {
    setKindState(next);
    try {
      localStorage.setItem(KIND_KEY, next);
    } catch {
      /* private mode */
    }
  };
  const [place, setPlace] = useState('');
  const [dish, setDish] = useState('');
  // On once a place is named, unless they turned it off.
  const [searchPick, setSearchPick] = useState<boolean | null>(null);
  const canSearch = kind === 'restaurant' && place.trim().length > 0;
  const search = canSearch && (searchPick ?? true);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<TaggedPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [stage, setStage] = useState<Stage>('capture');
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<ReactNode>(null);

  const held = useRef(photos);
  held.current = photos;
  useEffect(() => () => held.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const addPhotos = async (files: readonly File[]) => {
    const room = MAX_PHOTOS - held.current.length;
    if (!files.length || room <= 0) return;
    setError(null);
    setPreparing(true);
    try {
      const prepared = await Promise.all(files.slice(0, room).map(preparePhoto));
      // The usual pair is the plate, then the menu.
      setPhotos((ps) => [...ps, ...prepared.map((p, i): TaggedPhoto => ({ ...p, kind: ps.length + i === 0 ? 'plate' : 'menu' }))]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreparing(false);
    }
  };

  const removePhoto = (photo: TaggedPhoto) => {
    URL.revokeObjectURL(photo.preview);
    setPhotos((ps) => ps.filter((p) => p !== photo));
  };

  const retag = (photo: TaggedPhoto) => setPhotos((ps) => ps.map((p) => (p === photo ? { ...p, kind: p.kind === 'plate' ? 'menu' : 'plate' } : p)));

  /** From the items as they came back, so going back and answering differently can't stack. */
  const showEstimate = (r: EstimateResult, picked: readonly (number | null)[]) => {
    setItems(applyEstimateAnswers(r.items, r.questions, picked));
    setTouched(false);
    setStage('review');
  };

  const receive = (r: EstimateResult) => {
    if (!r.items.length) {
      // A menu says what's on offer, not what they ate, and the model is right not to guess.
      setError(r.kind === 'restaurant' && r.found.some((f) => f.from === 'menu') ? 'I can read the menu, but not what you had. Say what you ordered.' : 'I couldn’t find any food in that. Try a clearer photo, or say what you had.');
      return;
    }
    const none = r.questions.map(() => null);
    setResult(r);
    setAnswers(none);
    if (r.questions.length) setStage('questions');
    else showEstimate(r, none);
  };

  const changeItems = (next: EstimateItem[]) => {
    setItems(next);
    setTouched(true);
  };

  /** A home meal has no menu, so every photo goes as the food. */
  const photoKind = (p: TaggedPhoto): EstimatePhotoKind => (kind === 'home' ? 'plate' : p.kind);

  return { kind, setKind, place, setPlace, dish, setDish, canSearch, search, setSearch: setSearchPick, photoKind, text, setText, photos, preparing, addPhotos, removePhoto, retag, stage, setStage, result, answers, setAnswers, items, setItems, changeItems, touched, error, setError, receive, showEstimate };
}
export type EstimateFoodState = ReturnType<typeof useEstimateFood>;

const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));

function PhotoTile({ photo, onRetag, onRemove }: { photo: TaggedPhoto; onRetag: (() => void) | null; onRemove: () => void }) {
  return (
    <figure className="relative m-0 h-24 w-24 flex-none">
      <img src={photo.preview} alt={onRetag ? `The ${photo.kind}` : 'The food'} className="h-full w-full rounded-[10px] border border-line object-cover" />
      {onRetag && (
        <button type="button" aria-label={`Tagged ${photo.kind}. Change it`} onClick={onRetag} className="absolute bottom-1 left-1 min-h-6 rounded-md border-0 bg-[rgba(21,24,30,.75)] px-1.5 text-[11px] font-semibold text-white capitalize">
          {photo.kind}
        </button>
      )}
      <button type="button" aria-label="Remove photo" onClick={onRemove} className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-[rgba(21,24,30,.7)] text-white">
        <XIcon size={14} />
      </button>
    </figure>
  );
}

function Photos({ s, mobile }: { s: EstimateFoodState; mobile: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = s.photos.length >= MAX_PHOTOS;
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void s.addPhotos(imageFiles(e.dataTransfer.files));
  };
  return (
    <div>
      <div className="mb-1 text-[13px] font-semibold">
        Photos <span className="font-normal text-muted">· {s.kind === 'home' ? 'the plate, or the dish on the table' : 'the plate, the menu, or both'}</span>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex flex-wrap items-center gap-2 rounded-[12px] ${mobile ? '' : `border border-dashed p-2 ${over ? 'border-accent-ring bg-accent-tint' : 'border-line-strong'}`}`}
      >
        {s.photos.map((p) => (
          <PhotoTile key={p.preview} photo={p} onRetag={s.kind === 'restaurant' ? () => s.retag(p) : null} onRemove={() => s.removePhoto(p)} />
        ))}
        {!full &&
          (mobile ? (
            <button type="button" disabled={s.preparing} onClick={() => fileRef.current?.click()} className="flex h-24 w-24 flex-none flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line-strong bg-surface-2 text-xs text-ink">
              <CameraIcon size={22} /> {s.preparing ? 'Adding…' : 'Add photo'}
            </button>
          ) : (
            <span className="flex min-h-24 flex-auto flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-2 text-[13px] text-muted">
              {s.preparing ? (
                'Adding…'
              ) : (
                <>
                  Drop photos here, paste them, or
                  <Button size="sm" onClick={() => fileRef.current?.click()}>
                    Choose photos
                  </Button>
                </>
              )}
            </span>
          ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="Add photos"
        className="hidden"
        onChange={(e) => {
          const files = imageFiles(e.target.files);
          e.target.value = '';
          void s.addPhotos(files);
        }}
      />
    </div>
  );
}

function Question({ q, value, mobile, onChange }: { q: EstimateQuestion; value: number | null; mobile: boolean; onChange: (v: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[13px] font-semibold">{q.text}</div>
      <div className="flex flex-wrap gap-1.5">
        {q.options.map((o, i) => (
          <Chip key={o.label} mobile={mobile} on={value === i} onClick={() => onChange(value === i ? null : i)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** Reaches through the panel's padding, or the cards show underneath it as they scroll past. */
const FOOTER = 'sticky -bottom-4 -mb-4 mt-auto border-t border-divider bg-surface-alt pt-3 pb-4 mobile:bottom-[calc(-20px-env(safe-area-inset-bottom))] mobile:mb-[calc(-20px-env(safe-area-inset-bottom))] mobile:bg-surface mobile:pb-[calc(20px+env(safe-area-inset-bottom))]';

const FOUND_LABEL = { menu: 'Menu:', plate: 'Plate:', said: 'You said:', web: 'Published:' } as const;

/** What a search did, when one was asked for. */
function SearchNote({ result, place }: { result: EstimateResult; place: string }) {
  if (result.search === 'off') return null;
  const text =
    result.search === 'found'
      ? `Found ${place ? `${place}’s` : 'the'} published nutrition, and used it where it matched.`
      : result.search === 'none'
        ? 'Couldn’t find published nutrition for this, so it’s from what I know.'
        : 'Couldn’t search this time, so it’s from what I know.';
  return <div className={`text-xs ${result.search === 'found' ? 'text-accent-ink' : 'text-muted'}`}>{text}</div>;
}

function Questions({ s, result, mobile }: { s: EstimateFoodState; result: EstimateResult; mobile: boolean }) {
  const none = result.questions.map(() => null);
  return (
    <div className="flex flex-[1_0_auto] flex-col gap-4">
      <SearchNote result={result} place={s.place.trim()} />
      {result.found.length > 0 && (
        <section aria-label="What I found" className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[15px]">What I found</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {result.found.map((f) => (
              <li key={f.from + f.text} className="flex gap-1.5">
                <span aria-hidden="true" className="text-accent-ink">
                  ✓
                </span>
                <span>
                  <strong>{FOUND_LABEL[f.from]}</strong> {f.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Questions" className="flex flex-col gap-3">
        <div>
          <h3 className="m-0 text-[15px]">{result.questions.length === 1 ? 'One quick question' : 'Two quick questions'}</h3>
          <p className="m-0 text-xs text-muted">{result.questions.length === 1 ? 'It changes the estimate the most. Skip it and I’ll use the typical amount.' : 'They change the estimate the most. Skip either one and I’ll use the typical amount.'}</p>
        </div>
        {result.questions.map((q, i) => (
          <Question key={q.text} q={q} mobile={mobile} value={s.answers[i] ?? null} onChange={(v) => s.setAnswers(s.answers.map((a, j) => (j === i ? v : a)))} />
        ))}
      </section>
      <div className={`${FOOTER} flex justify-end gap-2`}>
        <Button variant="ghost" onClick={() => s.showEstimate(result, none)}>
          Skip
        </Button>
        <Button variant="primary" onClick={() => s.showEstimate(result, s.answers)}>
          Show my estimate
        </Button>
      </div>
    </div>
  );
}

/** "Anything different?": the change comes back as items, for the rider to see before logging. */
function AnythingDifferent({ s, focusRef }: { s: EstimateFoodState; focusRef: RefObject<HTMLInputElement | null> }) {
  const id = useId();
  const adjust = useAdjustEstimate();
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const update = () => {
    const said = message.trim();
    if (said.length < 2 || adjust.isPending) return;
    setError(null);
    adjust.mutate(
      { kind: s.result?.kind ?? s.kind, items: s.items, message: said, ...(s.result?.kind !== 'home' && s.place.trim() ? { place: s.place.trim() } : {}) },
      {
        onSuccess: (r) => {
          if (r.items.length) s.changeItems(r.items);
          setReply(r.reply);
          setMessage('');
        },
        onError: (e) => setError(errorContent(e)),
      },
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        Anything different?
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          ref={focusRef}
          value={message}
          maxLength={500}
          placeholder="e.g. no butter on the steak, I also had a coffee"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              update();
            }
          }}
          className={`${inputCls} min-w-0 flex-auto`}
        />
        <Button disabled={message.trim().length < 2 || adjust.isPending} onClick={update}>
          {adjust.isPending ? 'Updating…' : 'Update'}
        </Button>
      </div>
      {reply && <div className="text-xs text-muted">{reply}</div>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

function Review({ s, result, lib, date, slot, isToday, mobile, onClose }: { s: EstimateFoodState; result: EstimateResult; lib: FoodLibrary; date: IsoDate; slot: string; isToday: boolean; mobile: boolean; onClose: () => void }) {
  const id = useId();
  const m = useFoodMutations();
  const addRef = useRef<HTMLInputElement>(null);
  const budget = useEnergyBudget(date).data;
  const dayLog = useFoodLog(date).data;
  const [logAs, setLogAs] = useState<'meal' | 'items'>('meal');
  // The kind it was estimated as, even if the picker has moved since.
  const place = result.kind === 'restaurant' ? s.place.trim() : '';
  // On when a place is named: that's what makes it findable next time.
  const [save, setSave] = useState(!!place);
  const [error, setError] = useState<string | null>(null);
  const dish = (result.kind === 'home' && s.dish.trim()) || result.dish;
  const name = (place ? `${place} · ${dish}` : dish).slice(0, 120);
  const { nutrients } = estimateTotals(s.items);
  const eaten = sumNutrients((dayLog?.entries ?? []).map((e) => e.nutrients)).kcal;
  const left = budget?.ready ? Math.round(budget.total - eaten - nutrients.kcal) : null;

  const log = () =>
    m.logEstimate.mutate(
      {
        date,
        slot,
        time: lib.settings.slots.find((x) => x.name === slot)?.time ?? nowTime(),
        name,
        kind: result.kind,
        ...(place ? { place } : {}),
        items: s.items,
        logAs,
        ...(save ? { saveAs: name } : {}),
        images: s.photos.map((p) => ({ mediaType: p.mediaType, data: p.data, kind: result.kind === 'home' ? 'plate' : p.kind })),
      },
      { onSuccess: onClose, onError: (e) => setError(errorMessage(e)) },
    );

  return (
    <div className="flex flex-[1_0_auto] flex-col gap-4">
      <EstimateHeader items={s.items} left={left} isToday={isToday} onItemsChange={s.changeItems} />
      <SearchNote result={result} place={place} />
      <div className="flex items-baseline justify-between">
        <h3 className="m-0 text-base">What’s in it</h3>
        <button type="button" onClick={() => addRef.current?.focus()} className="min-h-11 border-0 bg-transparent text-[13px] font-semibold text-[#3F6212]">
          + Add something
        </button>
      </div>
      <EstimateItems items={s.items} mobile={mobile} onChange={s.changeItems} />
      <AnythingDifferent s={s} focusRef={addRef} />
      {s.items.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] font-semibold">Log as</div>
          <Segmented
            label="Log as"
            value={logAs}
            onChange={setLogAs}
            options={[
              { key: 'meal', label: 'One meal' },
              { key: 'items', label: `${s.items.length} items` },
            ]}
          />
        </div>
      )}
      <label htmlFor={id} className="flex min-h-11 items-start gap-2.5 text-[13px]">
        <input id={id} type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="mt-0.5 h-4 w-4 flex-none" />
        <span>
          <span className="font-semibold">Save as “{name}”</span>
          <span className="block text-xs text-muted">Next time, search for it. No AI needed.</span>
        </span>
      </label>
      <div className={`${FOOTER} flex flex-col gap-1.5`}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button variant="primary" disabled={!s.items.length || m.logEstimate.isPending} onClick={log}>
          Log ≈ {fmtKcal(nutrients.kcal)} kcal to {slot}
        </Button>
        <div className="text-center text-xs text-muted">Logged as an estimate. You can change it later.</div>
      </div>
    </div>
  );
}

/**
 * Estimate, in Log food: the one place food logging guesses (DECISIONS #94, #104), so every number here
 * is marked as one, and nothing is written until Log. Home-cooked goes by what's in it; Restaurant can
 * name the place and look up its published nutrition.
 */
export function EstimateFood({
  s,
  lib,
  date,
  slot,
  isToday,
  mobile,
  modeSwitch,
  onSearchMode,
  onClose,
}: {
  s: EstimateFoodState;
  lib: FoodLibrary;
  date: IsoDate;
  slot: string;
  isToday: boolean;
  mobile: boolean;
  modeSwitch: ReactNode;
  onSearchMode: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const estimate = useEstimateMeal();
  const home = s.kind === 'home';
  const ready = (s.photos.length > 0 || s.text.trim().length >= 2 || (home && s.dish.trim().length >= 2)) && !estimate.isPending && !s.preparing;

  const run = () => {
    if (!ready) return;
    if (s.touched && !window.confirm('Estimate again? Your changes to this estimate will be lost.')) return;
    s.setError(null);
    const place = home ? '' : s.place.trim();
    const dish = home ? s.dish.trim() : '';
    const text = s.text.trim();
    estimate.mutate(
      {
        kind: s.kind,
        ...(place ? { place } : {}),
        ...(dish ? { dish } : {}),
        ...(text ? { text } : {}),
        images: s.photos.map((p) => ({ mediaType: p.mediaType, data: p.data, kind: s.photoKind(p) })),
        search: s.search,
      },
      { onSuccess: s.receive, onError: (e) => s.setError(errorContent(e)) },
    );
  };

  const paste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    void s.addPhotos(files);
  };

  const enter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  };

  const restaurantFields = (
    <>
      <label className="flex flex-col gap-1 text-[13px] font-semibold" htmlFor={`${id}-place`}>
        <span>
          {mobile ? 'Where are you?' : 'Where were you?'} <span className="font-normal text-muted">optional</span>
        </span>
        <input id={`${id}-place`} value={s.place} maxLength={120} placeholder="The Keg · Prince George" onChange={(e) => s.setPlace(e.target.value)} className={`${inputCls} font-normal`} />
        <span className="text-xs font-normal text-muted">Chains often publish nutrition. Naming it helps the estimate.</span>
      </label>
      <label htmlFor={`${id}-search`} className={`flex min-h-11 items-start gap-2.5 text-[13px] ${s.canSearch ? '' : 'opacity-60'}`}>
        <input id={`${id}-search`} type="checkbox" checked={s.search} disabled={!s.canSearch} onChange={(e) => s.setSearch(e.target.checked)} className="mt-0.5 h-4 w-4 flex-none" />
        <span>
          <span className="font-semibold">Look up published nutrition</span>
          <span className="block text-xs text-muted">{s.canSearch ? 'Searches the web for this place’s nutrition. A few seconds slower.' : 'Name the place to look it up.'}</span>
        </span>
      </label>
      <Photos s={s} mobile={mobile} />
      <label className="flex flex-col gap-1 text-[13px] font-semibold" htmlFor={`${id}-text`}>
        What did you have?
        <textarea
          id={`${id}-text`}
          rows={mobile ? 3 : 4}
          value={s.text}
          maxLength={2000}
          placeholder="8 oz sirloin, garlic mashed instead of fries, side caesar. Shared the bread, had 2 pieces. Pint of lager."
          onChange={(e) => s.setText(e.target.value)}
          onKeyDown={enter}
          className={`${inputCls} resize-none font-normal`}
        />
        <span className="text-xs font-normal text-muted">Swaps, sides, sauces, how much you ate, and drinks all help.</span>
      </label>
    </>
  );

  const homeFields = (
    <>
      <Photos s={s} mobile={mobile} />
      <label className="flex flex-col gap-1 text-[13px] font-semibold" htmlFor={`${id}-dish`}>
        What was it?
        <input id={`${id}-dish`} value={s.dish} maxLength={120} placeholder="Lasagna, caesar salad, garlic bread" onChange={(e) => s.setDish(e.target.value)} className={`${inputCls} font-normal`} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold" htmlFor={`${id}-text`}>
        What’s in it?
        <textarea
          id={`${id}-text`}
          rows={mobile ? 3 : 4}
          value={s.text}
          maxLength={2000}
          placeholder="Beef and pork, ricotta, mozzarella, tomato sauce. A big square, about a sixth of the pan. Salad with creamy dressing, one piece of garlic bread."
          onChange={(e) => s.setText(e.target.value)}
          onKeyDown={enter}
          className={`${inputCls} resize-none font-normal`}
        />
        <span className="text-xs font-normal text-muted">Ingredients, how it was cooked, and how much you had all help.</span>
      </label>
    </>
  );

  const capture = (
    <div className="flex flex-col gap-3" onPaste={paste}>
      <Segmented
        label="What kind of meal"
        value={s.kind}
        onChange={s.setKind}
        options={[
          { key: 'home', label: 'Home-cooked' },
          { key: 'restaurant', label: 'Restaurant' },
        ]}
      />
      {home ? homeFields : restaurantFields}
      {s.error && <ErrorNote>{s.error}</ErrorNote>}
      <div className="flex flex-col gap-1">
        <Button variant="primary" disabled={!ready} onClick={run}>
          {estimate.isPending ? 'Estimating…' : s.result ? 'Re-estimate' : 'Estimate my meal'}
          {!mobile && !estimate.isPending && <kbd className="ml-1.5 rounded border border-black/20 px-1 font-mono text-[11px]">⌘↵</kbd>}
        </Button>
        <span className="text-center text-xs text-muted">{s.result ? 'Changed something? Estimate again.' : 'You’ll see what it thinks and change anything before it’s logged.'}</span>
      </div>
      {!mobile && (
        <div className="text-[13px] text-muted">
          Know exactly what it was?{' '}
          <button type="button" onClick={onSearchMode} className="border-0 bg-transparent p-0 font-medium text-accent-ink">
            Search my foods
          </button>
        </div>
      )}
    </div>
  );

  const working = s.search ? `Looking up ${s.place.trim()}…` : 'Working out your meal…';

  const panel =
    estimate.isPending ? (
      <div className="flex flex-auto items-center justify-center">
        <Spinner label={working} />
      </div>
    ) : s.stage === 'questions' && s.result ? (
      <Questions s={s} result={s.result} mobile={mobile} />
    ) : s.stage === 'review' && s.result ? (
      <Review s={s} result={s.result} lib={lib} date={date} slot={slot} isToday={isToday} mobile={mobile} onClose={onClose} />
    ) : (
      <div className="flex flex-auto flex-col items-center justify-center gap-1 p-6 text-center">
        <div className="text-[15px] font-semibold">Your estimate shows up here</div>
        <p className="m-0 text-[13px] text-muted">
          {home
            ? 'Add a photo of your plate, say what it was and what’s in it, then press Estimate my meal. You’ll see each item with a range and change anything before it’s logged.'
            : 'Add a photo of your plate or the menu, say what you had, then press Estimate my meal. You’ll see each item with a range and change anything before it’s logged.'}
        </p>
      </div>
    );

  if (mobile) {
    if (s.stage === 'capture' || estimate.isPending) {
      return (
        <>
          {modeSwitch}
          {capture}
          {estimate.isPending && <Spinner label={working} />}
        </>
      );
    }
    return (
      <>
        <button type="button" onClick={() => s.setStage('capture')} className="flex min-h-[44px] items-center gap-1 self-start border-0 bg-transparent p-0 font-medium text-accent-ink">
          <ChevronLeft /> Photos and description
        </button>
        {panel}
      </>
    );
  }

  return (
    <div className="grid min-h-0 flex-auto grid-cols-[minmax(0,1fr)_400px] grid-rows-[minmax(0,1fr)] gap-5">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {modeSwitch}
        {capture}
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto rounded-[12px] border border-line bg-surface-alt p-4">{panel}</div>
    </div>
  );
}
