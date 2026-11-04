import { Link } from '@tanstack/react-router';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { BrandLogo } from '../../components/BrandLogo';
import { ChevronLeft, LogoIcon } from '../../components/icons';
import { useExtensions } from '../../extensions';
import { passwordMeter } from '../../lib/password';
import { useIsMobile } from '../../lib/useIsMobile';
import { MIN_PASSWORD_LENGTH } from '@cycling-coach/shared';

/**
 * The public auth pages (DECISIONS #61): sign in, register, forgot and reset. Desktop is the form
 * beside a dark showcase panel of static sample content; below 800 px each page has its own phone
 * layout. No app shell.
 */

export function BrandMark({ size = 34, text = 16, tone = 'light' }: { size?: number; text?: number; tone?: 'light' | 'dark' }) {
  const { brand, logo } = useExtensions();
  if (logo) return <BrandLogo logo={logo} alt={brand} height={size + 6} tone={tone} />;
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center justify-center rounded-[9px] bg-accent text-on-accent" style={{ width: size, height: size }}>
        <LogoIcon size={Math.round(size * 0.53)} />
      </div>
      <div className="font-bold" style={{ fontSize: text }}>
        {brand}
      </div>
    </div>
  );
}

/** "© 2026 Brand · Privacy · Terms". */
export function AuthFooter() {
  const { brand, legalLinks } = useExtensions();
  return (
    <div className="flex gap-4 text-xs text-faint">
      <span>
        © {new Date().getFullYear()} {brand}
      </span>
      {legalLinks && (
        <>
          <a href={legalLinks.privacy} className="text-muted no-underline hover:text-ink">
            Privacy
          </a>
          <a href={legalLinks.terms} className="text-muted no-underline hover:text-ink">
            Terms
          </a>
        </>
      )}
    </div>
  );
}

type Showcase = 'signin' | 'register';

/**
 * Desktop: form column + showcase. Phone: `dark` puts a chat sample above a white sheet (sign in);
 * `back` is a white page with a back chevron to sign in (register, forgot, reset).
 */
export function AuthLayout({ showcase, phone, children }: { showcase: Showcase; phone: 'dark' | 'back'; children: ReactNode }) {
  const mobile = useIsMobile();
  if (mobile && phone === 'dark') {
    return (
      <div className="flex min-h-dvh flex-col bg-ink">
        <header className="flex flex-col gap-5 px-5 py-7 text-white">
          <BrandMark size={32} tone="dark" />
          <div className="flex flex-col gap-2.5" aria-hidden="true">
            <div className="max-w-[82%] self-end rounded-[16px_16px_4px_16px] bg-[#2A3140] px-[13px] py-[9px] text-[#E6EEF9]">What should I ride today?</div>
            <div className="flex items-start gap-2">
              <CoachTile size={26} />
              <div className="text-[#D5D9E0]">4 × 8 min at threshold — you're fresh, and the race is 12 days out.</div>
            </div>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-5 rounded-t-[24px] bg-surface px-5 pt-7 pb-6 text-ink">{children}</main>
      </div>
    );
  }
  if (mobile) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface text-ink">
        <header className="flex items-center justify-between border-b border-divider py-2 pr-2 pl-1">
          <Link to="/login" aria-label="Back to sign in" className="flex h-11 w-11 items-center justify-center rounded-[10px] text-ink">
            <ChevronLeft size={22} />
          </Link>
          <BrandMark size={28} text={15} />
          <div className="w-11" />
        </header>
        <main className="flex flex-1 flex-col gap-5 px-5 py-6">{children}</main>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-wrap bg-surface text-ink">
      <main className="box-border flex min-w-0 flex-[1_1_440px] flex-col gap-6 px-10 py-8">
        <BrandMark />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-[380px] flex-col gap-5">{children}</div>
        </div>
        <AuthFooter />
      </main>
      {showcase === 'signin' ? <SignInShowcase /> : <RegisterShowcase />}
    </div>
  );
}

export function AuthHeading({ title, sub }: { title: string; sub: ReactNode }) {
  const mobile = useIsMobile();
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className={`m-0 leading-tight font-bold tracking-[-0.01em] ${mobile ? 'text-[26px]' : 'text-[28px]'}`}>{title}</h1>
      <p className="m-0 text-[15px] text-muted">{sub}</p>
    </div>
  );
}

