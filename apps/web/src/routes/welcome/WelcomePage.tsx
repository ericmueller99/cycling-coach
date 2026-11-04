import { RAMP_TEST, wattsPerKg } from '@cycling-coach/core';
import {
  ftpSources,
  ONBOARDING_DONE_STEP,
  ONBOARDING_GOAL_LABEL,
  onboardingGoalChips,
  type FtpSource,
  type OnboardingGoalChip,
  type OnboardingState,
} from '@cycling-coach/shared';
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandTile } from '../../components/BrandTile';
import { CheckIcon, ChevronLeft, MemoryIcon, PlusIcon, XIcon } from '../../components/icons';
import { ErrorNote, Spinner } from '../../components/ui';
import { VerifyEmailBanner } from '../../components/VerifyEmailBanner';
import { ZoneChart } from '../../components/ZoneChart';
import { useExtensions } from '../../extensions';
import { errorMessage, useIntervals, useOnboarding, useOnboardingMutations, useProfileMutations } from '../../lib/queries';

/**
 * First-run onboarding (DECISIONS #62): five steps and a summary, one card, no app shell. Every
 * Continue saves its step, so a refresh resumes where the athlete was; Skip saves nothing.
 */

const LABELS = ['Fitness', 'Body', 'Goals', 'Memory', 'Sync'] as const;
const SOURCE_LABEL: Record<FtpSource, string> = {
  zwift: 'Zwift',
  ramp: 'A ramp test',
  '20min': 'A 20-minute test',
  app: 'Another app',
  guess: 'My best guess',
};
const KG_PER_LB = 0.45359237;
const SUGGESTIONS = [
  { label: 'Indoor or outdoor', text: 'Rides indoors on Zwift from November to March' },
  { label: 'Riding background', text: 'Riding for 6 years, mostly road and gravel' },
  { label: 'Workouts I like', text: 'Prefers short, hard sessions midweek' },
  { label: 'Things to work around', text: 'Keep long rides under 3 hours for now' },
];

export function WelcomePage() {
  const state = useOnboarding();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Already through it when the page opened (not just now, on "Go to my coach"): to the app. Only
  // on /welcome itself: while "Go to my coach" navigates, this page renders once more under the
  // new path, and redirecting then would drop the coach's prompt.
  const doneOnArrival = useRef<boolean | null>(null);
  if (state.data && doneOnArrival.current === null) doneOnArrival.current = !!state.data.completedAt;
  if (state.isPending) return <Spinner />;
  if (state.error || !state.data) return <ErrorNote>{errorMessage(state.error)}</ErrorNote>;
  if (doneOnArrival.current) return pathname === '/welcome' ? <Navigate to="/" replace /> : <Spinner />;
  return <Wizard initial={state.data} />;
}

/** The answers being edited, seeded once from the saved state. */
interface Draft {
  known: boolean;
  ftp: string;
  source: FtpSource;
  unit: 'kg' | 'lb';
  weight: string;
  chips: OnboardingGoalChip[];
  mainTitle: string;
  mainDate: string;
  eventName: string;
  eventDate: string;
  note: string;
}

function draftFrom(s: OnboardingState): Draft {
  const f = s.fitness;
  const unit = s.body?.unit ?? 'kg';
  const kg = s.body?.weightKg;
  return {
    known: f ? f.known : true,
    ftp: f?.known ? String(f.ftp) : '',
    source: f?.known ? f.source : 'zwift',
    unit,
    weight: kg === undefined ? '' : String(unit === 'lb' ? Math.round((kg / KG_PER_LB) * 10) / 10 : kg),
    chips: s.goals?.chips ?? [],
    mainTitle: s.goals?.main?.title ?? '',
    mainDate: s.goals?.main?.date ?? '',
    eventName: s.goals?.event?.name ?? '',
    eventDate: s.goals?.event?.date ?? '',
    note: '',
  };
}

