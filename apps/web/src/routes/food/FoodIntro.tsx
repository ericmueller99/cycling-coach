import { defaultPortionIndex, foodFromStaple } from '@cycling-coach/core';
import type { Food, FoodLibrary, StapleResult } from '@cycling-coach/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../../components/Dialog';
import { ChevronLeft, SearchIcon, SparkleIcon, XIcon } from '../../components/icons';
import { Button, ErrorNote, Spinner, inputCls } from '../../components/ui';
import { fetchStapleDetail, useFoodMutations, useStapleSearch } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { LabelAddPanel } from './LabelAddPanel';
import { useDebounced } from './staples';

/**
 * The food intro (DESIGN.md section 16, DECISIONS #88): why the user's foods start empty, how
 * logging by talking pays that back, and a real start on the list. Step 2 is canned, with no model
 * call and nothing logged. Step 3 is real: what's added there is saved. It's its own modal because
 * it goes full screen on phones, where `Dialog` would be a bottom sheet.
 */

const STEPS = ['Why it starts empty', 'Log by talking', 'Add your foods'] as const;

const TIPS = [
  "Nothing is wrong with your empty list. It fills up with the foods you really eat, and that's what makes AI logging accurate.",
  "If you say something that isn't in your foods, I'll tell you and offer to add it from Staples or a label.",
  'The trade-off: the first week or two takes a few extra taps while your list fills up. After that, most of what you eat is already here.',
];

const TITLE_ID = 'food-intro-title';

function StepHead({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-[0.06em] text-accent-ink uppercase">{eyebrow}</span>
      <h1 id={TITLE_ID} className="m-0 text-[27px] leading-[1.2] font-bold tracking-[-0.01em] max-[640px]:text-[23px]">
        {title}
      </h1>
      <p className="m-0 text-[15px] text-muted">{children}</p>
    </div>
  );
}

const NOISY = [
  ['Tortellini, cheese, generic', '307'],
  ['Three-cheese tortellini (restaurant)', '540'],
  ['Tortellini in cream sauce', '620'],
  ['Spinach tortellini, frozen', '280'],
  ['Tortellini soup, canned', '190'],
  ['Meat tortellini, dried', '350'],
] as const;

function SearchLook() {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-2.5 py-2 text-[#3B4250]">
      <SearchIcon size={15} />
      tortellini
    </div>
  );
}

