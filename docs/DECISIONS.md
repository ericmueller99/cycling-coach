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

*Nov 10:* the anchor is now the top week's position in the list's content, not the viewport, and
one `settle()` compensates for any shift before it re-reads the anchor. It runs on every commit (a
layout effect), from the ResizeObserver and from the scroll frame. Before, a scroll frame could run
between a prepend's commit and the ResizeObserver, re-read the anchor from the shifted layout and
adopt the shift, which made the view jump about 8 weeks (two months) back and then snap forward
while the athlete scrolled up.

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
- **Routes** (`cdn.zwift.com/gameassets/GameDictionary.xml`): when older than a week, checked by the hourly
  `zwiftPublic` job before the public sync (not at boot, as first written; corrected in #102).

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

*Superseded in part by #96:* a weight goal now has a pace picked from a list, not a date.

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

## 61. Real sign-in routes; what sign-in offers is per deployment (Nov 3)

**Decision.** The single sign-in card that rendered in place at any URL is replaced by real routes:
- Signed-out only: `/login`, `/register`, `/forgot`, `/reset`. A signed-in visitor goes on to `?next=` or
  `/`. Signed out on an app route → `/login?next=<path>`. `?next=` only ever takes a path on this site
  (`safeNextPath` in `packages/shared`: no `//host`, `/\host`, schemes or control characters).
- Desktop pages are the form beside a dark showcase panel of static sample content; phones get their own
  layouts. "Keep me signed in" maps to Better Auth's `rememberMe`.
- Public **`GET /api/auth-config`** → `{ signUp, passwordReset, emailVerification }`, derived from the auth
  options (`allowSignUp`, whether `sendResetPassword` and `sendVerificationEmail` exist). The pages show
  "Create an account", "Forgot password?" and the verify reminder only when the server can do them.
- `/api/me` adds `emailVerified` and `onboarded` (#62).
- Two web slots: `legalLinks` (terms and privacy URLs; when set, registering requires agreeing to them) and
  `signUpClosed` (what `/register` says while sign-up is off).
- While a server verifies email and the address isn't confirmed yet, a "Confirm your email" card with
  Resend sits in the desktop sidebar and on the Account page (and a bar on onboarding). Not in the page
  flow: the full-height pages (coach, calendar, library) would scroll.

**Self-host is unchanged in effect:** sign-up stays closed (the seed makes the account), there's no email, so
no reset or verification, and the seeded account goes straight to the app. A deployment opens sign-up and
adds email through `createCore({ auth })` (#57).

**Rejected.**
- *A hosted copy of the auth pages*: they're generic; only the brand, legal links and the email transport
  differ, and those are slots and options.
- *Requiring verification before sign-in* (`requireEmailVerification`): a new athlete would bounce to their
  inbox before onboarding. A deployment that needs verification gates what costs money instead (its
  spend guard).

## 62. First-run onboarding; FTP may be unknown until a ramp test (Nov 3)

**Decision.** A signed-in account that isn't onboarded is sent to **`/welcome`**: five steps and a summary in
one card, no app shell. Fitness · Body · Goals · Memory (optional) · Sync (optional) · All set.
- **State:** an `onboarding` document `{ step, fitness, unit, goals, goalIds, rampTest, completedAt }`.
  `onboarded` = a finished wizard, or a profile with no onboarding document (seeded accounts and accounts
  from before onboarding). Every Continue saves its step (`/api/onboarding/*`), and `step` only moves
  forward, so a refresh resumes where the athlete was. Skip saves nothing for that step.
- **Fitness:** a known FTP and where it's from (`profile.ftpSource`), or "I'm not sure".
- **Body:** creates the profile: weight (typed in kg or lb, stored in kg), the browser's timezone, and FTP
  from the Fitness step. Seeds the starter library (`seedStarterLibrary`, shared with the seed script).
- **Goals:** one main goal (the athlete's words, else the event, else the first chip), the other chips as
  its "Focus" line, and an event as its own goal. No measures; the coach proposes them later. Saving the
  step again replaces the goals it made before, never the athlete's own.
- **Memory:** ordinary long-term memory notes. Short-term things are told to the coach in chat.
- **Sync:** the deployment's intervals.icu connect slot (#58).
- **Finish:** when FTP is unknown, books the **FTP Ramp Test** (now in the starter library, category
  `Test`) for tomorrow in the athlete's timezone through `CalendarService` (rule 1); it reaches
  intervals.icu on the first sync after connecting. "Go to my coach" opens a new thread with a prompt.

**FTP can be unset.** `profile.ftpZwift` is optional. Screens show "Not set" or "—", workout targets fall
back to % of FTP, W/kg is left out, goal progress on FTP waits, and the coach's athlete block says to
prescribe by feel and heart rate and to propose an FTP from the ramp test (about 75% of the best minute).

**Rejected.**
- *A placeholder FTP until the test*: W/kg, zones, the energy budget and the coach would all present a
  made-up number as fact.
- *One goal per chip*: "Raise my FTP" next to "Raise my FTP to 300 W" is noise on the Athlete page.
- *Saving the whole wizard at the end*: a refresh or a closed tab would lose it.

## 63. A deployment can tag pushed workout names (`eventNameSuffix`) (Nov 3)

*Superseded by #105: the option is gone, and pushed workouts keep their own name.*

**Decision.** `createCore` takes an optional `eventNameSuffix`, e.g. `" via example.com"`. It's appended
to the `name` of every workout pushed to intervals.icu. The default is none, so a self-host install is
unchanged.
- **Why the name:** intervals.icu forwards the workout to Zwift, and Zwift titles the ride after it
  (`Zwift - Intervals icu: <name>`). The tag therefore reaches wherever the ride is shared, including
  Strava, without any Strava API (#2, #13). Zwift writes the ride's description itself, so a description
  can't travel this way.
- **Where:** `withNameSuffix` in `buildWorkoutEvent` (`providers/intervals-icu/map.ts`), passed in by
  `CalendarService`. Workouts only: races keep their plain title, because Zwift names race rides after
  the Zwift event.
- **Round trip:** `IntervalsSync` strips an exact trailing match (`withoutNameSuffix`) from every remote
  event it lists, before reconciling. Our own titles and the library-workout dedupe (by name and
  structure) never see the tag, and a rename made in intervals.icu doesn't come back as `… tag tag`.
- **Existing events** get the tag the next time they're pushed (a create, an edit or a move).

**Rejected.**
- *Tagging the `.zwo` `<name>` as well*: the library workout's own name would then carry the tag on
  downloads and imports. Revisit only if Zwift turns out to title rides from the file rather than the
  event.
- *A prefix*: Zwift already puts its own `Intervals icu: ` in front, so a tag at the end reads better.

## 64. Sync seams for webhooks: kicks that aren't lost, a settable poll, and a visible rejection (Nov 3)

**Decision.** A deployment that receives intervals.icu webhooks can schedule a sync for an athlete and poll less.
The webhook handler itself isn't in this repo: it needs an OAuth app, so it belongs to whoever runs one.
- **`Core.intervalsChanged(userId, { settings })`:** schedules that athlete's delta 60 s out. `settings` also
  re-reads the athlete record on that run, whatever its age (`athleteStale`), so an FTP change arrives.
- **`JobRunner.kickSoon(kind, key, delayMs)`:** `kickJob` now uses `$min`, so a burst of kicks is one run at the
  first one's time, and a kick never delays a run.
- **`rerunAt` on a job:** a kick during a run used to be lost, because the run's release overwrote `runAt` with its
  next interval. `rerunAt` survives into the release, which takes the sooner of the two. Claiming a job clears it:
  any kick before the claim is covered by the run that follows. It fixes `credentialsChanged` as well.
- **`createCore({ intervalsSyncEveryMs })`:** the delta's interval. Default 15 min, so self-host is unchanged.
- **`createCore({ intervalsBaseUrl })`:** a stand-in for intervals.icu in local testing.
- **`IntervalsIcu.disconnectApp()`:** revokes an OAuth token (#53).
- **A rejected key or token is an error state.** `lastErrorStatus` is stored with `lastError`, and `status()` says
  `error` on a 401/403 even after past syncs. Before, it only did on an account that had never synced, so a
  revoked token still showed "Connected". A successful sync clears it, and so does `credentialsChanged`.
- **`fullRun` stops when the athlete isn't connected.** "Not connected" counted as transient, so an import retried
  every minute forever after a disconnect. Its state stays, so a reconnect's delta resumes it.

**Why.** Polling doesn't fit an OAuth app's limits (#53). A delta is about 3 requests, so every 15 minutes is about
290 per rider per day against an allowance of 100 per user per day with a floor of 5,000: about 17 riders would use
all of it. A notification should only say "look now": the delta already reads and reconciles everything, so nothing
in a webhook needs trusting or parsing, and a forged one can at worst cause a sync.

**Verified.** Tests on in-memory Mongo (`jobs/runner.test.ts`, `services/intervals-sync.test.ts`), and a hosted
deployment driven in a browser against a local stand-in for intervals.icu: five notifications made one sync 62 s
later.

**Rejected.**
- *Applying the webhook's payload directly*: a second path into the calendar and rides, with undocumented shapes.
- *Stopping polling*: activity webhooks aren't sent for Strava-sourced rides, and delivery gives up after about
  8.5 minutes.
- *Ignoring our own `CALENDAR_UPDATED` echoes*: a push fires one, but a delta with no changes pushes nothing, so
  it ends after one extra run.

## 65. Two models: everyday coaching on Sonnet, plans and workouts on Opus (Nov 3)

**Decision.** `CLAUDE_MODEL` now defaults to `claude-sonnet-5-5`, and `CLAUDE_BUILD_MODEL` (`claude-opus-5-5`) does the
work that matters most. This replaces #11's single model. Titles move to the small `FOOD_AI_MODEL`.
- **How a turn moves:** tools marked `tier: 'build'` (`propose_plan`, `propose_calendar_changes`, `create_workout`).
  A turn starts on the chat model. When that model opens a build tool, the engine stops the call, keeps nothing from
  it, and re-issues the same messages on the build model. The tool list is the same on both, so the prefix is stable.
- **One warm follow-up:** for one turn after a build, while its cache is warm (5 minutes from the call's start), the
  thread stays on the build model. A warm read there costs far less than a cold write on the chat model.
- **When a model can't go on:** a retryable failure or refusal on the build model carries on with the chat model. A
  refusal on the chat model gets one try on the build model, because the two decline different things.
- **Use {model}** in the composer sends one message to the build model, for a question no tool would catch.
- Set both to the same model for no routing.
- The env vars named here are gone: see #69.

**Why.** Opus on every turn costs more than most people want to pay. Sonnet is exactly half of Opus on every price
line. Plans and workouts are all tools inside one chat loop, so routing has to happen inside it. Sonnet → Opus keeps
the reasoning, because Opus reads Sonnet's thinking blocks on the Claude API; Opus → Sonnet drops it without an error.

**Rejected.**
- *A small classifier before each turn*: it guesses, can't be explained to users, and adds a call.
- *Letting the chat model finish and rejecting its tool call*: a whole draft of latency, and the build model can copy it.
- *The advisor tool*: encrypted advice, and it only helps if the executor chooses to consult it.
- *One model at low effort*: simpler, and worth measuring, but it can't offer two tiers.

## 66. Usage is recorded for every attempt, including stopped ones (Nov 3)

**Decision.** `priceUsage` sums `usage.iterations`, each at its own model, because top-level usage covers only the
attempt that produced the message. A stream that stops early (the Stop button, a dropped connection, the handoff in
#65) records its input usage and an output estimate from elapsed time, marked `estimated`. `ai_calls` gains `tier`,
set from the route and not the model, because a fallback can serve another model.

**Why.** Once limits exist, anything unrecorded is free usage. Output tokens aren't reported until a stream finishes
and thinking isn't visible, so time is the only measure left. `ai_calls` stays an estimate, and the Console is the
source of truth.

## 67. `SpendGuard` returns a decision; a turn's context says why (Nov 3)

**Decision.** The guard from #57 now answers `{ allow: true, build?, coachNote? }` or
`{ allow: false, code, message, action? }`. `build: false` keeps a turn on the chat model. `coachNote` goes in the
turn's context message, so the coach can explain a change itself. `action` becomes a button. It's asked before a turn
and between its model calls, and `GET /coach/check` asks before a new thread is created. A `coachNotice` web slot sits
above the composer. A refused turn gives the text back to the composer.

**Why.** A plain string could only say no. A deployment needs "yes, but on the smaller model", and an athlete who
gets a worse answer should know why, from the coach as well as from a banner.

**Rejected.** *Refusing `POST /threads`*: onboarding opens a thread before the email is confirmed.

Also, from the same work: the athlete block no longer carries live CTL (it's in every context message, and in the
block it re-sent the whole block daily), a calendar whose window moved but whose sessions didn't counts as unchanged,
and `seen` is updated only once the coach has replied. The persona's cache marker uses the 1-hour TTL.


## 68. A race session holds out for a ride that looks like the race (Nov 3)

**Decision.** intervals.icu's pairing no longer wins outright for a race session (#17). If the paired ride's name
doesn't look like a race, the session skips the pairing while its day is going. Once the day is over it takes the
pairing only if no ride that day looks like a race. A skipped pairing falls through to the scorer. `matchActivities`
now takes `today`. Other sessions still trust the pairing.

**Why.** A warm-up before a Zwift race uploads first, and intervals.icu paired it with the race event, which left the
race as an unplanned ride. #32 says the two must stay apart. Checking for a better ride isn't enough: a sync can run
before the race uploads, and a matched session is closed to the matcher, so it has to wait.

**Cost.** An outdoor race with a plain ride name matches a day late. intervals.icu keeps its own pairing, because
rides are never written there (#16), so the two can disagree until the athlete fixes it there.

**Rejected.** *Re-matching done sessions when a better ride lands*: it could undo a choice the athlete made.
*The same rule for workouts*: a ride's name says nothing reliable about whether it was the session.

## 69. The model router is code, not env (Nov 3)

**Decision.** `CLAUDE_MODEL`, `CLAUDE_EFFORT`, `CLAUDE_BUILD_MODEL`, `CLAUDE_BUILD_EFFORT` and `FOOD_AI_MODEL` are removed.
This reverses that part of #65. `packages/coach/src/router.ts` holds `DEFAULT_ROUTER`: chat, build and small jobs.
- `CoachEngine` and `FoodAi` take a `RouterSource`, a function asked for the router. A turn reads it once at its start, so a
  change never lands mid-turn. Food and titles read it per call.
- `createCore` takes an optional `router` (like `spendGuard`, #57), so a deployment can supply its own, from a database for
  example. Self-host runs the defaults.
- `ai_calls` gains `turnId`, `effort` and `routeStart`, and a call stopped to move a turn is `stopReason: 'handoff'`, not
  `stopped`, so what routing costs can be measured apart from the user pressing Stop.

**Why.** Five env vars described one thing, and two models are now how the coach works, not an option. A wrong pairing was
easy to leave in a `.env` and silently turned routing off.

**Trade-off.** A self-hoster who wants another model now changes `DEFAULT_ROUTER` or passes `router`. If people ask for it,
a single env var over the defaults can come back.

## 70. A deployment can supply its own logo (Nov 3)

**Decision.** `Extensions` gains `logo`, a pair of image URLs for light and dark backgrounds, defaulting to `null`. When set,
the sidebar, the auth pages and the share page show the image in place of the tile and name; the sidebar keeps its FTP line.
The self-hosted app sets nothing and looks the same.

**Why.** A logo is a deployment's brand, like `brand` (#58). Two URLs fit the one dark surface we have, the phone sign-in
header. A `ReactNode` slot would make each caller know about backgrounds anyway.

## 71. Rides can come from a second source (Nov 4)

**Decision.** `Activity` gains optional `provider` and `sourceLabel`; absent means intervals.icu, so nothing needs migrating.
Such a ride's id starts `<provider>:`. A deployment writes them through `Core.rides` (`save`, `remove`, `settle`). This amends
#49 ("only the sync writes them") and #64, which turned down a second path into rides.
- **The sync only sees its own rides.** `storedRideRefs`, `ridesNeedingDetail` and `countActivities` filter to intervals.icu
  rows. Without this the delta would delete every other ride as "no longer listed".
- **`settleRides` is shared.** Dropping duplicates, ticking off sessions and marking missed ones moved out of the delta, which
  exits early for an athlete without intervals.icu.
- **Duplicates:** the same ride is one that starts within 5 minutes and lasts within 10%. The intervals.icu copy wins, because it
  has load and intervals and fitness is built on it. Sessions and feedback move to the survivor, so nothing dangles.
- **Hidden isn't deleted.** A ride intervals.icu lists as a placeholder still exists, so a stored copy stays (`listRides` returns
  `hidden`), and its detail stops being fetched (`UNSHARED_STATUS`). It used to be deleted, which would have lost history if
  intervals.icu hides a source's rides.

**Trade-off.** Another source's rides have no load, so they don't move CTL or ATL, and no power curve. Those stay intervals.icu's.

## 72. A deployment can add to the coach's turn context (Nov 4)

**Decision.** `createCore` takes `coachContext(userId, today)`, returning a line of text or null. It goes after the food line in
the per-turn context message, only when it changed (`thread.seen.extra`). A failure leaves it out and the turn carries on.

**Why here.** It's after every cache breakpoint, so the prefix doesn't move (#18, #67), and daily values already live here. A new
tool would change the prefix for everyone, and the athlete block would re-send whole on every daily change.

**Rejected.** *`SpendDecision.coachNote`*: free today, but it's a spend decision and this isn't one.

## 73. Web slots for extra connections and body cards (Nov 4)

**Decision.** `Extensions` gains `extraConnections` (rows above the usage row on Connections) and `athleteBodyCards` (above the
budget on Athlete › Body & energy), both empty by default. Generic on purpose: a deployment's own sources shouldn't need a named
slot here, as intervals.icu and Zwift have.

## 74. A deployment can supply the small logo (Nov 4)

**Decision.** `Extensions` gains `logoMark`, a square image shown wherever the lime tile appears, through a new `BrandTile`
component. Default null, so self-host keeps its tile.

**Why.** `logo` (#70) only covers the places that show a full logo. The coach avatar and the welcome pages show a small tile, and
a deployment with its own brand had no way to change it.

**Rejected.**
- *Making `logo` carry both*: the two are different shapes, and many deployments will only have one.

## 75. Manual sync limits, and failed pushes don't wait for the poll (Nov 4)

**Decision.**
- **`createCore({ intervalsManualLimits: { syncMs, fullSyncMs } })`:** how soon an athlete can repeat "Sync now" and "Full sync".
  Inside the limit the route answers 409 with `retryAt`, as `/events/refresh` does. Default: no limit, so self-host is unchanged.
- **The limit counts from the last finished run** (`lastSyncAt`, `lastFullSyncAt`), so a failed run can always be retried.
- **`CalendarService` takes an `onPushFailed` callback**, wired to `kickSoon` on the delta at 2 hours.

**Why.** A deployment on webhooks can poll rarely (#64), and every athlete shares one OAuth app's allowance (#53), so a repeated
Full sync costs everyone. A failed push only records an error and waits for the next delta: on a daily poll, a workout could miss
the session it was meant for.

The retry is bounded. `kickSoon` uses `$min`, so a failure costs at most one extra run per 2 hours, even if the failure is
permanent. A faster poll simply runs first, so a 15-minute install sees no change.

**Rejected.**
- *Retrying a push on its own timer*: a second retry path beside the delta, which already re-pushes.
- *A shorter retry*: a permanent failure, such as a deleted library workout, would repeat at that pace forever.

## 76. The coach says it can't reply before anyone writes to it (Nov 4)

**Decision.** The Coach page reads `/coach/check` on load and after each turn. When the spend guard refuses, its message and action
replace the composer and quick prompts. Past conversations stay readable. Food's AI dialogs show a refusal's action too, through
`errorContent` in `components/ui`. The food routes dropped `action` on the way out, so `/food/parse` and `/food/photo` now pass it on.

**Why.** A deployment can refuse AI for reasons that last, such as a plan ending (#57, #67). The composer stayed open, so people wrote
a message only to have it handed back. Self-hosted installs never refuse, so nothing changes for them.

The check fails open: if it can't be read the composer stays, and the server still refuses.

**Rejected.**
- *A new extension slot for the lock*: the guard's refusal already carries the words and the link, and it's generic.
- *Hiding the AI buttons on the food pages*: people wouldn't know the feature exists, and a refusal with a link says why.

## 77. A serving doesn't need a weight (Nov 4)

**2026-11-04** · A food can be saved with no weight or volume. Coffee-shop apps print "1 sandwich" and nothing else, so the form's
blank `g` row made those foods impossible to save without inventing a number.

- An untouched row (blank amount, blank or standard unit) no longer counts as a serving size. A label unit with no amount
  ("sandwich", blank) is still an error, because the user started typing it.
- With no rows left, the measure comes from the printed serving (`core.measureFromServingLabel`: "1 sandwich" → 1 sandwich), and
  failing that it's `1 serving`. A photo reading with no `servingMeasures` fills the row the same way, so it can be checked.
- The model didn't change (#33): a count is already a measure and `grams` was already optional. No migration. Such a food logs
  in servings or its own unit only, until the user adds a weight.

**Rejected.**
- *Letting `measures` be empty*: every reader would need a case for it, and `serving` already resolves.
- *Estimating a weight*: a made-up number would flow into logs and recipes as if it were measured.

## 78. Adjust a food with AI before saving it (Nov 4)

**2026-11-04** · A label gives the standard item, and people's orders differ: a mocha with no whipped cream. The food dialog now has
an **Adjust with AI** tab beside Details, whenever the form has a calorie value. The user says what was different, the small model
proposes a change, and **Apply** puts it on the form. Nothing is saved until Save, as in #33 and #34.

- **The model gives deltas, code does the sums.** `core.applyNutrientChanges` applies them to the form as it stands, so a value
  edited after the proposal is kept and two proposals can stack. Nothing goes below 0, and a blank nutrient stays blank.
- **Applied values are estimates and look like it.** They go amber with the "check" tag, the name takes the change, and a line goes in
  Notes. The prompt says to call them estimates and never official figures.
- **The chat isn't stored.** Turns live in the dialog and each send carries them, like refining in "Log with AI". Assistant turns say
  whether their proposal was applied, because the model only sees current values.
- **Text only, on the `small` route.** The form already holds what the photo said, so no image is resent. A turn cost about $0.0006 on
  Haiku. It has its own `ai_calls` purpose and `AiUse`, `food_adjust`.
- **A portion isn't an adjustment.** "I only had half" gets a reply saying to set it when logging, and no change.

**Rejected.**
- *The model returning new totals*: it would overwrite a manual edit, and the arithmetic belongs in code.
- *Applying straight to the form*: an estimate would replace a label value without a look (rule 5).
- *Resending the photo*: costs far more per turn and adds nothing the form doesn't hold.
- *Using the coach thread*: heavier and far dearer for a one-food question, and it would leave a thread behind.

## 79. Coach memory has two buckets: short-term and long-term (Nov 4)

**2026-11-04** · One flat list meant a passing fact like "I'm away next Wednesday" either got lost or was sent forever. Onboarding already
promised the split (#62). Now a note is **short-term** if it has an `until` date and **long-term** if it doesn't. No `term` field and no
migration: existing notes are long-term as they stand.

- **Short-term notes go a day after their date.** `until` is the last day a note matters, and that's what's stored and shown. A 1-day
  grace is applied only when filtering, so "away Wed Nov 11" is sent through Thursday and gone on Friday, in the athlete's own timezone.
  Expiry is a filter on read, so there's no job. Expired notes stay in the database, hidden.
- **Short-term notes live in the per-turn context, not the athlete block.** The block is frozen per thread and any change re-sends all of
  it, workout library included, into the permanent transcript. In the block, every add and every expiry would do that in every open
  thread. In the context message, the list is sent only when it changes (`seen.shortTerm`). It says it's the complete list, so a note the
  athlete deleted isn't saved again. The compare is strict, unlike `extra`, because an empty list after a full one is news.
- **The coach must pick a bucket.** `until` is required and nullable on `remember`, so a note can't go permanent by omission. That matters
  because running threads keep their old persona, which is also why the guidance is in the tool descriptions.
- **New tool `update_memory`**, alongside `remember` and `forget`: reword, move a date, or switch bucket. `strict: false`, to stay clear of
  the grammar limit. It writes directly and is undoable, so rule 5 now names it.
- **Undo on an update can't overwrite a later edit.** Chips don't remember being undone across a reload, so `POST /memories/:id/revert`
  applies only while the note still matches what the coach left. It skips the date check, because the old date may have passed.
- **Long-term notes never expire.** Six months without a look shows "Still true?" in the panel, with Keep, Edit and Delete. Any edit
  counts as a look.
- **The chat and the panel share `MemoryService`**, so both follow the same date rules: a real date (`isoDateSchema` only checks the shape),
  not past, within a year. Editing an expired note needs a new date.
- **The daily trend weight is out of the athlete block.** W/kg on power bests and the "now" value of goals on trend weight changed the
  block's text whenever the trend moved, which re-sent all of it. Power bests are now watts and date; those goals keep their target. The
  coach still gets the weight every turn. A zFTP with no Zwift weight still uses the trend in the Zwift metrics line.

**What it doesn't do.** An expired note leaves the coach's list and never reaches a new thread, but the words the athlete typed stay in
that thread's history (rule 2). The saving is mostly across threads.

**Verified.** Tests cover expiry over real turns through `sendMessage`. Real Sonnet turns with the production persona: right bucket and
date for "next Wednesday", a date range, a trip moved or cancelled, a note made permanent. Passing mentions of a sore knee (4 of 4) and a
cold (3 of 3) were saved; none of 6 small-talk or question turns were. "Work's crazy, only two rides this week" wasn't saved (0 of 5): the
coach planned the rides straight away instead.

**Rejected.**
- *Short-term notes in the athlete block*: see above.
- *A `term` field*: a second source of truth, and it allows a long-term note with a date.
- *Storing `until` + 1*: the coach reads the date back, so each update would add a day.
- *Expiry dates on long-term notes*: a dated long-term note is just a short-term note, and undated ones still go stale.
- *The coach raising stale notes in chat*: it needs throttling so it doesn't nag in every new thread. The panel is enough for now.
- *Sending only the memory section when a long-term note changes*: new threads seed `seen.athlete` with memory in it, so both sides of the
  comparison need care, for changes that are rare now that short-term notes are out of the block.
- *A job to delete expired notes*: filtering on read does the job. Purging them for good is still open.
- *Limits on the number of notes*: short-term notes expire, and a long-term note is about 30 tokens in a cached block.

## 80. A chat can have more than one API context (Nov 4)

**2026-11-04** · Every turn sent the whole thread, nothing limited a thread's size, and opening Coach reopened the latest one, so one chat
tended to grow for ever. The message cache lasts 5 minutes, so each return after a break rewrote the whole history at the cache-write price:
about $0.25 on Sonnet or $0.50 on Opus for 100K tokens, against about $0.07 for a new chat. This reverses #14's "threads have no context
expiry", and it's the idea #8 had for Strava, for a different reason.

- **A restart starts a new API context in the same chat.** The next request holds a fresh system prompt, a recap and the new message, and
  nothing older. Stored messages never change and the athlete still sees the whole chat, so rule 2 holds. #6 always said "per context".
  `ThreadDoc.contexts` records each one, and only messages from the last one's `startSeq` are sent.
- **Replaying nothing older is what makes it safe.** Dropping old turns while keeping recent ones verbatim breaks preserved thinking: their
  signatures record the full history. A summary plus the new turn is the shape the API docs recommend.
- **When** (`restartReason`, `packages/core/src/coach-context.ts`):
  - 80K+ tokens and idle 5 minutes or more. This is the saver, and it only fires on a return, because reads are cheap mid-conversation.
  - 200K+ tokens, even mid-conversation: the ceiling, which also limits a cold switch to the build model.
  - Idle 14+ days, whatever the size: the cut-off date. It adds freshness, not savings.
  - The tool definitions changed since the context began. `TOOLS_HASH` is stored per context. Thinking is tied to the tools it was written with,
    so on an enforced account a reworded description is a 400 on every open chat. Chats from before contexts existed restart once for the same reason.
  - A tool call has no result, which the API rejects. Such a chat was stuck; a restart frees it.
  - Never while a turn may be running (the last message isn't a finished reply and is under 20 minutes old). Restarting under another
    tab's turn would strand its tool results. `restartContext` is compare-and-set, so two tabs can't both restart.
- **Size comes from `ai_calls`:** the latest finished coach call after the boundary. No counter to keep in step. A fallback can double the
  figure and bring a restart forward, which is harmless.
- **The recap is a third system block,** `[persona, athlete, recap]`, because `seen.athlete` is compared against the athlete block alone. It has
  no cache breakpoint. `restartContext` is the only writer of `systemSnapshot` after creation. It resets `seen`, so the full calendar goes out again.
- **What's in it:**
  - A header saying the latest context message wins, so expired or deleted notes (#79) lose to the current list.
  - Haiku's summary of the athlete and coach text. Never thinking, tool results or context messages: they're most of the tokens and none of
    the conversation. It uses absolute dates and builds on the previous recap, so it never re-reads a whole chat. Input is capped at about
    50K tokens, under Haiku's 100K price step.
  - Open cards with their ids, written by code. Ids exist only in tool results, so without this "change X" made a second live card and "make the
    X" lost the idea's matches.
  - The last two exchanges word for word, so "yes, do that" still means something.
- **A recap never fails a turn.** It has 20 seconds and no retries, then the last few exchanges stand in. It's written before the message is
  stored, so Stop leaves nothing behind and the draft comes back. It has no tier, so it counts toward a total but not a chat allowance.
- **New chats get a recap too:** the athlete's latest other chat with a coach reply from the past 7 days, through the same path. It says
  to use it only if relevant. No open cards, because `replaces` only works within a chat. This closes #79's "only two rides this week" gap.
- **Opening Coach reopens the latest chat only if it was active in the last 12 hours,** or has a turn running (#46). Otherwise it's a new chat with a
  "Continue" link. A deep link or a refresh of `?t=` still opens that chat.
- **At 60K tokens a banner above the composer suggests a new chat,** dismissed per chat. It's only a suggestion: the rules above cap the
  cost whether it's pressed or not.
- **A divider marks each restart** ("Earlier messages are summarized for your coach"), so a forgotten detail isn't a surprise. It's on
  `ThreadView.contextBreaks`, not in `messages`, which leaves the live-turn counting alone. A carried recap shows none, because nothing was cut out.

**What it doesn't do.** A note the athlete deleted can come back as a question: the recap keeps what was said, so the coach may ask how the knee
is. An expired note already stayed in a chat's history (#79), so this is no worse. A chat that's warm on the chat model still writes its whole
context to the build model on a switch; only the ceiling limits that. Two tabs sending at the same moment can still interleave, as they could before.

**Verified.** Tests through `sendMessage` on a real Mongo, including stored messages unchanged, a retry keeping one user message, and Stop
during a recap. Live, with the check forced on (`prefix_mismatch_behavior: "error"`): the restart shape was accepted, with thinking, and hit the
cache on the next turn. A reworded tool description was rejected the same way, which is why the hash exists. On made-up chats with real Haiku
and Sonnet: "yes, do that" moved the right session, a plan change used `replaces`, a finished trip read as past, a newer note beat the
recap, "only two rides this week" reached a new chat, and an unrelated question stayed on topic. Recaps of those short chats cost under $0.001.

**Rejected.**
- *A date cut-off that keeps recent turns verbatim*: see above, it's a 400 on enforced accounts.
- *Anthropic's on-demand compaction*: it reads the raw history, thinking included, needs a beta header and a signed block on every later
  request, and that block can't seed a new chat. We keep no verbatim turns, so its one advantage goes unused.
- *Closing old chats or making them read-only*: a dead end for the athlete, and the restart already caps the cost.
- *A per-thread lease*: a heavier answer to two tabs. The in-flight check and compare-and-set stop restarts making that worse, and it's rare.
- *Thresholds as settings*: nothing real to set them from yet. They're constants until there is.
- *A 1-hour message cache*: it doubles every write to help gaps of 5–60 minutes. Worth measuring once sizes are capped.

## 81. A spend limit can tell a turn's start from its middle (Nov 4)

**Decision.** `AiUse` gains `coach_continue`, which `sendMessage` passes for the checks between a turn's calls. `coach` is now only the check that starts a turn. Self-host never refuses, so nothing changes there.

**Why.** The guard got `coach` both times, so a deployment with a limit had one choice: refuse a new turn and also cut off whichever turn was running when the limit passed. Stopping between tool calls leaves a half-finished answer that the athlete paid for. With the two apart, a deployment can stop new turns at its limit and let a started one finish, and still stop a runaway one later.

**Rejected.**
- *A second guard method*: one function with a `use` is the seam already, and every caller stays the same.
- *A flag on the call*: `use` is already what says what a call is for.

## 82. A new chat after 30 minutes, and the last one comes with it (Nov 4)

**Decision.** Coach starts a new chat once the latest has been quiet for 30 minutes, down from 12 hours (#80), the way other chat apps open on a blank page. What the old chat was doing comes with it, so a break doesn't lose the thread.
- **Opening Coach:** the same rule as #80, at 30 minutes. A running turn still wins.
- **Coming back to a page left open:** that page never reloads, so the rule above never ran, and a phone left on a chat overnight woke up on it. `useAwayReturn` notes what was on screen when the page went out of sight. Coming back after 30 minutes or more with nothing new in the chat goes to a new chat, with Continue pointing at the chat left behind. Both halves matter: a reply that landed while they were gone is what they came back to read.
- **Staying put:** a turn running, a draft, a recipe or idea pane, any open dialog, or their own message last, which means a lost turn that needs its Try again. A reload stays where it is. Any failure to read the chat stays too.
- **What a new chat gets:** a recap as before, plus the last two exchanges if the chat is under 12 hours old, and its open cards. Changing a carried card closes the old one, so `replaces` now works across the athlete's chats. This reverses #80's "new chats carry no open cards": at 12 hours that was rare, but at 30 minutes "swap Tuesday" in a new chat would make a second live plan, and adding both would duplicate sessions on the calendar and in intervals.icu.
- **Keeping it quick:** a chat of 3,000 characters or fewer goes across as it is, with no model call, and a recap gets 6 seconds instead of 20, because the first reply is waiting and the last messages are there to fall back on.
- **A recap passes on only what was said.** With short chats going across whole, each one carried the last one's heading, and a run of them stacked up headings in every prompt. Open cards and last words stay behind too, because they may be settled by the next chat.
- **Finding old chats:** "Show older", because chats now add up quickly and the list stopped at 50. The list reads only what it shows. The latest chat says how many proposals are waiting, for the Continue link.

**Why.** A chat that opens on yesterday's conversation feels wrong, and a long one rewrites its whole history on every return. It's a saving on mid-size and long chats only: a small chat costs about the same or slightly more as a new one, because it sends the calendar again and adds a title.

**Real calls (about $0.87, made-up athlete, Sonnet with the real persona).** "yes, do that" after a break moved the right session 8 of 8 times. Changing a carried card used `replaces` 6 of 6 times. An unrelated question raised the old chat in 2 of 5 runs, because the last words ended on an unanswered offer. A line saying that chat is over took it to 1 of 9, a one-line aside about a session due the next day.

**Known limits.**
- A desktop window left visible behind another app never hides, so it stays on its chat.
- Whether an installed iPhone app reopens at its start page or its last page, and whether Android restores it, hasn't been seen on a device.
- The 3,000 characters and 12 hours are guesses.
- The Continue link's card count is for the latest chat only, and counts proposals: meal ideas aren't waiting on anything.

**Rejected.**
- *Tracking sessions on the server*: the browser already knows, and there'd be one more thing to keep in step.
- *Time away alone*: it would pull the athlete off a reply they came back to read.
- *A new chat on reload*: a reload is the athlete staying.
- *Skipping the recap for short chats*: it would lose everything chained from before them.
- *Paging with a cursor*: a bigger limit does the job for a list this size.

## 83. The coach hands food logging to the logger (Nov 5)

**Decision.** The coach doesn't log food. Asked to, it calls `offer_food_log`, which puts a card in the chat: the athlete's
words, a **Log this** button and a fixed line on the quicker way to log next time. The button opens the existing confirm
dialog (`WordsDialog`), which matches the words and logs nothing until they press Log.
- **Nothing new is stored.** The block carries the phrase, so it comes back with the message: no collection, route or port.
- **No tier:** the turn stays on the chat model. The small model only runs when they tap, through the usual parse.
- **Today, not the planning day.** The dialog opens on plain today and the current meal, so "yesterday" isn't counted from
  the food strip's day. A meal or day in the phrase still wins.
- **The how-to is fixed text on the card,** not the model's words, so the path is never misremembered and costs no output.
- **`build_recipe` no longer says "and log".** That wording, with nothing else to reach for, is why logging turned into a recipe.

**Why.** Asking the coach to log food is natural, and refusing or writing a recipe feels broken. But a good logger already
exists, with matching, review, portions and misses. A hand-off keeps the confirm step (rule 5) and costs a one-line reply.
The coach sees what was logged on its next turn, through the Food line.

**Trade-offs.**
- It's a dialog, not a card that logs in the chat, and "half the rice" is said in the dialog, not to the coach.
- The button doesn't know it was used. Tapping again parses again, but the review step means it can't log twice by itself.
- Each attempt still costs a chat-model turn.
- The how-to shows on every card, which may wear on someone who keeps logging here.

**Rejected.**
- *A full in-chat log card* (drafts, routes, a claim against double taps): most of it would repeat the dialog.
- *Logging in chat, then saying it's better done elsewhere*: all of the cost, and it scolds people for using it.
- *Text only*: a dead end, and they'd retype what they just said.
- *A small model classifying each message first*: a call on every message to catch a rare one (see #65).

## 84. A coach reply stays where it is, comes in gently, and says it's still working (Nov 5)

**Problem.** The chat was jumpy. Accepting a card while the coach was still writing refetched the thread, which returned the
turn's stored messages. The stored and live copies both rendered, so the whole exchange appeared twice, and the change in
message count scrolled to the bottom: measured at 486 px with the page 486 px taller. Separately, the page scrolled to the end
on every token wherever the reader was, and the working pill vanished once any text had streamed, which hid the closing
model call after a card. Nothing runs after accepting: that late text is the same turn's last call.

**Decision.**
- **One copy of a turn.** While a turn is on screen, stored messages show only up to `baseCount`. A new `synced` flag keeps the
  live copy until the stored one has been fetched, so a refetch from anywhere can't double anything.
- **Sending anchors the message.** It moves up under the header once, and nothing scrolls during the turn. The reply grows down
  from where the eye already is. The conversation gets a `min-height` that stays after the turn, so the swap to the stored copy
  and shrinking cards can't clamp the scroll. **Latest** appears above the composer while unread words sit below it.
- **The working status sits above the composer** for the whole turn, over the chips, which can't be used then and keep the row's
  height. This changes #46's "except while text streams". It's a turning wheel, a label and the seconds: the tool, then
  Writing, then Finishing up after a card, then Thinking or the model.
- **`working` is a new event** for every tool, with no chip, from the moment the model starts writing the call, and `tool: null`
  when the tools are done. That is what makes "Drafting the plan" reachable: `runningLabel` would leave a chip stuck on running.
- **Text is paced in the browser** (`lib/textPacer.ts`). Events wait in order, so a card can't overtake the words before it. Text
  comes out by the word at `backlog / 1.2 s`, between 40 and 400 characters a second, and a finished stream gets 2 seconds. Stop,
  a hidden tab and reduced motion skip the pacing. These numbers are starting values, set by feel.
- **A live reply closes open `**` and `` ` ``,** so markers don't flash as literal text.
- **The stream sends a comment every 15 s,** so a proxy doesn't drop a turn during a long silent tool call.
- **Accept buttons say they're working,** and stay busy until the new status has arrived.

**Why.** Reading from the start of a reply is calmer than chasing its end, and the worst jump was a bug, not a lack of animation.
Pacing in the browser needs no server change, smooths any burst on the way, and adds only about a second of lag. It also cuts
renders from one per token to about 30 a second, and memoised rows stop re-parsing old messages.

**Trade-offs.**
- A short reply leaves empty space below it until the next message, because the page keeps its height.
- A long reply runs below the composer, so reaching the end takes a scroll or **Latest**.
- The chat model's text still vanishes when a turn moves to the build model (#65). It no longer moves the page.
- #46 says a turn finishes on the server if the user leaves. That holds for in-app navigation, but a dropped connection or a reload
  aborts the turn, through the same path as Stop. Not changed here.

**Rejected.**
- *Following the end unless the reader scrolls up*: smaller, but a long reply still runs away from them.
- *Keeping the pill under the reply*: it can be off screen, which was half the complaint.
- *Pacing on the server*: it would hold back bytes the browser could use, and change nothing about a burst after a proxy.
- *`runningLabel` on the card tools*: a chip that nothing ever finishes.
- *Fading in each word*: needs a markdown plugin and spans through every re-parse, for very little beyond pacing.

## 85. A quieter composer, and memory the athlete edits without asking the coach (Nov 5)

**Problem.** The Coach page carried a row of prompt chips, a model toggle and a model name under every reply, and most of it was
noise once someone knew the app. Changing a note meant asking the coach, which costs a turn, or leaving the chat for the Athlete page.

**Decision.**
- **The chips and the model toggle move inside the composer,** as **Suggestions** and **Think deeper**. Think deeper is the same
  `useBuildModel` for the next message only. Picking a suggestion now fills the input instead of sending, so it can be changed first.
- **No model name under replies.** It told the athlete nothing they could act on. `CoachWorking` still names a model while building.
- **The working status takes the place of those two buttons during a turn.** #84 laid it over the chip row, which is gone. In the
  toolbar it needs no row of its own, so the dock keeps its height and #84's no-jump behaviour holds.
- **`coachNotice` moves under the composer,** and `CoachLocked` becomes an amber card.
- **A Memory panel in the chat:** a header button with the note count, a card in the rail that always shows, and a drawer with the
  same rows as Athlete › Goals & coach (`MemorySection plain`). It calls the memory routes directly, so nothing reaches the model.
- **Two new slots.** `coachCopy` carries the words that depend on who pays for the AI: "allowance" is wrong on someone's own key.
  `snapshotHealth` lets a deployment add health numbers to the snapshot, and it's handed the weight tile to place.
- **Snapshot power comes from the 90-day bests only,** because the heading says so. `best5minW` falls back to other periods, so it's
  no longer used here.

**Why weight is passed into the slot.** Weight is the app's own data, with its trend and the Zwift alert. A deployment that adds
health tiles wants it beside them, but one with no health data, or a self-hosted install, must keep it.

**Rejected.**
- *A new slot under the composer:* `coachNotice` has one job, so moving it is simpler than keeping two.
- *Keeping a reserved row for the status:* an empty band above the composer for most of its life, to hold something shown during turns.
- *A second copy of the note rows for the panel:* two editors would drift, and both write the same notes.

## 86. Goals are open-ended unless they're an event or a weight goal, and the athlete sets how hard to go (Nov 5)

**Context.** "By when?" let anyone ask for a big number by a date with no pushback. The date did little anyway:
`targetDate` never reached the coach, so even a real event's date from onboarding was invisible when it planned the
first week. Only the calorie budget used a date.

**Decision.**
- **Only events and weight goals have a date.** `goal.event` is new, and `core.goalTakesDate` decides. A weight goal's
  date stays optional and still sets the calorie pace (#36). Every other goal is open-ended: the wizard and the editor
  don't ask, and the coach is told not to set one.
- **The coach now sees those dates** in the Goals block, as `event date …` or `reach by …`.
- **Nothing is deleted.** `targetLabel` is retired: nothing writes, shows or sends it. Old dates and labels on
  open-ended goals stay stored and ignored. Ticking "This is an event" on a hand-made race goal brings its date back. A
  boot migration flags the wizard's `Get ready for …` goals as events.
- **Training preference:** `profile.trainingPreference`, Steady, Committed or All in. Per athlete, not per goal: there's
  one body and one training load, and a main and secondary goal shouldn't pull against each other. Asked on the wizard's
  Goals step (Committed preselected) and on Athlete › Goals & coach. The coach can propose a change through
  `propose_profile_update`, and the athlete confirms it. Unset, the coach behaves as it did.
- **It's a ceiling, not a target.** Fatigue, ratings, illness and how they feel always win.

  | | Steady | Committed | All in |
  |---|---|---|---|
  | CTL gain per week, at most | about 2–4 | about 3–5 | about 5–8 |
  | Hard days per week | up to 2 | 2–3 | up to 3 |

  All in is for a block: after about 6–8 weeks the coach suggests stepping down. The athlete sees words, not numbers.
- **The coach is honest about big goals,** once, in chat: what's realistic from their numbers and preference, called an
  estimate, with a first milestone if it's a long way off. It never refuses a goal or repeats the doubt. Nothing is stored
  on the goal.
- **Availability is optional.** Most people's weeks change, so the default is "Tell my coach when I chat": the coach asks
  one short question when it needs to and saves the answer as a short-term note. `profile.usualWeek` (days, optional hours)
  is for those who want it, on the Athlete page only, and what they say in chat beats it.

**The numbers are starting guesses.** Friel puts 5–8 CTL a week as right for most; other coaches say 3–5. The FTP bands in
the persona (15–30% over 6–12 months for a beginner, 5–15% a year for an intermediate, 2–8% near their ceiling) come from
coaching articles, not research. The ceilings live only in the prompt, so nothing enforces them yet: if plans drift past
them, add a check on `propose_plan`.

**Rejected.**
- *A warning on the date*: it keeps the deadline, the thing that sets people up to fail, and needs a model of every measure.
- *Blocking an unachievable goal, as Xert can*: a coach says what's realistic, and the athlete decides.
- *Required weekly hours*: real weeks change, which is what chatting with a coach is for.
- *A preference per goal*: see above. A block of All in for one event is covered by changing it, and the step-down prompt.
- *Storing the coach's estimate on the goal*: it would turn back into a deadline.

## 87. Vacation and sick days are time off, not sessions (Nov 6)

**Context.** The athlete had no way to mark days they won't train. The coach only knew about a trip or an illness from a
short-term note, which the athlete never confirmed and which isn't on the calendar. A note also stops at the calendar
block's 14 days: a vacation next month was invisible to a four-week plan unless a note happened to exist.

**Decision.**
- **A separate `time_off` collection:** `kind` (`vacation`, `sick`), `startDate`, `endDate` (the last day, included,
  required, at most 366 days), `note`. Entries can overlap, because getting sick on vacation is real.
- **Writes go through `CalendarService`,** like every calendar write (`addTimeOff`, `patchTimeOff`, `removeTimeOff`).
  `patchTimeOff` checks the dates as they'll end up, because a refined schema can't be `.partial()`-ed.
- **They stay in this app.** Nothing is pushed to intervals.icu, and its own events of these kinds aren't imported.
- **The coach proposes, the athlete confirms** (rule 5). `propose_time_off` adds, changes or removes an entry on the
  existing change card, with new `time_off_*` rows beside the session rows. `propose_calendar_changes` keeps its narrower
  schema, so only this tool writes those rows. It isn't `tier: 'build'`: "I've got a cold" stays on the chat model.
- **Sessions on those days:**
  - *From the coach:* the tool adds a `remove` row for each one, so the offer doesn't depend on the model remembering.
    Each row can be skipped.
  - *By hand:* the panel lists them and asks before saving. They stay until the athlete moves or deletes them.
  - Both use `core.sessionsInSpan`: still planned, and on a day that hasn't passed.
- **Past sessions keep their status.** One that goes `missed` during time off stays `missed`, and the persona tells the
  coach to read it as excused. `settleRides` doesn't know about time off.
- **The coach sees it further ahead than sessions:** a block sent when it changes, from 14 days back to 180 ahead, with
  ids and absolute dates so the text only changes when the entries do, plus one line on each turn that today is inside an
  entry. `get_calendar` includes it too. It stays out of the athlete block, as short-term notes do (#79).
- **The boundary with memory:** days they won't train, because they're away or sick, go to `propose_time_off`. Niggles,
  busy weeks and feeling run down stay short-term notes. A trip and an illness are gone from the persona's and `remember`'s
  examples, so the coach doesn't record one absence twice.
- **On the calendar:** one chip per day, not a band across the grid. A chip that carries on squares its edge and reaches
  the side of its cell, so a run of days reads as one bar, named where it starts and at the start of each week.

**The first deploy costs a little.** A new tool changes `TOOLS_HASH`, so every open chat restarts once, with a recap call.
That restart is also what brings the persona edit to chats already open.

**Rejected.**
- *New kinds in `calendar_events`*: every reader assumes a ride. They'd be matched to rides, marked missed, counted in the
  week's hours, given 60 minutes of phantom exercise in the calorie budget and offered Mark done, and `type` would have to
  become optional. `listEvents` would also need an overlap query for every caller.
- *Syncing to intervals.icu*: it has `HOLIDAY` and `SICK` categories and an `end_date_local`, but we haven't tested
  whether that date is inclusive or what they do to its fitness chart. The model allows adding this later.
- *A new proposal kind and card*: the change card already has per-row Apply and Skip, which is what "add this, and offer
  to remove those" needs.
- *Removing sessions automatically*: wrong dates would delete workouts from intervals.icu.
- *A band spanning the week grid*: the grid is flat siblings in one CSS grid, and `scrollToWeek` depends on that.

## 88. The food intro shows once, on the first attempt to log (Nov 6)

**Context.** The user's foods start empty on purpose (rule 1a, #33), and nothing said so. A new user opened Log food to an
empty list and had to guess why. DESIGN.md section 16 had a three-step intro that was never built.

**Decision.**
- **It shows the first time they try to log,** and only then. `useFoodFlows` draws the intro in place of a `log` or `words`
  flow, and every way to log goes through there, so one check covers the Log food buttons, the log bar and the coach's
  hand-off. The flow stays set underneath, so when the intro ends it just appears, with the coach's phrase intact. Section 16
  also fired on opening the food side of the Calendar or Library › Foods; looking around shouldn't interrupt anyone.
- **Any way out counts as seen, and carries on to what they asked for:** ×, Skip intro, Esc or finishing. Clicking the scrim
  does nothing, because a stray click shouldn't use up something that shows once.
- **The flag is on the server,** `introSeenAt` on the food settings document, so it holds across devices. The library sends
  it as `introSeen`. It has its own route, `POST /api/food/intro-seen`, and isn't in `foodSettingsSchema`, because
  `PUT /settings` is the slots editor's and nothing should edit this.
- **It doesn't show for anyone who already logs:** `shouldShowFoodIntro` wants `!introSeen` and empty `usage`, the last 180
  days of logging. "Your foods start empty" would be wrong for them. Working from what they've logged needs no migration.
- **Step 2 is canned:** no model call, nothing logged. **Step 3 is real:** what's added there is saved, always from an
  explicit tap, so rule 1a holds.
- **It's its own modal, not `Dialog`,** because section 16 wants it full screen on phones, where `Dialog` is a bottom sheet.
  They share `useModal` for focus, Esc and the scroll lock.

**Differences from the prototype.**
- **The label step is `LabelAddPanel`, the real form,** not four value tiles. The form is what flags values to check. It's
  longer, and the dialog body scrolls.
- **No barcode scan in the intro.** `BarcodeDialog` is a flow of its own, and a known barcode can't come up on an empty list.
  The step says barcodes work from Log food.
- **"Popular staples" are search chips.** There's no such list to read, and a list in the code would show numbers that
  aren't the real ones. Rows show kcal per 100 g, because a row's serving is only known once its detail is fetched.

**Known gap.** The log bar's one-tap add from My foods logs straight away, without a flow. Someone who built their list in
the Library first and logs that way won't see the intro. They've already found their way around, so it's left alone.

## 89. A deployment can add sources to the wizard's Sync step (Nov 6)

**Decision.** `Extensions` gains `useWizardSync`, a hook returning a title, intro, rows and a list of sources, or null. Null is
the default and keeps the step to intervals.icu alone, exactly as it was. With sources, the step uses the deployment's title and
intro, drops the Sends and Brings back tiles, and shows intervals.icu as a row beside the others. The summary gets a row per
source. Skip for now and the "Connect intervals.icu" to-do only show while nothing is connected.

**Why.** A deployment's other source shouldn't wait to be found on Connections. It's a hook rather than a `ReactNode`, unlike
`extraConnections` (#73), because the summary and footer need live connection state, and the copy has to fall back when the
source turns out not to be available.

**Rows, not a main card.** The rider picks any of them or all of them, so no source gets the big card and full-width button.

**Rejected.**
- *Reusing `extraConnections` alone*: the title would still say one source, and the summary couldn't show the others.

## 90. The coach reads stored rides whichever source they came from (Nov 6)

**Decision.** `trainingContext` gains a status, `stored`: intervals.icu isn't connected, but the athlete has stored rides or the
deployment says another ride source is connected (`otherRideSource`, a new `createCore` option). The ride tools then work, and
the turn line says they may lack load, fitness and power curves, and not to ask the athlete to connect anything else.
`not_configured` now means there really is nothing to read. Labels and chips the athlete sees no longer say "from intervals.icu".

**Why.** The tools already read our own copy (#49), so rides from another source (#71) were stored and only a check on
intervals.icu kept them from the coach. It told the athlete it couldn't see rides that were on their calendar. The
`otherRideSource` check covers day one: a source just connected has no rides yet, and the first message is "Plan my first week".

**Trade-off.** Tool descriptions still say intervals.icu. Changing them would reset the cached prefix (#65), and the turn line
already says otherwise. The persona's line on where numbers come from stays too.

## 91. Two records are one ride if they overlap (Nov 6)

**Decision.** `isSameRide` now asks whether the two time windows overlap by at least half of the longer one. It replaces
"started within 5 minutes and lasted within 10%" from #71. Everything else in #71 stands: the intervals.icu copy wins, and
sessions and feedback move to it.

**Why.** One rider can't do two rides at once, so overlap is the real signal. Comparing lengths breaks when sources disagree
about stops: 3 hours of riding with a 30-minute stop is 14% apart if one source counts only the riding. A recording started
8 minutes late, or stopped early, also came out as two rides.

**Still two rides:** back-to-back rides, and a short ride inside a much longer recording, which is under half of it.

**Known gap.** Two records from the same second source aren't compared, so two devices recording one ride stay as two.

## 92. Coach asks a rider with no training source to connect intervals.icu (Nov 6)

**Decision.** While intervals.icu isn't connected, Coach shows a card at the top of the right rail: "<brand> works best
with intervals.icu", what the rider gains, the deployment's Connect action (or its hint), "No account? Sign up free"
(intervals.icu, new tab) and "All connections". On phones it's one row under the Today strip that leads to Connections.
A broken connection gets "Reconnect intervals.icu" instead, with no sign-up link.
- **Other sources are asked too.** intervals.icu is the only way a workout reaches Zwift or anywhere else, so a rider whose
  rides arrive some other way still needs it. A new `useOtherTrainingSource` extension says whether another source brings
  rides in (self-host: none), and only changes the words: those riders are told about sending workouts out, never that
  their rides are missing. It returns undefined while loading, and the card waits for it and for the intervals.icu status,
  so it doesn't flash. Revisit when workouts can go to another destination directly.
- **Mid widths:** below 940 px of page width the rail wraps under the chat, where the card would go unseen, so the row sits
  under the page header instead and the card hides. One ask at any width.
- **Both links land on Connections** (`/athlete/goals#connections`), which sits below Goals and Memory on phones.
- **Not dismissible.** It goes away when a source connects. A rider who never connects keeps seeing it.

## 92. A source can be hidden from the coach and stay on show (Nov 6)

**Decision.** `createCore` gains `coachHiddenProviders`, asked once per turn. Rides from those sources stay in `activities` and on
every screen, but the coach can't read them: the ride tools, the `stored` check (#90), ratings on those rides, and the food budget
in the turn's context all leave them out. A rating goes with its ride because it carries the ride's name.

**Why.** A deployment may have to stop sending a source to AI while the athlete keeps seeing their data.

**A failure fails the turn.** Unlike `coachContext`, which costs a line, a failed check here could send what's been withheld.

**The on-screen budget still counts these rides.** Only the coach's copy is filtered, so the athlete's numbers don't change.

## 93. Old chats can be forgotten, and what only Claude saw can be cleared (Nov 6)

**Decision.** Two steps, on `Core.coach`:
- `forgetContexts` flags every chat of an athlete. The next turn restarts with reason `reset`: nothing older and no recap, because a
  recap would send the same text to the summary model. A new chat won't recap a flagged one. It goes ahead of the
  in-flight check in `restartReason`: a promise not to send something outranks a stranded tool result, which `repair` fixes.
- `clearContexts` then edits stored messages. Context messages and tool results lose their content, which also takes any figures
  worked out from the data. Thinking blocks go. Chips whose result held the source's marker lose their rows. Recap blocks go. What
  the athlete typed and the coach's words stay.

**This amends rule 2 and #6.** Stored messages were never edited because replay needs them exact. A message that can't be sent again
has no such need, so clearing must follow forgetting, every time. The athlete's view is unchanged except for those chips.

**The chat says so.** A `reset` break reads "Your coach no longer sees earlier messages", because nothing was summarized.

**A flag on the thread,** not a time on the profile: `getProfile` returns every field, and the thread is already loaded each turn.
`restartContext` clears it.

**Trade-off.** The coach's replies can repeat what's been cleared, with no marker to find them by, so they stay. They're never sent
again. Memory notes the coach wrote aren't touched.

## 94. Food can be logged with no food behind it, and Eating out is the one place it guesses (Nov 6)

**Decision.** A log entry can be `kind: 'calories'`: numbers with no food, recipe or `refId`. It does two jobs:
- **Log calories:** a pinned row and a footer link in Search my foods. kcal is required. Protein, carbs, fat, alcohol and the rest are optional.
- **Eating out:** a third tab in Log food. Photos of the plate or menu, plus what they had, go to the model. They check an itemised
  estimate, then log it. Nothing is written before Log, photos included.

**This amends #33, #34 and rule 1a.** Logging was only ever from the user's own foods, and nothing was guessed. Both still hold for
everything else: Log with AI still refuses to guess a miss. An estimate is a guess and is marked as one wherever it goes, with ≈, a range,
a confidence and an Estimate tag, on the entry and on any total that includes it. kcal round to the nearest 5, and every item keeps a
range of at least ±10%, even if the model calls it exact.

**The model says what's in it; code does the sums (as #78).** `core/food/estimate.ts` works out every number, so the header is always the
sum of the cards. The server recomputes from the items and never takes a total from the client. Confidence comes from the width of the
range, not the model, so it moves when the rider changes something. Ranges add up to a wide total, so the lines are set from real estimates:
up to 0.3 of the kcal is High and up to 0.55 Medium. A clear order came in around 0.5 and a vague one around 0.6.

**How it's stored.**
- `refId` is optional on the entry, not a union: `FoodLogDoc` is an interface over `Omit<FoodLogEntry>`, and a union would lose it. `core.entryRef`
  is the one way to read a ref. `loggableKinds`, `mealItemSchema` and `foodLogInputSchema` didn't change, so a meal can't hold one of these.
- Blank macros are stored as 0, because totals add them up. A row with no macros reads "kcal only". A day's macros are understated by
  whatever was left blank, which we accept.
- `source` is `'manual'` for typed numbers and a new `'estimate'`, and `isEstimate` reads that alone. Details are in `entry.estimate`: range,
  place, items, photos.
- `alcohol` is a new optional nutrient. Reading a label doesn't produce it, so `readableNutrientKeys` leaves it out.
- A meal logged as N items is N entries sharing `estimate.group`, and counts as one estimate.

**Questions cost no second call.** The one estimate call returns its questions, and each answer carries a factor on one item, so answering
is arithmetic. An answer says whether it's about the amount: "about half" changes the portion, and "how much butter" changes `scale`, so two
pieces of bread stay two pieces. A skip or "Not sure" uses the typical amount and draws the item amber. At most two: the prompt says so and core enforces it,
because a schema limit would fail a call that's already been paid for.

**Models.** A new router job, `estimate`, defaulting to Sonnet at medium effort: judging a portion from a photo is more than the small model
was chosen for. On the same order, Haiku worked and cost a tenth as much, but offered no sizes and asked nothing. A real estimate took 1.5 to
8 seconds and 0.1¢ to 1.7¢ US. It stays on `SMALL_MODELS`, so never Opus. It has its own purpose and `AiUse`, `food_estimate`. "Anything different?" is text
only on `small`, under `food_adjust`, with its own schema and prompt: `ADJUST_SYSTEM` refuses "I only had half", the likeliest thing to say.

**Photos** go up with Log, not with the estimate, so an abandoned estimate leaves nothing in the bucket. A photo goes when the last entry
showing it does. A copy and a saved food don't carry them.

**Saved estimates.** Save as a food (on when a place is named) makes one serving of the whole meal with `source: 'estimate'` and a range.
Logging it later is a search with no AI, and the entry stays an Estimate. The same name updates that estimate, and never touches a food of
theirs that isn't one. They're left out of recipe ingredients, where the tag would be lost.

**The coach** sees a count on the Food line, so it doesn't quote the total as exact. No tool changed, so the cached prefix didn't.

**Trade-offs.**
- No web search, so a chain's numbers are what the model remembers, and it's told never to call them official. Revisit with real estimates.
- A saved estimate is one set of numbers. Its items aren't kept, so it has a normal portion, not Change portions.
- A new save has no usage yet, so it finds by search but isn't in Recent until it's logged from search once.

**Rejected.**
- *A built-in "Calories" food*: rule 1a says foods start empty, and every user would need a row seeded.
- *A discriminated union for entries*: see above.
- *A second AI call to apply answers*: slower, dearer, and it could move numbers the rider didn't ask about.
- *Storing photos with the estimate call*: writes before the rider confirms, and leaves orphans.
- *Reusing `adjustFood`*: it targets one food, can't add an item, and doesn't move ranges.
- *The model's own confidence*: it wouldn't change as the rider edits.

## 95. A deployment can delete everything of an athlete's (Nov 6)

**Decision.** `Core.account.deleteData(userId)` removes an athlete's jobs, everything in the collections that hold their data, and their photos. It's a seam for a deployment that closes accounts. The self-hosted app has no route to it and no UI: an install has one user.
- **`USER_COLLECTIONS` and `OTHER_COLLECTIONS`** in `repos/account.ts` list every collection between them, and a test fails if a new one is in neither.
- **This is the second exception to append-only transcripts,** after #93. The account is going, so nothing can be sent again. `foods` and `memories`, which are normally archived or soft-deleted, go too.
- **AI costs stay,** without `threadId` and `turnId`. They hold no words, and a deployment's cost history shouldn't shrink.
- **Photos go by prefix, not from stored keys,** because a reading uploads before anything points at it. One object at a time, since S3-compatible providers differ on bulk deletes. `removeAll` refuses an id that isn't a plain folder name, because the bucket may be shared.
- **It's safe to repeat, and should be.** `jobs.remove` doesn't stop a job in progress, and a running sync or coach turn can still write. Sign-in rows are the caller's.
- `messages` and `proposals` gain a `userId` index, since they only had `threadId`.

**Rejected.**
- *A delete hook in `createCore` options:* nothing in the core needs to call out, so a method the deployment calls is simpler.
- *Deleting through `threads`:* a turn still running can write to a thread that's gone.

## 96. Weight goals set a pace, not a date (Nov 7)

**Context.** A weight goal was a target and an optional "reach it by" date, and the budget spread what was left over the
weeks left (#36). The deficit was capped at 1 kg a week, but the date was still stored, shown on the goal and sent to the
coach as "reach by …". So "10 lb in 10 days" looked like a plan the app had accepted, and the cap was easy to miss.

**Decision.** A weight goal is a target weight and a **pace from a fixed list**, as calorie-counting apps do it:

| | per week | per month |
|---|---|---|
| lb | 0.5 · 1 · 1.5 · 2 | 2 · 4 · 6 · 8 |
| kg | 0.25 · 0.5 · 0.75 · 1 | 1 · 2 · 3 · 4 |

- **`goal.pace` is stored as picked** (`{ amount, unit, per }`), so 1 lb a week never shows as 0.45 kg. The target
  weight stays in kg, as everywhere else. `weightPaceSchema` rejects anything off the list, from the editor and the coach.
- **A month is 52/12 weeks.** The fastest options, 2 lb a week (0.91 kg) and 4 kg a month (0.92 kg), stay under the
  1 kg a week cap, which remains as a backstop. **Gaining** offers only the first two in each row (at most 0.5 kg a
  week), and the 0.5 kg cap still applies.
- **No date.** `goalTakesDate` is now true for events only. In its place is an estimate from the live trend weight,
  "at this pace, about Mar 14" (`core.weightEta`), on the goal and on the budget card. It moves with the trend, so it
  stays out of the coach's cached Goals block, which gets `pace 1 lb/week` instead.
- **The coach** offers a pace from the list in the athlete's units. When asked for something faster, it says once
  that 0.5–1 lb a week is what most people keep up and 2 lb is the most, then proposes a pace.
- **Older goals aren't migrated.** Their date stays stored and is ignored, as in #86. Until one is edited, it uses
  `defaultKgPerWeek` (0.5 kg a week unless changed), and the budget card says to pick a pace. That setting is no longer
  shown on the card. The primary weight goal drives the budget, else the first, since dates no longer sort them.

**Rejected.**
- *Keeping the date and warning on it:* the same reason as #86. It keeps the deadline that sets people up to fail.
- *A free kg/week number:* the list is what makes the paces safe and easy to understand.
- *An app-wide kg/lb setting:* the right thing eventually. For now the pace carries its own unit.

## 97. Missed and skipped sessions take a reason, and the coach reads it (Nov 7)

**Context.** A missed session told the coach only that it didn't happen. Being sick, too busy or without power at home
all look the same, and they call for different plans.

**Decision.** A missed or skipped session's panel has **What happened?**: a short note in the athlete's own words, with
no RPE. It's stored only, and no Claude call is made when it's saved. The coach reads it the way it reads ratings (#30).
- **Stored as a `session_feedback` doc with no `rpe`**, keyed by the session's `eventId`. `rpe` is now optional, and
  `core.isRating` tells a rating from a reason. `PUT /feedback` takes a note alone for a missed or skipped session,
  refuses an RPE there, and takes an empty note to clear it (`{ cleared: true }`). A done session and a ride still need an RPE.
- **The coach sees `why: "…"`** on missed and skipped sessions in the per-turn calendar block and in `get_calendar`.
  A new or edited reason changes the calendar text, so open chats get it on their next turn. `get_ride_feedback` and
  the activity tools skip reasons, because they aren't ratings.
- **The prompt says what the field is and nothing more.** One sentence: the reason tells you what happened, so weigh it
  as a coach would when you advise, plan or adjust. It has no rules for each kind of reason (illness, busy, equipment),
  because the coach should use its own judgment. The existing rules still apply: changes are proposals.
- **A reason only shows while the session is missed or skipped.** Setting the session back by hand (undo Skip, Mark
  done) or deleting it removes the reason (`deleteReasonForEvent`, which never touches a rating). Moving the session
  moves the reason's date with it. A late upload that marks it done goes through the sync, so the reason stays, hidden.
  The first rating saved replaces it, and the rating form opens empty.

**Rejected.** *A field on `calendar_events`*: the same reason as #30, since it would sit on the intervals.icu push
path. *A separate collection*: it would repeat the keying, the calendar response's join and account deletion that
`session_feedback` already has. *An automatic coach reply on save*: reviews come only when asked for (#30). *Rules for
each kind of reason in the persona*: the coach should judge like a coach, not follow a script.

## 98. Real-world events are races with event details, and the coach plans in blocks of two weeks (Nov 7)

**Context.** Riders enter fondos, crits and road races, often months ahead. A race session was a Zwift race in
practice, an outdoor race was labelled "Garmin race", and an event in September next year was invisible to a coach
whose calendar block reaches 14 days. Nothing stopped the coach from writing a months-long plan either, which is the
thing riders hate about other platforms: it doesn't adapt to jobs, kids and life, and re-making a 6-month plan costs
about $0.60–1.00 of Opus output each time.

**Decision.** This is phase 1 of the events plan. Courses (GPX), event goals and the coach's view of far-off events
come next.
- **An event is a `race` session ridden outdoors (`platform: 'garmin'`) with `eventInfo`:** type (14 kinds, gran fondo
  to triathlon bike leg), distance, climbing, location and link. Est. time stays `durationMin`; notes stay `coachNote`.
  It keeps everything a race already has: A/B/C priority, the push to intervals.icu (`RACE_A/B/C`, outdoor `Ride`), the
  hard-day handling and the week's hours. `core.isEventSession` also counts an outdoor race with no details yet, such
  as one made in intervals.icu, so its panel can offer **Add event details**.
- **Only races carry event details.** The input schema refuses them elsewhere. `normalise` drops them from a patch on
  anything else, and a race turned into something else has them unset. `eventInfo` is clearable, and a patch replaces
  the whole object.
- **intervals.icu gets what it is** at the head of the event's notes: "Gran fondo · 142 km · 2,350 m · place · link".
  intervals.icu's own distance field isn't sent; it's unverified. Imports are unchanged.
- **An event's ride is told by distance.** An outdoor ride is "Morning Ride", so a race session with a distance treats a
  ride within ±25% of it as looking like the race, in the scorer and in #68's hold-out. `settleRides` passes ride
  distances. Zwift races still go by name.
- **The coach plans in blocks of two weeks.** `core.planHorizonEnd(today)` is the first Sunday at least 12 days out, so
  a block of whole weeks fits from any day: this week and next from a Monday (13 days), the next two weeks from a
  Saturday (15).
  - Every turn's context says the date.
  - `propose_plan` and `propose_calendar_changes` (add, move, re-date) refuse a workout or ride past it. The refusal
    tells the coach to propose only up to then, and to tell the athlete that it plans in blocks of two weeks so the plan
    can adapt, that the event stays in view, and that it will plan the next block when it's due.
  - Races, events and Zwift events the athlete picked (`zwiftEventId`) are exempt, and so is anything added by hand.
  - The persona says the same, and that after missed sessions the coach moves what matters most within the block and
    drops what doesn't. The calendar shows "Your coach plans two weeks at a time, so sessions show up here closer to
    the day." as a full-width line before the first week past the horizon.
- **The UI follows `design/events-2026-11-07`.**
  - **Add:** "+ Add ▾" gains **Event** ("A fondo, race or ride you've entered"). The form is type, name, date, start,
    distance, elevation, est. time ("~5 h 30", "5:30", "330 min" all read), location, link, A/B/C with its meaning, and
    notes. Saving ends on a confirmation with **Ask your coach how to get ready →**. **View event** jumps to the event's
    week, because it can be months away from the weeks loaded.
  - **The event's panel:** type, priority and Outdoor tags, three stat tiles, place and link, then **Ask coach about
    this event** (a new chat with the prompt filled in and the event id), Edit and Delete. Mark done appears from the
    event's day.
  - **Chips:** a flag, and "142 km · 2,350 m · 7:00".
  - **Phones:** the day view's Session and Time off buttons become one **Add** (Session · Event · Time off), because a
    fourth floating button doesn't fit at 390 px.

**Rejected.**
- *A new session kind*: an event is a race in every way that matters (matching, hours, hard days, intervals.icu
  categories). A new kind would need every reader taught about it.
- *A stored season plan with dated phases*, and *opt-in outlines with up to four weeks of sessions*: neither adapts the
  way two-week blocks do, and re-planning costs real money.
- *Capping sessions the athlete adds by hand*: their calendar is theirs.
- *Telling the coach the cap only in the prompt*: models drift, so the tools enforce it.

**First deploy:** `calendarEventFields` feeds `propose_plan` and `propose_calendar_changes`, and their descriptions
changed. `TOOLS_HASH` therefore moves, and every open chat restarts once with a recap. The persona edit reaches open chats
through that restart.

## 99. An event's course: the browser reads the GPX, code measures it, and the coach will judge it (Nov 7)

**Context.** A fondo is decided by its climbs, and how long each one takes this rider decides which power matters. A
GPX has all of that, but as thousands of points. That's too many tokens to send Claude on every read, and models are
unreliable at arithmetic over long number lists. Phase 2 of the events plan (#98).

**Decision.**
- **The browser reads the file.** `core.parseGpx` uses regexes like `zwo.ts`, with no XML library. It reads track
  points, or route points when there's no track, with their heights and the file's name, and handles namespaced tags.
  It names what's wrong with a bad file: "This isn't a GPX file.", "No route in this file.", "That file is over 25 MB."
  `core.resampleTrack` then puts a point every 50 m (wider past 600 km, so at most 12,000 points), as
  `[km, m | null, lat, lon]`.
  - Only that track is sent, a few hundred KB at most. The raw file never leaves the device, so self-hosting needs no
    S3.
  - Heights count only when at least half the points have one.
- **The API analyses it itself** (`core.analyzeCourse`) and never takes the browser's analysis. The analysis covers:
  - distance, climbing and descent (a 200 m moving average, then 2 m hysteresis);
  - lowest and highest points, terrain (the Zwift events' m/km bands), and the climbing in the last 20 km;
  - about 300 profile points for the chart;
  - the climbs.
  A climb runs from a low point while it gains height. A dip under 30 m (or a tenth of the climb, if less) doesn't end
  it, but a bigger drop or 1 km without new height does. A flat run-up is trimmed. It counts at 500 m or longer, 3%
  average and 40 m gained. Each climb records length, gain, average and steepest 200 m; the longest is marked.
  **These thresholds are starting guesses.** They're tuned on made-up courses so far: a 142 km course with climbs of
  4.1 km at 5.2%, 11 km at 6.4% and 1.8 km at 7.9% came back as 4.3/5.0%, 11.1/6.3% and 2.1/6.8%, with total climbing
  within 1.5%.
- **Stored per event** in `courses` (unique by user and event): the track, the analysis and `analysisVersion`. Reading
  a course whose version is older analyses it again, so tuning the thresholds needs no migration.
  - The session gets a server-set `courseId`, which isn't in the patch or tool schemas.
  - `GET /calendar/:id/course` returns `null` when there's none. A course just removed isn't an error.
  - `PUT` (3 MB body limit) and `DELETE` go through `CalendarService`. A course is never pushed: intervals.icu doesn't
    hold courses.
  - It goes with its event, whether deleted here or by the sync's `remove-local`, and with the account (#95).
- **Times "for you"** (`core.climbTimeRange`) come from a plain power model: rider plus a 9 kg bike, CdA 0.32,
  Crr 0.005, 97% drivetrain. Each climb gets a range from FTP down to 90% of it: "≈ 33–36 min for you". With no FTP the
  times are left out. The Add panel's time estimate uses the Zwift events' model at 75% of FTP for every event type,
  because the course usually arrives before the type does.
- **The UI follows `design/events-2026-11-07`.**
  - **Add event:** a course drop zone first. Then the file, a mini profile and "142 km · 1,418 m · 3 climbs".
  - **Autofill:** name, distance, elevation and est. time are filled in where empty, or where an earlier file filled
    them. Each carries a "from GPX" mark, or "from GPX + FTP" for the time, until it's edited.
  - **Saving** adds the course after the event. If that fails, the event stays and the confirmation says to add the
    course from the event.
  - **Edit:** replaces or removes the course on Save.
  - **The event's panel:** a profile of grey bars, about one per km, with the climbs darker and the longest darkest,
    numbered markers, highest and lowest points, and a km axis. Then the climb list, "Last 20 km", and either the
    estimate note or "Set your FTP". Without a course, a drop zone adds one straight away.
- **The coach doesn't see courses yet.** `get_event_course` and the events block are phase 4.

**Rejected.**
- *Sending Claude the track*: tokens, and arithmetic the model gets wrong.
- *Keeping the raw GPX*: it would need S3 for self-hosters, for nothing the resampled track can't redo.
- *Parsing on the server*: a 25 MB upload against a 3 MB body for the same result.
- *A chart library*: the workout charts are bars already, and these read at 60 px and in a phone sheet.
- *Coloured or graded climb shading*: red means race, and gradients get noisy at phone width.

**Not verified:** accuracy on a real GPX. The check is a ride the athlete has done, against RideWithGPS's or Garmin's
distance and climbing (within about 5%).

## 100. An event goal says how much the coach weighs an event (Nov 7)

**Context.** An event on the calendar says when, but not whether the athlete is training for it. A fondo next September
might be the season's target, or a day out with friends. Phase 3 of the events plan (#98, #99).

**Decision.**
- **Two questions on Add event** (`design/events-2026-11-07`), separate from A/B/C priority, which stays how rested to be
  on the day:
  - "Should your coach take this event into account when coaching and creating plans and workouts?" Neither answer
    is preselected. No means no goal: "It stays on your calendar, and your coach plans around the day itself."
  - "How much weight should the coach give this event?" **Main goal** ("Plans build toward it", and it says which main
    goal it replaces), **Important** ("Real room for it beside your main goal, more as it gets closer") or **Keep in
    mind** ("Worked in where it fits, without changing your focus").
  - An optional aim (Finish · Target time · Compete) and a note.
- **Answering yes makes a goal for the event.** New goal fields:
  - `eventId`;
  - `weight` (`important` | `in_mind`). Main goal is the existing `primary`, and keeps `important` to fall back to;
  - `aim`.
  The note is the goal's `detail`. A weight not picked counts as Keep in mind.
- **The goal is the event's** (`services/goals.ts`, used by the routes and by applied coach proposals):
  - it must be a race session of the athlete's, with one goal per event (409);
  - it's always `event: true`, dated by the event whatever a patch says;
  - a goal whose event went some other way carries on, unlinked, instead of failing.
- **It follows the event:** moved here (`CalendarService.patch`) or in intervals.icu (the sync's `applyRemote`). On
  delete:
  - the panel asks "Also remove its goal" (ticked), and `DELETE /calendar/:id?goal=remove` removes it;
  - otherwise the goal stays, unlinked, with its last date, as it does when intervals.icu deletes the event.
- **Where it shows:**
  - The event panel's coaching card: "Your coach is training you for this" with weight and aim chips, the note, Edit
    and a link to the goal. Without a goal it reads "Your coach isn't training you for this. It plans around the day
    itself." and offers **Take it into account**, which asks the same questions.
  - Athlete › Goals & coach: an event goal card with its date and weeks to go, "On your calendar →", the chips and the
    note. A linked goal's editor shows "For: … · date" ("The date follows the event") and the same questions. An
    unlinked event goal can be linked to an upcoming event that has no goal.
  - The rail's Main goal card and the Athlete header tile show the event's date.
  - Saving a goal waits for the profile to refetch, so the card never shows the old weight for a moment.
- **The coach** reads `for calendar event e7 · weight: important · aim: compete` on the goal line in the athlete block.
  That's a text change only, so open chats get the usual "athlete context changed" note and nothing restarts. How it
  weighs these is phase 4's persona line, together with the events block.

**Rejected.**
- *Folding the weight into A/B/C*: an athlete can want an A day they aren't training for, or the reverse.
- *A weight on every goal*: only events compete with the main goal for the same weeks.
- *The goal's title following the event's*: the athlete may have named the goal themselves.
- *Deleting the goal with its event by default when intervals.icu deletes it*: nobody was asked.

## 101. The coach keeps far-off events in view, reads courses, and keeps an outlook (Nov 7)

**Context.** Phase 4 of the events plan (#98–#100). The coach's calendar block reaches 14 days, so a fondo next
September was invisible when it planned this week. It couldn't read a course. And nothing carried its view of how to
balance the main goal against an event from one chat to the next.

**Decision.**
- **What it sees:**
  - **An events block**, sent when it changes, like time off (#87). It lists every event from today to two years out
    (`core.coachEvents`: real-world events, any race with a goal, and A races; a Zwift C race without a goal stays in
    the 14-day calendar). Each line has absolute dates, type, priority, distance and climbing, estimated time, the
    course in one line (`core.courseLine`), and the goal's weight and aim or "no goal: on the calendar only".
  - **A line every turn:** "Events ahead: … in 44 weeks". It moves with the day, so it isn't compared.
- **`get_event_course(event_id, per_km)`:** the course as code measured it (`describeCourse`). That's every climb with
  this athlete's time for it, at FTP to 90% (#99's power model, labelled an estimate), the last 20 km, and on request
  the height every km. The chip is "Read the course · … · 142 km · 1,418 m", with the climbs as rows. The track itself
  never goes to Claude.
- **The outlook** (`coach_outlook`, one per athlete):
  - **`update_outlook(text)`** writes it directly, at most 800 characters. It's undoable, like `remember`. The chip,
    "Updated the outlook: …", has Show all and Undo. Undo is a compare-and-set revert (`POST /outlook/revert`): if the
    athlete has edited it since, it says "Couldn't undo: the outlook has changed since." and links to it.
  - **The athlete edits or clears it** on Athlete › Goals & coach, above short-term memory, without the coach and with
    no AI cost (#85). Their edits stand.
  - **In the context** it's sent when it changes, with who last wrote it and when. A cleared one says so.
  - **It's never a schedule and never on the calendar.**
- **`propose_goal`** takes `eventId`, `weight` and `aim`. Applied proposals already go through the goals service, which
  dates the goal by the event (#100). The goal card says "For an event on your calendar · Important · Aim: Compete".
- **The persona, as meanings, not rules:**
  - Events are weighed by how near they are and by their goal's weight. A main goal leads; Important gets real room,
    more as it nears; Keep in mind is worked in where it fits. An event with no goal is a day to plan around, not to
    train for.
  - The coach judges an event's demands from its type and course against the athlete's strengths.
  - When asked how to get ready, it reads the course and power curve and plans only the current block.
  - After an event is added without a goal, it asks once, then uses `propose_goal`.
  - It keeps the outlook current and says when it changes it.
  - The two-week blocks from #98 stand.
- **The app:**
  - **Ask coach to adjust my plan** under "What happened?" on a missed or skipped session opens a new chat with "I
    missed … (event id). Can you adjust my plan around it?".
  - **The rail's Coming up** card shows the next three events with how the coach treats each, from a new
    `upcomingEvents` on the dashboard.
- **Cost:** two new tools, `TOOLS_HASH` moves once (open chats restart with a recap), and the cached prefix grows by
  about 1.1K tokens, to about 21.3K (`coach:smoke`).
- **Checked live** (Nov 7: five turns, $0.60 in all, Opus $0.45 of it). The setup was a throwaway account with a made-up
  142 km fondo marked Important and a crit with no goal.
  - "How do I get ready" read the course, named the 11 km climb at km 96 as decisive, and planned exactly to the
    horizon. It treated the crit as a C race and that week's hard day, and wrote the outlook.
  - "I signed up for a gravel race" proposed it as an event, asked once how much it should count, then proposed a
    linked Keep in mind goal. The goal took the event's date.
  - Undo on the outlook chip put the earlier text back.
  - **A first run of "plan every week to September"** answered with a month-by-month plan in prose and said "the tool
    refuses anything past Sun Nov 22". The persona and the cap's refusal now say not to write the long plan out
    another way, to keep the longer view to a sentence (it belongs in the outlook), and to talk about two-week blocks
    as how the coach coaches, not as an app limit. The rerun explained the blocks and refused a week-by-week plan, with
    no tool talk. It still closed with a short arc, phases by season with no dates or sessions.

**Rejected.**
- *The events in the athlete block*: every added or moved event would resend the whole block into every open chat.
- *An events block limited to six months*: a fondo a year out is exactly what this is for.
- *The outlook through a confirm card*: it schedules nothing, and confirming every rewrite turns it back into a plan
  the athlete signs off.
- *Storing the outlook in memory*: memory is what the athlete said (#79). This is the coach's own view.
- *A coach-written course analysis stored on the event*: the numbers are code's, the judgement is redone each time
  with current fitness, and the outlook carries the conclusion.

## 102. A Zwift race can follow a Zwift route, with laps, and shows its profile (Nov 7)

**Context.** Riders read a Zwift race by its route: where the KOMs and sprints fall, and how often they come round in a
ladder race of several laps. The app knew a Zwift event's route and laps (#29) but kept neither on the calendar
session, and #99's course card only appeared on real-world events.

**Decision.**
- **The data is the `zwift-data` npm package** (MIT), a dependency of the API. It isn't copied into this repo.
  - Its route `id` is Zwift's own. It equals GameDictionary's `signature` and a pen's `routeId`: all 353 routes
    matched on Nov 7.
  - It gives each route's named segments (KOMs, sprints, timed segments) as km on one lap, from Zwift's public API
    and manual work.
  - For 338 routes it has one lap's heights. **Those heights come from Strava segment streams.** So the feature is
    limited to accounts with the Zwift feature (#54). On hosted that's the per-account `zwift` flag, and it isn't
    part of a plan. Rule 1 keeps Strava's data away from the coach, so **the coach never reads a route's course**:
    `get_event_course` reads stored GPX courses only.
  - `providers/zwift/route-data.ts` is the only file that reads the package. It imports one route's stream file by
    path when needed, and keeps the last 50. The package's own `streams` entry points would load all 31 MB.
- **On the session:** `zwiftRouteId` and `zwiftLaps` (1–50) are optional, and an edit can clear them.
  - They're **left out of the coach's tool schemas** (`coachEventInputSchema`, `coachEventPatchSchema`). The coach
    can't set them, and the cached prefix stayed byte-identical (`coach:smoke`, Nov 7).
  - Changing or clearing them alone isn't pushed to intervals.icu: they join `LOCAL_ONLY`.
  - "Add to calendar" on Zwift Events copies the pen's route, and its laps unless the pen is timed.
- **The course is derived when read, never stored.** `GET /calendar/:id/course` builds it for a race with a route,
  for an account with the feature (`ZwiftRouteCourses`). It's cached in memory by route and laps.
  - **The track:** the lead-in flat at the lap's starting height (there's no lead-in stream), then the lap once per
    lap, every 50 m (`core.zwiftRouteTrack`).
  - **The analysis** (`core.analyzeZwiftCourse`):
    - It runs #99's analysis, then puts **the named climbs in place of the found climbs they overlap**. A named climb
      is measured from the same smoothed heights and counts whatever its size. Found climbs elsewhere stay, unnamed.
    - **Climbing is counted on the raw heights.** #99's 200 m smoothing and 2 m hysteresis are for GPS noise, and on
      Zwift's clean streams they flattened the rollers. Over 290 routes they came out a median 24% under the
      published climbing, against 3% (90th percentile 9%) raw. Smoothing still drives climb finding and the chart.
  - **No laps** (a timed race) shows one lap and says so.
  - **No stream** gives the route's own totals with no profile.
  - A race with a route takes no GPX: a PUT returns 400.
- **The race form** (Zwift race only, with the feature): an optional **Zwift route** search over GameDictionary's
  routes and zwift-data's together (`GET /zwift/routes`, which returns 404 without the feature). Then **Laps
  (optional)**, with a total of lead-in plus laps.
- **The race panel** (planned and completed) gets a **route card**:
  - name, world, laps, distance, climbing and lead-in;
  - #99's profile, its markers labelled by climb, so the same KOM is the same number every lap (hidden past 12
    markers), with sprints marked under the bars;
  - **each climb and sprint listed once**, "×6 · first at km 1.2", with category, length, grade and "for you" times;
  - links to ZwiftInsider and What's on Zwift.
  - The colours stay #99's greys: red means race.

**Rejected.**
- *Storing the route's course in `courses`*: it's a function of route, laps and the package version. Storing it
  would need regenerating on every laps edit and on each package update.
- *ZwiftHub's data*: it's built into its app bundle, with no licence, its own route numbers and no segment positions.
- *Profiles from the athlete's own Zwift rides* (intervals.icu streams): clean, but only routes they've ridden.
  This is still the fallback if the Strava provenance ever matters.
- *Letting the coach read route courses*: the heights are Strava's (rule 1). Revisit only with a source that isn't
  Strava, such as the athlete's own rides.
- *A limit on laps per route* (zwift-data's `lap` flag): Zwift events set laps on routes it doesn't mark.


## 103. The coach chooses sessions from purpose, not habit (Nov 9)

**Context.** The coach scheduled VO2 work almost every time, whatever the athlete's goals. Nothing hard-coded VO2, but
everything pointed that way:
- The starter library was three VO2 workouts, a race-prep session above threshold and a ramp test, and the library is
  listed in every system prompt.
- Workouts imported from intervals.icu were filed as "VO2 max" if any step reached 106%, and the standard warm-up's
  1 min @ 110% is enough to trigger that.
- The persona gave no method for choosing a kind of session, and VO2 was the only intensity it named.
- Its fixed warm-up and cool-down (17 + 10 min) left no room for a 30-minute workout.
- Nothing checked that a plan's `workoutId` existed, or that the item's duration matched the workout.
- The coach had no recovery data beyond CTL/ATL unless the deployment added it (#72).

**Decision.**
- **A method in the persona** (`## Choosing sessions`). Before planning or saying what to ride, the coach works
  through these, using tools for what it doesn't know:
  - what the goals and event goals demand;
  - the limiter, from the power bests and curve against that demand (a rough 5-min-to-FTP guide, given as an estimate);
  - the phase: base, build, specific or taper by the weeks to the event that counts most, or focused blocks of
    3–6 weeks with no event;
  - the last 2–4 weeks: progress a stimulus, and don't make every hard day the same kind without saying why;
  - freshness and readiness;
  - the training approach;
  - the time available.

  Then it uses a library workout if one fits. Otherwise it builds one with `create_workout`, basing a version on the
  closest workout (`basedOnId`) so the library doesn't fill with near-duplicates. Each key session gets a short clause
  on what it trains. Sessions under about 45 min get a short warm-up (5-min ramp) and cool-down (3–5 min). The
  persona stays free of a favourite: no kind of session is the default. The ride-ratings rule now says "interval
  work".
- **A training approach on the profile** (`trainingApproach`: `auto` | `polarized` | `pyramidal` | `sweet_spot`,
  optional). It sits beside #86's training preference, which still sets how much hard work fits; the approach sets
  what kind. Unset and `auto` both leave the mix to the coach, which picks from hours and goals and notes it in the
  outlook. The athlete sets it on the Athlete page's Training card ("What kind of training?"), and the coach can
  propose it (`propose_profile_update`; `auto` hands the choice back). It isn't asked in onboarding. The athlete block
  shows it only when it's set and not `auto`.
- **A balanced starter library** (`core.STARTER_WORKOUTS`, easy to hard): Endurance 60, Recovery Spin 30, Tempo 3x12,
  Sweet Spot 3x12 and 2x20, Threshold 3x10, Over-Unders 3x9, VO2 5x4, VO2 30/15s, Surge and Settle, Sprints 8x15s,
  Openers 45 and the FTP Ramp Test. VO2 6x3 is gone. It seeds new accounts only (`seedStarterLibrary` is unchanged).
  A **`Tempo`** category joins `workoutCategories`. The Library page's filter chips are now the categories the library
  actually has.
- **Imported workouts are filed by their main set** (`core.classifyWorkout`). Only repeat steps and steady blocks of
  3 min or more count, so a warm-up spike doesn't. The band with the most time wins: ≥ 106% is VO2 max (or Sprint
  when it's mostly reps of 30 s or less at 150% or more), 95–105% is Threshold, 88–94% is Sweet spot, 76–87% is
  Tempo, and otherwise Endurance. Recovery and openers come from `inferSessionType`. That now needs **two** kicks of
  106% or more for openers, so an easy ride with the standard warm-up stays endurance.
- **Plans point at real workouts, at their length.** `propose_plan`, and `propose_calendar_changes` for additions and
  updates that set a `workoutId`, check each id against the library through a new `workoutLengths` port. An unknown id
  is a tool error that tells the coach to `create_workout` first, so it can fix it within the turn. A workout item's
  `durationMin` is set from the workout, and its `durationLabel` dropped.
- **The calendar context goes back two weeks** (`coachCalendarWindow`, previously one), so the coach sees the whole
  block just ridden when it plans the next one.
- **intervals.icu wellness as readiness.** `WellnessDay` keeps HRV, resting HR, sleep time and score, a device's
  readiness score, and the athlete's own 1–4 entries (sleep quality, soreness, fatigue, stress, mood, motivation),
  using intervals.icu's words for them. `core.readinessFromWellness` turns today's or yesterday's values into a line
  against 7- and 28-day baselines (at least 4 and 14 days, today left out), the same rules as hosted Garmin
  readiness. It goes in the turn context only when it changes (`seen.readiness`). A failure drops the line, not the
  turn. `createCore`'s `skipIntervalsReadiness` lets a deployment that sends its own readiness leave this line out.
  Older stored days pick up the new fields on the next sync that covers them.

**Rejected.**
- *A fixed intensity split in code* (for example a cap on VO2 sessions a week): the coach's judgment is the point,
  and the method plus the data makes it a good one. A rule would just be another bias.
- *Marking on-the-fly workouts as one-offs, hidden from the library:* more schema and UI than the problem needs. The
  coach reuses or bases a version on an existing workout instead. Revisit if libraries bloat the prompt.
- *Backfilling the new starter workouts into existing libraries:* existing athletes already have libraries they built.
- *Asking the approach in onboarding:* one more question at sign-up, and unset already means the coach decides.

**Known limits.**
- `classifyWorkout` can't tell race prep or a test from structure, so it files them by intensity.
- Tempo workouts are endurance-type days on the calendar (`inferSessionType` draws its line at 88%).
- The direction of intervals.icu's 1–4 entries follows its own form (for mood and motivation, 1 is the best). Check it
  against a live response before relying on those words.

## 104. Estimates are home-cooked or restaurant, and a restaurant estimate can look up published nutrition (Nov 10)

**Decision.** Eating out (#94) becomes **Estimate**, with a `Home-cooked | Restaurant` picker. The stored mode is still `out`.
- **Home-cooked** is a meal with no menu and no place, like dinner at a friend's. The rider gives photos of the plate, **What was it?**
  and **What's in it?**. Its prompt builds each item from the ingredients and method they describe, judges a home portion, and adds
  butter or oil only as far as the dish suggests. There's no search, and Save is off by default.
- **Restaurant** is #94's estimate, plus a **Look up published nutrition** toggle. It's on once a place is named, and the rider can
  turn it off. With it on, the call carries Anthropic's server-side web search (`web_search_20260209`, or the basic
  `web_search_20250305` on Haiku): at most 3 searches, with an approximate location of Canada and the athlete's timezone. It also
  carries web fetch (`web_fetch_20260209`, not on Haiku), to open up to 2 of the pages the search found, at most 12K tokens each,
  because snippets rarely hold the numbers. Fetch can only open a URL already in the conversation. The prompt tells the model to
  search because the rider asked, and to look only for this place's own figures: from its site, PDF or menu, or a nutrition site
  that lists them for that item. A page about the dish in general doesn't count. When it finds the numbers, it uses them and names
  whose they are. Otherwise it goes by what it knows, as before.
- **The kind is on the request, the result and the entry** (`estimate.kind`; absent means restaurant). The prompt is fixed per kind
  and search setting, so each of the three variants caches on its own. "Anything different?" is told which kind it's changing.

**A source can't be made up.** An item's `source` is kept only if it's one of the URLs the search actually returned, read from the
`web_search_tool_result` blocks by `FoodAi` and checked again by `core.estimateFromReading`. A source must be http(s), because the review
shows it as a link ("Published · host"). A search that leaves no item with a source reads `none`, whatever the model said, and its
`web` line in What I found is dropped.

**What the rider sees.** `EstimateResult.search` is `off`, `found`, `none` or `failed`. The review and the questions say which: found
the place's published nutrition, couldn't find it, or couldn't search.

**Cost.** Searches are priced into `costUsd` at $10 per 1,000 (`WEB_SEARCH_USD`), and `ai_calls.webSearches` counts them. Fetches
cost only the tokens they add. In the live check, a searching estimate cost 3–5¢ US and a home-cooked one about 1¢. So the spend
guard, the hosted pools and Costs need no change. The purpose stays `food_estimate`. A search turn can pause: it's sent back to finish
at most twice, and its requests count as one call. The answer is the last text block, because searching puts text between the tool
blocks. The rider waits up to 90 s instead of 60.

**Fallback.** If the request with search gets a 400 (web search can be off for the key's organization), it's made once more without
search and comes back as `failed`. The estimate never depends on search.

**This amends #94's trade-off** "No web search". Search is the rider's choice, per estimate, and only for a named place.

**Rejected.**
- *The model decides when to search*: every restaurant estimate would pay for the tool's tokens, and the rider knows best whether a
  place publishes nutrition.
- *Search on home-cooked meals*: there's nothing to look up, and the place is a person's home.
- *A separate search call, then the estimate*: twice the calls and a second wait. Kept as the fallback design if search and
  structured outputs ever stop working together in one call.
- *Keeping the model's source as given*: it could cite a page it never saw.

**Known limits.**
- In the first live checks (`estimate:smoke`, a Big Mac meal at McDonald's), the model searched and the results held a page with the
  chain's figures. It still went by what it knew and cited nothing, so the result read `none`. Asking it to open pages and telling
  it the rider wants a lookup didn't change that. If it keeps happening with real meals, the plan's fallback is the fix: one call that
  only finds the published figures, then the estimate with them passed in.


## 105. Pushed workouts keep their own name (Nov 10)

**Decision.** `createCore`'s `eventNameSuffix` (#63) is removed. A workout pushed to intervals.icu is named after its title,
nothing added, and the sync reads remote names as they are.
- **Why:** no deployment uses it any more, and Strava strips a tag like this from Zwift's ride titles anyway, so it never
  reached where it was meant to.
- **Gone with it:** `withNameSuffix` and `withoutNameSuffix` (`providers/intervals-icu/map.ts`), and `CalendarService`'s
  `eventNameSuffix` argument.
- **Events pushed with a tag** keep it in intervals.icu until they're pushed again (an edit or a move renames them). An
  edit made to one in intervals.icu brings the tagged name back as the local title; renaming it fixes that.
