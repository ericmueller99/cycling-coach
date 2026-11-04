# CLAUDE.md — Cycling Coach

A Claude-powered cycling coach: a chat that plans weeks, builds Zwift workouts (.zwo), puts sessions on
a calendar (and sends them to Zwift via intervals.icu) and reads training history from intervals.icu.
Web SPA now; iOS/Android via Capacitor later, against the same API. Self-hosted, single user per
install; `README.md` covers running it.

## Read this first

**`docs/DECISIONS.md`** — why things are the way they are, including rejected options. Append an entry
whenever a real decision gets made. `docs/ROADMAP.md` lists what's planned.

## Stack

| Layer | Choice |
|---|---|
| App UI | Vite + React 19 + TanStack Router/Query + Tailwind v4 (`apps/web`; a library: routes in `src/app.tsx`, extension slots in `src/extensions.tsx`, `main.tsx` is the self-host entry — DECISIONS #58) |
| API | Hono on Node, typed RPC client (`apps/api`) |
| DB | MongoDB (bundled container in the self-host compose; local replica set in dev), native driver (`packages/db`) |
| Schemas | Zod 4 in `packages/shared` — the single source of truth for types |
| Domain logic | `packages/core` — pure functions |
| Auth | Better Auth on Mongo, `bearer()` plugin for native |
| LLM | `@anthropic-ai/sdk` in `packages/coach` only |
| Training data | intervals.icu REST API, personal key, in `apps/api/src/providers/intervals-icu` only |
| Host | One Docker image (API + SPA, plus `dist/worker.js` for jobs only). Root `docker-compose.yml` runs it with a bundled Mongo (DECISIONS #44) |

## The rules that matter

### 1. intervals.icu is the backend — and Strava is never used
Only `providers/intervals-icu` talks to intervals.icu, and services get its client per athlete from
`IntegrationResolver.intervalsFor(userId)` (`zwiftFor` for Zwift) — never a server-wide client
(DECISIONS #53). Everything else uses our DTOs (`packages/shared/src/training.ts`) and the coach's
`TrainingDataPort`. Never add a Strava REST client: Strava's API policy forbids its data near an AI
(DECISIONS #2, #13).
Likewise only `providers/zwift` talks to Zwift (unofficial API for zFTP/zMAP/weight and events,
read-only, opt-in, DECISIONS #23, #29, #52). **Every Zwift request goes through the shared
`RequestGate`** (one at a time, 2 s apart), and the logged-in event feed runs only when the user clicks
"Get more events" — never on a timer, at boot or from the coach.

A deployment may add rides of its own through `Core.rides` (DECISIONS #71); the sync never touches them.

**Every calendar write goes through `apps/api/src/services/calendar.ts`** — it pushes workouts and
races to intervals.icu (DECISIONS #16). Writing `calendar_events` directly skips the sync; only the
sync job itself (importing from intervals.icu, done/missed status) may. The coach never writes
externally: its calendar changes are proposals the user accepts.

### 1a. The user's foods start empty
The food module never seeds or bulk-imports into the user's foods. Staples (`cnf_foods`, USDA), Open
Food Facts and photo readings are only proposals until they save one; logging is always from their own
foods. Only `providers/cnf|usda|openfoodfacts` talk to those sources and only `providers/storage/s3.ts`
to S3 (DECISIONS #33).

### 1b. Patch schemas never carry defaults
Zod applies `.default()` inside `.partial()`. Build patch schemas from default-free field sets
(see `calendar.ts`, `profile.ts`); a defaulted patch once demoted every moved workout to a ride and
deleted it from intervals.icu (DECISIONS #17).

### 2. Transcripts are append-only
`messages` is the verbatim Anthropic transcript, thinking blocks included. Never edit or delete a
stored message, and never re-render a thread's `systemSnapshot`. New facts reach the coach as
appended context messages (DECISIONS #6).

### 3. `packages/core` is pure
No I/O, no clock, no `new Date()` without an argument, no `fetch`, no `process`. ESLint enforces it.

### 4. Claude is only called from `packages/coach`
ESLint bans `@anthropic-ai/sdk` elsewhere. Tools are Zod schemas + handlers over `CoachPorts`;
the coach package never imports the database or the intervals.icu provider.

### 5. The coach proposes; the user confirms
Plans, calendar changes, profile updates and goals go through `proposals` (DECISIONS #7). Only
`create_workout` and `remember`/`forget` write directly, and both are undoable. Goals store a
measure and target, never a current value (DECISIONS #19).

### 6. `apps/api/src/app.ts` stays Node-free
The SPA typechecks against `AppType`. `app.ts` (and anything it imports) must not touch Node
globals or `packages/db` source — implementations are injected as `AppServices` by the composition
root `compose.ts` (`createCore`), which `server.ts` and `worker.ts` call (DECISIONS #57).
Routes must be **chained** and take input through `json()`/`query()` validators, or the typed client
can't see them.

### 7. Business logic lives in `services/`, not route handlers

### 8. No personal data in the repo
Fixtures use made-up ids, names and domains. Never commit `.env`, keys or a real athlete's data.

## Model selection

| Use | Model | Notes |
|---|---|---|
| Everyday coaching | `claude-sonnet-5-5` (router `chat`) | adaptive thinking, effort `medium` (set it: Sonnet's own default is `high`), `fallbacks: "default"` |
| Plans and workouts | `claude-opus-5-5` (router `build`) | effort `medium`. Tools marked `tier: 'build'` move the turn here (DECISIONS #65). The same model as `chat` means no routing |
| Thread titles | router `small` | effort `low` |
| Food: label photos, "log with words" | `claude-haiku-5-5` (router `small`) | `FoodAi` in `packages/coach/src/food.ts`; structured outputs, Zod-validated; never Opus (DECISIONS #33–34) |

The defaults are `DEFAULT_ROUTER` in `packages/coach/src/router.ts`, not env (DECISIONS #69). `createCore`'s `router` option replaces them.

Opus 5.5 and Sonnet 5.5: forced `tool_choice` (`any`/`tool`) returns 400 — use `auto` + prompt + strict tools.
Minimum cacheable prefix 512 tokens. Tools and persona alone are about 15.5K tokens, in front of every
call, so keep that prefix byte-stable: `pnpm --filter @cycling-coach/api coach:smoke` checks it.
Caches are per model. Effort is pinned per route, because changing it invalidates the messages cache.

## Commands

```bash
corepack enable          # once — pnpm is pinned in package.json
pnpm install
pnpm db:up               # local Mongo replica set in Docker
pnpm db:seed             # account + starting profile + starter library (idempotent); flags: --ftp --weight --timezone --sample
pnpm dev                 # api :8787, web :5173 (proxies /api); job loop only if BACKGROUND_JOBS (leases make it safe either way, DECISIONS #56)
pnpm test && pnpm typecheck && pnpm lint
docker compose up -d --build   # self-host stack (app + Mongo) on :8787; seed: docker compose run --rm app node dist/seed.js
pnpm --filter @cycling-coach/api worker   # jobs only, no HTTP (image: node dist/worker.js)
```

**Browser testing (Playwright MCP):** never ask for or read anyone's password. `pnpm dev:session`
mints a 7-day session for `SEED_USER_EMAIL` against whatever `.env` points at, then run code with
`filename: .playwright-mcp/sign-in.js` to add the cookie and open the app. End with
`pnpm dev:session --revoke`. To test password changes, `pnpm dev:session --qa` creates a throwaway
user (sign in via the login form) and `--qa --remove` deletes it. DECISIONS #27.