function Wizard({ initial }: { initial: OnboardingState }) {
  const navigate = useNavigate();
  const { brand } = useExtensions();
  const server = useOnboarding().data ?? initial;
  const m = useOnboardingMutations();
  const { createMemory, deleteMemory } = useProfileMutations();
  const intervals = useIntervals().data;
  const [step, setStep] = useState(Math.min(initial.step, ONBOARDING_DONE_STEP));
  /** Came here from the summary's Edit: Continue goes back to it. */
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>(() => draftFrom(initial));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const busy = m.fitness.isPending || m.body.isPending || m.goals.isPending || m.step.isPending || m.finish.isPending;
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [step]);

  const connected = intervals?.status === 'connected';
  const ftpNum = Number(d.ftp);
  const kg = d.unit === 'lb' ? Number(d.weight) * KG_PER_LB : Number(d.weight);
  const go = (n: number) => {
    setError(null);
    setStep(editing && n < ONBOARDING_DONE_STEP ? ONBOARDING_DONE_STEP : n);
    if (editing) setEditing(false);
  };

  async function save(): Promise<boolean> {
    setError(null);
    try {
      if (step === 0) {
        if (d.known && !(Number.isInteger(ftpNum) && ftpNum >= 50 && ftpNum <= 700)) return fail('Enter your FTP in watts (50–700), or pick "I\'m not sure".');
        await m.fitness.mutateAsync(d.known ? { known: true, ftp: ftpNum, source: d.source } : { known: false });
      } else if (step === 1) {
        if (!(kg >= 30 && kg <= 200)) return fail(d.unit === 'kg' ? 'Enter your weight in kg (30–200).' : 'Enter your weight in lb (66–440).');
        await m.body.mutateAsync({ weightKg: Number(d.weight), unit: d.unit, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
      } else if (step === 2) {
        const event = d.chips.includes('event');
        if (!d.chips.length && !d.mainTitle.trim()) return fail('Pick at least one goal, or write your main goal.');
        if (event && (!d.eventName.trim() || !d.eventDate)) return fail('Add the event’s name and date.');
        await m.goals.mutateAsync({
          chips: d.chips,
          ...(d.mainTitle.trim() ? { main: { title: d.mainTitle.trim(), ...(d.mainDate ? { date: d.mainDate } : {}) } } : {}),
          ...(event ? { event: { name: d.eventName.trim(), date: d.eventDate } } : {}),
        });
      } else {
        await m.step.mutateAsync(step + 1);
      }
      return true;
    } catch (err) {
      return fail(errorMessage(err));
    }
  }
  function fail(message: string) {
    setError(message);
    return false;
  }

  async function next() {
    if (step === ONBOARDING_DONE_STEP) {
      try {
        const done = await m.finish.mutateAsync();
        const ramp = done.rampTest;
        await navigate({ to: '/', search: { new: true, prompt: ramp ? 'Plan my first week around the ramp test.' : 'Plan my first week.' } });
      } catch (err) {
        setError(errorMessage(err));
      }
      return;
    }
    if (await save()) go(step + 1);
  }
  async function skip() {
    setError(null);
    try {
      await m.step.mutateAsync(step + 1);
      go(step + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addNote(text: string) {
    const t = text.trim();
    if (!t) return;
    try {
      await createMemory.mutateAsync(t);
      set({ note: '' });
      await m.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function removeNote(id: string) {
    try {
      await deleteMemory.mutateAsync(id);
      await m.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const done = step === ONBOARDING_DONE_STEP;
  const tip = {
    0: d.known ? 'A rough number is fine. If your rides show it is off, I will suggest an update.' : "No problem. Until the ramp test, I'll keep your rides by feel and heart rate.",
    1: 'If you weigh in regularly and connect intervals.icu, I can keep this up to date for you.',
    2: "I'll plan backwards from your main goal and check in on progress every week.",
    3: "For short-term things, like 'I'm away next week', just tell me in chat. I'll remember them for as long as they matter.",
    4: 'You can skip this and connect later from the Athlete page.',
    5: d.known ? 'Tell me which days you can ride this week and I will fill in your calendar.' : "Your ramp test goes on tomorrow's calendar; move it if another day suits you. Then tell me when you can ride and I'll plan around it.",
  }[step];

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-7 py-4 max-[640px]:px-5">
        <div className="flex items-center gap-2.5">
          <BrandTile size={32} radius={9} />
          <span className="text-base font-bold">{brand}</span>
        </div>
        <span className="text-[13px] text-muted">{done ? 'Setup complete' : `Step ${step + 1} of 5`}</span>
      </header>
      <VerifyEmailBanner variant="bar" />
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-12 max-[640px]:p-0">
        <div ref={top} className="box-border flex w-full max-w-[660px] scroll-mt-4 flex-col rounded-[20px] border border-line bg-surface max-[640px]:max-w-none max-[640px]:rounded-none max-[640px]:border-0">
          {!done && <Progress step={step} />}
          <div key={step} className="flex flex-col gap-[22px] px-8 pt-7 pb-2 max-[640px]:px-5 motion-safe:animate-[obIn_.35s_ease-out_both]">
            {step === 0 && <FitnessStep d={d} set={set} />}
            {step === 1 && <BodyStep d={d} set={set} ftp={d.known && ftpNum ? ftpNum : undefined} kg={kg} />}
            {step === 2 && <GoalsStep d={d} set={set} />}
            {step === 3 && <MemoryStep d={d} set={set} notes={server.memories} add={addNote} remove={removeNote} busy={createMemory.isPending || deleteMemory.isPending} />}
            {step === 4 && <SyncStep connected={connected} />}
            {done && (
              <DoneStep
                d={d}
                kg={kg}
                state={server}
                connected={connected}
                edit={(i) => {
                  setError(null);
                  setEditing(true);
                  setStep(i);
                }}
              />
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="flex items-start gap-2.5 rounded-xl border border-accent-line bg-accent-tint px-3.5 py-3">
              <BrandTile size={26} radius={7} />
              <span className="text-sm text-[#2C3A12]">{tip}</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2.5 rounded-b-[20px] border-t border-line bg-surface px-8 py-4 max-[640px]:sticky max-[640px]:bottom-0 max-[640px]:rounded-none max-[640px]:px-5 max-[640px]:pb-[calc(16px+env(safe-area-inset-bottom))]">
            {step > 0 && !done && (
              <button type="button" onClick={() => go(step - 1)} disabled={busy} className={secondaryBtn}>
                <ChevronLeft size={16} />
                Back
              </button>
            )}
            <span className="flex-1" />
            {(step === 3 || (step === 4 && !connected)) && !editing && (
              <button type="button" onClick={skip} disabled={busy} className="min-h-[46px] rounded-[10px] border-0 bg-transparent px-3 font-semibold text-muted">
                Skip for now
              </button>
            )}
            <button type="button" onClick={next} disabled={busy} className="min-h-[46px] rounded-[10px] border-0 bg-accent px-[22px] text-[15px] font-semibold text-on-accent disabled:opacity-60">
              {busy ? 'Saving…' : done ? 'Go to my coach' : editing ? 'Save' : step === 4 ? 'Finish setup' : 'Continue'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

const secondaryBtn = 'flex min-h-[46px] items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3.5 font-semibold text-ink';
const inputCls =
  'box-border min-h-[46px] w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[15px] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent-ring max-[640px]:text-base';

function Progress({ step }: { step: number }) {
  return (
    <div className="flex flex-col gap-2 px-8 pt-[22px] max-[640px]:px-5">
      <div aria-hidden="true" className="grid grid-cols-5 gap-1.5">
        {LABELS.map((l, i) => (
          <div key={l} className={`h-1 rounded-full transition-colors ${i < step ? 'bg-accent-ring' : i === step ? 'bg-accent' : 'bg-track'}`} />
        ))}
      </div>
      <ol className="m-0 grid list-none grid-cols-5 gap-1.5 p-0 text-xs max-[640px]:hidden">
        {LABELS.map((l, i) => (
          <li key={l} aria-current={i === step ? 'step' : undefined} className={`${i <= step ? 'text-ink' : 'text-faint'} ${i === step ? 'font-semibold' : 'font-medium'}`}>
            {l}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-[0.06em] text-accent-ink uppercase">{eyebrow}</span>
      <h1 className="m-0 text-[28px] leading-tight font-bold tracking-[-0.01em] max-[640px]:text-2xl">{title}</h1>
      <p className="m-0 text-[15px] text-muted">{sub}</p>
    </div>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium">
      {text}
      {children}
    </label>
  );
}

type StepProps = { d: Draft; set: (p: Partial<Draft>) => void };

function Choice({ on, onClick, icon, title, sub }: { on: boolean; onClick: () => void; icon: ReactNode; title: string; sub: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-11 items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left text-ink ${on ? 'border-accent-ring bg-[#F9FCEF]' : 'border-line bg-surface'}`}
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-hover text-accent-ink">{icon}</span>
      <span className="flex flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-[13px] text-muted">{sub}</span>
      </span>
    </button>
  );
}

function FitnessStep({ d, set }: StepProps) {
  return (
    <>
      <StepHead eyebrow="Step 1 · Fitness" title="What's your FTP?" sub="Functional threshold power is roughly the watts you can hold for an hour. It sets the targets in every workout." />
      <div role="group" aria-label="Do you know your FTP?" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        <Choice
          on={d.known}
          onClick={() => set({ known: true })}
          title="I know my FTP"
          sub="From Zwift, a recent test or another app"
          icon={
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
            </svg>
          }
        />
        <Choice
          on={!d.known}
          onClick={() => set({ known: false })}
          title="I'm not sure"
          sub="We'll find it with a ramp test"
          icon={
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" />
            </svg>
          }
        />
      </div>
      {d.known ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
          <Label text="FTP">
            <span className="relative flex">
              <input type="number" inputMode="numeric" min={50} max={700} value={d.ftp} onChange={(e) => set({ ftp: e.target.value })} className={`${inputCls} pr-10 font-mono`} />
              <span className="absolute top-[13px] right-3 text-muted">W</span>
            </span>
          </Label>
          <Label text="Where's it from?">
            <select value={d.source} onChange={(e) => set({ source: e.target.value as FtpSource })} className={`${inputCls} px-2.5`}>
              {ftpSources.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Label>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[14px] border border-accent-line bg-accent-tint p-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Your first workout will be a ramp test</span>
            <span className="text-sm text-[#3B4250]">
              About 25 minutes. The power steps up every minute until you can't hold it, and your coach sets your FTP from the result. It goes on your calendar as your first to-do.
            </span>
          </div>
          <div className="rounded-lg bg-surface px-1.5 pt-1.5">
            <ZoneChart segments={RAMP_TEST.segments} height={64} />
          </div>
        </div>
      )}
    </>
  );
}

function BodyStep({ d, set, ftp, kg }: StepProps & { ftp: number | undefined; kg: number }) {
  const switchUnit = (unit: 'kg' | 'lb') => {
    if (unit === d.unit) return;
    const n = Number(d.weight);
    const converted = d.weight && Number.isFinite(n) ? String(Math.round((unit === 'lb' ? n / KG_PER_LB : n * KG_PER_LB) * 10) / 10) : d.weight;
    set({ unit, weight: converted });
  };
  return (
    <>
      <StepHead eyebrow="Step 2 · Body" title="What's your current weight?" sub="Used for W/kg, climbing and your daily calorie budget. Only you and your coach see it." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_200px]">
          <Label text="Weight">
            <span className="relative flex">
              <input type="number" inputMode="decimal" step="0.1" value={d.weight} onChange={(e) => set({ weight: e.target.value })} className={`${inputCls} pr-11 font-mono`} />
              <span className="absolute top-[13px] right-3 text-muted">{d.unit}</span>
            </span>
          </Label>
        </div>
        <div role="group" aria-label="Units" className="flex rounded-[10px] bg-hover p-[3px]">
          {(['kg', 'lb'] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={d.unit === u}
              onClick={() => switchUnit(u)}
              className={`min-h-10 min-w-14 rounded-lg border-0 font-semibold text-ink ${d.unit === u ? 'bg-surface' : 'bg-transparent'}`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      {ftp && (
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-[10px] bg-surface-2 px-3 py-2.5">
            <div className="text-xs text-muted">FTP</div>
            <div className="font-mono text-base font-semibold">{ftp} W</div>
          </div>
          <div className="flex-1 rounded-[10px] bg-surface-2 px-3 py-2.5">
            <div className="text-xs text-muted">Power to weight</div>
            <div className="font-mono text-base font-semibold text-accent-ink">{kg >= 30 ? `${wattsPerKg(ftp, kg).toFixed(2)} W/kg` : '—'}</div>
          </div>
        </div>
      )}
    </>
  );
}

function GoalsStep({ d, set }: StepProps) {
  const toggle = (c: OnboardingGoalChip) => set({ chips: d.chips.includes(c) ? d.chips.filter((x) => x !== c) : [...d.chips, c] });
  return (
    <>
      <StepHead eyebrow="Step 3 · Goals" title="What are you training for?" sub="Pick any that fit. Add a target now, or talk it through with your coach later." />
      <div role="group" aria-label="Goals" className="flex flex-wrap gap-2">
        {onboardingGoalChips.map((c) => {
          const on = d.chips.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              className={`flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-3.5 font-semibold text-ink transition-colors ${on ? 'border-accent-ring bg-accent-tint' : 'border-line-strong bg-surface'}`}
            >
              {on && <CheckIcon size={14} className="text-accent-ink" />}
              {ONBOARDING_GOAL_LABEL[c]}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-line p-4">
        <span className="font-semibold">Main goal</span>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <Label text="What does success look like?">
            <input type="text" maxLength={120} placeholder="e.g. Raise my FTP to 300 W" value={d.mainTitle} onChange={(e) => set({ mainTitle: e.target.value })} className={inputCls} />
          </Label>
          <Label text="By when?">
            <input type="date" value={d.mainDate} onChange={(e) => set({ mainDate: e.target.value })} className={inputCls} />
          </Label>
        </div>
        {d.chips.includes('event') && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <Label text="Event name">
              <input type="text" maxLength={100} placeholder="e.g. Gran Fondo Whistler" value={d.eventName} onChange={(e) => set({ eventName: e.target.value })} className={inputCls} />
            </Label>
            <Label text="Event date">
              <input type="date" value={d.eventDate} onChange={(e) => set({ eventDate: e.target.value })} className={inputCls} />
            </Label>
          </div>
        )}
      </div>
    </>
  );
}

function MemoryStep({
  d,
  set,
  notes,
  add,
  remove,
  busy,
}: StepProps & { notes: OnboardingState['memories']; add: (t: string) => void; remove: (id: string) => void; busy: boolean }) {
  const texts = new Set(notes.map((n) => n.text));
  const ideas = SUGGESTIONS.filter((s) => !texts.has(s.text));
  return (
    <>
      <StepHead
        eyebrow="Step 4 · Memory · optional"
        title="What should your coach know?"
        sub="The long-term things: your usual schedule, what you like, what to work around. Your coach reads these before every chat and every plan."
      />
      <div className="overflow-hidden rounded-[14px] border border-line">
        {notes.map((n) => (
          <div key={n.id} className="flex items-center gap-2.5 border-b border-divider py-2.5 pr-2 pl-3.5">
            <MemoryIcon size={16} className="flex-none text-accent-ink" />
            <span className="min-w-0 flex-1">{n.text}</span>
            <button type="button" onClick={() => remove(n.id)} disabled={busy} aria-label="Remove note" className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted">
              <XIcon size={16} />
            </button>
          </div>
        ))}
        <form
          className="flex flex-wrap gap-2 bg-surface-alt px-3.5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            add(d.note);
          }}
        >
          <input
            type="text"
            aria-label="New note"
            maxLength={500}
            placeholder="Add something your coach should know…"
            value={d.note}
            onChange={(e) => set({ note: e.target.value })}
            className={`${inputCls} min-h-11 flex-[1_1_220px]`}
          />
          <button type="submit" disabled={busy || !d.note.trim()} className="min-h-11 rounded-[10px] border-0 bg-ink px-4 font-semibold text-white disabled:opacity-60">
            Add note
          </button>
        </form>
      </div>
      {ideas.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted">Ideas to get started</span>
          <div className="flex flex-wrap gap-2">
            {ideas.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={busy}
                onClick={() => add(s.text)}
                className="flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-[#B8C0CC] bg-surface px-3 text-[13px] font-semibold text-ink"
              >
                <PlusIcon size={12} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SyncStep({ connected }: { connected: boolean }) {
  const { intervalsConnect } = useExtensions();
  const arrow = (dir: 'out' | 'in') => (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'out' ? 'M5 12h14M13 6l6 6-6 6' : 'M19 12H5M11 6l-6 6 6 6'} />
    </svg>
  );
  return (
    <>
      <StepHead
        eyebrow="Step 5 · Sync · optional"
        title="Connect intervals.icu"
        sub="Keep your training in sync both ways. Planned workouts go out to your intervals.icu calendar, and from there to the apps and devices you ride with. Your rides come back so your coach knows what you actually did."
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        <div className="flex flex-col gap-1.5 rounded-xl bg-surface-2 px-3.5 py-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">{arrow('out')}Sends</span>
          <span>Planned workouts and races</span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-xl bg-surface-2 px-3.5 py-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">{arrow('in')}Brings back</span>
          <span>Completed rides, fitness and load, weigh-ins</span>
        </div>
      </div>
      {connected ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border-2 border-accent-ring bg-[#F9FCEF] p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-white">
            <CheckIcon size={18} />
          </span>
          <span className="flex flex-[1_1_220px] flex-col">
            <span className="font-semibold">Connected</span>
            <span className="text-[13px] text-muted">Your rides and weigh-ins sync in the background. Recent ones show up within a few minutes.</span>
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 rounded-[14px] border border-line p-4">
          <span className="text-[13px] text-muted">{intervalsConnect.hint}</span>
          {intervalsConnect.action}
          <span className="text-xs text-muted">You can connect or disconnect any time from the Athlete page.</span>
        </div>
      )}
    </>
  );
}

function DoneStep({ d, kg, state, connected, edit }: { d: Draft; kg: number; state: OnboardingState; connected: boolean; edit: (step: number) => void }) {
  const ftp = d.known ? Number(d.ftp) : undefined;
  const goals = state.createdGoals.map((g) => g.title);
  const rows = [
    { label: 'FTP', value: ftp ? `${ftp} W${kg >= 30 ? ` · ${wattsPerKg(ftp, kg).toFixed(2)} W/kg` : ''}` : 'Ramp test first', step: 0 },
    { label: 'Weight', value: d.weight ? `${d.weight} ${d.unit}` : '—', step: 1 },
    { label: 'Goals', value: goals.length ? goals.join(' · ') : 'None yet', step: 2 },
    { label: 'Memory', value: state.memories.length === 1 ? '1 note' : `${state.memories.length} notes`, step: 3 },
    { label: 'intervals.icu', value: connected ? 'Connected' : 'Not connected', step: 4 },
  ];
  const todos = [
    ...(!ftp ? [{ title: 'Ramp test', meta: 'About 25 min · on your calendar for tomorrow', accent: true }] : []),
    { title: 'Plan your first week', meta: 'Tell your coach when you can ride', accent: false },
    ...(!connected ? [{ title: 'Connect intervals.icu', meta: 'Sync workouts and rides', accent: false }] : []),
  ];
  return (
    <>
      <div className="flex flex-col items-start gap-2.5">
        <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-accent text-on-accent">
          <CheckIcon size={24} />
        </span>
        <h1 className="m-0 text-[28px] leading-tight font-bold tracking-[-0.01em] max-[640px]:text-2xl">You're all set</h1>
        <p className="m-0 text-[15px] text-muted">Here's what your coach knows so far. You can change any of it later.</p>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 border-b border-divider px-3.5 py-3 last:border-b-0">
            <span className="w-[110px] flex-none text-[13px] text-muted">{r.label}</span>
            <span className="min-w-0 flex-1 font-medium">{r.value}</span>
            <button type="button" onClick={() => edit(r.step)} className="min-h-9 flex-none rounded-lg border-0 bg-transparent px-2.5 text-[13px] font-semibold text-accent-ink">
              Edit<span className="sr-only"> {r.label}</span>
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Your first to-dos</span>
        {todos.map((t) => (
          <div key={t.title} className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${t.accent ? 'border-accent-line bg-accent-tint' : 'border-line bg-surface'}`}>
            <span aria-hidden="true" className="box-border h-5 w-5 flex-none rounded-md border-2 border-[#B8C0CC]" />
            <span className="flex flex-1 flex-col">
              <span className="font-semibold">{t.title}</span>
              <span className="text-[13px] text-muted">{t.meta}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
