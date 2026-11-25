#!/usr/bin/env node
/**
 * KNUST Bus Tracker — GPS SIMULATOR.
 *
 * Drives fake buses along the seeded routes through the REAL server APIs,
 * exactly like a driver's phone: 1) login (phone+PIN), 2) start a trip, 3)
 * open an authenticated Socket.IO connection, 4) stream `driver:location`
 * every --interval ms. The server does all the real work (snap-to-route,
 * smoothing, next-stop, ETA, history, offline detection), so the student map
 * shows genuinely moving buses with no real buses or phones.
 *
 * PRIVACY: only DRIVER positions (their assigned bus) are ever sent — never
 * student locations. Talks to REST + Socket.IO only; no direct DB access.
 *
 * Examples
 *   npm run sim                                   # 3 seeded buses (auto-drivers)
 *   npm run sim -- --bus KN-101                   # just one bus
 *   npm run sim -- --speed 35 --interval 5000     # faster, coarser updates
 *   npm run sim -- --duration 120 --no-end        # run 2 min then let buses go
 *                                                 #   offline (tests bus:offline)
 */

import { io } from 'socket.io-client';
import { computeCumulative, projectToPolyline, bearingDeg, toRad } from '../src/lib/geo.js';

/* ---------------------------------------------------------------------------
 * Tiny CLI parser (no external deps)
 * ------------------------------------------------------------------------- */
function parseArgs(argv) {
  const cfg = {
    base: 'http://localhost:5000',
    buses: null, // comma list of bus_numbers; null = all with a drivable route
    speed: 25, // km/h target cruise speed
    interval: 3000, // ms between GPS fixes
    duration: 0, // seconds to run; 0 = until Ctrl+C
    dwell: 6000, // ms pause at each stop (simulates boarding)
    jitter: 4, // metres of perpendicular GPS noise per fix
    laps: 0, // end each bus after N full laps; 0 = endless
    phase: 'auto', // start offset as fraction [0,1); auto = stagger
    cycle: 0, // seconds between status changes; 0 = disabled
    logEvery: 10, // seconds between live-fleet status tables
    provision: true, // create/fix drivers so every selected bus runs
    noEnd: false, // on exit, leave trips running (test offline)
    adminPhone: '0241234001',
    adminPin: 'admin123',
  };

  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };

  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  cfg.base = flag('--url') || cfg.base;
  cfg.buses = flag('--bus') || flag('--buses') || null;
  if (cfg.buses) {
    cfg.buses = cfg.buses.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  cfg.speed = numberFlag('--speed', cfg.speed);
  cfg.interval = numberFlag('--interval', cfg.interval);
  cfg.duration = numberFlag('--duration', cfg.duration);
  cfg.dwell = numberFlag('--dwell', cfg.dwell);
  cfg.jitter = numberFlag('--jitter', cfg.jitter);
  cfg.laps = numberFlag('--laps', cfg.laps);
  cfg.cycle = numberFlag('--cycle', cfg.cycle);
  cfg.logEvery = numberFlag('--log', cfg.logEvery);
  cfg.phase = flag('--phase') || cfg.phase;
  cfg.provision = !argv.includes('--no-provision');
  cfg.noEnd = argv.includes('--no-end');
  cfg.adminPhone = flag('--admin-phone') || cfg.adminPhone;
  cfg.adminPin = flag('--admin-pin') || cfg.adminPin;

  if (cfg.interval < 500) {
    console.error('--interval must be >= 500 ms (the server rate-limits high-frequency updates).');
    process.exit(1);
  }
  return cfg;
}

/** Read a numeric CLI flag, falling back to `fallback` when absent/invalid. */
function numberFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isNaN(value) ? fallback : value;
}

