/**
 * This repo is pnpm-only, and `npm install` doesn't merely warn here — it fails.
 *
 * Workspace packages depend on each other with the `workspace:*` protocol, which npm cannot
 * resolve. Worse, once a pnpm `node_modules` exists, npm crashes while reading it and reports
 * "Cannot read properties of null (reading 'matches')", which names nothing useful.
 *
 * This guard catches a fresh clone. It CANNOT catch the already-installed case, because npm dies
 * during tree resolution before lifecycle scripts ever run — that one is covered in the README's
 * troubleshooting section instead.
 */
const agent = process.env.npm_config_user_agent ?? '';

if (!agent.startsWith('pnpm/')) {
  const tool = agent.split('/')[0] || 'this package manager';
  console.error(
    [
      '',
      `  This repo uses pnpm — installing with ${tool} will fail.`,
      '  Workspace packages depend on each other via `workspace:*`, which only pnpm resolves.',
      '',
      '    corepack enable     # ships with Node 22, one time only',
      '    pnpm install',
      '',
      '  Then:  pnpm db:up && pnpm db:seed && pnpm dev',
      '  App runs at http://localhost:5173',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
