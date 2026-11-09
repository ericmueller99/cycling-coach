# Cycling Coach

A personal cycling coach powered by Claude. You chat with it, and it:

- plans your training week around your goals, fitness and fatigue,
- builds structured Zwift workouts (.zwo) and keeps them in a library,
- puts sessions and races on a calendar and sends them to Zwift through intervals.icu,
- reads your rides, power curve and fitness from intervals.icu, plus how hard each ride felt,
- logs food and reads nutrition labels from a photo.

It's a single-user app. You run your own copy, with your own API keys, and your data stays in
your own database.

## Hosted version

[bikecoach.ai](https://bikecoach.ai) runs a hosted copy for a small group of invited riders. It isn't
sold as a service; to use BikeCoach, run your own copy (below).

## Run it with Docker

You need [Docker](https://docs.docker.com/get-docker/), an
[Anthropic API key](https://console.anthropic.com/) and an [intervals.icu](https://intervals.icu)
account (free) with your rides in it.

```bash
git clone https://github.com/<you>/cycling-coach.git
cd cycling-coach
cp .env.example .env                              # fill in the variables below
docker compose up -d --build                      # builds the app, starts it with MongoDB
docker compose run --rm app node dist/seed.js --ftp 250 --weight 72 --timezone Europe/London   # once
```

Then open <http://localhost:8787> and sign in.

### Required settings in `.env`

| Variable | Where to get it |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`, `SEED_USER_NAME` | Your login. Sign-up is disabled after the seed, so this is the only account. You can change the name and password later under **Account** (bottom of the sidebar). |
| `CLAUDE_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) → API keys |
| `INTERVALS_ICU_KEY` | intervals.icu → Settings → Developer Settings |

Without `CLAUDE_API_KEY` the app runs, but the coach shows as offline. Without `INTERVALS_ICU_KEY`
there's no training data, and the coach says so.

### Optional settings

| Variable | What it adds |
|---|---|
| `ZWIFT_USERNAME`, `ZWIFT_PASSWORD` | zFTP, zMAP and weight pulled from Zwift every 6 hours, and "Get more events" (about a week of events, with sign-up counts). **Read [Zwift login](#zwift-login-at-your-own-risk) first.** Leave them blank and you can enter zFTP by hand. |
| `USDA_FDC_API_KEY` | A free [USDA FoodData Central](https://fdc.nal.usda.gov/api-key-signup) key for food search. Without it, a shared demo key is used (30 requests an hour). |
| `S3_HOSTNAME`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKETNAME`, `S3_REGION` | An S3-compatible bucket for keeping nutrition-label photos. Without it, photos are read but not kept. |
| `APP_PORT`, `PUBLIC_URL` | The host port (default `8787`) and the address you open the app at (default `http://localhost:8787`). |

### Zwift login (at your own risk)

The Zwift login uses Zwift's **unofficial** API. This project isn't affiliated with or endorsed by
Zwift, using that API may breach Zwift's terms of service, and Zwift could change it or act on your
account at any time. It's off unless you set `ZWIFT_USERNAME` and `ZWIFT_PASSWORD`. If you do, your
account and the risk are yours.

What the app does to keep its footprint small:
- It only reads. It never signs you up, joins events or changes anything on your Zwift account.
- Every Zwift request goes through one queue, one at a time and 2 seconds apart.
- After a rejected login it stops trying on its own; it tries again only when you press Sync now on
  the Zwift row, or after a restart.
- Metrics sync every 6 hours. The logged-in event list runs only when you click "Get more events", at
  most every 6 hours.

Without a login you still get the public Zwift event feed (about the next day, no sign-up counts)
and can type your zFTP, zMAP and Zwift weight on the Athlete page.

### What the seed does

The seed creates your account and a starting profile, adds a small starter workout library and
imports the Canadian Nutrient File used for food search. Options:

| Option | Default |
|---|---|
| `--ftp <watts>` | 200 |
| `--weight <kg>` | 75. Replaced by your intervals.icu weigh-ins on the first sync. |
| `--timezone <IANA name>` | The machine's timezone (UTC in Docker), e.g. `Europe/London` |
| `--sample` | Off. Adds example goals and coach memory so you can see what they look like. |

You can change all of it later on the Athlete and Account pages. Re-running the seed is safe: it
fills gaps and never overwrites anything.

### Updating and data

```bash
git pull
docker compose up -d --build
```

Your data lives in the `mongo-data` Docker volume, so rebuilding and restarting don't touch it.
`docker compose down -v` deletes it.

## Running it on a server

Run the same stack on any machine with Docker. Put it behind an https reverse proxy or tunnel
(Caddy, nginx, Cloudflare Tunnel, Tailscale, …), and set `PUBLIC_URL` to the https address
people will use, so that sign-in cookies and auth callbacks match the browser.

The image also contains a jobs-only process. To keep background syncs out of the web process, run a
second container from the same image with `node dist/worker.js` and set `BACKGROUND_JOBS=false` on
the app. Any number of processes can share the database: each job is leased, so it never runs twice
(docs/DECISIONS.md #56).

## Training data

Rides, power curves and fitness come from intervals.icu. Connect Zwift or Garmin to intervals.icu
directly, because rides it imported from Strava aren't available through its API. Strava itself
isn't used: its API policy rules out AI use, and its MCP server doesn't accept custom apps
(docs/DECISIONS.md #12–13). "Send to Zwift" on a calendar session puts the workout on your
intervals.icu calendar, which forwards it to Zwift when Zwift is linked there.

## Development

You need Node 22+ and Docker.

```bash
corepack enable          # once, so `pnpm` (pinned in package.json) is on PATH
pnpm install
cp .env.example .env     # same settings as above
pnpm db:up               # just the MongoDB container
pnpm db:seed
pnpm dev                 # API on :8787, web on http://localhost:5173
pnpm test && pnpm typecheck && pnpm lint
```

`CLAUDE.md` describes how the code is organized and the rules it follows, and
`docs/DECISIONS.md` records why things are the way they are. `docs/ROADMAP.md` lists what's next.

The Docker app and `pnpm dev` both use port 8787. Stop the app (`docker compose stop app`), or move
it with `APP_PORT`. Both can share one database, because background jobs are leased. Keep
`BACKGROUND_JOBS=false` in your dev `.env` if you don't want `pnpm dev` to sync on its own.

## Troubleshooting

- **Port 8787 already in use**: set `APP_PORT` (and `PUBLIC_URL` to match) for Docker, or run
  `pnpm dev:stop` for the dev servers.
- **Sign-in doesn't stick, or you get bounced back to login**: `PUBLIC_URL` must match the address
  in your browser exactly, including `http` or `https` and the port.
- **`pnpm: command not found`**: run `corepack enable`.
- **`Transaction numbers are only allowed on a replica set member`**: you're on a standalone
  mongod. Use `pnpm db:up`, which starts a replica set, with the `?directConnection=true` URI from
  `.env.example`.
- **The app container won't start**: `docker compose logs app` lists any missing or invalid
  settings.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md): the first pull
request asks you to sign a Contributor License Agreement.

## License

[GNU Affero General Public License v3.0 only](LICENSE). If you run a modified version for other
people over a network, you must offer them its source.
