import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { LogoIcon } from '../components/icons';
import { Button, Card, ErrorNote } from '../components/ui';
import { useExtensions } from '../extensions';
import { signIn } from '../lib/api';
import { errorMessage, keys } from '../lib/queries';

export function LoginPage() {
  const qc = useQueryClient();
  const { brand, loginFooter } = useExtensions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-accent text-on-accent">
              <LogoIcon />
            </div>
            <div className="text-lg font-bold">{brand}</div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-[42px] rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-[42px] rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-ink"
            />
          </label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {loginFooter && <div className="mt-4 text-center text-sm text-muted">{loginFooter}</div>}
      </Card>
    </div>
  );
}
