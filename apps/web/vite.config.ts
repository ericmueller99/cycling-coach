import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The repo-root .env, shared with the API. DEV_PUBLIC_URL is the ngrok address used to test on a
  // phone (camera/barcode need HTTPS); Vite rejects requests for hosts it doesn't know.
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');
  const publicHost = env.DEV_PUBLIC_URL ? new URL(env.DEV_PUBLIC_URL).hostname : undefined;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      allowedHosts: publicHost ? [publicHost] : [],
      // Same-origin in dev, like production (where the API serves the SPA): cookies just work and
      // there is no CORS preflight on every call. The native app uses VITE_API_URL instead.
      proxy: {
        '/api': { target: 'http://localhost:8787' },
        '/health': { target: 'http://localhost:8787' },
      },
    },
    // Absolute on the web: a relative base made deep links (/calendar/2026-11-02) load
    // /calendar/assets/… (the SPA shell, not JS) and fooled the new-version check. The Capacitor
    // bundle (Phase 5) has no server routes and needs relative paths: build it with CAPACITOR=1.
    base: process.env.CAPACITOR ? './' : '/',
    build: { outDir: 'dist', sourcemap: true },
  };
});