function printHelp() {
  console.log(`
KNUST Bus Tracker — GPS simulator
Moves the fleet along the seeded routes through the real server APIs.

Usage:  node scripts/gps-simulator.js [options]

Options:
  --url <base>         Backend base URL            (default: http://localhost:5000)
  --bus <n,..>         Bus numbers to simulate     (default: all with a drivable route)
  --speed <kmh>        Cruise speed                (default: 25)
  --interval <ms>      GPS fix frequency           (default: 3000)
  --duration <sec>     Run for N seconds then stop (default: 0 = until Ctrl+C)
  --dwell <ms>         Pause at each stop          (default: 6000)
  --jitter <m>         Perpendicular GPS noise     (default: 4)
  --laps <n>           End each bus after N laps   (default: 0 = endless)
  --phase <f|auto>     Start offset [0,1)          (default: auto-stagger)
  --cycle <sec>        Cycle driver statuses every N sec (default: 0 = off)
  --log <sec>          Print a live-fleet table every N sec (default: 10)
  --no-provision       Never create/fix driver accounts
  --no-end             On exit, leave trips running (test the 60 s offline marker)
  --admin-phone, --admin-pin   Admin creds used for provisioning
`);
}

/* ---------------------------------------------------------------------------
 * Minimal HTTP helpers (Node 18 global fetch)
 * ------------------------------------------------------------------------- */
