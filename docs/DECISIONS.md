# Decisions

Why the code is the way it is, for contributors. Code comments cite entries as `DECISIONS #n`, so
numbers never change. Some early entries describe things that were later superseded; the later entry
says so.

Append-only. Newest at the bottom. Record the **rejected** option and why — that's the part that stops
a decision being relitigated later.

Format: `## N. Title` · **Date** · **Decision** · **Why** · **Rejected** · **Revisit if**

---

## 1. Claude via the Messages API
**2026-10-29** · An API key from a Claude Console organization pays for usage. `@anthropic-ai/sdk`,
one engine in `packages/coach`.

**Why.** It's the documented path for apps, and the same code serves a multi-user build on the Claude
Platform later.

**Rejected.** *Agent SDK + `claude setup-token` subscription token* — documented only for scripts/CI,
shares a person's interactive plan limits, spawns a Claude Code subprocess per turn, and Anthropic's
legal/compliance page forbids routing products through plan credentials. Not a path to multi-user.

**Revisit if** Anthropic changes its subscription/API terms.

## 2. Strava data only through the official Strava MCP — never the REST API
**2026-10-29** · Strava's API Policy (effective 2026-06-01) section 5.3 forbids using REST API data, or
anything derived from it, in the operation of any AI application, explicitly including "ingestion
into a context window", with no own-data exception. Section 3.5 permits subscribers to use the Strava MCP
with their own AI application for personal use. So: MCP only, read-only, and Strava data is held
≤ 7 days (6.2), never in a persistent index (5.5), never re-exposed (5.16b).

