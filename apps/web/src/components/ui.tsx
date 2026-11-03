import type { SessionType } from '@cycling-coach/shared';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { SESSION_STYLE, TENTATIVE } from '../lib/session';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'neutral' | 'danger';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-0 bg-accent text-on-accent font-semibold',
  secondary: 'border border-line-strong bg-surface text-ink font-medium',
  ghost: 'border border-line-strong bg-transparent text-ink',
  /** A primary button with nothing to do yet ("Saved"): grey, not faded. */
  neutral: 'border-0 bg-hover text-faint font-semibold disabled:opacity-100',
  danger: 'border border-[#F1B5B0] bg-surface text-danger font-medium',
};

/** Primary buttons 40–44px, secondary 36px, radius 8–10px; every tap target ≥ 44px on mobile. */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  const sizing = size === 'sm' ? 'min-h-9 mobile:min-h-[44px] px-3 rounded-lg text-[13px]' : size === 'lg' ? 'min-h-11 mobile:min-h-[44px] px-4 rounded-[10px]' : 'min-h-10 mobile:min-h-[44px] px-3.5 rounded-[10px]';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 ${sizing} ${VARIANT[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-line bg-surface ${className}`}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{children}</div>;
}

export function SessionTag({ type, tentative, label }: { type: SessionType; tentative?: boolean | undefined; label?: string }) {
  const s = SESSION_STYLE[type];
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={
        tentative
          ? { color: TENTATIVE.fg, background: TENTATIVE.bg, border: `1px dashed ${TENTATIVE.border}` }
          : { color: s.fg, background: s.bg }
      }
    >
      {label ?? (tentative ? `${s.label}?` : s.label)}
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${tone === 'accent' ? 'bg-accent-tint-2 text-accent-ink' : 'bg-hover text-muted'}`}
    >
      {children}
    </span>
  );
}

export function StatTile({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="rounded-[10px] bg-surface-2 p-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono text-xl font-semibold">
        {value}
        {unit && <span className="text-xs text-muted"> {unit}</span>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, height = 8 }: { value: number; height?: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="overflow-hidden rounded bg-track" style={{ height }}>
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-7 py-[18px]">
      <div className="min-w-0">
        <h1 className="m-0 text-xl font-bold">{title}</h1>
        {subtitle && <div className="text-[13px] text-muted">{subtitle}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-[10px] border border-[#F3C4C0] bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="p-6 text-[13px] text-muted">{label}</div>;
}

/** A pill toggle (event filters, portion chips). */
export function Chip({ on, onClick, children, mobile }: { on: boolean; onClick: () => void; children: ReactNode; mobile?: boolean | undefined }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${mobile ? 'min-h-[36px]' : 'min-h-8'} rounded-full border px-2.5 text-[13px] ${on ? 'border-accent-ring bg-[#E4F5B5] font-semibold text-[#2F4A0D]' : 'border-line-strong bg-surface text-ink'}`}
    >
      {children}
    </button>
  );
}

/** Pill segmented control. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  small,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="grid rounded-[10px] bg-hover p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`${small ? 'min-h-[30px] text-xs' : 'min-h-8 text-[13px]'} rounded-lg border-0 ${value === o.key ? 'bg-surface font-semibold text-ink' : 'bg-transparent text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text input styling shared by forms (16px on mobile stops iOS zoom). */
export const inputCls =
  'min-h-10 min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-ink outline-none focus:border-accent-ring mobile:min-h-[44px]';

export function Field({ label, hint, htmlFor, children, className = '' }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** − value + in fixed steps (portions in 0.25s, recipe servings in 1s). */
export function Stepper({
  value,
  onChange,
  step = 0.25,
  min = 0,
  label,
  children,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  label: string;
  /** Replaces the plain number between the buttons (e.g. an input). */
  children?: ReactNode;
}) {
  const btn = 'flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border border-line-strong bg-surface text-lg text-ink mobile:h-12 mobile:w-12';
  const snap = (v: number) => Math.round(v / step) * step;
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} aria-label={`Less ${label}`} onClick={() => onChange(Math.max(min, snap(value - step + 1e-9)))}>
        −
      </button>
      {children ?? <span className="min-w-8 text-center font-mono font-semibold">{value}</span>}
      <button type="button" className={btn} aria-label={`More ${label}`} onClick={() => onChange(snap(value + step + 1e-9))}>
        +
      </button>
    </div>
  );
}