const fieldCls =
  'box-border w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent-ring mobile:px-3.5 mobile:text-base';

export function TextField({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <input id={id} className={`${fieldCls} min-h-11 mobile:min-h-12`} {...input} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

const EyeIcon = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Password with a show/hide eye; `meter` adds the 3-segment strength hint under it. */
export function PasswordField({
  label = 'Password',
  value,
  onChange,
  autoComplete,
  meter = false,
  aside,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  meter?: boolean;
  /** Right of the label ("Forgot password?" on desktop). */
  aside?: ReactNode;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const score = passwordMeter(value);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative flex">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={autoComplete === 'new-password' ? MIN_PASSWORD_LENGTH : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={meter ? `${id}-hint` : undefined}
          className={`${fieldCls} min-h-11 flex-1 pr-12 mobile:min-h-12 mobile:pr-[52px]`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute top-0.5 right-0.5 flex h-10 w-10 items-center justify-center rounded-lg border-0 bg-transparent text-muted mobile:h-11 mobile:w-11"
        >
          <EyeIcon />
        </button>
      </div>
      {meter && (
        <div id={`${id}-hint`} className="flex items-center gap-2 text-xs text-muted mobile:text-[13px]">
          <div aria-hidden="true" className="flex gap-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-1 w-7 rounded-full mobile:w-6 ${score >= i ? 'bg-accent-ring' : 'bg-track'}`} />
            ))}
          </div>
          At least {MIN_PASSWORD_LENGTH} characters
        </div>
      )}
    </div>
  );
}

export function SubmitButton({ busy, children, busyLabel, disabled }: { busy: boolean; children: ReactNode; busyLabel: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="min-h-12 rounded-[10px] border-0 bg-accent text-[15px] font-semibold text-on-accent disabled:opacity-60 mobile:min-h-[52px] mobile:rounded-xl mobile:text-base"
    >
      {busy ? busyLabel : children}
    </button>
  );
}

function CoachTile({ size }: { size: number }) {
  return (
    <div className="flex flex-none items-center justify-center rounded-lg bg-accent text-on-accent" style={{ width: size, height: size }}>
      <LogoIcon size={Math.round(size * 0.53)} />
    </div>
  );
}

const panel = 'box-border m-3 flex min-w-0 flex-[1.25_1_520px] flex-col justify-center gap-8 rounded-[20px] bg-ink px-12 py-14 text-white';
const darkCard = 'rounded-[14px] border border-[#2E3440] bg-[#1E232C]';

const PLAN = [
  { day: 'Tue', type: 'Intervals', fg: '#F7A06A', bg: 'rgba(245,120,42,.18)', title: '4 × 8 min threshold', dur: '1:05' },
  { day: 'Thu', type: 'Recovery', fg: '#B6BDC9', bg: 'rgba(122,132,148,.22)', title: 'Easy spin, high cadence', dur: '0:45' },
  { day: 'Sat', type: 'Endurance', fg: '#7FB2FF', bg: 'rgba(59,139,246,.18)', title: 'Long Z2 ride', dur: '2:30' },
];

