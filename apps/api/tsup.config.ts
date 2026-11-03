import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    seed: 'src/scripts/seed.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they're bundled in. npm dependencies stay
  // external and must be resolvable from this package — which is why @anthropic-ai/sdk (used by
  // packages/coach) is also a dependency of the API.
  noExternal: [/^@cycling-coach\//],
});
