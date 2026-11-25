-- ============================================================================
-- KNUST Bus Tracker — Seed data (KNUST campus, Kumasi)
--
-- IMPORTANT: Coordinates below are APPROXIMATE PLACEHOLDERS around
-- ~6.6745 N, 1.5716 W. Replace with real surveyed GPS coordinates for
-- production.
--
-- Dev credentials:
--   Admin:  0241234001 / PIN admin123
--   Driver: 0241234002 / PIN 1234 (Kwame Mensah)
--   Driver: 0241234003 / PIN 1234 (Ama Owusu)
-- ============================================================================

BEGIN;

-- 1. STOPS
INSERT INTO stops (name, code, geom) VALUES
  ('Main Gate',         'ST-01', ST_SetSRID(ST_Point(-1.5760, 6.6795), 4326)),
  ('Commercial Area',   'ST-02', ST_SetSRID(ST_Point(-1.5780, 6.6773), 4326)),
  ('KNUST Hospital',    'ST-03', ST_SetSRID(ST_Point(-1.5772, 6.6750), 4326)),
  ('Katanga',           'ST-04', ST_SetSRID(ST_Point(-1.5745, 6.6745), 4326)),
  ('Republic Hall',     'ST-05', ST_SetSRID(ST_Point(-1.5769, 6.6726), 4326)),
  ('Africa Hall',       'ST-06', ST_SetSRID(ST_Point(-1.5748, 6.6715), 4326)),
  ('Engineering',       'ST-07', ST_SetSRID(ST_Point(-1.5720, 6.6710), 4326)),
  ('Main Library',      'ST-08', ST_SetSRID(ST_Point(-1.5700, 6.6722), 4326)),
  ('Tech Junction',     'ST-09', ST_SetSRID(ST_Point(-1.5684, 6.6740), 4326)),
  ('Brunei',            'ST-10', ST_SetSRID(ST_Point(-1.5693, 6.6758), 4326)),
  ('Unity Hall',        'ST-11', ST_SetSRID(ST_Point(-1.5710, 6.6752), 4326)),
  ('Independence Hall', 'ST-12', ST_SetSRID(ST_Point(-1.5755, 6.6760), 4326))
ON CONFLICT (code) DO NOTHING;

-- 2. ROUTES
WITH r1 AS (
  SELECT ST_Segmentize(ST_MakeLine(ARRAY[
    ST_SetSRID(ST_Point(-1.5760, 6.6795), 4326),
    ST_SetSRID(ST_Point(-1.5780, 6.6773), 4326),
    ST_SetSRID(ST_Point(-1.5772, 6.6750), 4326),
    ST_SetSRID(ST_Point(-1.5745, 6.6745), 4326),
    ST_SetSRID(ST_Point(-1.5769, 6.6726), 4326),
    ST_SetSRID(ST_Point(-1.5748, 6.6715), 4326),
    ST_SetSRID(ST_Point(-1.5720, 6.6710), 4326),
    ST_SetSRID(ST_Point(-1.5700, 6.6722), 4326),
    ST_SetSRID(ST_Point(-1.5684, 6.6740), 4326),
    ST_SetSRID(ST_Point(-1.5693, 6.6758), 4326),
    ST_SetSRID(ST_Point(-1.5710, 6.6752), 4326),
    ST_SetSRID(ST_Point(-1.5755, 6.6760), 4326)
  ]), 0.0006)::geometry(LineString, 4326) AS path
)
INSERT INTO routes (id, name, code, colour, is_loop, is_active, path_geom, total_distance_m)
SELECT 1, 'Campus Loop', 'R1', '#0ea5e9', true, true, path,
       round(ST_Length(path::geography))::integer
FROM r1
ON CONFLICT (id) DO NOTHING;

WITH r2 AS (
  SELECT ST_Segmentize(ST_MakeLine(ARRAY[
    ST_SetSRID(ST_Point(-1.5700, 6.6722), 4326),
    ST_SetSRID(ST_Point(-1.5684, 6.6740), 4326),
    ST_SetSRID(ST_Point(-1.5693, 6.6758), 4326),
    ST_SetSRID(ST_Point(-1.5710, 6.6752), 4326),
    ST_SetSRID(ST_Point(-1.5745, 6.6745), 4326),
    ST_SetSRID(ST_Point(-1.5772, 6.6750), 4326),
    ST_SetSRID(ST_Point(-1.5780, 6.6773), 4326),
    ST_SetSRID(ST_Point(-1.5760, 6.6795), 4326)
  ]), 0.0006)::geometry(LineString, 4326) AS path
)
INSERT INTO routes (id, name, code, colour, is_loop, is_active, path_geom, total_distance_m)
SELECT 2, 'Tech Shuttle', 'R2', '#ef4444', false, true, path,
       round(ST_Length(path::geography))::integer
