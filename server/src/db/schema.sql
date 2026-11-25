-- ============================================================================
-- KNUST Bus Tracker — Database Schema
-- PostgreSQL + PostGIS (SRID 4326, WGS84) — apply via docker initdb scripts
-- or with:  cd server && npm run db:init
-- ============================================================================

-- PostGIS is provided by the postgis/postgis Docker image; enable it explicitly
-- so the same schema also works against a manually provisioned database.
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- USERS         one row per person who can log in (admin, driver).
--               Students never log in and never get a row/account.
--               `pin_hash` is the bcrypt hash of the login PIN (NOT plaintext).
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE CHECK (phone <> ''),
  pin_hash   TEXT NOT NULL CHECK (pin_hash <> ''),
  role       TEXT NOT NULL CHECK (role IN ('admin', 'driver')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ROUTES        a bus line. path_geom is the drivable line the bus is snapped
--               to. is_loop=true means the bus serves the stop order in a
--               circle; is_loop=false means "out-and-back" (drive to the end
--               stop, then return, serving the same stops in reverse).
-- ============================================================================
CREATE TABLE IF NOT EXISTS routes (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  code             TEXT NOT NULL UNIQUE,
  colour           TEXT NOT NULL DEFAULT '#0ea5e9',
  is_loop          BOOLEAN NOT NULL DEFAULT false,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  path_geom        GEOMETRY(LineString, 4326),
  total_distance_m DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- STOPS          a bus stop. geom is its point (SRID 4326). Coordinates in the
--                seed file are APPROXIMATE placeholders to be replaced with
--                real surveyed GPS coordinates before production use.
-- ============================================================================
CREATE TABLE IF NOT EXISTS stops (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  code       TEXT UNIQUE,
  geom       GEOMETRY(Point, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- BUSES         a physical vehicle. route_id is the route the bus currently
--               belongs to (set by the admin). status reflects its live state:
--                 idle    -> not currently on a trip
--                 on_trip -> actively sharing GPS during a trip
--                 offline -> no GPS update seen for 60 s
-- ============================================================================
CREATE TABLE IF NOT EXISTS buses (
  id          BIGSERIAL PRIMARY KEY,
  bus_number  TEXT NOT NULL UNIQUE,
  model       TEXT NOT NULL DEFAULT 'Coaster',
  capacity    INTEGER NOT NULL DEFAULT 18 CHECK (capacity >= 1),
  colour      TEXT,
  status      TEXT NOT NULL DEFAULT 'idle'
              CHECK (status IN ('idle', 'on_trip', 'offline')),
  route_id    BIGINT REFERENCES routes(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- DRIVERS        transport-role details per driver (one driver = one user).
--               assigned_bus_id is the bus the admin assigned to this driver.
-- ============================================================================
CREATE TABLE IF NOT EXISTS drivers (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  license_number  TEXT,
  assigned_bus_id BIGINT REFERENCES buses(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ROUTE_STOPS    ordered stop list per route. sequence is 1-based in travel
--                order. For loop routes the first stop repeats as the last
--                via wrap-around logic in the server (not duplicated here).
-- ============================================================================
CREATE TABLE IF NOT EXISTS route_stops (
  id       BIGSERIAL PRIMARY KEY,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id  BIGINT NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  UNIQUE (route_id, sequence),
  UNIQUE (route_id, stop_id)
);

-- ============================================================================
-- TRIPS          one row per journey a bus makes. A trip is started when the
--                driver taps "Start trip" and ended on "End trip". Every GPS
--                point sent during a trip is stored against its trip_id so we
--                can replay history and build reports.
-- ============================================================================
CREATE TABLE IF NOT EXISTS trips (
  id         BIGSERIAL PRIMARY KEY,
  bus_id     BIGINT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  driver_id  BIGINT REFERENCES drivers(id) ON DELETE SET NULL,
  route_id   BIGINT REFERENCES routes(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- BUS_LOCATIONS  raw GPS observations from drivers (small payloads, stored per
--                trip for history/replay/reports). The live bus positions used
--                by the app are kept in-memory on the server and derived from
--                this table + the live Socket.IO feed.
--                PRIVACY: only drivers on active trips write here; student
--                locations are never sent to or stored by the server.
-- ============================================================================
CREATE TABLE IF NOT EXISTS bus_locations (
  id          BIGSERIAL PRIMARY KEY,
  bus_id      BIGINT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  trip_id     BIGINT REFERENCES trips(id) ON DELETE CASCADE,
  geom        GEOMETRY(Point, 4326) NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed_kmh   DOUBLE PRECISION,
  heading     DOUBLE PRECISION,  -- degrees, 0..360 (0 = north)
  accuracy    DOUBLE PRECISION,  -- horizontal accuracy in metres
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ANNOUNCEMENTS  news banner items shown to students & drivers.
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcements (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'info'
             CHECK (kind IN ('delay', 'breakdown', 'schedule', 'info')),
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- FEEDBACK      optional student feedback/report form submissions.
-- ============================================================================
CREATE TABLE IF NOT EXISTS feedback (
  id         BIGSERIAL PRIMARY KEY,
  message    TEXT NOT NULL,
  contact    TEXT,
  stop_id    BIGINT REFERENCES stops(id) ON DELETE SET NULL,
  bus_id     BIGINT REFERENCES buses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES  (geospatial + the hot query paths)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_stops_geom             ON stops  USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_routes_path_geom       ON routes USING GIST (path_geom);
CREATE INDEX IF NOT EXISTS idx_bus_locations_geom     ON bus_locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_bus_locations_trip     ON bus_locations (trip_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_bus_locations_time     ON bus_locations (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_stops_order      ON route_stops (route_id, sequence);
CREATE INDEX IF NOT EXISTS idx_announcements_active   ON announcements (is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_bus_time         ON trips (bus_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_driver_time      ON trips (driver_id, started_at DESC);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Haversine great-circle distance between two lat/lng pairs, in kilometres.
-- Used as a fast, dependency-free speed/distance helper. (PostGIS geography
-- is used for the precision-critical nearest-stop queries.)
CREATE OR REPLACE FUNCTION haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 6371.0088 * 2 * asin(
    sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    )
  );
$$;

-- Return the `p_limit` stops nearest a given lat/lng, ordered by distance.
-- Uses the GiST index (KNN <->) for speed. Note argument order: lat, lng.
CREATE OR REPLACE FUNCTION nearest_stops(
  p_lat double precision,
  p_lng double precision,
  p_limit integer DEFAULT 5
) RETURNS TABLE (
  id          bigint,
  name        text,
  code        text,
  distance_m  double precision
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT s.id, s.name, s.code,
         ST_Distance(s.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m
    FROM stops s
   ORDER BY s.geom::geography <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
   LIMIT p_limit;
$$;

