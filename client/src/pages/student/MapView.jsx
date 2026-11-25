import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Popup,
  Circle,
  Tooltip,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './leaflet.css';

/**
 * STUDENT MAP — the full-screen Leaflet view of the live campus.
 *
 * Layers (bottom → top): OSM tiles (+ a dark-mode filter from leaflet.css),
 * route polylines (coloured by route.colour), a dashed walking line from the
 * student's device to their nearest stop, stop circle markers, live bus
 * markers, and the on-device "you" marker with its accuracy circle.
 *
 * Bus markers are eased toward each new position on a requestAnimationFrame
 * loop (SmoothBusMarker) so they glide smoothly instead of teleporting every
 * 3-5 s. The 🚌 glyph rotates to follow the bus heading; offline buses grey
 * out; the selected bus scales up.
 *
 * The live map instance is handed to the parent (onMap) so header buttons can
 * flyTo()/fitBounds(), and the camera fits the routes exactly once at load.
 * Marker clicks bubble up via onBusClick / onStopClick so the bottom sheet
 * (Panels.jsx) can show the detail.
 */

const CENTER = [6.6745, -1.5716]; // KNUST campus centre (approx)
const DEFAULT_ZOOM = 15;
const MAX_ZOOM = 19;

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** divIcon for the on-device "you" marker (styles live in leaflet.css). */
const youIcon = L.divIcon({
  className: 'you-marker',
  html: '<div class="you-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/** Colour a stop marker by its route's colour, brand gold when shared. */
function stopColour(stop, routes) {
  const serving = routes.filter((r) => r.stops?.some((s) => s.id === stop.id));
  if (serving.length === 1) return serving[0].colour;
  return '#c9a227';
}

/** divIcon "pin" for a live bus; the 🚌 glyph rotates to the heading. */
function busIcon(bus, selected) {
  const colour = bus.route?.colour || '#0ea5e9';
  const offline = bus.status === 'offline' || bus.lat == null;
  // The 🚌 emoji faces east (90°); rotate so the front points along the heading.
  const rotation = (Math.round(bus.heading || 0) - 90 + 360) % 360;
  return L.divIcon({
    className: `bus-marker-wrap${selected ? ' is-selected' : ''}${offline ? ' is-offline' : ''}`,
    html: `<div class="bus-marker-pin" style="--bus:${colour}"><span class="bus-glyph" style="transform:rotate(${rotation}deg)">🚌</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 35],
    popupAnchor: [0, -32],
  });
}

/** Hands the live map instance up to the parent for flyTo()/fitBounds(). */
function MapController({ onMap }) {
  const map = useMap();
  const ref = useRef(onMap);
  ref.current = onMap;
  useEffect(() => {
    ref.current?.(map);
  }, [map]);
  return null;
}

/** Fit the camera to all routes once, the first time they arrive. */
function FitToRoutes({ routes }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !routes || routes.length === 0) return;
    const pts = [];
    for (const r of routes) for (const p of r.path || []) pts.push([p.lat, p.lng]);
    for (const r of routes) for (const s of r.stops || []) pts.push([s.lat, s.lng]);
    if (pts.length < 2) return;
    map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: DEFAULT_ZOOM });
    done.current = true;
  }, [routes, map]);
  return null;
}

/**
 * Smoothly-animated bus marker.
 *
 * A single raw Leaflet marker is created per bus and then — on each
 * requestAnimationFrame — is eased toward the bus's current (target)
 * position. Because updates arrive every 3-5 s, this produces a glide
 * instead of a teleport, while costing almost nothing on low-end phones.
 *
 * Clicks use refs so the freshest bus object bubbles up, and the divIcon is
 * re-derived whenever the bus's look changes (route colour, heading,
 * selected/offline state). A bus with no GPS yet (lat/lng null) is hidden.
 */
function SmoothBusMarker({ bus, selected, onClick }) {
  const map = useMap();
  const markerRef = useRef(null);
  const current = useRef(null); // where the icon actually sits right now
  const target = useRef(null); // where it should glide towards
  const rafRef = useRef(0);
  const busRef = useRef(bus);
  busRef.current = bus;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // Create the marker once per busId.
  useEffect(() => {
    const start =
      bus.lat != null && bus.lng != null ? [bus.lat, bus.lng] : CENTER;
    const mk = L.marker(start, { icon: busIcon(bus, selected) });
    mk.on('click', () => onClickRef.current?.(busRef.current));
    mk.addTo(map);
    markerRef.current = mk;
    current.current = L.latLng(start);
    return () => {
      mk.remove();
      markerRef.current = null;
      current.current = null;
      target.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus.busId, map]);

  // Track the wanted position; hide buses with no fix yet.
  useEffect(() => {
    if (!markerRef.current) return;
    if (bus.lat == null || bus.lng == null) {
      markerRef.current.setOpacity(0);
      return;
    }
    markerRef.current.setOpacity(1);
    target.current = L.latLng(bus.lat, bus.lng);
  }, [bus.lat, bus.lng, bus.busId]);

  // Refresh the icon when the visual appearance changes.
  useEffect(() => {
    markerRef.current?.setIcon(busIcon(bus, selected));
  }, [bus.busId, selected, bus.status, bus.heading, bus.route?.colour]);

  // Ease toward the target each frame.
  useEffect(() => {
    const step = () => {
      const mk = markerRef.current;
      const t = target.current;
      if (mk && t) {
        const c = current.current;
        if (c && c.distanceTo(t) > 0.5) {
          // Move a fixed fraction of the gap each frame → smooth glide.
          const next = L.latLng(
            c.lat + (t.lat - c.lat) * 0.22,
            c.lng + (t.lng - c.lng) * 0.22
          );
          mk.setLatLng(next);
          current.current = next;
        } else if (c && (c.lat !== t.lat || c.lng !== t.lng)) {
          mk.setLatLng(t);
          current.current = t;
        } else if (!c) {
          mk.setLatLng(t);
          current.current = t;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return null;
}

export default function MapView({
  routes = [],
  hiddenRouteIds = new Set(),
  stops = [],
  busList = [],
  selectedBusId = null,
  myLoc = null,
  nearestStop = null, // { id, lat, lng, ... } → draws the walking line
  onBusClick,
  onStopClick,
  onToggleRoute,
  onMap,
}) {
  const visibleRoutes = useMemo(
    () => routes.filter((r) => !hiddenRouteIds.has(r.id)),
    [routes, hiddenRouteIds]
  );

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={CENTER}
        zoom={DEFAULT_ZOOM}
        maxZoom={MAX_ZOOM}
        className="student-map"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        <MapController onMap={onMap} />
        <FitToRoutes routes={routes} />

        {/* ---- route polylines ---- */}
        {visibleRoutes.map((r) => {
          if (!r.path || r.path.length < 2) return null;
          return (
            <Polyline
              key={r.id}
              positions={r.path.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: r.colour, weight: 4, opacity: 0.85 }}
            >
              <Tooltip sticky>
                <span style={{ color: r.colour }}>●</span> {r.name}
              </Tooltip>
            </Polyline>
          );
        })}

        {/* ---- walking line: device → nearest stop ---- */}
        {myLoc && nearestStop && (
          <Polyline
            positions={[
              [myLoc.lat, myLoc.lng],
              [nearestStop.lat, nearestStop.lng],
            ]}
            pathOptions={{
              color: '#0d9488',
              weight: 4,
              dashArray: '8 8',
              opacity: 0.85,
            }}
          />
        )}

        {/* ---- stop markers ---- */}
        {stops.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={6}
            pathOptions={{
              color: stopColour(s, routes),
              weight: 2,
              fillColor: '#fff',
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onStopClick?.(s) }}
          >
            <Tooltip>{s.name}</Tooltip>
            <Popup>
              <div className="text-sm">
                <div className="font-bold">{s.name}</div>
                <div className="text-xs text-slate-500">{s.code}</div>
                <button
                  className="mt-2 btn-primary !px-3 !py-1.5 !min-h-0 text-xs"
                  onClick={() => onStopClick?.(s)}
                >
                  View arrivals
                </button>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* ---- live bus markers (smoothly animated) ---- */}
        {busList.map((bus) => (
          <SmoothBusMarker
            key={bus.busId}
            bus={bus}
            selected={selectedBusId === bus.busId}
            onClick={onBusClick}
          />
        ))}

        {/* ---- "you" marker (device-only, never uploaded) ---- */}
        {myLoc && (
          <>
            <Circle
              center={[myLoc.lat, myLoc.lng]}
              radius={myLoc.accuracy || 15}
              pathOptions={{
                color: '#0d9488',
                weight: 1,
                opacity: 0.35,
                fillColor: '#0d9488',
                fillOpacity: 0.08,
              }}
            />
            <Marker position={[myLoc.lat, myLoc.lng]} icon={youIcon} />
          </>
        )}
      </MapContainer>

      {/* ---- route legend / visibility toggle (overlay, top-right) ---- */}
      {routes.length > 0 && (
        <div className="absolute top-2 right-2 z-[1000] card !rounded-xl p-2 space-y-1 text-xs shadow-lg max-w-[190px]">
          <div className="px-1 font-bold uppercase tracking-wide text-[10px] text-slate-500 dark:text-slate-400">
            Routes
          </div>
          {routes.map((r) => {
            const on = !hiddenRouteIds.has(r.id);
            return (
              <button
                key={r.id}
                className="w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-100 dark:hover:bg-night-700"
                onClick={() => onToggleRoute?.(r.id)}
                title={on ? `Hide ${r.name}` : `Show ${r.name}`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.colour }} />
                <span className={`truncate flex-1 ${on ? '' : 'opacity-40 line-through'}`}>
                  {r.name}
                </span>
                <span className="text-[10px] text-slate-400">{on ? 'on' : 'off'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


