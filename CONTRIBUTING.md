# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome.

## Before you start

- For anything bigger than a fix, open an issue first so we can agree on the approach.
- Read `CLAUDE.md`: it describes how the code is organized and the rules it keeps (intervals.icu is the
  only training-data backend, transcripts are append-only, `packages/core` stays pure, and so on).
- `docs/DECISIONS.md` explains why things are the way they are, including options that were rejected.
  If your change makes a real decision, add an entry.

## Development

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:seed
pnpm dev
```

Before you open a pull request, run `pnpm test && pnpm typecheck && pnpm lint`. CI runs the same
checks, builds the Docker image and scans for secrets.

Never commit API keys, `.env` files or personal data. Test fixtures use made-up ids.

## Contributor License Agreement

The first time you open a pull request, CLA Assistant asks you to sign the
[Contributor License Agreement](CLA.md) with your GitHub account. It takes one click and covers all your
future contributions.

Why: the app is licensed under the AGPL-3.0, and the maintainer also runs a hosted version built on
the same code. The CLA lets the maintainer offer your contribution under other terms as well, for
example in that hosted version. You keep the copyright in your work, and your contribution stays
available to everyone under the AGPL.
