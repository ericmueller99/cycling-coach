import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ErrorNote, Spinner } from '../../components/ui';
import { useExtensions } from '../../extensions';
import { ApiError, requestPasswordReset, resetPassword, signIn, signUp } from '../../lib/api';
import { errorMessage, keys, useAuthConfig } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { AuthHeading, AuthLayout, PasswordField, SubmitButton, TextField } from './parts';

/** The auth pages (DECISIONS #61). Signed-in visitors never see them: the router sends them on. */

const linkCls = 'font-semibold text-accent-ink no-underline hover:text-accent-ink-hover';

function useSubmit(run: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit };
}

export function SignInPage() {
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const config = useAuthConfig().data;
  const { brand, loginFooter } = useExtensions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const { busy, error, submit } = useSubmit(async () => {
    await signIn(email, password, remember);
    // The router sees the session and goes on to `?next=` (or the coach).
    await qc.invalidateQueries({ queryKey: keys.me });
  });
  const forgot = config?.passwordReset ? (
    <Link to="/forgot" className={`text-[13px] font-medium text-accent-ink no-underline ${mobile ? 'flex min-h-11 items-center text-sm' : ''}`}>
      Forgot password?
    </Link>
  ) : null;

  return (
    <AuthLayout showcase="signin" phone="dark">
      <AuthHeading title="Welcome back" sub={mobile ? 'Sign in to pick up where you left off.' : 'Sign in to pick up where you left off with your coach.'} />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <TextField label="Email" type="email" autoComplete="username" inputMode="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" aside={mobile ? null : forgot} />
          {mobile
            ? forgot && <div className="-mt-2 flex justify-end">{forgot}</div>
            : (
                <label className="flex min-h-7 cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="m-0 h-4 w-4 accent-accent-ink" />
                  Keep me signed in on this device
                </label>
              )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <SubmitButton busy={busy} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
        {config?.signUp && !mobile && (
          <p className="m-0 text-center text-muted">
            New to {brand}?{' '}
            <Link to="/register" className={linkCls}>
              Create an account
            </Link>
          </p>
        )}
      </form>
      {loginFooter && <div className="text-center text-sm text-muted">{loginFooter}</div>}
      {config?.signUp && mobile && (
        <>
          <div className="flex-1" />
          <div className="flex flex-col items-center gap-1 border-t border-divider pt-4">
            <span className="text-muted">New to {brand}?</span>
            <Link
              to="/register"
              className="box-border flex min-h-11 w-full items-center justify-center rounded-xl border border-line-strong font-semibold text-ink no-underline"
            >
              Create an account
            </Link>
          </div>
        </>
      )}
    </AuthLayout>
  );
}

export function RegisterPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const config = useAuthConfig();
  const { legalLinks, signUpClosed } = useExtensions();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const { busy, error, setError, submit } = useSubmit(async () => {
    try {
      await signUp({ name: name.trim(), email, password });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'USER_ALREADY_EXISTS') {
        setError(
          <>
            There's already an account with that email.{' '}
            <Link to="/login" className="font-semibold text-danger">
              Sign in instead
            </Link>
          </>,
        );
        return;
      }
      throw err;
    }
    await qc.invalidateQueries({ queryKey: keys.me });
    await navigate({ to: '/welcome', replace: true });
  });

  const signInLine = (
    <p className="m-0 text-center text-muted">
      Already have an account?{' '}
      <Link to="/login" className={linkCls}>
        Sign in
      </Link>
    </p>
  );

  if (config.isPending) return <Spinner />;
  if (!config.data?.signUp) {
    return (
      <AuthLayout showcase="register" phone="back">
        <AuthHeading title="Sign-up isn't open yet" sub={signUpClosed} />
        {signInLine}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout showcase="register" phone="back">
      <AuthHeading
        title="Create your account"
        sub={mobile ? "Next, you'll set a goal and tell your coach when you can ride." : 'Set a goal, tell your coach when you can ride, and get a plan that fits your week.'}
      />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <TextField
            label="First name"
            autoComplete="given-name"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...(mobile ? {} : { hint: 'Your coach calls you by this.' })}
          />
          <TextField label="Email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordField value={password} onChange={setPassword} autoComplete="new-password" meter />
          {legalLinks && (
            <label className="flex cursor-pointer items-start gap-2.5 pt-0.5 text-[13px] text-muted mobile:min-h-11 mobile:gap-3 mobile:text-sm">
              <input
                type="checkbox"
                required
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="m-0 mt-0.5 h-4 w-4 flex-none accent-accent-ink mobile:h-5 mobile:w-5"
              />
              <span>
                I agree to the{' '}
                <a href={legalLinks.terms} target="_blank" rel="noreferrer" className="font-medium text-accent-ink">
                  Terms
                </a>{' '}
                and{' '}
                <a href={legalLinks.privacy} target="_blank" rel="noreferrer" className="font-medium text-accent-ink">
                  Privacy policy
                </a>
                .
              </span>
            </label>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <SubmitButton busy={busy} busyLabel="Creating your account…" disabled={!!legalLinks && !agreed}>
          Create account
        </SubmitButton>
        {signInLine}
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const config = useAuthConfig();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await requestPasswordReset(email.trim());
    setSent(true);
  });

  if (config.isPending) return <Spinner />;
  return (
    <AuthLayout showcase="signin" phone="back">
      {!config.data?.passwordReset ? (
        <AuthHeading title="Forgot your password?" sub="This server can't send reset emails. Ask whoever runs it to reset your password." />
      ) : sent ? (
        <AuthHeading title="Check your inbox" sub={`If there's an account for ${email.trim()}, we've sent it a link to choose a new password. The link works for an hour.`} />
      ) : (
        <>
          <AuthHeading title="Forgot your password?" sub="Enter your email and we'll send you a link to choose a new one." />
          <form onSubmit={submit} className="flex flex-col gap-5">
            <TextField label="Email" type="email" autoComplete="username" inputMode="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <ErrorNote>{error}</ErrorNote>}
            <SubmitButton busy={busy} busyLabel="Sending…">
              Send reset link
            </SubmitButton>
          </form>
        </>
      )}
      <p className="m-0 text-center text-muted">
        <Link to="/login" className={linkCls}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

/** From the emailed link: Better Auth sends `?token=` here, or `?error=INVALID_TOKEN`. */
export function ResetPasswordPage({ token, error: linkError }: { token?: string | undefined; error?: string | undefined }) {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(!token || !!linkError);
  const { busy, error, submit } = useSubmit(async () => {
    try {
      await resetPassword(token!, password);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_TOKEN') return setExpired(true);
      throw err;
    }
  });

  return (
    <AuthLayout showcase="signin" phone="back">
      {done ? (
        <>
          <AuthHeading title="Password changed" sub="Sign in with your new password. Any other devices were signed out." />
          <Link to="/login" className="flex min-h-12 items-center justify-center rounded-[10px] bg-accent font-semibold text-on-accent no-underline">
            Sign in
          </Link>
        </>
      ) : expired ? (
        <>
          <AuthHeading title="This link has expired" sub="Reset links work once, for an hour. Ask for a new one." />
          <Link to="/forgot" className="flex min-h-12 items-center justify-center rounded-[10px] bg-accent font-semibold text-on-accent no-underline">
            Send a new link
          </Link>
        </>
      ) : (
        <>
          <AuthHeading title="Choose a new password" sub="You'll sign in with it from now on." />
          <form onSubmit={submit} className="flex flex-col gap-5">
            <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" meter />
            {error && <ErrorNote>{error}</ErrorNote>}
            <SubmitButton busy={busy} busyLabel="Saving…">
              Save new password
            </SubmitButton>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
