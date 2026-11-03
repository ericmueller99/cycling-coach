import { MIN_PASSWORD_LENGTH } from '@cycling-coach/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { CheckCircleIcon, CheckIcon, ChevronRight, LockIcon } from '../components/icons';
import { Button, Card, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { VerifyEmailBanner } from '../components/VerifyEmailBanner';
import { useExtensions } from '../extensions';
import { ApiError, changePassword, signOut } from '../lib/api';
import { errorMessage, keys, useMe, useProfile, useProfileMutations, useUpdateName } from '../lib/queries';
import { useIsMobile } from '../lib/useIsMobile';

const INPUT = 'min-h-[42px] min-w-0 rounded-lg border bg-surface px-3 text-ink mobile:min-h-[44px]';

/**
 * Account: name, sign-in email, password, sign out. On mobile the password
 * form is its own full-screen view at `?password=1`, so the back arrow and gesture leave it.
 */
export function AccountPage({ password = false }: { password?: boolean | undefined }) {
  const me = useMe();
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const router = useRouter();
  const navigate = useNavigate();
  const { accountCards } = useExtensions();
  if (!me.data) return <Spinner />;

  async function onSignOut() {
    await signOut();
    // Root swaps to the login page on a null `me`; nothing else of this account stays cached.
    qc.setQueryData(keys.me, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  }

  if (mobile && password) {
    return (
      <>
        <AppBar back title="Change password" />
        <div className="flex flex-col p-4">
          <PasswordCard email={me.data.email} fullScreen onDone={() => router.history.back()} />
        </div>
      </>
    );
  }

  if (mobile) {
    return (
      <>
        <AppBar back title="Account" />
        <div className="flex flex-col gap-3.5 p-4">
          <VerifyEmailBanner variant="card" />
          <div className="flex flex-col items-center gap-1.5 py-2">
            <Avatar name={me.data.name} size={72} />
            <div className="text-[17px] font-semibold">{me.data.name}</div>
            <div className="text-[13px] text-muted">{me.data.email}</div>
          </div>
          <ProfileCard name={me.data.name} email={me.data.email} />
          <TimezoneCard />
          <Card className="overflow-hidden">
            <h2 className="m-0 px-4 pt-3.5 pb-1 text-[16px]">Security</h2>
            <button
              type="button"
              onClick={() => void navigate({ to: '/account', search: { password: true } })}
              className="flex min-h-[56px] w-full items-center gap-3 border-0 bg-transparent px-4 text-left text-ink"
            >
              <LockIcon size={20} className="flex-none text-muted" />
              <span className="flex-auto">
                <span className="block font-medium">Change password</span>
                <span className="block text-xs text-muted">Use at least {MIN_PASSWORD_LENGTH} characters</span>
              </span>
              <ChevronRight className="flex-none text-[#9AA1AD]" />
            </button>
          </Card>
          {accountCards}
          <Button variant="danger" className="min-h-[48px]! rounded-xl font-semibold" onClick={() => void onSignOut()}>
            Sign out
          </Button>
          <span className="text-center text-xs text-muted">
            Connections (intervals.icu, Zwift, Claude API) live on the <Link to="/athlete/$tab" params={{ tab: 'goals' }}>Athlete</Link> page.
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Account" subtitle="Your sign-in details" />
      <div className="flex w-full max-w-[600px] flex-col gap-5 p-7 max-[560px]:p-4">
        <VerifyEmailBanner variant="card" />
        <ProfileCard name={me.data.name} email={me.data.email} />
        <TimezoneCard />
        <PasswordCard email={me.data.email} />
        {accountCards}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-xs text-muted">
            Connections (intervals.icu, Zwift, Claude API) live on the <Link to="/athlete/$tab" params={{ tab: 'goals' }}>Athlete</Link> page.
          </span>
          <Button variant="danger" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </>
  );
}

function ProfileCard({ name, email }: { name: string; email: string }) {
  const update = useUpdateName();
  const mobile = useIsMobile();
  // null = showing the saved name; a string = being edited.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? name;
  const dirty = value.trim().length > 0 && value.trim() !== name;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty || update.isPending) return;
    update.mutate(value.trim(), { onSuccess: () => setDraft(null) });
  }

  return (
    <Card className="flex flex-col gap-4 p-5 mobile:gap-3 mobile:p-4">
      {mobile ? (
        <h2 className="m-0 text-[16px]">Profile</h2>
      ) : (
        <div className="flex items-center gap-3.5">
          <Avatar name={name} size={56} />
          <div>
            <h2 className="m-0 text-base">Profile</h2>
            <div className="text-[13px] text-muted">Your name is how the coach addresses you</div>
          </div>
        </div>
      )}
      <form onSubmit={save} className="flex flex-col gap-1">
        <label htmlFor="acc-name" className="text-xs font-medium text-muted">
          Name
        </label>
        <div className="flex gap-2 mobile:flex-col">
          <input
            id="acc-name"
            type="text"
            autoComplete="name"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            className={`${INPUT} grow border-line-strong`}
          />
          <Button type="submit" size="lg" variant={dirty ? 'primary' : 'neutral'} className="mobile:min-h-[48px]! mobile:rounded-xl" disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
        {update.isError && <ErrorNote>{errorMessage(update.error)}</ErrorNote>}
      </form>
      <div className="flex flex-col gap-1">
        <label htmlFor="acc-email" className="text-xs font-medium text-muted">
          Email
        </label>
        <div className="relative flex">
          <input
            id="acc-email"
            type="email"
            value={email}
            readOnly
            aria-describedby="email-note"
            className={`${INPUT} grow border-line bg-surface-2 pr-10 text-[#4B5563]`}
          />
          <LockIcon className="absolute top-[13px] right-3 text-faint" />
        </div>
        <span id="email-note" className="text-xs text-muted">
          Your sign-in email can&apos;t be changed here.
        </span>
      </div>
    </Card>
  );
}

/** Every IANA zone the browser knows, with the saved one first available even if it isn't listed. */
function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

/**
 * Timezone (moved here from the Athlete page): what "today" means for the calendar,
 * the food log and the coach. Saved on the profile, so the whole profile goes back with it.
 */
function TimezoneCard() {
  const profile = useProfile();
  const { saveProfile } = useProfileMutations();
  const saved = profile.data?.profile.timezone;
  const [draft, setDraft] = useState<string | null>(null);
  if (!profile.data || !saved) return null;
  const value = draft ?? saved;
  const dirty = value !== saved;
  return (
    <Card className="flex flex-col gap-2 p-5 mobile:p-4">
      <h2 className="m-0 text-base mobile:text-[16px]">Timezone</h2>
      <label htmlFor="acc-tz" className="text-xs font-medium text-muted">
        Used for "today" on the calendar, the food log and the coach
      </label>
      <div className="flex gap-2 mobile:flex-col">
        <select id="acc-tz" value={value} onChange={(e) => setDraft(e.target.value)} className={`${INPUT} grow border-line-strong`}>
          {timeZones(saved).map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <Button
          size="lg"
          variant={dirty ? 'primary' : 'neutral'}
          className="mobile:min-h-[48px]! mobile:rounded-xl"
          disabled={!dirty || saveProfile.isPending}
          onClick={() => saveProfile.mutate({ ...profile.data!.profile, timezone: value }, { onSuccess: () => setDraft(null) })}
        >
          {saveProfile.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>
      {saveProfile.isError && <ErrorNote>{errorMessage(saveProfile.error)}</ErrorNote>}
    </Card>
  );
}

const STRENGTH_COLOR = ['#E5E8EC', '#D92D20', '#E9B80F', '#7DA30A', '#15803D'];
const STRENGTH_LABEL = ['—', 'Weak', 'Fair', 'Good', 'Strong'];

/** 0–4: long enough, long, mixed case, a digit or symbol. A hint, not a rule. */
function strength(pw: string) {
  let score = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const EMPTY = { cur: '', nw: '', conf: '' };

/**
 * `email` fills a hidden username field so password managers update the right login. `fullScreen`
 * (mobile) opens straight on the form and hands Cancel / Done back to `onDone`.
 */
function PasswordCard({ email, fullScreen = false, onDone }: { email: string; fullScreen?: boolean; onDone?: () => void }) {
  const [mode, setMode] = useState<'idle' | 'form' | 'done'>(fullScreen ? 'form' : 'idle');
  const [pw, setPw] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [revoke, setRevoke] = useState(true);
  const [curError, setCurError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const score = strength(pw.nw);
  const rules = [
    { ok: pw.nw.length >= MIN_PASSWORD_LENGTH, text: `At least ${MIN_PASSWORD_LENGTH} characters` },
    { ok: pw.nw.length > 0 && pw.nw !== pw.cur, text: 'Different from your current password' },
    { ok: pw.nw.length > 0 && pw.nw === pw.conf, text: 'Both new passwords match' },
  ];
  const canSave = pw.cur.length > 0 && rules.every((r) => r.ok) && !busy;

  function open() {
    setPw(EMPTY);
    setCurError(false);
    setError(null);
    setShow(false);
    setMode('form');
  }

  function close() {
    setPw(EMPTY);
    if (fullScreen && onDone) onDone();
    else setMode('idle');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword({ currentPassword: pw.cur, newPassword: pw.nw, revokeOtherSessions: revoke });
      setPw(EMPTY);
      setMode('done');
    } catch (err) {
      // Keep the new-password fields so only the current one needs retyping.
      if (err instanceof ApiError && err.code === 'INVALID_PASSWORD') setCurError(true);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="m-0 text-base">Password</h2>
          <div className="text-[13px] text-muted">{mode === 'done' ? 'Changed just now' : `Use at least ${MIN_PASSWORD_LENGTH} characters`}</div>
        </div>
        {mode === 'idle' && <Button onClick={open}>Change password</Button>}
      </div>

      {mode === 'done' && (
        <div role="status" className="flex items-start gap-2.5 rounded-[10px] border border-[#ABEFC6] bg-[#ECFDF3] px-3.5 py-3 text-[13px] text-[#085D3A]">
          <CheckCircleIcon className="shrink-0" />
          <div className="grow">
            <strong>Password changed.</strong> {revoke ? 'Other devices have been signed out.' : 'You stay signed in on your other devices.'}
          </div>
          <button
            type="button"
            onClick={close}
            className="min-h-8 rounded-lg border border-[#ABEFC6] bg-surface px-2.5 text-[13px] font-semibold text-[#085D3A]"
          >
            Done
          </button>
        </div>
      )}

      {mode === 'form' && (
        <form onSubmit={submit} className="flex flex-col gap-3.5 border-t border-divider pt-3.5">
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <div className="flex flex-col gap-1">
            <label htmlFor="pw-cur" className="text-xs font-medium text-muted">
              Current password
            </label>
            <input
              id="pw-cur"
              type="password"
              autoComplete="current-password"
              value={pw.cur}
              onChange={(e) => {
                setPw({ ...pw, cur: e.target.value });
                setCurError(false);
              }}
              aria-invalid={curError}
              aria-describedby={curError ? 'pw-cur-err' : undefined}
              className={`${INPUT} ${curError ? 'border-[#D92D20]' : 'border-line-strong'}`}
            />
            {curError && (
              <span id="pw-cur-err" className="text-xs text-danger">
                That&apos;s not your current password.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pw-new" className="text-xs font-medium text-muted">
              New password
            </label>
            <div className="relative flex">
              <input
                id="pw-new"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={pw.nw}
                onChange={(e) => setPw({ ...pw, nw: e.target.value })}
                aria-describedby="pw-rules"
                className={`${INPUT} grow border-line-strong pr-16`}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute top-1 right-1 min-h-[34px] rounded-md bg-transparent px-2.5 text-[13px] font-semibold text-accent-ink"
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            <div aria-hidden="true" className="mt-1 grid grid-cols-4 gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-1 rounded-sm" style={{ background: pw.nw && score >= i ? STRENGTH_COLOR[score] : STRENGTH_COLOR[0] }} />
              ))}
            </div>
            <span className="text-xs text-muted">
              Strength: <strong style={{ color: pw.nw ? STRENGTH_COLOR[score] : undefined }}>{pw.nw ? STRENGTH_LABEL[score] : '—'}</strong>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pw-conf" className="text-xs font-medium text-muted">
              Confirm new password
            </label>
            <input
              id="pw-conf"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={pw.conf}
              onChange={(e) => setPw({ ...pw, conf: e.target.value })}
              className={`${INPUT} border-line-strong`}
            />
          </div>
          <ul id="pw-rules" className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {rules.map((r) => (
              <li key={r.text} className={`flex items-center gap-2 ${r.ok ? 'text-success' : 'text-muted'}`}>
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-white ${r.ok ? 'bg-success' : 'bg-[#C5CBD4]'}`}>
                  <CheckIcon size={10} strokeWidth={3.5} />
                </span>
                {r.text}
              </li>
            ))}
          </ul>
          <label className="flex min-h-10 items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} className="h-[18px] w-[18px] accent-accent-ink" />
            Sign out of other devices
          </label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex justify-end gap-2 mobile:grid mobile:grid-cols-2">
            <Button size="lg" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="lg" variant={canSave ? 'primary' : 'neutral'} disabled={!canSave}>
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
