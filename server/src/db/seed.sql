-- ============================================================================
-- KNUST Bus Tracker — Seed data (KNUST campus, Kumasi)
--
-- IMPORTANT: The single route (Shuttle Station → Brunei) and its 6 stops use
-- real surveyed GPS coordinates (Google Plus Codes MCMF+36R / MCGJ+2XV etc.)
-- supplied by the transport team. Section 9's sample trip history uses the
-- same surveyed points.
--
-- Dev credentials:
--   Admin:  0241234001 / PIN admin123
--   Driver: 0241234002 / PIN 1234 (Kwame Mensah)
--   Driver: 0241234003 / PIN 1234 (Ama Owusu)
-- ============================================================================

BEGIN;

-- 1. STOPS
INSERT INTO stops (name, code, geom) VALUES
  ('Shuttle Station (MCMF+36R)',  'ST-01', ST_SetSRID(ST_Point(-1.5769921, 6.6827308), 4326)),
  ('Global Expert Recovery Ltd.', 'ST-02', ST_SetSRID(ST_Point(-1.5639323, 6.6614917), 4326)),
  ('Peace Junction Bus-Stop A',   'ST-03', ST_SetSRID(ST_Point(-1.5728044, 6.6792775), 4326)),
  ('Trinity Bus Stop',            'ST-04', ST_SetSRID(ST_Point(-1.5671778, 6.6693073), 4326)),
  ('Shuttle Station (MCGJ+2XV)',  'ST-05', ST_SetSRID(ST_Point(-1.5675626, 6.6751188), 4326)),
  ('Brunei Bus Stop',             'ST-06', ST_SetSRID(ST_Point(-1.5741533, 6.6704376), 4326))
ON CONFLICT (code) DO NOTHING;

-- 2. ROUTES
WITH r1 AS (
  SELECT ST_Segmentize(ST_MakeLine(ARRAY[
    ST_SetSRID(ST_Point(-1.5769921, 6.6827308), 4326),
    ST_SetSRID(ST_Point(-1.5639323, 6.6614917), 4326),
    ST_SetSRID(ST_Point(-1.5728044, 6.6792775), 4326),
    ST_SetSRID(ST_Point(-1.5671778, 6.6693073), 4326),
    ST_SetSRID(ST_Point(-1.5675626, 6.6751188), 4326),
    ST_SetSRID(ST_Point(-1.5741533, 6.6704376), 4326)
  ]), 0.0006)::geometry(LineString, 4326) AS path
)
INSERT INTO routes (id, name, code, colour, is_loop, is_active, path_geom, total_distance_m)
SELECT 1, 'Shuttle to Brunei', 'R1', '#0ea5e9', false, true, path,
       round(ST_Length(path::geography))::integer
FROM r1
ON CONFLICT (id) DO NOTHING;

-- 3. ROUTE_STOPS
INSERT INTO route_stops (route_id, stop_id, sequence)
SELECT r.id, s.id, v.seq
FROM (VALUES
  ('R1', 1, 'Shuttle Station (MCMF+36R)'),
  ('R1', 2, 'Global Expert Recovery Ltd.'),
  ('R1', 3, 'Peace Junction Bus-Stop A'),
  ('R1', 4, 'Trinity Bus Stop'),
  ('R1', 5, 'Shuttle Station (MCGJ+2XV)'),
  ('R1', 6, 'Brunei Bus Stop')
) AS v(code, seq, stop_name)
JOIN routes r ON r.code = v.code
JOIN stops s ON s.name = v.stop_name
ON CONFLICT DO NOTHING;

-- 4. BUSES
INSERT INTO buses (id, bus_number, model, capacity, status, route_id)
SELECT 1, 'KN-101', 'Toyota Coaster', 18, 'idle', r.id FROM routes r WHERE r.code = 'R1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO buses (id, bus_number, model, capacity, status, route_id)
SELECT 2, 'KN-102', 'Toyota Coaster', 18, 'idle', r.id FROM routes r WHERE r.code = 'R1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO buses (id, bus_number, model, capacity, status, route_id)
SELECT 3, 'KN-103', 'Mercedes Sprinter', 26, 'idle', r.id FROM routes r WHERE r.code = 'R1'
ON CONFLICT (id) DO NOTHING;