function WhyStep() {
  return (
    <>
      <StepHead eyebrow="Why it works this way" title="Your foods start empty. On purpose.">
        Most food apps search one giant shared database. Here you keep a list of only the foods you actually eat, so your coach can log from a plain sentence and pick the right thing.
      </StepHead>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-[#FAFAFB] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#3B4250]">A shared database</span>
            <span className="rounded-full bg-[#FFF4E5] px-2 py-0.5 text-xs font-semibold text-[#B54708]">Hundreds of matches</span>
          </div>
          <SearchLook />
          <div className="flex flex-col text-[13px] text-muted">
            {NOISY.map(([name, kcal], i) => (
              <div key={name} className="flex justify-between gap-2 border-b border-divider px-0.5 py-1.5" style={{ opacity: 1 - i * 0.13 }}>
                <span>{name}</span>
                <span className="font-mono whitespace-nowrap">{kcal}</span>
              </div>
            ))}
          </div>
          <span className="text-[13px] text-muted">Which one did you eat? The AI has to guess.</span>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[14px] border-2 border-accent-ring bg-[#F9FCEF] p-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Your foods</span>
            <span className="rounded-full bg-[#E4F5B5] px-2 py-0.5 text-xs font-semibold text-accent-ink">1 match</span>
          </div>
          <SearchLook />
          <div className="flex items-center gap-2.5 rounded-[10px] border border-accent-line bg-surface px-3 py-2.5">
            <span className="flex size-[26px] flex-none items-center justify-center rounded-full bg-accent">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E1014" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5 9-10" />
              </svg>
            </span>
            <span className="flex min-w-0 flex-auto flex-col">
              <span className="font-semibold">Cheese tortellini</span>
              <span className="text-xs text-muted">Your usual · 1 cup (113 g)</span>
            </span>
            <span className="font-mono text-[13px] font-semibold whitespace-nowrap">330 kcal</span>
          </div>
          <span className="text-[13px] text-[#3B4250]">The one you buy. Nothing to guess.</span>
        </div>
      </div>
    </>
  );
}

const HEARD = [
  { heard: 'Tortellini', food: 'Cheese tortellini', why: 'Your foods · your usual portion', amount: '1 cup', kcal: '330 kcal' },
  { heard: '50 grams of cheese', food: 'Parmesan, grated', why: 'Your foods · your only cheese', amount: '50 g', kcal: '196 kcal' },
];

function TalkStep() {
  const [demo, setDemo] = useState<'idle' | 'busy' | 'done'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = () => {
    setDemo('busy');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDemo('done'), 1100);
  };
  return (
    <>
      <StepHead eyebrow="The payoff" title="Then just say what you ate">
        Because the AI only looks at your foods, a short sentence is enough. Try it.
      </StepHead>
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border-[1.5px] border-accent-ring p-1.5">
        <span className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-ink px-2.5 text-[13px] font-semibold text-accent">
          <SparkleIcon size={14} />
          AI
        </span>
        <span className="min-w-0 flex-[1_1_200px] px-1.5 text-[15px]">Tortellini with 50 grams of cheese</span>
        <button type="button" onClick={run} disabled={demo === 'busy'} className="flex min-h-11 items-center gap-2 rounded-[10px] border-0 bg-ink px-4 font-semibold text-white">
          {demo === 'busy' && (
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="3" className="motion-safe:animate-spin">
              <circle cx="12" cy="12" r="9" stroke="#3B4250" />
              <path d="M12 3a9 9 0 0 1 9 9" stroke="#C8F25A" strokeLinecap="round" />
            </svg>
          )}
          {demo === 'busy' ? 'Reading…' : demo === 'done' ? 'Try again' : 'Log with AI'}
        </button>
      </div>
      {demo !== 'done' ? (
        <div className="rounded-[14px] border-[1.5px] border-dashed border-line-strong p-[22px] text-center text-muted">
          Press <strong className="text-ink">Log with AI</strong> to see how it reads the sentence.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-line motion-safe:animate-[obIn_.35s_ease-out_both]">
          <div className="flex justify-between gap-2 border-b border-line bg-bg px-3.5 py-2.5 text-[13px]">
            <span className="font-semibold">Add to Dinner?</span>
            <span className="text-muted">2 items · 526 kcal</span>
          </div>
          {HEARD.map((r) => (
            <div key={r.food} className="flex items-center gap-3 border-b border-divider px-3.5 py-3">
              <span className="flex min-w-0 flex-auto flex-col">
                <span className="text-xs text-muted">“{r.heard}”</span>
                <span className="font-semibold">{r.food}</span>
                <span className="text-xs font-medium text-accent-ink">{r.why}</span>
              </span>
              <span className="text-right font-mono text-[13px] whitespace-nowrap">
                {r.amount}
                <br />
                <span className="text-muted">{r.kcal}</span>
              </span>
            </div>
          ))}
          <div className="px-3.5 py-2.5 text-[13px] text-muted">You check it before anything is logged.</div>
        </div>
      )}
    </>
  );
}

/** Reading a label for real, then a "scan another" that starts it over. */
function ScanTab() {
  const [saved, setSaved] = useState<Food | null>(null);
  if (saved) {
    return (
      <div role="status" className="flex flex-col gap-2.5 motion-safe:animate-[obIn_.35s_ease-out_both]">
        <div className="flex items-center gap-2.5 rounded-xl border border-[#B7E0C2] bg-[#ECF7EF] px-3.5 py-3 text-[#14532D]">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
            <path d="M5 12l5 5 9-10" />
          </svg>
          <span>
            <strong>{saved.name}</strong> is in your foods.
          </span>
        </div>
        <span>
          <Button onClick={() => setSaved(null)}>Scan another</Button>
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[#3B4250]">Snap the nutrition label and the values are read for you. You check them before anything is saved. Barcodes work too, from Log food.</p>
      <LabelAddPanel onSaved={(food) => setSaved(food)} />
    </div>
  );
}

/** Starting points, not a list of foods: each runs a real search. */
const POPULAR = ['banana', 'egg', 'oats', 'rice', 'chicken breast'];

/** Live staples search. "+ Add" is the save (rule 1a): nothing becomes a food without that tap. */
function StapleTab() {
  const m = useFoodMutations();
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim(), 250);
  const cnf = useStapleSearch(q, 'cnf');
  const usda = useStapleSearch(q, 'usda', cnf.isSuccess && !cnf.data.results.length);
  const hits = [...(cnf.data?.results ?? []), ...(usda.data?.results ?? [])].slice(0, 6);
  const searching = cnf.isFetching || usda.isFetching || q !== input.trim();
  const unavailable = cnf.data?.unavailable ?? usda.data?.unavailable;
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const keyOf = (hit: StapleResult) => `${hit.source}:${hit.ref}`;

  const add = async (hit: StapleResult) => {
    setError(null);
    setAdding(keyOf(hit));
    try {
      const detail = await fetchStapleDetail(hit.source, hit.ref);
      await m.createFood.mutateAsync(foodFromStaple(detail, { name: hit.name, defaultIndex: defaultPortionIndex(detail.portions) }));
      setAdded((s) => new Set(s).add(keyOf(hit)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[#3B4250]">Staples are plain foods without a label, like fruit, eggs, rice or chicken, from the Canadian Nutrient File. Add one and it's yours.</p>
      <label className="relative flex">
        <span className="absolute top-1/2 left-3 flex -translate-y-1/2 text-muted">
          <SearchIcon size={17} />
        </span>
        <input type="search" aria-label="Search staples" placeholder="Search staples, e.g. banana" value={input} onChange={(e) => setInput(e.target.value)} className={`${inputCls} w-full pl-[38px] max-[640px]:text-base`} />
      </label>
      {!input.trim() && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-muted">Popular:</span>
          {POPULAR.map((p) => (
            <button key={p} type="button" onClick={() => setInput(p)} className="min-h-10 rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
              {p}
            </button>
          ))}
        </div>
      )}
      {unavailable && <ErrorNote>{unavailable}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {q.length >= 2 && searching && <Spinner label="Searching…" />}
      {hits.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-xl border border-line">
          {hits.map((hit) => {
            const key = keyOf(hit);
            return (
              <div key={key} className="flex items-center gap-3 border-b border-divider py-2 pr-2 pl-3.5 last:border-b-0">
                <span className="flex min-w-0 flex-auto flex-col">
                  <span className="font-semibold">{hit.name}</span>
                  <span className="text-xs text-muted">{Math.round(hit.kcalPer100g)} kcal per 100 g</span>
                </span>
                {added.has(key) ? (
                  <span className="flex min-h-10 items-center px-3 font-semibold text-accent-ink">Added</span>
                ) : (
                  <Button aria-label={`Add ${hit.name} to my foods`} disabled={adding !== null} onClick={() => void add(hit)}>
                    {adding === key ? 'Adding…' : '+ Add'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {q.length >= 2 && !searching && !hits.length && !unavailable && <div className="rounded-xl border border-line p-3.5 text-muted">No staple matches. For packaged food, scan its label instead.</div>}
    </div>
  );
}

function AddStep({ lib }: { lib: FoodLibrary }) {
  const [tab, setTab] = useState<'scan' | 'staple'>('scan');
  const count = lib.foods.filter((f) => !f.archived).length;
  const tabCls = (on: boolean) => `flex min-h-11 flex-[1_1_0] items-center justify-center rounded-[9px] border-0 font-semibold text-ink ${on ? 'bg-surface' : 'bg-transparent'}`;
  return (
    <>
      <StepHead eyebrow="Building your list" title="Add a food once, log it forever">
        When something isn't in your foods yet, add it one of two ways. Try both.
      </StepHead>
      <div role="tablist" aria-label="Ways to add a food" className="flex gap-1 rounded-xl bg-hover p-1">
        <button type="button" role="tab" aria-selected={tab === 'scan'} onClick={() => setTab('scan')} className={tabCls(tab === 'scan')}>
          Scan a label
        </button>
        <button type="button" role="tab" aria-selected={tab === 'staple'} onClick={() => setTab('staple')} className={tabCls(tab === 'staple')}>
          Add a staple
        </button>
      </div>
      {tab === 'scan' ? <ScanTab /> : <StapleTab />}
      {count > 0 && (
        <div className="text-[13px] text-[#3B4250]">
          <strong>{count === 1 ? '1 food' : `${count} foods`}</strong> in your foods so far.
        </div>
      )}
    </>
  );
}

/** `onEnd(true)` is Start logging food; every other way out is `onEnd(false)`. */
export function FoodIntro({ lib, onEnd }: { lib: FoodLibrary; onEnd: (startLogging: boolean) => void }) {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useModal(ref, () => onEnd(false));
  const last = step === STEPS.length - 1;
  const pad = 'px-7 max-[640px]:px-5';

  return createPortal(
    // The scrim doesn't close it: this shows once, and a stray click shouldn't use that up.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,16,20,.48)] p-4 max-[640px]:items-stretch max-[640px]:bg-surface max-[640px]:p-0">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-64px)] w-full max-w-[680px] flex-col overflow-hidden rounded-[20px] bg-surface shadow-[0_24px_64px_rgba(14,16,20,.28)] outline-none max-[640px]:h-dvh max-[640px]:max-h-none max-[640px]:max-w-none max-[640px]:rounded-none max-[640px]:shadow-none"
      >
        <div className={`flex flex-none flex-col gap-2.5 pt-[18px] ${pad}`}>
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-muted">Food · quick intro</span>
            <span className="grow" />
            <span className="text-[13px] text-muted">
              Step {step + 1} of {STEPS.length}
            </span>
            <button type="button" aria-label="Close intro" onClick={() => onEnd(false)} className="-mr-2.5 flex size-10 items-center justify-center rounded-[10px] border-0 bg-transparent text-muted hover:bg-surface-2">
              <XIcon size={18} />
            </button>
          </div>
          <div aria-hidden="true" className="grid grid-cols-3 gap-1.5">
            {STEPS.map((label, i) => (
              <div key={label} className="flex flex-col gap-1.5">
                <div className={`h-1 rounded-full transition-colors duration-300 ${i < step ? 'bg-accent-ring' : i === step ? 'bg-accent' : 'bg-track'}`} />
                <span className={`text-xs max-[640px]:hidden ${i === step ? 'font-semibold' : 'font-medium'} ${i <= step ? 'text-ink' : 'text-faint'}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div key={step} className={`flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto pt-[22px] pb-5 ${pad}`}>
          <div className="flex flex-col gap-5 motion-safe:animate-[obIn_.35s_ease-out_both]">
            {step === 0 && <WhyStep />}
            {step === 1 && <TalkStep />}
            {step === 2 && <AddStep lib={lib} />}
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-accent-line bg-accent-tint px-3.5 py-3">
            <span className="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-accent text-on-accent">
              <SparkleIcon size={14} />
            </span>
            <span className="text-sm text-[#2C3A12]">{TIPS[step]}</span>
          </div>
        </div>

        <div className={`flex flex-none items-center gap-2.5 border-t border-line bg-surface py-3.5 ${pad}`}>
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="flex min-h-[46px] items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3.5 font-semibold text-ink hover:bg-surface-2">
              <ChevronLeft />
              Back
            </button>
          )}
          {step === 0 && (
            <button type="button" onClick={() => onEnd(false)} className="min-h-[46px] rounded-[10px] border-0 bg-transparent px-3 font-semibold text-muted hover:bg-surface-2">
              Skip intro
            </button>
          )}
          <span className="grow" />
          <button type="button" onClick={() => (last ? onEnd(true) : setStep(step + 1))} className="min-h-[46px] rounded-[10px] border-0 bg-accent px-[22px] text-[15px] font-semibold text-on-accent hover:brightness-95">
            {last ? 'Start logging food' : 'Continue'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