async function api(cfg, path, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${path}: ${data.error || res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

/* ---------------------------------------------------------------------------
 * Route profile — turn the raw polyline into something we can drive.
 * We reuse the server's own computeCumulative() so our distances match the
 * server's snap-to-route exactly (both use Haversine over the same vertices).
 * ------------------------------------------------------------------------- */
function buildProfile(route) {
  const vertices = route.path || [];
  if (vertices.length < 2) return null;
  const cum = computeCumulative(vertices);
  const total = cum[cum.length - 1];

  /** Point + along-route heading at cumulative distance d (clamped to route). */
  function pointAt(d) {
    const dd = Math.max(0, Math.min(d, total));
    const n = vertices.length;
    for (let i = 0; i < n - 1; i += 1) {
      if (dd <= cum[i + 1] || i === n - 2) {
        const segLen = cum[i + 1] - cum[i] || 1;
        const t = (dd - cum[i]) / segLen;
        const a = vertices[i];
        const b = vertices[i + 1];
        return {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
          heading: bearingDeg(a.lat, a.lng, b.lat, b.lng),
        };
      }
    }
    const last = vertices[n - 1];
    return { lat: last.lat, lng: last.lng, heading: 0 };
  }

  // Pre-compute each stop's distance-along-route using the same projection the
  // server's RouteModel uses, so "at a stop" detection lines up with ETAs.
  const stops = (route.stops || [])
    .map((s) => {
      const proj = projectToPolyline(s.lat, s.lng, vertices, cum);
      return { ...s, distanceAlong: proj ? proj.cumulativeM : 0 };
    })
    .sort((a, b) => a.distanceAlong - b.distanceAlong);

  return { total, pointAt, stops };
}

/* ---------------------------------------------------------------------------
 * Movement state machine for one simulated bus
 * ------------------------------------------------------------------------- */
class BusSim {
  constructor({ cfg, bus, route, profile, driver, index }) {
    this.cfg = cfg;
    this.bus = bus; // { id, busNumber, routeId, ... } from /api/admin/buses
    this.route = route; // { id, code, name, isLoop, path, stops } from /api/routes
    this.profile = profile; // { total, pointAt, stops }
    this.driver = driver; // { phone, pin }
    this.index = index;

    // Start staggered around the route so buses don't pile up on the map.
    const phase =
      cfg.phase === 'auto'
        ? (index * 0.37) % 1 // golden-ratio stagger
        : Math.max(0, Math.min(0.999, Number(cfg.phase) || 0));
    this.dist = profile.total * phase; // metres along the route
    this.dir = 1; // +1 along polyline; flips at ends for out-and-back
    this.travelled = 0; // cumulative metres driven (lap counting)
    this.lapsDone = 0;
    this.lastPoint = null;

    this.dwelt = new Set(); // stop ids already dwelt at during the current pass

    this.token = null;
    this.tripId = null;
    this.socket = null;
    this.timer = null;
    this.statusTimer = null;
    this.dwellingUntil = 0;
    this.speed = this.cfg.speed;
    this.tick = 0;
    this.stopping = false;
  }

  /* ------------------------------ lifecycle ------------------------------ */

  /** Log the driver in and start a trip on the assigned bus. */
  async start() {
    const { token } = await api(this.cfg, '/api/auth/login', {
      method: 'POST',
      body: { phone: this.driver.phone, pin: this.driver.pin },
    });
    this.token = token;

    const started = await api(this.cfg, '/api/driver/trip/start', {
      method: 'POST',
      token,
      body: { routeId: this.route.id },
    });
    this.tripId = started.trip.id;
    log(
      `🧑‍✈ ${this.bus.busNumber} · trip#${this.tripId} started on ${this.route.name} (${this.driver.phone})`
    );

    this.openSocket();
    this.timer = setInterval(() => {
      this.tickLoop().catch((e) => this.fail('tick', e));
    }, this.cfg.interval);
    if (this.timer.unref) this.timer.unref();

    // Optional: rotate the driver status to demo the live status button.
    if (this.cfg.cycle > 0) {
      const statuses = ['on_trip', 'full', 'break', 'on_trip', 'breakdown'];
      let i = 0;
      this.statusTimer = setInterval(async () => {
        if (this.stopping) return;
        const s = statuses[i % statuses.length];
        i += 1;
        try {
          await api(this.cfg, '/api/driver/status', {
            method: 'POST',
            token: this.token,
            body: { status: s },
          });
          log(`   • ${this.bus.busNumber} status → ${s}`);
        } catch (e) {
          this.fail('status', e);
        }
      }, this.cfg.cycle * 1000);
      if (this.statusTimer.unref) this.statusTimer.unref();
    }
  }

  /** Open the authenticated Socket.IO connection (auto-reconnects). */
  openSocket() {
    this.socket = io(this.cfg.base, {
      auth: { token: this.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => log(`🔌 ${this.bus.busNumber} socket connected`));
    this.socket.on('disconnect', (reason) =>
      log(`   • ${this.bus.busNumber} socket lost (${reason}) — reconnecting…`)
    );
    this.socket.on('connect_error', (err) =>
      log(`   • ${this.bus.busNumber} socket error: ${err.message}`)
    );
  }

  /** End the trip via REST and tear the connection down. */
  async stop() {
    this.stopping = true;
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.timer) clearInterval(this.timer);
    if (this.socket && this.socket.connected) this.socket.disconnect();

    if (this.cfg.noEnd) {
      log(
        `   • ${this.bus.busNumber} left running (--no-end) — it will be marked offline after 60 s`
      );
      return;
    }
    if (!this.token) {
      log(`   • ${this.bus.busNumber} had no active trip — nothing to end`);
      return;
    }
    try {
      await api(this.cfg, '/api/driver/trip/end', { method: 'POST', token: this.token });
      log(`🏁 ${this.bus.busNumber} trip ended cleanly (laps: ${this.lapsDone})`);
    } catch (e) {
      this.fail('trip/end', e);
    }
  }

    /* ------------------------------- movement ------------------------------- */

  async tickLoop() {
    if (this.stopping) return;
    this.advance();
    this.sendFix();
  }

  /** Advance the cursor along the route, respecting stops, corners and ends. */
  advance() {
    const { total, stops } = this.profile;
    if (stops.length === 0) return; // no stops → nothing to dwell at
    const dt = this.cfg.interval / 1000;

    // ---- 1) still dwelling at a stop: keep reporting speed 0, don't move ----
    if (this.dwellingUntil && Date.now() < this.dwellingUntil) {
      this.speed = 0;
      return;
    }
    this.dwellingUntil = 0;

    // ---- 2) normal cruise speed (oscillates + noise so it isn't robotic) ----
    const step = (this.cruiseSpeed() / 3.6) * dt;
    const radius = Math.max(25, step * 2); // bigger than one tick step

    // ---- 3) dwell once at each stop we reach (radius skips "jumping over") ----
    const next = this.nextStopAhead(radius);
    if (next && !this.dwelt.has(next.id) && Math.abs(this.dist - next.distanceAlong) <= radius) {
      this.dwelt.add(next.id);
      this.speed = 0;
      this.dwellingUntil = Date.now() + this.cfg.dwell;
      return;
    }

    // ---- 4) move along the polyline ----
    const before = this.dist;
    let d = this.dist + this.dir * step;
    if (this.route.isLoop) {
      // Loop: distance wraps; crossing the start counts as one full lap.
      d = ((d % total) + total) % total;
      if (d < before) this.lapsDone += 1;
    } else {
      // Out-and-back: bounce at both ends of the polyline.
      if (d >= total) {
        d = total;
        this.dir = -1;
        this.lapsDone += 0.5; // half a circuit (out and back)
      } else if (d <= 0) {
        d = 0;
        this.dir = 1;
        this.lapsDone += 0.5;
      }
    }
    this.dist = d;
    this.travelled += Math.abs(d - before);
    this.speed = this.cruiseSpeed();

    // Forget stops that are now behind us so they can be dwelt at again on the
    // next lap / return leg (avoids re-dwelling a stop we just left).
    for (const s of stops) {
      if (this.dwelt.has(s.id) && this.passedStop(s)) this.dwelt.delete(s.id);
    }

    // Stop condition: finished the requested number of laps.
    const lapLength = this.route.isLoop ? total : total * 2;
    if (this.cfg.laps > 0 && this.travelled >= lapLength * this.cfg.laps) {
      log(`   • ${this.bus.busNumber} completed ${this.cfg.laps} lap(s) — ending trip`);
      this.stop().catch((e) => this.fail('auto-stop', e));
    }
  }

  /** True when the cursor has moved past `stop` in the current direction. */
  passedStop(stop) {
    const r = 25; // metres past the stop marker
    if (this.route.isLoop) return this.dist > stop.distanceAlong + r;
    if (this.dir >= 0) return this.dist > stop.distanceAlong + r;
    return this.dist < stop.distanceAlong - r;
  }

  /** The nearest stop ahead in the current direction of travel (or null). */
  nextStopAhead(radius) {
    const stops = this.profile.stops;
    if (stops.length === 0) return null;
    // Epsilon avoids re-triggering a stop we have just passed.
    const eps = radius;
    if (this.route.isLoop) {
      const ahead = stops.filter((s) => s.distanceAlong > this.dist + eps);
      return ahead.length ? ahead[0] : stops[0]; // wrapped → first on the loop
    }
    if (this.dir >= 0) {
      const ahead = stops.filter((s) => s.distanceAlong > this.dist + eps);
      return ahead.length ? ahead[0] : null;
    }
    // Reverse: stops we have passed, in reverse service order.
    const behind = stops.filter((s) => s.distanceAlong < this.dist - eps);
    return behind.length ? behind[behind.length - 1] : null;
  }

  /** Cruise speed with a gentle oscillation + noise so it isn't robotic. */
  cruiseSpeed() {
    const osc = 1 + 0.12 * Math.sin(this.tick / 6);
    const noise = (Math.random() - 0.5) * 4;
    return Math.max(5, Math.min(70, this.cfg.speed * osc + noise));
  }

  /** Build + emit one `driver:location` fix. */
  sendFix() {
    if (!this.socket || !this.socket.connected) return; // queued on reconnect

    const pt = this.profile.pointAt(this.dist);
    // Perpendicular GPS noise (jitter). The server snaps it back to the route,
    // which exercises snap-to-route + smoothing instead of a perfect line.
    let { lat, lng } = pt;
    if (this.cfg.jitter > 0) {
      const off = (Math.random() - 0.5) * 2 * this.cfg.jitter;
      const perp = pt.heading + 90;
      const mPerDegLat = 111132.92;
      const mPerDegLng = mPerDegLat * Math.cos(toRad(lat));
      lat += (Math.cos(toRad(perp)) * off) / mPerDegLat;
      lng += (Math.sin(toRad(perp)) * off) / mPerDegLng;
    }

    // Heading = bearing between previous and current fix, which matches the
    // actual direction of travel (incl. out-and-back reverses).
    const heading = this.lastPoint
      ? bearingDeg(this.lastPoint.lat, this.lastPoint.lng, lat, lng)
      : pt.heading;
    this.lastPoint = { lat, lng };

    this.tick += 1;
    this.socket.emit(
      'driver:location',
      {
        lat,
        lng,
        speed: Math.round(this.speed * 10) / 10,
        heading: Math.round((heading + 360) % 360),
        accuracy: 6, // good GPS (server rejects fixes worse than ~50 m)
        timestamp: Date.now(),
      },
      (ack) => {
        // Best-effort recovery: if the server lost our trip (e.g. it restarted)
        // re-start it and keep driving.
        if (ack && ack.ok === false && ack.error === 'no-active-trip' && !this.stopping) {
          log(`   • ${this.bus.busNumber} trip lost on server — restarting…`);
          api(this.cfg, '/api/driver/trip/start', {
            method: 'POST',
            token: this.token,
            body: { routeId: this.route.id },
          })
            .then((s) => {
              this.tripId = s.trip.id;
            })
            .catch((e) => this.fail('restart-trip', e));
        } else if (ack && ack.ok === false) {
          log(`   • ${this.bus.busNumber} fix rejected: ${ack.error}`);
        }
      }
    );
  }

  fail(where, err) {
    if (this.stopping) return;
    console.error(`[${this.bus.busNumber}] ${where} failed:`, err.message);
  }
}

/* ---------------------------------------------------------------------------
 * Fleet discovery + driver provisioning
 * ------------------------------------------------------------------------- */
async function discover(cfg) {
  // Admin session (for read-only fleet view + driver provisioning).
  const { token: adminToken } = await api(cfg, '/api/auth/login', {
    method: 'POST',
    body: { phone: cfg.adminPhone, pin: cfg.adminPin },
  });

  const [fleet, drivers, routes] = await Promise.all([
    api(cfg, '/api/admin/buses', { token: adminToken }),
    api(cfg, '/api/admin/drivers', { token: adminToken }),
    api(cfg, '/api/routes'),
  ]);

  const routesById = new Map(routes.map((r) => [r.id, r]));
  const driverByBus = new Map();
  for (const d of drivers) {
    if (d.assignedBusId != null && !driverByBus.has(Number(d.assignedBusId))) {
      driverByBus.set(Number(d.assignedBusId), d);
    }
  }

  // Only routes that are active and have a drivable path.
  const drivableRoutes = routes.filter((r) => r.isActive !== false && (r.path || []).length >= 2);

  // Decide which buses to simulate (fleet buses whose route is drivable).
  let selected = fleet.filter((b) => drivableRoutes.some((r) => r.id === Number(b.routeId)));
  if (cfg.buses && cfg.buses.length) {
    selected = selected.filter((b) => cfg.buses.includes(String(b.busNumber).toUpperCase()));
  }

  log(
    `Fleet: ${fleet.length} buses · drivable routes: ${drivableRoutes.map((r) => r.code).join(', ')} · ` +
      `simulating ${selected.map((b) => b.busNumber).join(', ') || '(none)'}`
  );

  // Ensure a login-able driver for every selected bus.
  const jobs = [];
  let provisioned = 0;
  for (const bus of selected) {
    const route = routesById.get(Number(bus.routeId));
    const profile = buildProfile(route);
    if (!profile) continue;

    let driver = driverByBus.get(Number(bus.id));
    if (driver) {
      if (cfg.provision) {
        // Reset the assigned driver's PIN to a known value so we can log in.
        await api(cfg, `/api/admin/drivers/${driver.id}`, {
          method: 'PUT',
          token: adminToken,
          body: { pin: '1234', isActive: true },
        });
        driver = { phone: driver.phone, pin: '1234' };
        log(`   • ${bus.busNumber}: driver ${driver.phone} (PIN ensured 1234)`);
      } else {
        // Without provisioning we assume the seeded PIN (1234).
        driver = { phone: driver.phone, pin: '1234' };
        log(`   • ${bus.busNumber}: using assigned driver ${driver.phone} / pin 1234`);
      }
    } else if (cfg.provision) {
      const phone = `2480100000${bus.id % 10}`; // e.g. 24801000003 for bus 3
      await api(cfg, '/api/admin/drivers', {
        method: 'POST',
        token: adminToken,
        body: {
          name: `Sim Driver ${bus.busNumber}`,
          phone,
          pin: '1234',
          licenseNumber: `SIM-${bus.id}`,
          assignedBusId: Number(bus.id),
        },
      });
      driver = { phone, pin: '1234' };
      provisioned += 1;
      log(`   • ${bus.busNumber}: provisioned driver ${phone} / pin 1234 (assigned to bus)`);
    } else {
      log(`   • ${bus.busNumber}: NO driver — skipping (use --provision to auto-create one)`);
      continue;
    }

    jobs.push({ bus, route, profile, driver });
  }
  if (provisioned) log(`✔ Provisioned ${provisioned} new driver(s).`);

  return { jobs };
}

/* ---------------------------------------------------------------------------
 * Live fleet table (polls the same public endpoint the student app uses)
 * ------------------------------------------------------------------------- */
async function printFleet(cfg) {
  try {
    const live = await api(cfg, '/api/buses/live');
    const cols = [10, 19, 11, 7, 24, 7, 11, 11];
    const heads = ['BUS', 'ROUTE', 'STATUS', 'SPEED', 'NEXT STOP', 'ETA', 'LAT', 'LNG'];
    console.log('\n  LIVE FLEET');
    console.log(`  ${'-'.repeat(96)}`);
    console.log(`  ${heads.map((h, i) => pad(h, cols[i])).join('')}`);
    console.log(`  ${'-'.repeat(96)}`);
    if (live.length === 0) {
      console.log('  (no buses on the road yet…)');
      console.log('');
      return;
    }
    for (const b of live) {
      const row = [
        b.busNumber || '?',
        (b.route && `${b.route.code} ${b.route.name}`) || '—',
        b.status || '?',
        b.speedKmh != null ? `${Math.round(b.speedKmh)} km/h` : '—',
        b.nextStop ? b.nextStop.stopName : '—',
        b.nextStop ? `${Math.round(b.nextStop.etaSeconds / 60)}m` : '—',
        b.lat != null ? b.lat.toFixed(5) : '—',
        b.lng != null ? b.lng.toFixed(5) : '—',
      ];
      console.log(`  ${row.map((c, i) => pad(c, cols[i])).join('')}`);
    }
    console.log('');
  } catch (e) {
    console.error('[live] could not fetch /api/buses/live:', e.message);
  }
}

function pad(str, width) {
  const s = String(str ?? '');
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/* ---------------------------------------------------------------------------
 * main
 * ------------------------------------------------------------------------- */
const cfg = parseArgs(process.argv.slice(2));

async function main() {
  const { jobs } = await discover(cfg);

  if (jobs.length === 0) {
    console.error('No buses matched. Check --bus, or use --provision to auto-create drivers.');
    process.exit(1);
  }

  const busses = jobs.map((job, i) => new BusSim({ cfg, ...job, index: i }));
  await Promise.all(busses.map((b) => b.start()));

  // Periodic live-fleet table (same data the student map renders).
  const logger = setInterval(() => printFleet(cfg).catch(() => {}), cfg.logEvery * 1000);
  if (logger.unref) logger.unref();
  printFleet(cfg).catch(() => {});

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(logger);
    log('Shutting down simulated fleet…');
    await Promise.all(busses.map((b) => b.stop().catch(() => {})));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Optional automatic stop after --duration seconds.
  if (cfg.duration > 0) {
    setTimeout(async () => {
      log(`--duration ${cfg.duration}s reached — shutting down…`);
      await shutdown();
    }, cfg.duration * 1000);
  }
}

main().catch((err) => {
  console.error('\n✖ GPS simulator failed:', err.message);
  process.exit(1);
});