-- 5. USERS
INSERT INTO users (name, phone, pin_hash, role) VALUES
  ('System Administrator', '0241234001',
   '$2a$10$8jtmvGiMk8lxfe.KDJBah.gtva1DNBpXh4ut/A3oUkbMRjsgsGUeG', 'admin'),
  ('Kwame Mensah',         '0241234002',
   '$2a$10$FvgaQ2A9yIG5p5QF2U2bSeBzUIUNZYSk1L4cvz7EqVqgH1/DIy96.', 'driver'),
  ('Ama Owusu',            '0241234003',
   '$2a$10$FvgaQ2A9yIG5p5QF2U2bSeBzUIUNZYSk1L4cvz7EqVqgH1/DIy96.', 'driver')
ON CONFLICT (phone) DO NOTHING;

-- 6. DRIVERS
INSERT INTO drivers (user_id, license_number, assigned_bus_id)
SELECT u.id, 'GH-2024-001', b.id
FROM users u
JOIN buses b ON b.bus_number = 'KN-101'
WHERE u.phone = '0241234002'
ON CONFLICT DO NOTHING;

INSERT INTO drivers (user_id, license_number, assigned_bus_id)
SELECT u.id, 'GH-2024-002', b.id
FROM users u
JOIN buses b ON b.bus_number = 'KN-102'
WHERE u.phone = '0241234003'
ON CONFLICT DO NOTHING;

-- 7. ANNOUNCEMENTS
INSERT INTO announcements (kind, title, message, created_by, expires_at, is_active)
SELECT 'delay',
       'Shuttle running late',
       'Bus KN-102 is running about 10 minutes behind schedule near Peace Junction Bus-Stop A due to traffic.',
       u.id,
       now() + interval '2 hours',
       true
FROM users u WHERE u.phone = '0241234001'
ON CONFLICT DO NOTHING;

INSERT INTO announcements (kind, title, message, created_by, expires_at, is_active)
SELECT 'info',
       'Welcome to KNUST Bus Tracker',
       'Track campus shuttles live. Tap any moving bus to see its next stop and ETA.',
       u.id,
       now() + interval '7 days',
       true
FROM users u WHERE u.phone = '0241234001'
ON CONFLICT DO NOTHING;

-- 8. FEEDBACK
INSERT INTO feedback (message, contact, stop_id)
SELECT 'The Trinity Bus Stop needs a bench and better lighting at night.',
       'student@st.knust.edu.gh', s.id
FROM stops s WHERE s.name = 'Trinity Bus Stop'
ON CONFLICT DO NOTHING;

-- 9. SAMPLE TRIP HISTORY
WITH trip AS (
  INSERT INTO trips (id, bus_id, driver_id, route_id, started_at, ended_at, status)
  SELECT 1, b.id, d.id, b.route_id,
         now() - interval '3 hours',
         now() - interval '90 minutes',
         'completed'
  FROM buses b
  JOIN drivers d ON d.assigned_bus_id = b.id
  WHERE b.bus_number = 'KN-101'
  ON CONFLICT (id) DO NOTHING
  RETURNING id, bus_id, started_at
)
INSERT INTO bus_locations (bus_id, trip_id, geom, lat, lng, speed_kmh, heading, accuracy, captured_at)
SELECT t.bus_id, t.id,
       ST_SetSRID(ST_Point(v.lng, v.lat), 4326),
       v.lat, v.lng, v.speed, v.heading, 8.0,
       t.started_at + (v.idx * interval '8 minutes')
FROM (VALUES
  ( 0, 6.6827308, -1.5769921,  0,   0),
  ( 1, 6.6614917, -1.5639323, 24, 145),
  ( 2, 6.6792775, -1.5728044, 23, 335),
  ( 3, 6.6693073, -1.5671778, 24, 150),
  ( 4, 6.6751188, -1.5675626, 22, 355),
  ( 5, 6.6704376, -1.5741533, 22, 235)
) AS v(idx, lat, lng, speed, heading)
CROSS JOIN trip t
ON CONFLICT DO NOTHING;

-- 10. SEQUENCE SYNC
SELECT setval(pg_get_serial_sequence('routes', 'id'), (SELECT COALESCE(MAX(id), 1) FROM routes));
SELECT setval(pg_get_serial_sequence('buses',  'id'), (SELECT COALESCE(MAX(id), 1) FROM buses));
SELECT setval(pg_get_serial_sequence('trips',  'id'), (SELECT COALESCE(MAX(id), 1) FROM trips));

COMMIT;