**Rejected.** *Registering a REST API app (Single Player Mode)* — easy (localhost callback domain is
allowed, the app needn't be live) but unusable for anything that reaches Claude.

**Caveat.** Section 3.5 is personal use only: a multi-user version could not feed other users' Strava data
to Claude under current terms.

## 3. Stack
**2026-10-29** · pnpm + Turborepo, TypeScript strict, Zod 4. Vite + React 19 + TanStack
Router/Query + Tailwind v4 SPA; Hono API with typed RPC (`hc<AppType>`); Better Auth with the
`bearer()` plugin; Capacitor with the SPA bundled into the binary for mobile (later).

**Why.** An SPA plus a separate API fits a future native shell: the same bundle goes into the app,
against the same API.

**Rejected.** *Next.js* — its value (SSR/RSC) doesn't survive the trip into a Capacitor binary, and
a remote-URL shell risks App Store guideline 4.2. *Expo* — a second UI codebase.

## 4. MongoDB, native driver + Zod
**2026-10-29** · Database `cycling_coach`. On a shared cluster, give the app a DB user whose only
role is `readWrite` on that database. Native `mongodb` driver; Zod schemas in `packages/shared` are
the single source of truth. Every document carries `userId`.

**Why.** Documents fit (workouts with nested segments, transcripts of content blocks), and a scoped
user means a bug here can't touch anything else on the cluster.

**Rejected.** *Postgres* — no need here for relational set operations. *Mongoose* — a second schema
definition beside Zod.

## 5. Self-hosted: one Docker image
*Where it runs is covered by #42 and #44; the one-image part stands.*

**2026-10-29** · Hono serves the API and the built SPA from one container (`Dockerfile`). One origin
means plain cookie sessions on the web.

**Rejected.** *Separate hosting for the API and the static SPA* — two deploys and more accounts for a
one-person app. *Running only on a laptop* — no phone access, no stable OAuth callback.

## 6. Coach transcripts are append-only and verbatim
**2026-10-29** · `messages` stores each Anthropic content array exactly as returned, including
thinking blocks, and is never edited while it's part of a live API context. The system prompt is
frozen per context (`threads.systemSnapshot`); later profile/calendar changes reach the coach as
appended mid-conversation `role: "system"` context messages that only repeat what changed.

**Why.** Opus 5.5 thinking blocks are only valid when replayed exactly (preserved thinking), and the
prompt cache is a prefix match. Rewriting history breaks both, silently or with a 400.

## 7. Confirm-before-write through proposals
**2026-10-29** · Plans, calendar changes and profile updates from the coach are stored as
`proposals` and rendered as cards; nothing is written until the user presses Add / Apply. Workouts and
memory notes are written immediately but are visible and undoable (library entry / Undo chip).

**Why.** Plans and schedule changes need confirm-before-write; workouts and memory
are cheap to undo and slowing them down would make the coach tedious.

## 8. Strava retention is structural, not a convention
**2026-10-29** · Strava payloads live only in `strava_cache` (TTL index, 7 days). Tool chips persist
a summary line; their rows are read back from the cache and show "expired" after. A thread's API
context expires 7 days after its first Strava tool result; the next turn starts a fresh context from
a text summary, and a 6-hourly sweep redacts old Strava tool results (only ever on messages outside
a live context, so #6 holds). Calendar matching stores only the activity id.

## 9. Strict tool schemas from Zod via our own converter
**2026-10-29** · Tools are defined once in Zod; `packages/coach/src/schema.ts` produces strict-mode
JSON Schema, and inputs are re-validated with Zod before any tool runs.

**Rejected.** *The SDK's `transformJSONSchema`* — it demotes `enum` and `const` into description
text, leaving session types and segment kinds unconstrained.

## 10. Local MongoDB runs as a single-node replica set
**2026-10-29** · `docker-compose.yml` starts `mongod --replSet rs0`. Better Auth uses transactions
when given the client, which a standalone mongod rejects; managed Mongo services run replica sets
too, so dev matches production.

## 11. Model defaults
**2026-10-29** · `claude-opus-5-5`, adaptive thinking (always on for this model), effort `medium`
(set explicitly — the default changed between Opus versions), streaming, server-side fallbacks
(`fallbacks: "default"`), no forced `tool_choice` (400s on Opus 5.5). Titles and continuation
summaries use the same model at effort `low`.

## 12. Spike A: Strava MCP rejects custom clients (OPEN)
**2026-10-29** · Discovery works (`mcp.strava.com` → issuer `www.strava.com/mcp-issuer`), but
`POST https://www.strava.com/oauth/mcp/register_client` returns `400 invalid_client_metadata: Unable
to register client` for every variant tried: hosted https redirect, `http://localhost:8976/callback`,
`127.0.0.1`, minimal metadata, full metadata with `client_uri`/`application_type`. Dynamic client
registration appears limited to Strava's approved platforms (Claude, Gemini). The planned CLI
fallback uses the same endpoint, so it's blocked too.

**Not attempted, deliberately.** Registering under another client's name (e.g. "Claude Code") to
get through an allowlist.

**Options under consideration.** (a) intervals.icu as the coach's activity source (personal API key,
power curves, CTL/ATL, pushes workouts to Zwift — activities must reach it directly from
Zwift/Garmin, not via Strava); (b) ask Strava developer support how section 3.5 "bring your own AI
Application" is meant to work, and check strava.com/settings → MCP; (c) the Agent SDK running Claude
Code as the Strava MCP client. The coach only sees the `StravaPort` interface, so any of these is a
provider swap, not a rewrite.

## 13. intervals.icu is the training-data source; the Strava integration is removed
**2026-10-30** · Resolves #12. All training data comes from intervals.icu's REST API with the user's
personal key (`INTERVALS_ICU_KEY`, Basic auth `API_KEY:<key>`, athlete `0` = the key's owner).
Rides should reach intervals.icu directly (from Zwift, source `ZWIFT`, or a device), so they carry
full power, load and fitness data. The Strava MCP provider, OAuth vault, `strava_cache` and its 7-day machinery
(#2, #8 retention parts) are deleted.

**Why.** Strava's MCP refuses custom clients and its REST API is off-limits for AI (#2, #12).
intervals.icu's API terms allow any lawful use including commercial; it gives more than Strava did:
rolling 90-day / season / all-time power curves (so power bests fill themselves — the manual
"Strava flag" flow is gone), CTL/ATL/form, detected intervals per ride, and a calendar that
forwards planned workouts to Zwift.

**What the coach gets.** `get_recent_activities` (power, NP, IF, load, detected intervals),
`search_activities`, `get_activity_detail` (intervals + ride power curve), `get_power_curve`,
`get_fitness`; today's CTL/ATL/form in every turn's context message.

**Writes to intervals.icu are the user's, never the coach's.** "Send to Zwift" (calendar panel, or the
Schedule control's checkbox) uploads our `.zwo` as an indoor `WORKOUT` event; moving/editing the
session re-sends it, deleting it deletes theirs. The coach has no tool that writes externally.

**Rejected.** *Keeping the Strava provider "for later"* — dead code that can't be exercised; this
decision log records how to rebuild it. *intervals.icu OAuth* — unnecessary for one athlete; a
per-user key or OAuth is the path if this ever goes multi-user.

**Trade-offs.** Data is only as complete as what reaches intervals.icu directly (rides it imported
from Strava aren't exposed by its API). Some Garmin-sourced data needs attribution if this is ever
shown publicly. Strava's section 3.5 multi-user caveat no longer applies.

## 14. Transcripts keep tool rows; no retention machinery
**2026-10-30** · With Strava gone there's no 7-day rule: tool-chip rows are stored in the message's
`ui` block, threads have no context expiry, and there's no redaction sweep. #6 (append-only,
verbatim, frozen system snapshot) is unchanged.

## 15. Strict mode only on the small tool schemas
**2026-10-30** · The first live turn failed with `400 The compiled grammar is too large`: the API
compiles every strict tool schema in a request into one grammar, and ours (optional-heavy calendar
events, nested unions) exceeded it. `propose_plan`, `propose_calendar_changes`,
`propose_profile_update` and `create_workout` now run non-strict; every input is still
Zod-validated before a tool runs and failures go back to the model as correctable errors. A test
pins the non-strict list, and `pnpm --filter @cycling-coach/api coach:smoke` checks the real request
shape against the API (it also asserts a prompt-cache hit).

**Rejected.** *No strict tools at all* — the small ones fit comfortably and keep their guarantee.
*Slimming the calendar schemas until they fit* — brittle against a limit the API doesn't publish.

## 16. intervals.icu is the backend: two-way calendar sync
**2026-10-30** · Supersedes #13's "Send to Zwift is a button". Workouts and races sync both ways
with the intervals.icu calendar; rides stay local. Every ride shows on our calendar, read live from
intervals.icu (never stored).
- **Writes** go through `apps/api/src/services/calendar.ts` only. Workouts/races push on create,
  edit, move and delete — triggered by the user's actions or coach proposals they accepted. The coach
  still has no tool that writes externally.
- **Conflicts** (`calendar-reconcile.ts`, pure, tested): intervals.icu wins (edits and deletes made
  there apply here) except over a local change that hasn't been pushed (`intervals.error`). A
  failed push never blocks the local change; the next sync retries it.
- **Identity:** intervals.icu assigns its own `uid` and ignores ours, but keeps `external_id`
  (`cycling-coach:<id>`). A sync adopts its own events by that, and creates never-pushed sessions
  only *after* reconciling, so a create whose response was lost is adopted, not duplicated.
- **Imports:** workouts created in intervals.icu are downloaded as `.zwo`, parsed by our parser
  (which reads its PowerLow/PowerHigh ranges), deduped by name + structure, and stored as source
  `import`. Their intensity tag comes from `core.inferSessionType`.
- **Deletes** remove the intervals.icu event first; if that fails the local session stays, so it
  can't come back on the next pull.
- **Schedule:** ±400-day backfill at boot and on "Sync now", then every 15 min (−21/+120 days).
  Runs are serialized per athlete.

**Verified live (2026-10-30):** create workout + race → both on intervals.icu (indoor/structured,
RACE_C 17:30); move → moved; edit in intervals.icu → came back; delete in intervals.icu → removed
here; delete here → removed there.

**Rejected.** *Storing rides* — they're intervals.icu's; reading live keeps old months free.
*Pushing rides* — only structured sessions and races belong there.

## 17. Session kinds and `missed`
**2026-10-30** · A session has a `kind` — `workout` (structured, library, `platform` zwift|garmin),
`race` (Zwift races first-class: start time, A/B/C priority) or `ride` (named for what it is) —
separate from `type`, the intensity colour. `missed` is set automatically for past planned sessions
with no matching ride; `skipped` stays the user's call. Matching uses intervals.icu's own pairing
(`paired_event_id`) first, then our scorer; a late upload un-misses a session.

**Gotcha found in the live test:** Zod applies `.default()` inside `.partial()`. A patch schema
built from defaulted fields turned every move into `kind: 'ride'`, which un-synced and deleted the
workout on intervals.icu. Patch schemas are now built from default-free field sets (calendar and
goals); `packages/shared/src/calendar.test.ts` guards it.

## 18. Trend weight, plus an optional Zwift weight
**2026-10-30** · Weight syncs from intervals.icu (the scale's weigh-ins). The coaching weight is the
**median of the last 7 days** (`core.trendWeight`) — a one-off post-pizza reading doesn't move it.
The latest weigh-in is shown alongside. An optional monthly `zwiftWeightKg` mirrors the baseline
the athlete sets in Zwift (race categories); it falls back to the trend. Body weight lives in the per-turn
context, not the athlete block, so daily changes don't invalidate the cached prompt.

**Rejected.** *Latest weigh-in* — too noisy to coach from. *Mean* — one outlier still shifts it.

## 19. Goals are live measures
**2026-10-30** · A goal stores *what it's measured by* and a target — never a current value:
`wkg` (Zwift or trend weight), `ftp`, `power_best`, `weight`, `fitness`, or `manual`. Progress is
computed (`core.goalProgress`) wherever goals are shown, including the coach's context. The coach
can propose goals (`propose_goal`, confirm card).

## 20. TrainerRoad removed
**2026-10-30** · This app replaces TrainerRoad for its user. `ftpTrainerRoad` is gone from
the profile, coach context, UI and seed (a boot migration unsets it).

## 21. The calendar scrolls; no Week/Month views
**2026-10-30** · The calendar is one endless Monday-start week list instead of paged month/week
views: a month grid left half the screen empty, and the next month is what the athlete wants to see
there. Sentinels above and below grow the range 8 weeks at a time; data loads in fixed 4-week
chunks aligned to the range start (`useCalendarRange`), so growing it only fetches the new
chunks — each `/calendar` call reads rides from intervals.icu live. The page keeps the top visible
week in place itself (browser scroll anchoring off) so prepended weeks and late-loading chips
above the view don't make it jump. The detail panel is sticky beside the grid, or a bottom sheet
on phones, since it can no longer sit below an endless grid.

**Rejected.** *Paged months that fill the screen* — still jumps at month edges. *One query for the
whole range* — refetches everything (and hits intervals.icu) on every extension.

## 22. Zwift weight drift alert
**2026-10-30** · When `zwiftWeightKg` is more than 2 kg off the trend weight
(`core.zwiftWeightDrift`, `ZWIFT_WEIGHT_TOLERANCE_KG`), the Athlete page and the Coach right
rail say so and offer to set it to the trend once the athlete has changed it in Zwift (no Zwift API at
the time — since #23 the Zwift weight syncs from Zwift when its login is set, and the alert then
only says to update it in Zwift).
2 kg is roughly where W/kg moves by 0.1 — enough to matter for race categories, while normal
day-to-day swings, already smoothed by the median, stay quiet. Unset means "use the trend", so
no alert. The page "PRs & goals" is now "Athlete" (route still `/profile`) with its own Weight
section.

Saving the profile is now a true replace: optional fields left out of the PUT are `$unset`
(clearing the Zwift weight used to silently keep the old value).

## 23. zFTP and Zwift metrics from Zwift's own (unofficial) API
**2026-10-30** · Zwift Racing League still places riders by Zwift's zFTP/zMAP
category (A: zFTP ≥ 4.2 W/kg and ≥ 250 W, or zMAP ≥ 5.1 W/kg; `core.ZWIFT_CATEGORY_THRESHOLDS`).
The app now keeps `profile.zwift` = {zftp, zmap, category, racingScore, asOf, source}, and goals
can be measured by `{kind:'zwift_wkg', metric:'zftp'|'zmap'}` (÷ Zwift weight). The A goal uses
zFTP W/kg; the coach sees zFTP/zMAP, the category and the watts the next one takes.

Source: `providers/zwift` logs in to Zwift's game API as the user (password grant, client
"Zwift Game Client", as Sauce4Zwift does) and reads `/api/profiles/me` (FTP, weight),
`/api/power-curve/power-profile` (zFTP, zMAP, category, `metricsTimestamp`) and `/api/profiles/{id}`
(Racing Score — `/me` returns `competitionMetrics: null` for your own profile; by id it's filled). Read-only,
one account, every 6 h plus "Sync now". It is against Zwift's terms and may break without
notice — the user accepts that by setting a login (#52). Credentials are env-only (`ZWIFT_USERNAME`/`ZWIFT_PASSWORD`); a
rejected login isn't retried until "Sync now", so bad credentials can't lock the account. The
sync also writes the Zwift weight and the FTP set in Zwift (what its workouts scale to). Without
a login, or when it fails, the same fields are typed in on the Athlete page (`source: 'manual'`)
until the next good sync.

Racing Score is stored and shown, but is never a goal measure: it follows race results, not
power — a 3.8 W/kg rider who races well can out-score a stronger one.

**Rejected.** *ZwiftPower by athlete id* — every page and JSON endpoint needs a logged-in Zwift
session (login page / 403 without one), and it shows its own FTP, not zFTP. *zwiftracing.app* —
needs a key granted by its maintainers, and has neither zFTP nor Racing Score. *Zwift Developer
API* — the clean route, but partner-only. *Manual entry only* — kept as the fallback.

## 24. Completed sessions can't be deleted
**2026-10-30** · Deleting a session removes it from intervals.icu (and so from Zwift) as well as
here. That's only allowed for sessions that weren't ridden: `planned`, `missed`, `skipped`, and
with no matched `activityId` (`core.canDeleteSession`). A completed session keeps its plan↔ride
pairing — deleting it would lose what was planned against what was done. `CalendarService.remove`
enforces it (409 from the route), so accepted coach `remove` proposals follow the same rule; the
calendar panel hides Delete for completed sessions and asks for a confirmation otherwise.
"Mark planned" doesn't get around it: the matched `activityId` stays.

## 25. Change cards preview before → after; revisions replace the old card
**2026-10-30** · A `calendar_changes` proposal used to store only `eventId` + patch, so the card
could say no more than "Update session". Now, when the coach proposes the changes, the API
(`services/proposals.ts` `createCoachProposal`) stores `before[]`, a snapshot of each event
touched, parallel to `items`. `core.previewCalendarChange` turns a change plus its snapshot into
before/after and the list of changed fields. The card shows one row per change (+ add, → move,
~ update, − remove; old → new for changed fields). Expanding a row shows the coach note and the
workout's zone chart (both charts when the workout is swapped). Each row can be applied or skipped
on its own.

The snapshot is taken at creation on purpose. A live lookup would show an applied update's new
values as its "before". `null` means an add, or an id that didn't resolve, which is flagged as
"will fail". Proposals stored before this have no `before` and fall back to the old labels.

**Request changes** puts `Change "<card title>": ` in the composer. The coach re-proposes with
`replaces: <old proposal id>` (an optional field on `propose_plan` and `propose_calendar_changes`,
plus a persona line), and the API dismisses the old card's pending items, but only within the same
thread. That way two versions of one plan can't both be applied. Rejected: re-proposing without
closing the old card, which left both "Apply" buttons live.

## 26. Athlete: weigh-in history read live; Zwift card holds everything Zwift; A+ in the rules
**2026-10-30** · The Weight card's trend chart needs weigh-in history. The new
`GET /api/weight` reads 90 days (plus a 6-day lead-in) from intervals.icu on request, using the
provider's 10-min cache, and `core.trendSeries` gives each weigh-in the `trendWeight` as of that
day, so the line ends on the coaching weight. Nothing is stored: the history already lives in
intervals.icu. Rejected: a `weigh_ins` collection filled by the sync, which would be a second
copy to keep in step for one chart. With intervals.icu off or failing, the route returns no
points and the chart shows an empty state. The page never waits on intervals.icu.

The Zwift weight and the drift warning moved from the Weight card to the Zwift card. The Zwift
weight is now an input even when it syncs from Zwift, the same as zFTP and zMAP: an edit holds
until the next Zwift sync replaces it, as the card's footnote says. This replaces the read-only
field from #23. Saving a weight-only edit leaves the synced metrics (and their `source`) alone.

`core.zwiftCategoryTable` gives the pace-category panel its rows. Zwift's A+ (zFTP ≥ 4.6 W/kg and
≥ 300 W, with no zMAP route) joined the thresholds, and `'A+'` joined `zwiftCategories`. Watts for
a line are `ceil(W/kg × weight)`, rounded first so 4.2 × 80 is 336 W and not 337 W. The current
category is now the rider meeting those whole watts, which is the same test as before for
integer watts. The badge shows Zwift's synced category when there is one; the table and its gaps
are computed.

## 27. Account page on Better Auth's own endpoints; Playwright signs in with a minted session
**2026-10-30** · The Account page changes the name and password through Better Auth's built-in
`update-user` and `change-password` endpoints, called with plain fetch like sign-in. We added no
routes. `MIN_PASSWORD_LENGTH` (8) lives in `packages/shared` so the server and the checklist can't
drift apart. The name reaches the coach as a `Name:` line in the athlete block. Changing it changes
the render, so open threads get the usual "updated athlete context" note, and no snapshot is
rewritten. There is no forgot-password flow, because it would need an email provider.

Browser testing can't depend on the user's password once it has changed from the seed value.
`pnpm dev:session` uses Better Auth's `testUtils` plugin in a one-off auth instance built from the
same `authOptions`, so the cookie is signed and named the same way. That plugin is never in
`createAuth`. The script mints a session tagged `dev-session (Playwright)` that lasts 7 days and
replaces the previous one; `--revoke` deletes it. It writes `.playwright-mcp/sign-in.js` for
Playwright's run-code tool. It runs against whatever `.env` points at, a remote database included,
because developing against real data is the point. That grants nothing new, since
`BETTER_AUTH_SECRET` and the DB login are already enough to forge a session. It refuses only under
`NODE_ENV=production`. Password-form tests use `--qa`: a throwaway `qa@cycling-coach.test` user with
a random password. It never gets a profile, so the sync jobs (which only visit users with one) leave
it alone, and `--qa --remove` deletes it with its login and sessions.

Rejected: a dev sign-in HTTP route, which would ship in the deployed image. Reading the password
from `.env`, which goes stale once it's changed. A separate test DB or env mode, which loses the
real data that makes testing against it worthwhile.

## 28. Mobile: its own shell and a paged week agenda, switched at 800 px
**2026-10-30** · Below 800 px the sidebar is hidden and each page renders a sticky
top bar (`components/AppBar`) over a fixed bottom tab bar in `AppShell`. One breakpoint, two
mechanisms: styling-only differences use the `mobile:` / `desktop:` Tailwind variants defined in
`styles.css`, and layouts that differ in structure switch in JS with `useIsMobile()` (the same
media query). The calendar needs the JS switch: its infinite scroll is what trapped the nav on
phones, so its IntersectionObservers must not mount there at all, not just be hidden.

The phone calendar is `routes/calendar/WeekAgenda`: exactly one week, paged by chevrons, swipe or a
month picker, with the week in the URL (`/calendar?week=YYYY-MM-DD`, normalised to the Monday) so
back/forward work. Desktop keeps its continuous scroll and only reads `?week=` to centre that week
on load. The agenda fetches the 4-week chunk holding the week, on the same chunk grid the desktop
grid uses (`calendarChunkStart`), so paging within a chunk is instant and the cache is shared.
Day grouping and the week-hours rule moved to `core` (`groupByDay`, `weekSummary`) so both
layouts count hours the same way. Panels (session, ride, add) take a `sheet` flag and render in a
shared bottom `Sheet` on mobile.

The mobile Today strip needs the next race beyond the current week, so the dashboard gained
`nextRace` (planned races in the next 28 days). Workouts gained a ⋯ → Delete that uses the
existing archive endpoint. The mobile password form is `/account?password=1`, full screen.

The app's root font size is 14px, so rem-based Tailwind sizes run at 87.5% (`h-11` is 38.5px).
The mobile shell and tap targets use explicit px (`h-[44px]`, 56px bar, 64px tab bar) so those
sizes hold. Inputs are 16px on mobile through an unlayered rule, which beats Tailwind's layered
text sizes and stops iOS zooming on focus.

Rejected: hiding the desktop calendar with CSS on phones (its observers would still grow the
range); putting the top bar's title and actions in a shell-level context (each page rendering
`AppBar` itself is simpler and keeps actions next to their handlers); changing the root font size
to 16px (it would resize the whole desktop UI).


## 29. Zwift events: a local copy, the public feed by default, one paced logged-in walk on request
**2026-10-31** · Extends #23. The Events page and the coach's `find_events` only ever
query our own `zwift_events` collection. Zwift is called in three ways, all read-only:

- **Public feed** (`/api/public/events/upcoming`, no login, ~28 h, 200 per page): hourly, 15 s
  after boot, and from "Refresh". At most 5 pages a run (it takes 3). Never within 15 min of the
  last sync, whoever asks; `lastPublicSyncAt` is persisted, so restarts and a dev server reloading on
  every save don't add calls.
- **"Get more events"** (logged-in `/api/event-feed`, ~7 days): only when the user clicks it — never on a
  timer, at boot or by the coach. One cursor walk from now to now + 7 d, 50 per page (100 and 200
  are refused), about 65 pages. It stops at the end of the feed, past the window, at 120 pages, at
  6 minutes, or when a cursor repeats or a page adds nothing new. No retries: the first non-2xx or
  timeout ends the run. Afterwards it can't run again for 6 h, failed or not (`lastExtendedAt` in
  `sync_state`, so a restart doesn't reset it); during a run a second click just returns progress.
- **Routes** (`cdn.zwift.com/gameassets/GameDictionary.xml`): at boot when older than a week.

**One gate for all Zwift traffic.** `providers/zwift/gate.ts` (`RequestGate`) runs every request —
the zFTP sync, both feeds, the route file, token calls — one at a time, at least 2 s apart. The
public sync, the logged-in walk and the route refresh also share a lock in `ZwiftEventsService`,
so they never overlap. Every request logs one line (path, status, ms) so the call count can be
checked.

**Cleanup.** Each event carries `expiresAt` (its last pen's start + estimated ride time + 2 h) and
a TTL index deletes it; sign-ups (`zwift_event_marks`) expire the same way. A walk that reached
the end of its feed also deletes events in the window it covered that it no longer saw
(cancelled), only among events that feed itself had stored (`seenVia`).

**Derived at sync, per pen** (`core/events`): distance = lead-in + laps × route (or the pen's own
distance), climbing likewise, terrain from m/km, and `penKind` — `category`, `pace`, `distance`
(pens that differ in route/laps/distance but share one pace and no rules: Tour of Watopia's
Long/Standard/Short, zFondo) or `none`. **Per athlete, at query time:** ride-time estimates, "fits
Z2" (a pace group inside Z2 W/kg at Zwift FTP ÷ Zwift weight), and eligibility from each event's
`accessExpression`, parsed by a small evaluator (no `eval`) with three-valued logic: values we
don't know (`scoring.max30`, women's categories) make a pen "check rules in Zwift" rather than a
guess. Racing Score pens without an expression use their `rangeAccessLabel`.

Signing up stays a link to `zwift.com/events/view/<id>`. "Add to calendar" is an ordinary session
through `services/calendar.ts` (races and TTs as `race`, group rides as `ride`), with the new
`zwiftEventId` / `zwiftPenId` fields so the list can show "on your calendar".

Rejected: the logged-in feed on a schedule (the maintainer's call — maybe a daily sync later, through the
same gate and budgets); `POST /api/events/search` (protobuf only, and it ignored the date window);
filtering in Mongo queries (the rules are per-athlete expressions; ~4,000
events filter in-process in ~200 ms); hiding events (no hide action yet).

## 30. Ride feedback is stored data the coach reads, not a per-ride review
**2026-10-31** · Completed sessions and rides get an optional RPE 1–10 and a free-text note. Ratings live in their own `session_feedback` collection, keyed by `eventId` (with the
matched ride's `activityId` alongside) or by `activityId` alone for an unplanned ride, which has no
session to hang them on. Date, title and workout id are copied in, so range reads and the coach
tool need no join. A ride rated before the sync matched it is folded into the session's rating the
next time that rating is saved.

The coach sees ratings where it already looks: `felt: RPE 4/10 (Easy) · "note"` on
`get_recent_activities`, `search_activities` and `get_activity_detail` lines (joined through two
new `CoachPorts` methods), on done sessions in the per-turn calendar block (a new rating changes
that text, so open threads get it on their next turn with no snapshot rewritten) and in
`get_calendar`. `get_ride_feedback` lists up to 180 days with a per-workout roll-up. The persona
carries calibration rules of thumb, as offers only: a harder `basedOnId` copy, raising FTP in
Zwift, or an FTP test.

The completed panel's result (`GET /calendar/:id/result`) is computed live from intervals.icu's
detected intervals (`core.sessionCompliance`) and never stored. **Unlink** (`POST
/calendar/:id/unlink`, through `CalendarService`) clears `activityId`, sends the session back to
planned or missed, and records the ride in `ignoredActivityIds`, which `matchActivities` honours on
both the `pairedEventId` and the scoring paths. Otherwise the next sync would re-pair them. The
rating stays with the ride.

**Rejected.** *An automatic "Coach's read" on save* (a one-shot Claude call, a cached
`SessionReview` and actions that propose changes): reviews should come only when asked for. It costs a
call per ride and adds noise on rides that went to plan, and its actions would have needed
proposals without a thread. *Feedback fields on `calendar_events`*: unplanned rides have no
event, and keeping ratings out of the calendar document keeps them out of the intervals.icu push
path. *Ratings in the cached athlete block*: every rating would trigger an "updated athlete
context" note. *Renaming `done` to `completed`*: a data migration for a label.

## 31. Events that have started are hidden by default

**2026-10-31** · Events that have already started don't belong in the list; other event
pages make you filter them out every time. `eventFilters.upcoming` (default `true`) hides any event
whose start is at or before now, in `queryEvents`, so the page, saved searches and `find_events`
all get it. It's a filter, not a hard cutoff: turning it off brings back the one-hour late-join
window from #29. The `all` count still includes that window. `useEvents` refetches every 60 s
(our API only, never Zwift) so the list keeps up while the page is open.

## 32. Rides grouped into a session by hand; `activityId` stays the primary ride

**2026-11-01** · A long Zwift ride often ends up as several activities (Nov 1: the 84-min pacer ride
matched "Long Z2", and a 27-min Beach Island Loop sat beside it as an unplanned ride). The athlete can now
group same-day rides into one session. A session keeps `activityId` as its primary ride (the one
the matcher, intervals.icu pairing, the rating and Unlink already use) and gains a server-set
`extraActivityIds`. `core.sessionRideIds` is the one place that lists a session's rides.

- **Manual only, no suggestions.** A race with a warm-up ride before it must stay apart, and a
  heuristic can't tell that from a split Z2 ride. Grouping happens from the ride's panel ("Part of a
  planned session?") or the session's ("Add a ride from this day"), through
  `CalendarService.addRide` / `removeRide` (`POST /calendar/:id/rides`,
  `DELETE /calendar/:id/rides/:activityId`). Rules (`core.canAddRide`): same local day, a cycling
  sport, not a skipped session, not already in it, not in another session.
- **Unmatched sessions too.** A ride added to a planned or missed session with no ride becomes its
  `activityId` and marks it done — e.g. a 2 h ride done as two 1 h rides the matcher left unmatched.
- **Removing:** an extra just leaves (not ignored, so the sync may match it to another session that
  day). Removing the primary remembers it in `ignoredActivityIds` and promotes the first extra; with
  none left the session goes back to planned/missed and its rating to the ride, as Unlink does.
  ⋯ Unlink releases every ride.
- **Everywhere else:** the matcher treats extras as taken; `GET /calendar` tags them with
  `matchedEventId`, so they drop out of the day's rides and the week's done count, while ridden
  minutes still include them. Chips show combined totals ("110 min · load 98 · 2 rides"); the panel
  lists the rides with Remove. `GET /calendar/:id/result` reads every ride, returns `rides` and
  `totals`, and walks their intervals in start order for compliance. The coach sees `done (2 rides)`.
- **Combined numbers** (`core.combineRides`): time, distance and load add up; average power is
  time-weighted; NP is the time-weighted fourth-power mean of the rides' NPs (exact but for the 30 s
  window at each ride's edges); IF is that NP against the first ride's FTP.
- **Local only.** Rides are never written to intervals.icu (#16), so grouping changes nothing there.

**Known limit.** The session's rating is stored against the primary ride, so the activity tools
show `felt:` on that ride only.

**Rejected.** *Replacing `activityId` with an array* — a migration that touches every reader for
no gain. *Automatic grouping or "looks like part of…" hints* — the race + warm-up case rules them
out. *Pairing the extra rides in intervals.icu* — it's their calendar, not ours to annotate.

## 33. Food: our own logger, an empty personal database, one reference serving per food

**2026-11-01** · Lose It has no public API, and the Apple Health bridge (Health Auto Export) caused
problems elsewhere, so the app has its own food log. The first step is the logging
machinery; budgets, burned-vs-eaten and the coach reading food come next (#36, #41).

- **The user's foods start empty.** Public databases are full of junk that makes logging harder.
  Foods only enter when the user adds one: a staple (Canadian Nutrient File 2026 first, USDA FoodData
  Central Foundation + SR Legacy as the fallback — never USDA Branded), a photo read by the small
  model, an Open Food Facts product for a scanned barcode they review, or by hand. After that,
  logging is a local search, a barcode match or a recipe/meal — no AI.
- **Units model.** A food stores nutrients for ONE reference serving exactly as the source gave
  them ("per ¾ cup (175 g)", "per 100 g", "per grande"), plus `measures`: everything that serving
  equals (`[{g:175},{cup:0.75}]`). `core.toServings` does all portion maths: any mass measure
  unlocks every mass unit, any volume measure every volume unit, label units ("bagel", "large
  egg") only match themselves (plurals too). "1 cup = 120 g" is stored relative to the serving
  (`core.withMeasure`). Volumes are Canadian metric (cup 250 ml, tbsp 15, tsp 5); a food's own cup
  measure always wins. Changing the unit in the picker keeps the same amount of food.
- **History is a snapshot.** Log entries keep name, source, servings, grams and nutrients at log
  time; editing a food never rewrites past days. Foods, recipes and meals are archived, never
  deleted. Recipes are computed from their ingredient foods on read; meals log as separate entries
  (`fromMealId`) so one item can be tweaked, with a ×0.25–2 scale for partial meals.
- **Usual portion** = the most common (quantity, unit) over the last 20 entries, per slot first
  (`core.foodUsage`); the whole library (foods, recipes, meals, usage) is one cached payload and
  search runs in the browser (`core.rankByUse`).
- **Staples** are a reference table (`cnf_foods`, ~6,000 rows, `pnpm food:import-cnf`), ranked by
  `core.rankStaples` (lead noun, raw foods, everyday foods with many household portions first;
  partial matches as a fallback). CNF household portions become measures ("1 large egg" = 52.6 g;
  a qualified volume like "250 ml slices" becomes its own "cup slices" unit).
- **Photos** go to an S3-compatible bucket under `cycling-coach/food-images/<userId>/`
  (`providers/storage/s3.ts`, path-style), viewed via 15-minute signed
  URLs. Without the S3 vars a photo is read but not kept. Images are shrunk in the browser
  (1600 px JPEG) before upload.
- **Barcodes** are stored as GTIN-13. Scanning uses the `barcode-detector` ponyfill (Safari has no
  BarcodeDetector) with zxing's WebAssembly bundled, not fetched from a CDN. An unknown code offers
  Open Food Facts (one product lookup, reviewed before saving), linking it to an existing food, or
  reading the label.
- **Models.** Label reading and "log with words" use `claude-haiku-5-5` (`FOOD_AI_MODEL`) with
  structured outputs (`output_config.format` from the Zod schema through `toStrictSchema`),
  validated again with Zod. Usage goes to `ai_calls` as `food_vision` / `food_parse`. The API
  allows at most 16 nullable (union-typed) fields per structured-output schema, so the label
  reading's text fields are `""` when absent rather than `null` (a test guards the count).

**Rejected.** *Lose It's private web API* — reverse-engineered, breaks on every deploy, needs the user's
password. *Apple Health via Health Auto Export* — ruled out after problems elsewhere. *A public
food database as the search source* — the junk is the problem. *Nutrients per 100 g only* — loses
the label's own serving and rounding, and screenshots ("grande") have no weight. *Per-search CNF API
calls* — the bulk table is faster and offline. *Opus for food tasks* — a small model reads labels
fine at a fraction of the cost.

## 34. "Log with words": the small model sees the user's catalog; code checks every id

**2026-11-01** · The first design had the model only split the phrase and deterministic code do the
matching. Fuzzy matching handles "bagle" but not "PB", "my oats" or "the usual breakfast". Instead
the model gets the user's own catalog as short ids (`f12`, `r3`, `m1` — name, other names, units,
usual portion) as the cached system prefix, and answers with those ids. `core.resolveWords` then
drops any id that isn't theirs, fills missing amounts with their usual portion (per slot), keeps said
amounts in a counting unit ("two eggs" → 2 large eggs), validates units, and clamps the day.
Unmatched items are shown as "isn't in your foods yet" with Add from screenshot / Search staples
/ Skip — never guessed. Refining ("make it half a bagel") sends the current list plus the change,
and the model returns the whole list. Nothing is written until **Log N items**.

## 35. BMR and body scans: their own documents, on the Athlete page

**2026-11-01** · BMR lives on the Athlete page, not a Food tab, and isn't tied to one kind of scan: a number
with its source (measured RMR, body scan, formula, other), date and note, in `energy_settings`
(`GET/PATCH /api/energy`, a default-free patch). Body scans are a history in `body_scans`
(weight, body fat %, lean mass, bone mineral, fat-free mass, the report's own RMR). "Calculate from
this scan" uses Katch-McArdle, 370 + 21.6 × fat-free mass (fat-free mass = as reported, else lean +
bone, else weight × (1 − BF%)). Kept out of the full-replace `PUT /profile` so a save can't drop it,
and out of the coach's cached athlete block until the budget uses it (#36).

## 36. The calorie budget is built from synced data and the weight goal, set on the Athlete page

**2026-11-01** · The original design asked for an activity factor and a goal on a Food
"Energy & BMR" tab. Instead everything that shapes the budget lives on the **Athlete** page (a
"Calorie budget" card next to BMR), and the Food log only shows the result ("Energy today").

`budget = BMR + everyday living (BMR × 0.10) + steps + exercise + goal adjustment` (`core.dailyBudget`).
- **Activity comes from data, not a question.** intervals.icu already has device steps for every day,
  including days with no recorded activity. Steps cost
  `steps × weight × 0.0004` kcal (≈ 0.5 kcal/kg/km at ~1,333 steps/km; 10k steps ≈ 320 kcal at
  80 kg). Past days use actual steps; **today uses the larger of the 14-day average and the count so
  far**, so the budget doesn't creep up as steps sync but a hiking day still counts. No step data →
  BMR × 1.3 "average day"; a fixed factor (×1.2–1.5) stays available as an override.
- **Exercise** = each activity's kJ of work for power activities (≈ kcal on a bike: ~24% gross
  efficiency × 4.184 kJ/kcal), else the device's estimate; switchable to device calories.
  Today's planned sessions are projected (library workout: segments × FTP; others: minutes × FTP ×
  a per-type intensity) until the ride syncs and the matcher marks them done.
- **Goal from Goals.** The open weight goal (primary, else soonest dated) sets the pace: what's left
  over the weeks to its date, clamped to 1.0 kg/week loss / 0.5 gain; without a date the default
  pace (0.5 kg/week, editable); within 0.3 kg → maintain; no weight goal or no trend weight →
  maintain. 7,700 kcal per kg. "No deficit on race and hard days" (≥ 900 kcal of exercise or a race)
  is an optional switch, off by default.
- **Macros:** protein 1.8 g/kg and fat 0.85 g/kg of trend weight (editable); carbs fill the rest.
- `Activity` now carries `kilojoules`/`calories`; steps come from `IntervalsIcu.steps`.
  `GET /api/energy/budget?date=` degrades to a warning, never an error, when intervals.icu fails.
- The goal editor gained a **target date**; "Add a weight goal" opens it with the weight measure.

**Rejected.** *Asking for an activity factor* — the data is already there and changes daily.
*Garmin's own daily calorie total* — intervals.icu doesn't carry it. *Adaptive TDEE (intake vs
trend-weight change)* — the right calibration later, but it needs weeks of logging first.
*Walk/run steps de-duplicated against activities* — the activities this targets are rides;
revisit if that changes.

## 37. One calendar for training and food; Library and a 3-tab Athlete

**2026-11-01** · The Food day log was a second calendar, so it's merged into Calendar: the week grid
carries a food layer (eaten / budget per day, net and trend weight per week), a day panel and a full day view with
one timeline of meals and sessions. Workouts, foods, recipes and meals live under **Library**; Athlete is three tabs
under a snapshot strip; "Events" is **Zwift Events**. Food logic, dialogs and data are unchanged.
- **The food layer is its own endpoint** (`GET /api/energy/days`), not folded into `/api/calendar`. The calendar's
  chunked queries, optimistic panels and mutations stay untouched, and the layer can be switched off. A range's
  budgets come from one read of settings/profile/goals/sessions and one intervals.icu call each for rides, steps and
  weigh-ins (`EnergyService.budgets`), sharing `dayBudget` with the single-day `budget()` so they can't drift.
- **Workout fuel is placed by time, not stored on the session.** `core.dayTimeline` nests the fuel slot under the
  nearest ride (or the first); there's still no session id on log entries.
- **Desktop calendar is viewport-locked** with an inner scroller (the scroll anchoring, sentinels and jumps now use
  the container). The phone opens on the day, with the week agenda one tap away.

**Rejected / deferred.** *One combined `/api/days` payload for both layers* — would mean re-plumbing every calendar
cache and mutation for a first pass. *Coach-written day notes and "Log usual dinner"* — model calls per view; later.
*Merge duplicate foods, .zwo import, FFM-follows-trend, TSS / last-done on workouts* — UI first.

## 38. The resting base is "RMR"; a report's printed RMR is a scan value

**2026-11-01**. Body-scan reports often print an RMR that is *calculated* from fat-free mass (e.g.
`19.7 × FFM + 413`), not measured. For the budget, RMR and BMR fill the same slot (what you burn at
rest; steps and rides are added on top), so the UI says **RMR** everywhere and the stored fields keep
their names (`bmrKcal`, `bmrSource`; no migration). "Measured" means a lab test (breath analysis); a
number printed on a scan report is `scan`. When the newest scan has an RMR, "Use the scan's RMR" is
the default and Katch-McArdle (370 + 21.6 × FFM) the alternative. Body fat on a scan is fat ÷ total
mass (some reports headline fat ÷ soft tissue instead). The budget card warns not to apply a report's
×1.2–1.9 activity multipliers — steps and rides are already counted.

## 39. Staples inline in the recipe and meal builders; adding one always saves it to the user's foods

**2026-11-01**. "Not in your foods? Search staples" in the recipe builder swapped the whole dialog for the staples
dialog. The builders' search (`ItemSearch`) now takes an opt-in `staples` mode with the Log food **Include staples**
switch and section (shared in `routes/food/staples.tsx`; pref `food.builder.staples`, same defaults as Log food).
A picked staple shows an inline card with **Save to my foods only** and **Save to my foods & add to recipe/meal**.
Ingredients and meal items reference a food id, so "add" creates the food first — rule 1a holds: nothing is saved
until the user clicks one of the two buttons.

**Label photos, same shape (later the same day).** Packaged ingredients (a brand of chocolate chips) aren't staples,
so the builders also get **Label photo**: an inline card reusing `usePhotoCapture` / `PhotoTiles` (split out of
`PhotoDialog`), the unchanged `POST /api/food/photo` (Haiku, one call per read — #33–34), `draftFromReading` and
`FoodForm` for the check, then the same two buttons. No server change; nothing is saved before a button press.

**Log food, same day.** Most foods get added from a label photo, so Log food's search bar gets a camera button beside
the barcode button (opens the existing photo dialog; Save & log returns to Log food with it picked). The footer's
"Add from label / screenshot" and "Search staples" links are gone — both have a direct route now — leaving
"Enter manually".

**Rejected.** *Recipe-only staples (an ingredient carrying CNF nutrition without becoming a food)* — needs a second
ingredient shape in the schema, recipe totals and the coach's catalog, for little gain.

## 40. "Log with AI" back inside Log food; staples offered per miss, recent phrases per device

**2026-11-01** · The overhaul left AI logging only on the day view's log bar, so from the calendar it
was gone. Log food gets a `Search my foods | Log with AI` switch (remembered per device). AI mode reuses
`POST /api/food/parse` unchanged — Haiku reads the sentence, `core.resolveWords` checks every id against the user's
catalog — and the confirmation cards are shared with WordsDialog (`routes/food/words.tsx`).
- **"AI matching may use staples" is done on the client, per miss.** The model never sees CNF (6,000 rows would bloat
  the prompt and invite guesses). An unmatched item offers the top Canadian hit for its words, only when every word
  heard is in the staple's name ("a zorblax bar" gets no offer), and it's saved to their foods only on click (rule 1a).
- **Recent phrases live in localStorage** (last 5, with kcal), written when a parse is logged.

**Rejected.** *Server-side phrase history* — a new collection for a convenience list. *Sending staples to the model* —
cost and guessing, against "nothing is guessed".


## 41. Meal ideas and recipes in Coach chat: Opus writes them, code prices them, drafts until the user clicks

**2026-11-01** · The user asks the coach for meal ideas from what they have, picks one, gets a recipe, and
logs how much they ate — now or any time later.
- **Who writes what.** The coach (Opus) composes the ideas and the recipe — it already has the day: kcal and protein
  left, the meal being planned and the training (a new "Food" line in the per-turn context). Two tools,
  `suggest_meals` and `build_recipe`, take ingredient lines (name, amount for the whole recipe, unit, `toTaste`) and
  steps. **Nutrition is never the model's**: each line is matched to the user's foods by the small model
  (`FoodAi.matchIngredients`, Haiku, same catalog-with-short-ids approach as #34, ids checked in code), a miss takes
  the top CNF staple only when its name covers every word (`core.stapleCovers`, shared with #40), and `core.priceLines`
  prices it. The tool result hands the computed numbers back so the coach's prose quotes them. Lines already matched on
  the picked idea are reused, so building a recipe from an idea usually needs no second match call.
- **Drafts in their own collections.** `meal_ideas` (a priced snapshot) and `recipe_drafts` (lines with their match,
  priced on every read). The transcript only holds `meal_ideas` / `recipe_ref` blocks with ids (rule 2); "Picked" and
  the "Logged to Dinner — see day" pills come from those documents, not new messages. Threads get a `food` tag.
- **Log = save + log.** There are no hidden draft recipes in `recipes`: pressing **Log** (or **Save as recipe**) makes
  it a normal Library recipe with `steps` (new optional field) and a "To taste: …" note, then Log writes one
  `via: 'coach'` recipe entry. That's what lets the user log it again any time from Log food / Library. Staples in use are
  saved to their foods at that click (rule 1a; the pane says which), reusing a food already saved from the same staple.
  Save is idempotent and serialized per draft. Unresolved lines (no food, or a unit the food can't measure) block both
  buttons until the user picks a food, fixes the amount, marks it to taste or removes it.
- **UI.** Idea cards + follow-up chips in the thread; a recipe link card opens a 420 px pane (`?recipe=`, a Sheet on
  phones) that replaces the right rail; a "Planning with" strip above the composer on food threads (meal · day, kcal
  and protein left, tomorrow's session) — a slot/day picked there is sent with each message.

**Rejected / deferred.** *Coach-estimated kcal on idea cards* — against "nothing is guessed"; the match call is cheap.
*Haiku writing the ideas* — it doesn't have the coaching context, and one voice in the chat is simpler. *Draft
recipes stored in `recipes` with a status* — every library/search/catalog reader would need to filter them.
*Fridge photo in the composer, "leftover → tomorrow's lunch" (needs planned food entries)* — later.

## 42. The image runs anywhere Docker runs; one process owns the background work
*The background-work part is superseded by #56 (a Mongo-leased job schedule).*

**2026-11-02** · The production image is the same one `docker compose` builds: one container serving
the API and the SPA, configured by env, talking to any MongoDB replica set. Put it behind whatever
TLS front you like (a reverse proxy or a tunnel); the app itself needs no published port beyond the
one the front talks to.

**Background work (at the time).** The intervals.icu sync, Zwift metrics, Zwift events and the route
refresh all started inside the API process on timers. An in-process queue only serialized runs within
one process, so two processes on the same DB could double-import. `BACKGROUND_JOBS` (default true)
turned the timers off for local dev. Manual "Sync now" and "Get more events" still worked everywhere.
#56 replaced all of this with leases, so correctness no longer depends on a single process.

**Rejected.** *Building on the server*: it shouldn't need a source checkout. *Serverless/edge runtimes*:
Hono and the Node-free `app.ts` fit, but long-lived coach turns, the request gates and the Mongo
driver make it an experiment, not a default.

## 43. Home-screen web app (PWA) before Capacitor; no service worker
**2026-11-02** · To use the app on a phone now, it installs from the browser (on iOS, Safari's
**Share → Add to Home Screen**). The pieces: `apps/web/public/manifest.webmanifest` (standalone,
"Coach"); icons rendered once from `icon.svg` and committed (the 180 px `apple-touch-icon` is
opaque, since iOS rounds the corners itself); the `apple-mobile-web-app-*` meta tags with a
**`default` (solid) status bar** and white `theme-color` to match the app bar; and
`env(safe-area-inset-top)` on `AppBar`. Capacitor (#3) stays the plan for a real native shell.

**No service worker.** iOS installs without one. Every screen needs the network anyway (coach,
intervals.icu, food AI), and a service worker cache is the usual cause of a stale app. Instead, the
shell is revalidated on every request: `index.html` and the SPA fallback send `Cache-Control:
no-cache`, hashed `/assets/*` files are `immutable` for a year, and the manifest and icons are
cached for an hour (`apps/api/src/lib/spa.ts`).

**A home-screen app stays open across deploys.** Lazy chunks from the old build (the barcode scanner)
no longer exist, so `/assets/*` misses return a 404 instead of the SPA's `index.html`, and
`vite:preloadError` reloads the page once, with a sessionStorage guard so it can't loop.

A home-screen app has its own cookie jar, separate from the browser's, so you sign in once inside
it. The 90-day session covers that.

**Rejected.** *vite-plugin-pwa / Workbox*: precaching gains nothing without an offline need and
risks serving a stale app. *`black-translucent` status bar*: content slides under the notch and
every page would need a top inset. *Silent auto-reload on a new version*: it loses unsaved input.

**Fix (Nov 2): absolute base on the web.** The relative `base: './'` (kept for Capacitor) made a cold
load of a deep link request `/calendar/assets/…`, which the SPA fallback answered with HTML. The web
build now uses `base: '/'`; a Capacitor build sets `CAPACITOR=1` to get `./`. `index.html` links the
manifest and icons absolutely.

**Removed (Nov 2): a new-version toast.** A foreground check for a new build kept misfiring and was
removed. A reopened home-screen app picks up a deploy on its next cold load, because `index.html` is
`no-cache`. The silent single reload on `vite:preloadError` stays, since without it the barcode
scanner breaks after a deploy.

## 44. Open-source self-host stack: the root compose runs the app with a bundled Mongo
**2026-11-02** · `README.md` targets self-hosters. Root `docker-compose.yml` has an `app` service
built from the `Dockerfile`, next to `mongo`. `docker compose up -d --build` gives a working app on
:8787, and `docker compose run --rm app node dist/seed.js` (the seed is bundled by tsup) creates the
login. The `app` service pins `MONGO_DB_URI` to the bundled Mongo whatever `.env` says, so it can't
touch an external DB by accident. It sets `BETTER_AUTH_URL` and `APP_URL` from `PUBLIC_URL` (one
origin, default `http://localhost:8787`) and publishes `APP_PORT`. `pnpm db:up` starts only `mongo`,
so dev is unchanged. `.env.example` serves both self-host and dev.

**Rejected.** *A separate `docker-compose.selfhost.yml`*: one more file and `-f` flag for every
self-hoster, while dev only ever starts `mongo`. *De-personalizing the seed and persona in the same
change*: a separate task (#59).

## 45. Meal idea Details pane: look before picking; misses fixed inline without AI (Nov 2)

**Decision.** Each idea card gets **Details**, which opens a right-hand pane (Sheet on phones). The pane shows nutrition,
how the meal fits the day (kcal / protein left, the range asked for), the coach's why, ingredients with sources,
preview steps, equipment and leftovers. Its only action is **Make this**. The first design's Swap / 2 servings / Ask chips were
dropped: the pane is for reading before spending a recipe turn.

- **The coach writes words, the app the numbers.** `suggest_meals` adds `difficulty, equipment, leftovers, why, steps`
  (why: no numbers, since pricing happens after the call) and `kcal_range` when the user names one. These fields are optional, so
  ideas from before Nov 2 still open.
- **Misses are fixed inline, without AI.** Up to 3 offers are stored per unmatched line when the ideas are made: the user's foods
  (`rankByText`) first, then CNF hits with whole-word matches ahead of prefix hits ("Salmonberry" for salmon). There is
  also a Search my foods… chip. `PATCH /coach-food/ideas/:id` saves a picked staple as one of their foods (their click,
  rule 1a; it reuses one saved from the same staple). It applies the match to every unmatched line with that name across
  the ideas, then re-prices the pane and the card. `build_recipe` already reuses matched lines, so a fix carries into the recipe.
- **Fixes live on the `meal_ideas` doc**, not the message. The transcript stays append-only (rule 2).

**Known gap.** The coach isn't told about fixes, so its prose from that turn can say "130 kcal, couldn't match the
salmon" after the user fixed it. The next turn's tool results carry the real numbers.

**Rejected.** *Computing suggestions on each GET*: a staple search per miss per view. *Fixing unit mismatches in the
Details pane*: the recipe pane already has the amount editor.


## 46. A coach turn lives outside the Coach page; nothing navigates from a stream (Nov 2)

**Problem.** The user pressed Make this, saw nothing happen, went to another page — and the app pulled them back to Coach when
the recipe arrived. The turn's state was `useState` in `CoachPage`, the stream loop kept running in the closure of an
unmounted page, and its `recipe_ref` handler called `navigate()` from wherever they were.

**Decision.** `lib/coachTurn.ts` is a small module store (`useSyncExternalStore`) of live turns by thread. `startTurn`
owns the stream loop that `CoachPage.send()` had; the page only reads the turn, so leaving and coming back shows it still
running and keeps the buttons disabled. Leaving doesn't abort it (it finishes and is stored server-side anyway; Stop
still does). **The store never navigates**: a `recipe_ref` sets `readyRecipe`, and the Coach page opens the pane only if
it is showing that thread (then clears it). The new-thread `replace` navigation happens only while the page is still
mounted. A turn that finishes while the user is elsewhere (`setWatching` says which thread is on screen) leaves one notice
— a toast with Open — and the Coach nav item / tab shows a pulsing dot while any turn runs.

Visible work: a "working" pill (dots, a label from the running tool, seconds after 5 s) for the whole turn except while
text streams; Make this shows "Writing…" on the button pressed (the turn's `origin`), and on desktop the right column
becomes a skeleton until the recipe opens. The right column is one fixed 420 px width (`rightColumn.ts`) for the rail,
Details and the recipe pane — it used to be ~300 / 440 / 420 and content could stretch the panes.

**Rejected.** *Abort on unmount*: the server would finish the turn anyway and the user would come back to a half-written bubble.
*Navigating back when done*: the bug. *A global zustand store*: one small module is enough and adds no dependency.

## 47. Recipes stay structured; they get a page, cook mode and scaling (Nov 2)

**Decision.** Markdown was suggested for nicer recipes. We kept the recipe **structured** and render it well instead:
amounts must stay numbers for pricing (#41 — nutrition is never the model's) and for scaling. Steps may carry inline
markdown — the coach bolds heat, time and doneness cues, rendered with `react-markdown` limited to `strong/em/code` —
and are told to name ingredients **without amounts** so scaled amounts can't contradict them.
- `Recipe` gains optional `description`, `minutes`, `toTaste[]` and per-line `label` (the coach's "chicken thighs" vs the
  food "Chicken, broiler, thigh, raw"). `draftToRecipeInput` fills them instead of folding description and "To taste"
  into `notes`; old recipes simply lack them. Patch schemas stay default-free (rule 1b).
- `core.recipeView` / `draftRecipeView` → a `RecipeView` DTO (no ids) for the recipe page, cook mode and share links.
  `core.scaleLines` / `scaleQuantity` round the way a cook measures (g/ml to 5s above 50, whole below, ½ under 10;
  spoons, cups and counts to ¼; never to zero).
- **Two kinds of scaling.** On a coach draft, the servings stepper (always shown until saved) rescales every line on the
  server (`PATCH servings`), because "make it for 3" means the recipe makes 3 — per-serving numbers hold and logging
  stays "1 of 3". Make this takes a servings count too (reversing #45's dropped "2 servings" chip, on request). On a
  saved recipe or a share link, "Cooking for N" (`?for=N`) scales the **display** only; the saved yield is unchanged.
- Page `/library/recipes/:id` (Cook, Log a serving, Share, Edit) and full-screen cook mode (tick ingredients and steps,
  Wake Lock "Keep screen on", ticks in `sessionStorage`).

**Rejected.** *Claude returns a markdown recipe*: freezes amounts, unpriceable, can't scale. *Scaling saved recipes in
place*: "for 4 tonight" isn't a new recipe. *Amounts inside steps with placeholders*: brittle; naming ingredients is
how most recipes read anyway.

## 48. Share links: live, revocable tokens on a public `/api/public` route; accounts later (Nov 2)

**Decision.** A recipe should be shareable with someone who has no account. `recipe_shares {userId, recipeId, token, createdAt,
revokedAt?}`: one active link per recipe, 24 random bytes base64url (`randomBytes` in the service — `app.ts` stays
Node-free), URL `${APP_URL}/r/{token}`. **Live**: the link shows the recipe as it is now. **Turn off link** sets
`revokedAt` (→ 410); sharing again makes a new token. `GET /api/public/recipes/:token` is a separate sub-router mounted
**before** the guarded `/api` (tested: it answers without a session; everything else still 401s), with `no-store` and
`noindex`, and returns only the `RecipeView` and the sharer's first name — no food, recipe or user ids. Malformed tokens
are refused before a lookup. The SPA's `Root` skips the login gate and app shell for `/r/*`. Share uses the native share
sheet where there is one (Messages on iOS), else copies; after an await Safari may refuse the sheet, so it falls back
to copying or showing the link.

**Later — multi-account (not built).** A signed-in viewer of `/r/:token` gets "Add to my library": their click copies
the recipe and its foods into **their** foods (rule 1a still holds — it's their save). Foods are reused by
`source`/`sourceRef` like `foodForStaple`, else copied as `manual` with a `copiedFrom`; images aren't copied. The
server resolves foods from the token, so the public DTO never needs ids. A second account also needed per-user
intervals.icu credentials and a neutral persona (since done: #53, #59).

**Rejected.** *Snapshot links*: live was chosen (fix a typo, the link follows). *Hashing tokens at rest*: then the page
couldn't show the link again; a recipe link is low-stakes and revocable. *Signed, expiring URLs*: nothing to expire for
a recipe.

## 49. Rides and wellness are stored; intervals.icu is the synced data source (Nov 2)

**Supersedes** the "read live / never stored" parts of #16 (rides on the calendar), #21 (each calendar chunk reading
rides live), #26 (weigh-in history read live; a `weigh_ins` collection rejected) and #30 (the completed-session result
read live). Prod was being rate-limited by intervals.icu: every calendar chunk, the 5-minute budget refetch in seven
components, the dashboard (`status()` + fitness on every load), coach tools and completed panels all called it, a ±400-day
backfill ran on every boot and every "Sync now", and any write cleared the provider's whole read cache.

**Decision.** intervals.icu is the hub Garmin, Zwift and Strava feed; we **sync from it into Mongo** and the app reads
only Mongo. Coach-created sessions still push out through `services/calendar.ts`, and their results come back.
- **Stored:** `activities` (the `Activity` DTO + `tags`, `fingerprint`, detected `intervals`, `detailAt`, the ride's
  `powerCurve` once the coach asks), `wellness` (per day: CTL/ATL, ramp, weigh-in, steps), and on the `integrations`
  doc the athlete record (hourly), the four athlete power curves, and the full import's state. Only the sync writes them.
- **Reads** go through `services/training-data.ts` (`TrainingData`), which also implements the coach's
  `TrainingDataPort` (the coach package stays db-free). A ride whose intervals haven't been fetched yet is fetched once,
  on demand, and kept. Compliance (#30) is still computed, never stored — now from stored intervals.
- **Delta sync** (every 15 min, boot, "Sync now"): push owed changes; reconcile the calendar over −21/+120 days (a
  date window, because a delete only shows as a missing event); re-read rides and wellness from the **last successful
  sync's day less 7 days** to today (late Garmin uploads, reprocessed loads; the window grows by itself after an
  outage); write rides whose fingerprint changed (dropping their stale intervals), delete stored rides intervals.icu no
  longer lists *in that window*; done/missed from stored rides; weight trend from stored wellness; power curves only
  when rides changed or once a day; up to 10 rides' intervals. About 3 requests when nothing happened. No backfill at boot.
- **Full import** (first run, or "Full sync" on Athlete › Connections): rides quarter by quarter back to the first
  (stopping after 12 empty quarters, never before 2000), wellness year by year, every ride's intervals, then the
  delta's last pass matches done/missed across all history and reconciles ±400 days of calendar. It runs in the
  background, saves its cursor after every request, and survives restarts (the next delta resumes it). The UI shows a
  progress bar on Connections and a chip in the shell; the screens that show rides refresh every 30 s while it runs.
- **Pacing:** every intervals.icu request (reads and writes, sync and on-demand) goes through one `RequestGate`
  (`providers/gate.ts`, shared with Zwift's own instance): one in flight, **one a second**. A 429 pauses the gate for its
  `Retry-After` (default 60 s, capped at 15 min) and retries once; a second 429 throws, and the full import waits
  (`waitingUntil`) for the next delta. The background worker queues one request at a time, so a click never waits
  behind a backlog. The provider's read cache is gone.

**Rejected.** *Keeping live reads with a better cache*: still one request per screen per user, still stale after a
write, and the coach's history stays limited to what we'd fetch per turn. *An "updated since" delta*: intervals.icu's
list endpoints only filter by date, and wouldn't report deletions anyway. *Full backfill at boot*: deploys triggered it.
*400 days of history*: all of it is wanted, paced.

## 50. Editing sessions: `unset` on the calendar patch; Edit replaces Move (Nov 2)

**Decision.** Planned/missed/skipped sessions get an Edit form (the Add form prefilled, kind fixed). Since a patch could
only `$set`, `calendarEventPatchSchema` gains `unset: ('startTime' | 'coachNote' | 'meta' | 'durationMin' |
'durationLabel')[]`; a field both set and unset keeps the set value. Typing minutes or picking a new workout also
clears the coach's `durationLabel`, which would otherwise keep winning on the chip. Edit replaces Move (the form has the
date). Kind can't change in an edit — that's delete + add, so an edit never unlinks a session from intervals.icu by accident.

Two fixes found while testing it:
- `CalendarService.patch` normalised the patch alone, so any race patch without `priority` (every Move, too) reset an
  A race to B and a Garmin race to Zwift. `normalisePatch` now falls back to the stored values before defaulting.
- Race and workout pushes omitted an empty `description`, so a PUT kept old notes on intervals.icu. They now always send it.

**Rejected.** *Nullable fields on the patch* (`startTime: null`): the coach's `update` proposal is built from the same
schema, and its strict tool schema would change; the coach doesn't need to clear fields (`unset` is omitted there).
*A separate `edit` selection type*: edit mode is local state in the session panel, keyed by event id, so the calendar,
day view and phone agenda needed no changes.

## 51. Open core: a public AGPL repo for self-hosting, a private repo for the hosted service (Nov 2)

**Decision.** The single-user, self-hosted app (intervals.icu API key) is this repo, published under
**AGPL-3.0-only** with a fresh history. A hosted service (registration, onboarding, intervals.icu OAuth,
billing, marketing) is built in a private repo that includes this one as a git submodule. Design files,
progress notes, the production deploy files and an unscrubbed decisions log stay private. This
`DECISIONS.md` keeps its numbering so code comments still resolve, with infrastructure and personal details
removed. Outside contributions need a CLA (CLA Assistant), so they can also ship in the hosted version.

Before the split, the public repo gains the seams the hosted layer plugs into:
- a per-user integration resolver (`intervalsFor`/`zwiftFor(userId)`; on self-host the env key applies to the
  owner account only);
- a `Features` port;
- a Mongo-leased job runner that replaces the `setInterval` timers (#42);
- `createCore()` as the composition root;
- the web app exportable as a router plus slots;
- a neutral persona and seed.

**Why.** The app is easy to replicate, so this isn't about secrecy. The aims are a clean repo strangers can run,
a hosted service that takes some effort to copy, and no personal data in public. A submodule makes the boundary
something git enforces: anything in this repo is a public commit, and hosted code can't reach its history.
AGPL plus the CLA stops a closed competing service built on the code, while the maintainer can still run one.

**Rejected.**
- *A private fork tracking the public repo as `upstream`*: less friction, but any commit that mixes core and
  hosted code becomes a cherry-pick, and one wrong push publishes private code. This is the fallback if the
  submodule spike fails.
- *Exporting the public tree from one private monorepo (filter or copybara)*: incoming PRs are awkward, and leaks
  depend on the filter being right.
- *MIT/Apache*: allows a closed competing hosted service.
- *FSL/BSL*: not OSI open source.
- *Publishing the packages to npm*: too much release overhead for one developer.
- *Keeping the existing history*: it contains personal health data and infra notes.

## 52. Zwift: opt-in with a ToS warning in the open-source app; a per-account flag on hosted (Nov 2)

**Decision.** Zwift support stays in the open-source app and is off until `ZWIFT_USERNAME`/`ZWIFT_PASSWORD` are
set. The README, `.env.example` and the Zwift card say it uses Zwift's unofficial API, isn't endorsed by Zwift and
may breach Zwift's terms, so use it at your own risk. On hosted, the **public** event feed and route table
(no login) are available to everyone. The logged-in features (zFTP/zMAP/weight sync, "Get more events") need a
`zwift` flag on the account **and** that user's own Zwift login, stored encrypted. Every Zwift request from every
user still goes through the one shared `RequestGate`, and the "Get more events" cooldown becomes per user.

**Why.** The maintainer keeps their zFTP sync, and other users of the hosted service don't put their Zwift accounts at risk
by default. The existing safeguards (#23, #29) are what make the self-host warning reasonable: requests paced
2 s apart, no retry after a rejected login, and the logged-in feed runs only when clicked.

**Rejected.**
- *Removing Zwift from the open-source app*: self-hosters choose their own risk.
- *Flagged hosted users sharing the server's Zwift login*: their sign-ups would land on the server owner's account.
- *Hiding the public event feed on hosted*: it needs no login and makes the Events page and the coach's race
  suggestions useful for everyone.

## 53. Integration clients are per athlete; intervals.icu OAuth shapes the credentials (Nov 2)

**Decision.** No service holds an intervals.icu or Zwift client any more. `IntegrationResolver`
(`apps/api/src/integrations.ts`) hands out a client per `userId` (`intervalsFor`, `zwiftFor`). It caches one
client per athlete and drops it on `invalidate`. All athletes share one intervals.icu `RequestGate` and one Zwift
`RequestGate`. Credentials come from a `CredentialSource`:
- **Self-host (`envCredentials`):** `INTERVALS_ICU_KEY` and `ZWIFT_*` belong to the **owner account**, which is
  `OWNER_EMAIL`, or else the oldest account. Every other account is "not connected".
- **Hosted (later, private):** each user's stored, encrypted OAuth token, or an API key, plus a Zwift login for
  flagged accounts (#52).

Consequences:
- `IntervalsIcu` takes `auth: { kind: 'apiKey' } | { kind: 'bearer' }`.
- `CalendarService`, `TrainingData`, `IntervalsSync`, `ZwiftSync` and `ZwiftEventsService` take the resolver.
- "Not configured" is per athlete: the `intervals` and `zwift` services are never null, `status` says
  `not_configured`, and syncs answer 503.
- `TrainingData` is always present, because it reads our own copy.
- The coach asks `intervalsConnected(userId)`.
- The "Get more events" cooldown and run state move from the global `sync_state` doc to the athlete's Zwift
  `integrations` doc (`extended`). The public feed and route table stay global, and every walk still shares one
  lock.
- The coach's "not configured" texts no longer tell the model to name an env var or a person.

**Why.** The 15-minute `syncAll` ran every profile through the one env client, so a second account would have
had the owner's rides, wellness and calendar imported into it. That's fixed now, and it's verified: on a local
throwaway DB with two accounts, the second gets `not_configured` and 503s and has nothing written. It also gives
the hosted layer a single seam to plug credentials into.

**intervals.icu OAuth facts** that shaped this (forum OAuth thread 2759, cookbook 80090, API terms 114087; read
2026-11-02):
- **Endpoints:** authorize at `https://intervals.icu/oauth/authorize` (`client_id`, `redirect_uri`, `scope`,
  `state`, optional PKCE S256). Exchange at `POST https://intervals.icu/api/oauth/token` (`client_id`,
  `client_secret`, `code`, within 2 minutes).
- **Tokens:** the response includes `athlete: { id, name }` and the scopes actually granted. Use it as
  `Authorization: Bearer`. There is **no refresh token**, and expiry isn't documented. Athlete id `"0"` works
  with a token.
- **Scopes:** `ACTIVITY|WELLNESS|CALENDAR|LIBRARY|SETTINGS|CHATS`, each `:READ` or `:WRITE` (WRITE implies
  READ), comma-separated. We need `ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE,SETTINGS:READ`. SETTINGS covers
  the athlete record.
- **Disconnect:** `DELETE /api/v1/disconnect-app`.
- **Webhooks:** a POST whose JSON carries a top-level `secret` plus `events[]` with `athlete_id` and `type`.
  Retried 8 times with backoff (about 8.5 minutes in total) until a 2xx comes back. Duplicates are possible.
  Use `CALENDAR_UPDATED`, not the legacy per-event types. Activity webhooks are never sent for Strava-sourced
  activities.
- **Rate limits** are **per app**, not per token: 100 per user per day, at least 5,000 and at most 50,000 a day,
  and a 15-minute window of 1/8 of the daily limit (at least 2,500). There's also roughly 10 requests a second
  per IP. That's why one intervals.icu gate is shared by every athlete.
- **Terms:** commercial use is allowed, and nothing about AI. One condition: data from Garmin devices must carry
  Garmin attribution. intervals.icu warns that Garmin API data may be cut off soon.
- **Application:** a privacy policy isn't needed until the app is made public (until then it's visible only to
  its creator). Redirect URLs are matched exactly, without wildcards. `http://localhost` is always allowed for a
  confidential client.

The hosted app's OAuth callback and webhook routes live on its own app host (#55); the webhook is verified by
the body `secret` and the configured authorization header. The hosted app mounts both routes before the core
`/api` auth guard (#57).

**Rejected.**
- *Each service resolving credentials from the DB itself*: that spreads credential handling everywhere.
- *A gate per athlete*: intervals.icu limits the app and the IP, not the token.
- *Treating every account as the owner on self-host*: that's the bug.
- *Keeping the Zwift cooldown global*: on hosted, one athlete's click would block everyone else.

## 54. `Features`: what an account may use, separate from what it has connected (Nov 2)

**Decision.** `/api/me` returns `features: Features` (`packages/shared/src/account.ts`), built by a
`FeatureSource` (`apps/api/src/integrations.ts`). It has one flag today, `zwiftAccount`, meaning the account may
use the logged-in Zwift features (zFTP/zMAP/weight sync, "Get more events").
- **Self-host (`envFeatures`):** the owner gets it. Other accounts don't.
- **Hosted:** the account's `zwift` flag (#52).

Whether a login is actually connected is still the Zwift status. The web shows the Zwift connection row only
when `zwiftAccount` is set. The server enforces the same rule through the credential source: an account that
may not use Zwift never gets a Zwift client, so its syncs and "Get more events" answer 503 or `not_configured`.

**Why.** Hosted needs three states:
- not allowed: no Zwift row at all;
- allowed but not connected: "Connect Zwift";
- connected: "Sync now".

A status alone can't tell the first two apart.

Hand-entered zFTP and Zwift weight, the Zwift card on the Performance tab and the weight-drift alert don't use
Zwift's API, so they stay for everyone. The coach context keeps Zwift metrics for the same reason.

**Rejected.**
- *Hiding all Zwift UI without the flag*: many athletes race on Zwift and enter zFTP by hand.
- *Deriving the flag from "has credentials"*: a flagged hosted account must see "Connect" before it has any.

## 55. A hosted version runs the app on its own host, apart from its marketing site (Nov 2)

**Decision.** The hosted version serves this app (SPA and API) on a dedicated app host, and its marketing
site (landing, pricing, privacy, terms) separately on the apex domain, from the private repo. Cookies stay
host-only on the app host; the marketing site only links to sign-in and register and shares no session. The
intervals.icu OAuth redirect URL points at the app host from the start, since redirect URLs are matched
exactly (#53).

**Why.** Keeping the app on its own host keeps marketing deploys, caching and analytics away from the app and
auth. It's a common split.

**Rejected.**
- *Serving marketing from the app's Hono server by `Host`*: it mixes marketing into the open-source app, which
  has to stay generic.
- *Marketing at the apex with the app under `/app`*: the SPA base path, PWA scope, cookie paths and SEO all get
  messier.
- *Cookies shared across subdomains*: nothing on the marketing site needs a session.

## 56. Background work on a Mongo-leased job schedule, not `setInterval` (Nov 2)

**Decision.** The timers in `server.ts` are gone. `JobRunner` (`apps/api/src/jobs/runner.ts`) keeps one `jobs`
document per kind and key, which is both the schedule and a **lease**. It's claimed with an atomic
`findOneAndUpdate`, kept alive by a heartbeat (2-minute lease, renewed every 40 s), and rescheduled on release.
A process that dies just lets its lease run out.

Kinds (`apps/api/src/jobs/index.ts`):
- `intervals.delta` per connected athlete, every 15 minutes;
- `intervals.full` per athlete while an import runs: 4-minute slices that resume from the saved cursor, deleted
  when the import is over;
- `zwift.metrics` per athlete with a Zwift login, every 6 hours;
- `zwift.public`, hourly, refreshing the route table first when it's a week old (so the separate daily timer is
  gone);
- `jobs.ensure`, hourly: it creates or removes per-athlete jobs as connections change.

On failure a job backs off 1, 2, 4… minutes, capped at its own interval. New jobs get up to 60 s of jitter, and
existing jobs keep their time across restarts, so a deploy doesn't re-run everything.

**Manual runs take the same lease.** `runNow`:
- "Sync now" waits for a run held anywhere (up to 2 minutes), then runs and reschedules a full interval out.
- Zwift "Sync now" works the same way.
- "Full sync" uses `trigger`: it marks the job due and starts it in this process unless someone holds it, so it
  runs even where the loop is off.

`withLock(name)` is the same lease without a schedule. **`lock:zwift`** wraps every Zwift call: the metrics
sync, the public feed and route table, and "Get more events". That way only one process ever talks to Zwift,
whatever the gate in each process says.

`BACKGROUND_JOBS` now only means "this process runs the loop". It's still off for local dev, so dev doesn't sync
on its own, but correctness no longer depends on that. `JOBS_CONCURRENCY` (default 2) sets how many jobs one
process runs at once. The standalone `worker.ts` uses the composition root (#57), so it doesn't
duplicate `server.ts`.

**Why.**
- The in-memory queues only serialized within one process, which is why two processes on one database (dev and
  prod sharing it) could double-import.
- One `syncAll` loop walked every athlete back to back, which doesn't scale past a handful.
- A crash forgot an in-flight full import until the next delta noticed.
- The persisted schedule also gives webhooks somewhere to go later: a webhook just `kick`s a job.

**Verified.**
- 11 tests on `mongodb-memory-server`: one claimer wins, an expired lease is re-claimable, only the holder
  releases, backoff and reset, one-offs deleted, concurrency respected, `runNow` waits or gives up,
  `withLock` across runners, `trigger`.
- Live, with two API processes on a local throwaway DB:
  - The owner's delta ran once, in one process.
  - The second account had no job.
  - "Sync now" on process B waited while a lease was held elsewhere and ran once it was released.
  - SIGTERM left no leases behind.

**Rejected.**
- *Agenda / Bull / pg-boss*: a dependency (and Redis for Bull) for about 250 lines we can test.
- *A cron container*: still needs locks, and loses per-athlete schedules.
- *Keeping `setInterval` plus a Mongo lock*: there's still no per-athlete schedule, and no resume after a crash.
- *Zwift pacing per process only*: a separate worker would double the request rate to Zwift.

## 57. One composition root, `createCore`, with seams for the hosted version (Nov 2)

**Decision.** `server.ts`'s wiring moved to `apps/api/src/compose.ts`, exported as `createCore(opts)`
(`@cycling-coach/api/core`). It connects the database and builds auth, integrations, services, the job schedule
and the API, and returns `{ env, c, auth, app, services, integrations, jobs, startJobs, close }`. It has three
callers:
- `server.ts`: serves the SPA when `WEB_DIST` is set (`serveSpa` in `lib/spa.ts`), then the HTTP server, and the
  job loop when `BACKGROUND_JOBS` is set.
- `worker.ts`: new; jobs only, no HTTP. Built to `dist/worker.js`, run in dev with `pnpm --filter
  @cycling-coach/api worker`.
- The hosted version.

Options, each with a self-host default:
- `credentials(ctx)`: a `CredentialSource` (#53). Default: env credentials for the owner.
- `features(ctx)`: a `FeatureSource` (#54). Default: everything for the owner.
- `auth`: an `AuthExtension`, meaning `allowSignUp`, extra Better Auth `plugins`, and `options` merged over the
  base (`emailAndPassword` field by field). `Auth` stays the base instance's type, because the routes only use
  `handler` and `api.getSession`.
- `spendGuard(userId, use)`: asked before each coach turn and each food-AI call (`food_parse`, `food_vision`).
  A message refuses the call: the coach yields it as an error, and food answers **402** (added to
  `ServiceFailure` and the web's `ErrorStatus`). The default never refuses. Ingredient matching inside a coach
  turn rides on that turn's check.

Hosted adds its own routes by putting them in front of the core app:
`new Hono().route('/api/oauth', …).route('/', core.app)`. Routes registered first answer before the core
`/api` guard, and the core's routes and guard still apply behind them (verified). Hosted authed routes call
`core.auth.api.getSession` themselves and use their own typed client.

**Deferred:** making the env-file path overridable. A consuming repo's scripts can pass their own
`--env-file`.

**Why.** The hosted version needs the whole app with a few parts swapped, not a fork of `server.ts`. Without a
shared root, `worker.ts` would also have duplicated about 370 lines of wiring.

**Verified.**
- Typecheck, lint and tests pass.
- `createCore` driven from outside on a local throwaway DB, with custom credentials, features, open sign-up and a
  guard that refuses one account:
  - Sign-up via the auth handler returned 200.
  - Features and intervals.icu status were decided per account.
  - The refused account's coach turn came back as an error, with no Claude call.
  - Its food parse returned 402.
  - A route mounted in front answered, while `/health` and the 401 guard still worked behind it.
- The built `dist/server.js` with jobs off ran beside `dist/worker.js`. The worker ran the delta, and shutdown
  left no leases.

**Rejected.**
- *A plugin registry or DI container*: five plain options cover what hosted needs.
- *Hosted forking `server.ts`*: every core change would need porting.
- *`createApp` taking a route-extension callback*: route types would have to flow through generics, and putting
  routes in front of the app already works.

## 58. The web app is a library: `createAppRouter`, `<App>` and slots (Nov 3)

**Decision.** `apps/web/src/main.tsx` is now about 20 lines. The route tree, the sign-in gate and the providers
moved to `src/app.tsx`, which exports:
- `createAppRouter({ extraRoutes, publicPaths })`. Extra routes are children of the exported `appRootRoute`
  and render inside the app shell behind the login, unless their path starts with one of `publicPaths`. `/r/`
  (share links, #48) is always public. Public paths travel in the router context; they replace the hard-coded
  `/r/` check in `Root`.
- `<App router queryClient extensions>` and `createQueryClient()`.
- `reloadOnStaleChunks`, and the Extensions types and defaults.

`src/extensions.tsx` is a React context with one default per slot; the defaults are the self-hosted app:
- `brand`: the name in the sidebar, sign-in page and share links (`Coach`).
- `navItems(core)`: the sidebar and tab bar items. The tab bar's columns follow the item count.
- `loginFooter`: under the sign-in form.
- `intervalsConnect` and `zwiftConnect`: `{ hint, action? }` for a Connections row while the athlete isn't
  connected. The action (a Connect button) also shows while a connection is broken. The self-host hints say the
  env credentials connect the owner account only (#53), which fixes the misleading "Set INTERVALS_ICU_KEY" text
  a second account used to see.
- `usageCard`: the Claude API row (now `components/ClaudeUsageRow.tsx`), or `null`.
- `accountCards`: extra cards at the end of Account.

`apps/web/package.json` gained `exports`: `./app`, `./styles.css`, `./components/*` and `./lib/*`, all source,
like `packages/*`.

**What a consuming app must do** (documented in `app.tsx`):
- Register its own router type (`declare module '@tanstack/react-router'`). The core's `Link`s are then checked
  against its route tree.
- Define each extra route as its own `const` and pass the constants. Routes written inline in the
  `extraRoutes` array (or returned from a callback) collapse the router type to `any`, and every typed `Link` with
  it. Found while verifying; the first design took a `(root) => routes` callback for this reason.
- Give Vite `resolve.dedupe` for React, React DOM and TanStack Router/Query. The coach-turn store and the query
  cache are module singletons.
- Import `@cycling-coach/web/styles.css` from its own stylesheet and add `@source` for its own files.

**Also fixed:** `loadEnv` treats an empty value as unset. `.env.example` ships `OWNER_EMAIL=` (#57), which
failed `z.email()`, so a fresh self-host copy would not have booted.

**Why.** Hosted pages (register, onboarding, billing) need the whole app with a few additions, not a fork of
`main.tsx`. Slots cover the few places the self-hosted app has to speak differently, without the core knowing
about hosted features.

**Verified.**
- A throwaway consumer outside the package (scratchpad, imports by package name): typecheck (a bogus nav path is
  rejected), Vite build (Tailwind emits the consumer's classes and the core's), and a browser run against a local
  throwaway DB (`verify_1e`, dropped). It checked the public `/register` page with no login, the brand and
  login footer, the extra tab, `/billing` inside the shell, the Connect hint and button, the usage card, and the
  Account card.
- The self-hosted app with defaults: the same pages unchanged, with the new owner-only hint.

**Rejected.**
- *A slot for the whole sign-in page*: a sign-in redesign can land here as an ordinary feature.
- *An onboarding gate slot*: add it when hosted onboarding exists. It's a small public commit then.
- *Exporting every file*: four subpaths are the public surface.

## 59. The code speaks of "the athlete", not one person (Nov 3)

**Decision.** Before the public release, nothing in `apps/` or `packages/` is about one person:
- **Coach persona** (`packages/coach/src/prompt.ts`): "the athlete" and they/their throughout. The name still
  reaches the coach through the athlete block (`Name:` from `getUserName`). Personal facts became general
  rules:
  - a specific Garmin scale → "weigh-ins synced to intervals.icu";
  - racing ZRL as a personal fact → "ZRL and many events place riders by zFTP/zMAP category";
  - a Peloton note → "power from another platform (a Peloton, a gym bike)…";
  - particular race series as the athlete's own → "often a Zwift race";
  - a personal standard warm-up → "the athlete's own warm-up when memory has one", else the same ramp.

  Facts like these belong in the athlete's coach memory. Snapshots are frozen (#6): running threads keep the
  old persona, and new threads get the new one.
- **Tool descriptions and runtime strings** (`tools.ts`, `context.ts`, `food.ts`) are neutral the same way.
  The examples are generic: activity id `i123456789`, "my last crit", FTP 280 W.
- **Seed:** creates the account (`SEED_USER_NAME` is required, with no default) and a starting profile from
  `--ftp` (200), `--weight` (75) and `--timezone` (the machine's zone). Without a profile the app has nothing to
  show and the coach refuses. `--sample` adds generic example goals and memory.
- **Starter library:** `seed-library.ts` → `starter-library.ts`, `SEED_WORKOUTS` → `STARTER_WORKOUTS`. The
  workouts were already generic.
- **Profile timezone default:** a specific zone → `UTC`. Every writer sends the full profile, and stored
  profiles keep their zone.
- **Test fixtures:** real intervals.icu activity and athlete ids, a Zwift id, a real domain and a personal name
  are replaced. Generic Zwift terms (ZRL, Club Ladder) stay as test data.
- **Comments:** personal names became "the athlete" or "the user", and citations of private design documents
  were removed. `DECISIONS #n` references stay.
- **UI copy:** "your Garmin scale" → "your scale", "Zwift / Garmin calorie estimates" → "Calorie estimates
  from Zwift or your device", and the race placeholder became "Zwift race".

**Rejected.** *Keeping personal seed data behind a `--file` option*: not needed; it stays in private history.


## 60. Credentials can change at runtime; deployments keep their own collections (Nov 3)

**Decision.** A user's integration credentials may now change while the app runs (a deployment that stores
them per user lets people connect, change and remove logins), so:
- `IntegrationResolver` asks the `CredentialSource` on **every** lookup and keeps a user's client only while
  the credentials are the same as when it was built (compared in memory). Unchanged → the same client, so a
  Zwift token and its "rejected, don't retry" flag survive. Changed → a new client. `null` → none.
  `invalidate` stays as the local fast path.
- `Core.credentialsChanged(userId)` drops that user's cached clients, schedules or removes their per-user
  jobs (`ensureUserJobs`, extracted from `ensureJobs`) and kicks an intervals.icu delta when connected. The
  first delta starts the full import (#49). Jobs are database documents, so this works from any process,
  including a one-off admin script.
- `CoreContext` and `Core` expose `db`, so a deployment can keep its own collections beside the core's.
- The web's `ConnectSlot` gains `manage`, shown while a connection exists (working or broken), next to
  `action` for "not connected or broken" (#58).
- The providers' rejection messages no longer name env vars ("check the username and password"), because
  the credentials may not come from env at all. The README and `.env.example` keep the env-var guidance.

**Why.** With a cache per process and no expiry, a login saved through the API would have left the worker
process syncing with the old one until a restart. Asking the source each time costs one cheap lookup and
needs no cross-process invalidation channel.

**Rejected.**
- *A TTL on cached clients*: every expiry would mean a fresh Zwift login, and a change would still lag.
- *A change notification between processes* (a collection to poll, or pub/sub): more moving parts than
  re-reading the source.
