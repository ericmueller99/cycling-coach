import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = { MONGO_DB_URI: 'mongodb://localhost:27017', BETTER_AUTH_SECRET: 'x'.repeat(32) };

describe('loadEnv', () => {
  it('treats an empty value as unset, as .env.example ships OWNER_EMAIL and DEV_PUBLIC_URL', () => {
    const env = loadEnv({ ...base, OWNER_EMAIL: '', DEV_PUBLIC_URL: '', INTERVALS_ICU_KEY: '', JOBS_CONCURRENCY: '' });
    expect(env.OWNER_EMAIL).toBeUndefined();
    expect(env.DEV_PUBLIC_URL).toBeUndefined();
    expect(env.INTERVALS_ICU_KEY).toBeUndefined();
    expect(env.JOBS_CONCURRENCY).toBe(2);
  });

  it('still rejects a malformed value', () => {
    expect(() => loadEnv({ ...base, OWNER_EMAIL: 'not-an-email' })).toThrow(/OWNER_EMAIL/);
  });
});