FROM r2
ON CONFLICT (id) DO NOTHING;

WITH r3 AS (
  SELECT ST_Segmentize(ST_MakeLine(ARRAY[
    ST_SetSRID(ST_Point(-1.5769, 6.6726), 4326),
    ST_SetSRID(ST_Point(-1.5748, 6.6715), 4326),
    ST_SetSRID(ST_Point(-1.5720, 6.6710), 4326),
    ST_SetSRID(ST_Point(-1.5700, 6.6722), 4326),
    ST_SetSRID(ST_Point(-1.5684, 6.6740), 4326),
    ST_SetSRID(ST_Point(-1.5710, 6.6752), 4326),
    ST_SetSRID(ST_Point(-1.5755, 6.6760), 4326),
    ST_SetSRID(ST_Point(-1.5745, 6.6745), 4326)
  ]), 0.0006)::geometry(LineString, 4326) AS path
)
INSERT INTO routes (id, name, code, colour, is_loop, is_active, path_geom, total_distance_m)
SELECT 3, 'Hall Hopper', 'R3', '#22c55e', true, true, path,
       round(ST_Length(path::geography))::integer
FROM r3
ON CONFLICT (id) DO NOTHING;

-- 3. ROUTE_STOPS
INSERT INTO route_stops (route_id, stop_id, sequence)
SELECT r.id, s.id, v.seq
FROM (VALUES
  ('R1',  1, 'Main Gate'),         ('R1',  2, 'Commercial Area'),
  ('R1',  3, 'KNUST Hospital'),    ('R1',  4, 'Katanga'),
  ('R1',  5, 'Republic Hall'),     ('R1',  6, 'Africa Hall'),
  ('R1',  7, 'Engineering'),       ('R1',  8, 'Main Library'),
  ('R1',  9, 'Tech Junction'),     ('R1', 10, 'Brunei'),
  ('R1', 11, 'Unity Hall'),        ('R1', 12, 'Independence Hall'),
  ('R2',  1, 'Main Library'),      ('R2',  2, 'Tech Junction'),
  ('R2',  3, 'Brunei'),            ('R2',  4, 'Unity Hall'),
  ('R2',  5, 'Katanga'),           ('R2',  6, 'KNUST Hospital'),
  ('R2',  7, 'Commercial Area'),   ('R2',  8, 'Main Gate'),
  ('R3',  1, 'Republic Hall'),     ('R3',  2, 'Africa Hall'),
  ('R3',  3, 'Engineering'),       ('R3',  4, 'Main Library'),
  ('R3',  5, 'Tech Junction'),     ('R3',  6, 'Unity Hall'),
  ('R3',  7, 'Independence Hall'), ('R3',  8, 'Katanga')
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
SELECT 3, 'KN-103', 'Mercedes Sprinter', 26, 'idle', r.id FROM routes r WHERE r.code = 'R2'
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
       'Campus Loop running late',
       'Bus KN-102 is running about 10 minutes behind schedule near Katanga due to traffic.',
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
SELECT 'The Tech Junction stop needs a bench and better lighting at night.',
       'student@st.knust.edu.gh', s.id
FROM stops s WHERE s.name = 'Tech Junction'
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
  ( 0, 6.6795, -1.5760,  0,   0),
  ( 1, 6.6785, -1.5772, 22, 210),
  ( 2, 6.6773, -1.5780, 24, 190),
  ( 3, 6.6762, -1.5776, 26, 160),
  ( 4, 6.6750, -1.5772, 25, 120),
  ( 5, 6.6745, -1.5745, 24,  80),
  ( 6, 6.6735, -1.5757, 22, 200),
  ( 7, 6.6726, -1.5769, 20, 160),
  ( 8, 6.6715, -1.5748, 22,  90),
  ( 9, 6.6710, -1.5720, 24,  70),
  (10, 6.6722, -1.5700, 26,  40)
) AS v(idx, lat, lng, speed, heading)
CROSS JOIN trip t
ON CONFLICT DO NOTHING;

-- 10. SEQUENCE SYNC
SELECT setval(pg_get_serial_sequence('routes', 'id'), (SELECT COALESCE(MAX(id), 1) FROM routes));
SELECT setval(pg_get_serial_sequence('buses',  'id'), (SELECT COALESCE(MAX(id), 1) FROM buses));
SELECT setval(pg_get_serial_sequence('trips',  'id'), (SELECT COALESCE(MAX(id), 1) FROM trips));

COMMIT;