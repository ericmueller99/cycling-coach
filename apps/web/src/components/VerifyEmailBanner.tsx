import { useEffect, useState } from 'react';
import { sendVerificationEmail } from '../lib/api';
import { errorMessage, useAuthConfig, useMe } from '../lib/queries';

const COOLDOWN_S = 60;

/**
 * "Check your inbox" until the email address is confirmed, on servers that ask for it
 * (DECISIONS #61). The link in the email signs the athlete in and brings them back here. `bar`
 * runs across the top of a scrolling page (onboarding); `card` sits in the desktop sidebar and on
 * the Account page, so the full-height pages (coach, calendar) keep their layout.
 */
export function VerifyEmailBanner({ variant }: { variant: 'bar' | 'card' }) {
  const me = useMe().data;
  const config = useAuthConfig().data;
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!me || !config?.emailVerification || me.emailVerified) return null;

  const resend = async () => {
    setState('sending');
    setError(null);
    try {
      await sendVerificationEmail(me.email);
      setState('sent');
      setWait(COOLDOWN_S);
    } catch (err) {
      setState('idle');
      setError(errorMessage(err));
    }
  };

  const label = state === 'sending' ? 'Sending…' : wait > 0 ? `Sent · again in ${wait} s` : 'Resend email';
  if (variant === 'card') {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl border border-accent-line bg-accent-tint p-3 text-[13px]">
        <div className="font-semibold">Confirm your email</div>
        <div className="text-muted">
          We sent a link to <span className="break-all text-ink">{me.email}</span>. Your coach can chat once it's confirmed.
        </div>
        {error && <div className="text-danger">{error}</div>}
        <button
          type="button"
          onClick={resend}
          disabled={state === 'sending' || wait > 0}
          className="min-h-8 rounded-lg border border-accent-line bg-surface px-3 font-medium text-accent-ink disabled:text-muted mobile:min-h-11"
        >
          {label}
        </button>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-accent-line bg-accent-tint px-7 py-2 text-[13px] mobile:px-4">
      <span className="min-w-0 flex-1">
        Check your inbox to confirm <strong className="font-semibold">{me.email}</strong>. Your coach can chat once it's confirmed.
        {error && <span className="text-danger"> {error}</span>}
      </span>
      <button
        type="button"
        onClick={resend}
        disabled={state === 'sending' || wait > 0}
        className="min-h-8 rounded-lg border border-accent-line bg-surface px-3 font-medium text-accent-ink disabled:text-muted mobile:min-h-11"
      >
        {label}
      </button>
    </div>
  );
}