function SignInShowcase() {
  const { brand } = useExtensions();
  return (
    <aside aria-label={`What ${brand} does`} className={panel}>
      <div className="flex max-w-[520px] flex-col gap-3">
        <div className="text-xs font-semibold tracking-[0.06em] text-accent uppercase">AI cycling coach</div>
        <h2 className="m-0 text-[34px] leading-[1.15] font-bold tracking-[-0.015em]">Training built around your week — and the food to fuel it.</h2>
        <p className="m-0 text-[15px] text-[#A3AAB6]">
          Set a goal, tell your coach when you can ride, and it fills your calendar with workouts. Log what you eat and get meals that fit the training.
        </p>
      </div>
      <div className="flex max-w-[560px] flex-col gap-3" aria-hidden="true">
        <div className="max-w-[78%] self-end rounded-[16px_16px_4px_16px] bg-[#2A3140] px-3.5 py-2.5 text-[#E6EEF9]">
          I can ride Tuesday and Thursday evenings, plus a long one Saturday. Race on the 22nd.
        </div>
        <div className="flex items-start gap-2.5">
          <CoachTile size={30} />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="text-[#D5D9E0]">Here's your week — intervals Tuesday, an easy spin Thursday, and a long endurance ride Saturday.</div>
            <div className={`${darkCard} overflow-hidden`}>
              <div className="flex items-center justify-between gap-3 border-b border-[#2E3440] px-3.5 py-3">
                <div className="font-semibold">This week's plan</div>
                <div className="rounded-lg bg-accent px-2.5 py-[5px] text-xs font-semibold text-on-accent">Add all to calendar</div>
              </div>
              {PLAN.map((r) => (
                <div key={r.day} className="flex items-center gap-3 border-t border-[#262C36] px-3.5 py-2.5 first-of-type:border-t-0">
                  <div className="w-[34px] font-mono text-xs text-[#A3AAB6]">{r.day}</div>
                  <div className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ color: r.fg, background: r.bg }}>
                    {r.type}
                  </div>
                  <div className="min-w-0 flex-1 truncate">{r.title}</div>
                  <div className="font-mono text-xs text-[#A3AAB6]">{r.dur}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={`${darkCard} ml-10 flex items-center gap-3 px-3.5 py-3`}>
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#2A3140] text-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11h16a8 8 0 0 1-16 0z" />
              <path d="M8 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M16 7c0-1.5 1-2 1-3.5" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Dinner idea · fuels Tuesday's intervals</div>
            <div className="text-[13px] text-[#A3AAB6]">
              Chicken rice bowl · <span className="font-mono">680</span> kcal · <span className="font-mono">42</span> g protein
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: ReactNode }) {
  return (
    <li className={`${darkCard} flex gap-4 px-[18px] py-4`}>
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent text-[13px] font-bold text-on-accent">{n}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div>
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="text-[#A3AAB6]">{body}</div>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-[#262C36] px-3 py-2.5" aria-hidden="true">
          {children}
        </div>
      </div>
    </li>
  );
}

const DarkBar = ({ pct }: { pct: number }) => (
  <div className="h-1.5 rounded-full bg-[#3A414D]">
    <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
  </div>
);

function RegisterShowcase() {
  const { brand } = useExtensions();
  return (
    <aside aria-label={`How ${brand} works`} className={panel}>
      <div className="flex max-w-[520px] flex-col gap-3">
        <div className="text-xs font-semibold tracking-[0.06em] text-accent uppercase">How it works</div>
        <h2 className="m-0 text-[34px] leading-[1.15] font-bold tracking-[-0.015em]">Three steps to a plan that fits your life.</h2>
      </div>
      <ol className="m-0 flex max-w-[560px] list-none flex-col gap-3.5 p-0">
        <Step n={1} title="Set your goal" body="An event, a power target or a fitness milestone — the coach plans backwards from it.">
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="font-semibold">Raise my FTP to 300 W</span>
            <span className="font-mono text-[#A3AAB6]">by Mar 1</span>
          </div>
          <DarkBar pct={62} />
        </Step>
        <Step
          n={2}
          title="Tell it when you can ride, week by week"
          body="No fixed weekly schedule. Tell the coach what this week looks like and it fills in your calendar. It also remembers what you've told it before."
        >
          <div className="max-w-[88%] self-end rounded-[12px_12px_4px_12px] bg-[#2A3140] px-[11px] py-[7px] text-[13px] text-[#E6EEF9]">
            Fill in my schedule this week. I'm free Wednesday after 6 and most of Saturday.
          </div>
          <div className="flex items-start gap-2 text-[13px] text-[#D5D9E0]">
            <CoachTile size={22} />
            <div>Intervals Wednesday evening and a long ride Saturday. Added both to your calendar.</div>
          </div>
          <div className="ml-[30px] text-xs text-[#A3AAB6]">Also remembered: no rides before 7 am on weekdays</div>
        </Step>
        <Step n={3} title="Eat for the training" body="Log food in a sentence, and ask for meals and recipes that fit the day.">
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="font-semibold">Today</span>
            <span className="font-mono text-[#A3AAB6]">2,310 / 2,890 kcal</span>
          </div>
          <DarkBar pct={80} />
        </Step>
      </ol>
    </aside>
  );
}
