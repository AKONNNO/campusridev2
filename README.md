# KNUST Bus Tracker

Real-time campus bus tracking for KNUST (Kumasi, Ghana): live bus locations,
next stops, ETAs, a nearest-stop tool, trip planner and arrival alerts for
students, a mobile GPS-sharing driver app, and an admin dashboard — all in one
project.

> **Status: complete.** Student, driver and admin apps are all implemented on a
> single React + Express + PostgreSQL/PostGIS stack. The seed data uses
> **approximate placeholder coordinates** — replace them with real surveyed GPS
> points before production (see [Before production](#before-production)).

## The three apps

| App | URL | Who | What it does |
|-----|-----|-----|--------------|
| **Student** | `/` | anyone, no login | Live Leaflet map of every bus, route polylines, stop markers, next-stop + ETA cards, nearest-stop tool, trip planner, favourites, arrival alerts, announcements, offline cache, dark mode |
| **Driver** | `/driver` | login with phone + PIN | Shows the assigned bus + chosen route, Start/End trip, on-trip status (On route / Break / Breakdown / Full), and shares the phone's GPS to the server every 3–5 s (accuracy-filtered, with wake lock + offline queueing) |
| **Admin** | `/admin` | login with phone + PIN (admin role) | 9 tools: live Overview, Buses, Routes (map-draw + GeoJSON import + drag-to-reorder stops), Stops (click-to-place), Drivers, Announcements, Trips history + GPS replay, Reports, Feedback (review student reports) |

## Features

**Student app**
- Live map (Leaflet + OpenStreetMap): every bus on an active trip moves in real
  time over the Socket.IO feed, coloured by route and rotated to its heading.
- Tap a bus → its next stops, ETAs (per-stop, accounting for dwell) and status;
  tap a stop → live arrivals at that stop.
- **Locate me** — uses the device GPS to rank the nearest stops instantly on
  the client (Haversine) with walking-time estimates. *The student's location
  is never sent to any server (see Privacy below).*
- **Plan** tab — trip planner: pick from/to stops and see which routes serve
  both, estimated ride time, and any live buses with an ETA to pickup.
- **Alerts** tab — set an arrival alert minutes before a bus is due, with an
  optional browser notification.
- Favourite stops (stored locally), announcements banner, dark mode, and an
  offline mode that shows the last-cached stops/routes. Built as an
  **installable PWA** (manifest + service worker) — in production builds an
  "Install the app" prompt appears so students can add it to their home screen.
- **Feedback** tab in the bottom sheet — report a problem (full bus, late
  route…) or suggest an improvement, with optional contact and a related
  stop/bus. No account needed; the transport team reviews these in the admin app.

**Driver app**
- Phone + PIN login (bcrypt-hashed PINs, JWT session).
- Route picker + Start/End trip controls.
- GPS sharing: `watchPosition` throttled to ~3 s, readings with
  accuracy > 50 m are dropped, a screen **wake lock** keeps the phone awake,
  and if the network drops the *latest* fix is queued and re-sent on reconnect.
- Status buttons broadcast to students, and admin announcements appear live.

**Admin app**
- Overview: live fleet map + quick stats.
- Buses: create / edit / delete vehicles and assign a bus to a route.
- Routes: create / edit / delete routes — draw the path on the map, paste a
  GeoJSON LineString, and add / drag-to-reorder the served stops.
- Stops: create / edit / delete stops; click the map to place coordinates.
- Drivers: create accounts (with PIN), assign buses, toggle active, delete.
- Announcements: post (with kind + optional expiry) — broadcasts instantly to
  every connected student/driver via `announcement:new`.
- Trips: recent trip history with a map **replay** of each trip's GPS points.
- Reports: trips per day (last 7 days), busiest stops by GPS hits, average
  completed-trip duration.
- Feedback: review student feedback/report submissions (stop/bus/contact
  context) and remove them once actioned.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite, Tailwind CSS, Leaflet + react-leaflet + OSM tiles, socket.io-client |
| Backend | Node.js + Express (helmet, cors, morgan, express-rate-limit), Socket.IO, zod |
| Database | PostgreSQL + PostGIS (SRID 4326), `pg` pool |
| Auth | JWT + bcrypt (PIN-based, no passwords) |

## Repository layout

```
campusride/
├── docker-compose.yml          # PostGIS container + auto-init schema & seed
├── .env.example                # server env template
├── .github/workflows/ci.yml    # GitHub Actions: build client + boot PostGIS (schema/seed check)
├── server/
│   ├── src/
│   │   ├── index.js / app.js   # boot, middleware, route mounting
│   │   ├── config/             # env.js (validated config) + db.js (pg pool)
│   │   ├── lib/                # AppError, asyncHandler, geo maths
│   │   ├── middleware/         # auth (JWT), validate (zod)
│   │   ├── routes/             # auth, public (student), driver, admin
│   │   ├── services/           # routeModel, routesCache, liveStore
│   │   ├── socket/             # Socket.IO (driver:location → bus:update …)
│   │   └── db/                 # schema.sql + seed.sql
│   └── scripts/                # init-db.js, generate-hashes.js, gps-simulator.js,
│                               #   smoke-test.ps1
└── client/
    ├── vite.config.js          # dev proxy /api + /socket.io → :5000
    ├── public/                 # manifest.webmanifest, sw.js (service worker), PWA icons
    ├── scripts/                # generate-icons.ps1 (regenerate the PWA icon set)
    └── src/
        ├── lib/                # api, socket, token, pwa, useAuth, format
        ├── hooks/              # useDarkMode, useInstallPrompt
        └── pages/
            ├── student/        # MapView, Panels, hooks (live buses, alerts…)
            ├── driver/         # login, dashboard, useGpsSharing
            └── admin/          # login, dashboard, shared map, tabs
```

## Quick start

Prerequisites: **Node 18+**, and either **Docker** (for the PostGIS database)
or your own PostgreSQL with PostGIS enabled.

```bash
# 1) Database — Docker recommended (auto-applies schema + seed on first boot)
docker compose up -d
#    ...or without Docker, once you have an empty PostGIS database:
#      cd server && cp ../.env.example .env && npm install && npm run db:init

# 2) Backend API + Socket.IO  (http://localhost:5000)
cd server
cp ../.env.example .env      # only if you didn't above
npm install
npm run dev

# 3) Frontend  (http://localhost:5173) — dev proxy forwards /api + /socket.io → :5000
cd client
npm install
npm run dev
```

Open the apps: **student** → `http://localhost:5173/`,
**driver** → `http://localhost:5173/driver`, **admin** → `http://localhost:5173/admin`.

> The backend binary is not included in the repo — `npm install` in both
> directories must succeed before anything runs. See the
> [Testing guide](#testing-guide) for a full QA walkthrough.

### Demo credentials (development only — change before deploy)

| Role   | Phone      | PIN        |
|--------|------------|------------|
| Admin  | 0241234001 | admin123   |
| Driver | 0241234002 | 1234       |
| Driver | 0241234003 | 1234       |

These are inserted by `server/src/db/seed.sql` (bcrypt-hashed). Generate new
hashes with `node scripts/generate-hashes.js <PIN>` if you edit the seed.

## Scripts

**Server** (`cd server`)

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the API + Socket.IO with watch mode |
| `npm start` | Start without watch (production-style) |
| `npm run db:init` | Apply `schema.sql` + `seed.sql` to `DATABASE_URL` |
| `npm run db:seed` | Apply `seed.sql` only (schema already applied) |
| `node scripts/generate-hashes.js <pin>` | Print a bcrypt hash for a PIN |
| `powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1` | End-to-end API smoke test (server + DB must be running) |
| `npm run sim` | Start the GPS simulator — moves the seeded fleet so you can test without real buses |

**Client** (`cd client`)

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server (port 5173, proxy to :5000) |
| `npm run build` | Production build to `dist/` (targets ES2020 for low-end WebViews) |
| `npm run preview` | Preview the production build locally (PWA/service worker active) |
| `node scripts/generate-icons.ps1` | Regenerate the PWA/app icons (PowerShell + System.Drawing) |

## Automated checks (CI)

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to
`main` and on every pull request, so the repo validates itself without needing a
local environment:

1. **Build the client** — `npm ci && npm run build` (a compile error fails CI).
2. **Install the server** — `npm ci` (dependencies cached from the lockfile).
3. **Validate Compose** — `docker compose config --quiet`.
4. **Boot the real PostGIS database** — starts the `db` service and waits for its
   healthcheck. Because Docker mounts `schema.sql` + `seed.sql` and applies them
   on first boot with an empty volume, a schema or seed regression breaks CI —
   not just the runtime.

The end-to-end API smoke test (`server/scripts/smoke-test.ps1`) needs a *running*
API + DB, so it is not part of CI; run it locally after changes (see
[Testing guide](#testing-guide)).

## GPS simulator (test without real buses)

`server/scripts/gps-simulator.js` starts fake trips and streams GPS fixes for the
seeded buses **through the real REST + Socket.IO + JWT code path** — exactly like
a driver's phone, so the server's snap-to-route, smoothing, next-stop/ETA and
offline detection are all genuinely exercised. The buses appear and move on the
student map, admin overview and `/api/buses/live`.

With the backend running, just:

```bash
cd server
npm run sim                       # all 3 seeded buses, ~25 km/h, 3 s fixes
npm run sim -- --bus KN-101       # only KN-101
npm run sim -- --speed 35 --interval 5000     # faster, coarser updates
npm run sim -- --duration 120 --no-end        # 2 min run, then leave trips so
                                              #   buses show OFFLINE after 60 s
npm run sim -- --cycle 15         # spin statuses (on_trip/full/break/breakdown)
node scripts/gps-simulator.js --help          # full option list
```

Key behaviour:

- **Auto-provisioning.** The seed only has drivers for KN-101 and KN-102. By
  default the simulator uses the admin account to ensure every selected bus has
  a login-able driver (resetting its PIN to `1234` or creating a new driver) so
  the whole fleet can be simulated. Pass `--no-provision` to refuse these
  writes (buses without a known driver are then skipped).
- **Motion.** Buses start staggered around the route, cruise at `--speed` km/h
  with speed jitter, pause `--dwell` ms at each stop, add `--jitter` metres of
  GPS noise, loop on circular routes and reverse on out-and-back routes, and
  send `accuracy: 6` so the server's accuracy filter lets them through.
- **Robustness.** Sockets auto-reconnect; if the server restarts mid-run the
  simulator detects the `no-active-trip` ack and re-starts the trip; Ctrl+C ends
  all trips cleanly (add `--no-end` to leave them running so you can watch buses
  transition to offline).
- `npm run sim` uses `socket.io-client` (a dev dependency of the server).

## Environment variables

Copy `server/.env.example` → `server/.env`. Key variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `5000` | HTTP + Socket.IO port |
| `NODE_ENV` | `development` | `production` turns off dev logging |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/knust_bus_tracker` | Matches docker-compose |
| `JWT_SECRET` | `dev-secret-…` | **Set a long random secret in production** (e.g. `openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `BCRYPT_ROUNDS` | `10` | PIN-hash cost |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Comma-separated allowed CORS origins |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `120` | Global API rate limit |
| `SOCKET_PING_TIMEOUT` / `SOCKET_PING_INTERVAL` | `10000` / `8000` | Socket.IO keep-alive tuning for weak links |

Additional navigation/GPS tunables (`server/src/config/env.js`): `MIN_SPEED_KMH`
(ETA floor speed), `AVG_DWELL_SECONDS` (per-stop dwell), `MAX_ACCURACY_M`
(GPS fixes worse than this are rejected), `MAX_JUMP_M` (rejects teleports),
`MAX_SPEED_KMH` (rejects unrealistic speeds), `OFFLINE_AFTER_MS` (a bus with no
update for this long is marked offline).

Client `client/.env.example` → `VITE_API_URL` / `VITE_SOCKET_URL`. Both may be
left **empty** in development — the Vite proxy keeps everything same-origin. Set
them to the deployed backend URL when serving the built client separately.

## API reference

All routes are JSON. Protected/logged-in routes require `Authorization: Bearer <JWT>`.
Public routes return `{ error }` with the correct status code on failure.

**Public (student app)**
- `GET /api/health` — service liveness.
- `GET /api/stops` — all stops `{ id, name, code, lat, lng }`.
- `GET /api/routes` — all **active** routes as polyline `path` + ordered `stops`.
- `GET /api/buses/live` — current live bus list (REST fallback for the socket feed).
- `GET /api/stops/nearest?lat=&lng=&limit=` — nearest stops via the PostGIS KNN `nearest_stops()` function, with `distanceM` + `walkSeconds`.
- `GET /api/stops/:id/arrivals` — live buses arriving at a stop, soonest first.
- `GET /api/trip-plan?from=&to=` — routes serving both stops + ride time + live-bus ETAs.
- `GET /api/announcements` — active announcements (banner).
- `POST /api/feedback` `{ message, contact?, stopId?, busId? }` — student feedback/report submission (no login; rate-limited).

**Auth**
- `POST /api/auth/login` `{ phone, pin }` → `{ token, user, driverId }`. Students never authenticate.

**Driver** (JWT · driver role)
- `GET /api/driver/me` — driver context: assigned bus, active trip, available routes.
- `POST /api/driver/trip/start` `{ routeId? }` — begin a trip + start GPS sharing.
- `POST /api/driver/trip/end` — end the active trip.
- `POST /api/driver/status` `{ status }` — `on_trip | break | breakdown | full`.

**Admin** (JWT · admin role)
- Buses: `GET/POST /api/admin/buses`, `PUT/DELETE /api/admin/buses/:id`
- Drivers: `GET /api/admin/drivers`, `POST /api/admin/drivers`,
  `PUT/DELETE /api/admin/drivers/:id`
- Routes: `GET /api/admin/routes` (full geometry + ordered stops),
  `POST /api/admin/routes`, `PUT/DELETE /api/admin/routes/:id`,
  `PUT /api/admin/routes/:id/geojson`, `PUT /api/admin/routes/:id/stops`
- Stops: `GET/POST /api/admin/stops`, `PUT/DELETE /api/admin/stops/:id`
- Announcements: `POST /api/admin/announcements`,
  `PATCH/DELETE /api/admin/announcements/:id` (list via public `/api/announcements`)
- Trips: `GET /api/admin/trips`, `GET /api/admin/trips/:id/locations` (replay points)
- Reports: `GET /api/admin/reports/summary` (trips/day, busiest stops, avg duration)
- Feedback: `GET /api/admin/feedback`, `DELETE /api/admin/feedback/:id`

Route-editor endpoints accept `coordinates` as `[lng, lat]` pairs and `stops`
as `[{ stopId, sequence }]`; GeoJSON imports are `[lng, lat]` too.

## Socket.IO events

One shared connection carries all real-time traffic (`/socket.io`, websocket
with polling fallback for weak links).

| Direction | Event | Payload | Notes |
|-----------|-------|---------|-------|
| Server → all | `bus:update` | live bus (`busId`, `busNumber`, `status`, `lat`, `lng`, heading, speed, route, next stop/ETA) | Sent on every GPS fix (smoothed, snapped to route) |
| Server → all | `bus:offline` | bus id | A bus reported nothing for ~60 s |
| Server → all | `bus:ended` | bus id | A trip ended — remove the marker |
| Server → all | `announcement:new` | the announcement | Emitted when an admin posts |
| Driver → server | `driver:location` | `{ lat, lng, speed, heading, accuracy, timestamp }` | ~3 s apart; ack confirms acceptance (or error) |

Students connect with no token and only receive broadcasts. Drivers/admins
connect with `auth: { token }` — the server verifies the JWT and only lets a
driver push `driver:location` for their **assigned bus** while a trip is active.

## How the core logic works

The movements you see are not raw GPS jitter — every fix is processed:

1. **Snap-to-route** — the raw point is projected onto the nearest point of the
   route's `path_geom` polyline (`services/routeModel.js`), turning 2D coordinates
   into a scalar **distance-along-route** in metres. Jitter disappears and the
   whole route becomes 1-D, which makes ETA maths trivial and accurate.
2. **Next stop + ETA** — the first stop whose distance-along is ahead of the bus
   is the next stop; ETA = remaining distance ÷ effective speed (floored at
   `MIN_SPEED_KMH` so a stationary or full bus doesn't get absurd ETAs) plus
   `AVG_DWELL_SECONDS` for each stop still to be dwelt at.
3. **Loops vs out-and-back** — a loop `is_loop=true` wraps around (the stop
   order repeats), while a non-loop route serves stops forward then reverse, so
   travel direction decides the service order.
4. **In-memory live store** — latest positions live in `services/liveStore.js`
   (no Redis needed for a handful of campus buses). Only history is written to
   `bus_locations` (for replay/reports). Route models are cached in
   `services/routesCache.js`, refreshed on admin edits and on a 60 s safety timer.

**Privacy:** students are never modelled in the database and their location is
used and discarded on-device only; nothing student-related ever reaches the API.

## Deployment

The app splits into a Node/Express + Socket.IO **backend** and a static React
**frontend**. Because Socket.IO needs long-lived, stateful connections, keep the
backend on a persistent Node host (not a serverless function), and the database
must be **PostgreSQL with PostGIS** — a plain managed Postgres is not enough.
Two deployment config files ship with the repo to make this easy: `client/vercel.json`
(Vite build config + SPA rewrites so `/driver`, `/admin`, etc. resolve back to
`index.html`) and `server/render.yaml` (a Render blueprint with build/start
commands and slots for `DATABASE_URL` / `JWT_SECRET` / `CLIENT_ORIGIN`). The
full walkthrough is below.

> **PostGIS tripping point.** Render's managed Postgres does **not** bundle
> PostGIS, so on Render point `DATABASE_URL` at a PostGIS-enabled external
> database. Supabase, Neon and Railway's PostGIS Postgres plugin all support
> PostGIS; a VPS running the bundled `docker-compose.yml` is the most faithful
> option.

### Option A — one origin (simplest, recommended)

One HTTPS domain serves the built frontend **and** proxies `/api` + `/socket.io`
to the Node backend, so `VITE_API_URL` / `VITE_SOCKET_URL` stay empty and CORS
is trivial. Good fits:

- **VPS with Docker** — run the DB (`docker compose up -d`) on the box, serve
  `client/dist` from nginx/Caddy, and reverse-proxy `/api/` + `/socket.io/` to
  the Node port (pass the WebSocket `Upgrade` header — see below).
- **Railway** — a backend service with start command `npm start` (from
  `server/`), a Static service for `client/dist`, and a
  [Railway Public Networking / custom-domain](https://docs.railway.com) rule so
  `/api*` and `/socket.io*` route to the backend service.
- **Render** — a Web Service for the backend plus a Static Site for `dist/`,
  fronted by a custom domain you control (static/proxy roots can then share it).

### Option B — separate frontend + backend origins

1. **Database** — provision PostgreSQL + PostGIS (Supabase, Neon, Railway
   PostGIS plugin, or your own VPS). Give the backend its `DATABASE_URL` and
   apply the schema + seed once: `cd server && npm run db:init`.
2. **Backend → Render or Railway**
   - Build: `cd server && npm ci --omit=dev`.
   - Start command: `npm start`.
   - Env: `NODE_ENV=production`, a strong `JWT_SECRET` (`openssl rand -hex 32`),
     `DATABASE_URL`, and `CLIENT_ORIGIN=https://<your-frontend-domain>`.
   - Render **Web Services** support WebSockets out of the box. On Railway, make
     the service **Public** and set the port to `5000`.
3. **Frontend → Vercel (or any static host)**
   - `cd client` and copy `client/.env.example` → `.env`, set:
     - `VITE_API_URL=https://<backend-domain>`
     - `VITE_SOCKET_URL=https://<backend-domain>`
   - Build: `npm run build` → deploy `dist/`.
   - Vercel (\`vercel --prod\`, output dir `dist`) and Railway Static handle the
     SPA fallback automatically; on a plain static host add a rewrite so any
     unknown path returns `index.html` (the app uses client-side routing).

### Socket.IO behind a proxy

If you front the Node service with a reverse proxy (nginx, Caddy, or a
platform proxy rule), pass the upgrade headers or WebSocket upgrades fail:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### HTTPS

Browser geolocation, notifications and the service worker (for an installable
PWA) all require a **secure origin**. Every host above serves HTTPS by default;
just keep `CLIENT_ORIGIN` set to your exact `https://…` origin(s).

## Testing guide

A full manual smoke test (fresh `docker compose up -d`, then run both servers).
There is also an automated one: with the backend running on :5000, run the
`server/scripts/smoke-test.ps1` script — it exercises auth guards, login,
driver context, a full trip start → status → live bus → arrivals → end,
trip history, reports, the trip planner and admin feedback endpoints.

1. **Student app** — the map shows the route polyline and the 6 surveyed stop
   markers, the banner shows the seeded announcements, and no console errors
   appear. To see buses without a real driver, start the GPS simulator in a
   second terminal (`cd server && npm run sim`) — the map will animate
   KN-101/KN-102/KN-103 along the Shuttle–Brunei route with live next-stop +
   ETAs.
2. **Driver app** — log in as *0241234002* / *1234*, pick the Shuttle to Brunei
   route, tap **Start trip**. The GPS-sharing banner turns green. In another tab the
   student map shows the bus moving (you can nudge it by walking/driving).
   Try **Break / Breakdown / Full** and watch the student's bus card update.
   Tap **End trip** — the bus disappears from the live map.
3. **Admin app** — log in as *0241234001* / *admin123*:
   - **Overview** shows the live buses while a trip is running.
   - **Buses / Drivers / Stops / Routes**: create, edit, reorder stops (drag),
     and delete each — the student map updates as soon as routes/stops change.
   - **Announcements**: post one with an expiry — it appears instantly in the
     student and driver apps.
   - **Trips**: complete a driver trip, then replay it from the list.
   - **Reports**: after trips, counts/durations are non-zero and busiest stops
     populate from GPS hits.
   - **Feedback**: in the student app's Feedback tab, send a message with a
     related stop — it appears in admin → Feedback with the stop context;
     remove it there.
4. **Offline**: stop the backend — the student map keeps showing cached
   stops/routes and the "offline" state appears instead of errors.
5. **Security smoke**: hitting `/api/admin/*` without a token returns 401, with a
   driver token returns 403, and with the admin token succeeds.

## Troubleshooting

**The map is empty / no buses appear** — that's normal on a fresh start: buses
only show while a trip is active. Start the simulator (`cd server && npm run sim`)
or log into the driver app and tap **Start trip**.

**Schema errors (`relation "stops" does not exist`, …)** — the database wasn't
initialised, or `DATABASE_URL` points at the wrong database. Reset it:
`docker compose down -v && docker compose up -d` (re-applies schema + seed), or
run `npm run db:init` against a fresh PostGIS database.

**Ports 5000 / 5173 / 5432 already in use** — another process holds them. Change
`PORT` in `server/.env`, `server.port` in `client/vite.config.js`, or the host
port in `docker-compose.yml`, then restart.

**CORS errors after deploying** — `CLIENT_ORIGIN` must list the *exact* frontend
origin(s) you load the app from (no trailing slash, comma-separated); the Vite
dev proxy avoids CORS entirely in development.

**Map tiles won't load** — the OpenStreetMap tile layer needs internet access and
its public servers can be slow on some networks. Live bus positions stream over
the WebSocket independently of the tiles, so the map can still update.

**Geolocation / notifications / PWA install don't work** — all three require a
**secure origin**: HTTPS (or `localhost`). They won't work over plain `http://`
when reaching the app from a phone on your LAN — serve the built app over HTTPS,
or test on `http://localhost`.

**Wake Lock keeps releasing** — the Wake Lock API is only available on
Chromium-based mobile browsers and the lock is released when the tab loses
focus. GPS sharing continues regardless; re-focusing the tab re-acquires it
automatically.

**Service worker doesn't register in dev** — by design the worker only activates
in production builds (`npm run build && npm run preview`) so Vite HMR never
fights the cache.

**Admin edits don't show up on the map** — route/stop geometry is cached on the
server (`services/routesCache.js`) and refreshes on every admin save and on a
60-second safety timer, so changes land within a minute.

**Icons look wrong** — regenerate `client/scripts/generate-icons.ps1` output (runs
on Windows PowerShell / System.Drawing) and rebuild the frontend.

## Before production

- Replace every **approximate placeholder coordinate** in `server/src/db/seed.sql`
  (routes, stops) with real surveyed GPS points.
- Change the **seeded credentials** and any demo seed data.
- Set a strong `JWT_SECRET`, restrict `CLIENT_ORIGIN` to your real origins, and
  serve everything over HTTPS.
- If you add scheduled timetables, the Reports "average delay" can be upgraded
  from average completed-trip duration to actual-vs-scheduled delay.


