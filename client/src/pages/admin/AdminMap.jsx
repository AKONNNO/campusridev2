import { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Popup,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../student/leaflet.css';

/**
 * AdminMap — the map used across the dashboard.
 *
 * Supports three modes:
 *   'view'        live buses + routes + stops (Overview, Trips replay)
 *   'place-stop'  clicking the map sets draftPoint (Stops tab); the draft
 *                 marker is draggable and existing stops can be dragged to
 *                 copy/reposition the stop being edited
 *   'draw-route'  every click appends a point to routePoints (Routes tab);
 *                 clicking an existing stop toggles it in the route's ordered
 *                 stop list (a numbered badge shows its position)
 *
 * Everything the maps need is already in the admin data: routes carry
 * `path` (lat/lng polyline) and ordered `stops`; drawing overlays are passed
 * in as props and rendered on top. The live map instance is handed to the
 * parent via onMap so it can flyTo() a selected bus/stop.
 */

const CENTER = [6.6745, -1.5716];
const DEFAULT_ZOOM = 15;
const MAX_ZOOM = 19;

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function busIcon(bus, selected) {
  const colour = bus.route?.colour || '#0ea5e9';
  const rotation = (Math.round(bus.heading || 0) - 90 + 360) % 360;
  return L.divIcon({
    className: `bus-marker-wrap${selected ? ' is-selected' : ''}${
      bus.status === 'offline' || bus.lat == null ? ' is-offline' : ''
    }`,
    html: `<div class="bus-marker-pin" style="--bus:${colour}"><span class="bus-glyph" style="transform:rotate(${rotation}deg)">🚌</span></div>`,
    iconSize: selected ? [46, 46] : [36, 36],
    iconAnchor: selected ? [23, 45] : [18, 35],
  });
}

const draftIcon = L.divIcon({
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#0d9488;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);position:relative"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const rpIcon = L.divIcon({
  html: '<div style="width:13px;height:13px;border-radius:50%;background:#c9a227;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>',
  iconSize: [13, 13],
  iconAnchor: [6.5, 6.5],
});

/** Gold stop marker — used for draggable stops in place-stop mode. */
const stopIcon = L.divIcon({
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#c9a227;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:grab"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/** Numbered teal badge showing a stop's position in the route being edited. */
const stopNumIcon = (n) =>
  L.divIcon({
    html: `<div style="width:24px;height:24px;border-radius:50%;background:#0d9488;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)">${n}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

/** Hands the live map instance to the parent (for flyTo etc.). */
function MapHandoff({ onMap }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!done.current) {
      onMap?.(map);
      done.current = true;
    }
  }, [map, onMap]);
  return null;
}

function ClickHandler({ mode, onMapClick }) {
  useMapEvents({
    click(e) {
      if (mode !== 'view' && onMapClick) onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
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

export default function AdminMap({
  routes = [],
  stops = [],
  busList = [],
  selectedBusId = null,
  highlightStopId = null,
  onBusClick,
  onStopClick,
  onStopDrag,
  onDraftDragEnd,
  routeStopOrder = null,
  minHeight = 320,
  mode = 'view',
  draftPoint = null,
  routePoints = [],
  onMapClick,
  onMap,
}) {
  return (
    <div
      className="relative h-full w-full min-h-[320px] rounded-2xl overflow-hidden border border-slate-200 dark:border-night-700"
      style={{ minHeight }}
    >
      <MapContainer
        center={CENTER}
        zoom={DEFAULT_ZOOM}
        maxZoom={MAX_ZOOM}
        className="h-full w-full bg-slate-100 dark:bg-night"
      >
        <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        <FitToRoutes routes={routes} />
        <ClickHandler mode={mode} onMapClick={onMapClick} />
        <MapHandoff onMap={onMap} />

        {/* route geometry */}
        {routes.map((r) =>
          r.path && r.path.length > 1 ? (
            <Polyline
              key={r.id}
              positions={r.path.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: r.colour, weight: 4, opacity: 0.8 }}
            >
              <Tooltip sticky>{r.name}</Tooltip>
            </Polyline>
          ) : null
        )}

        {/* stops — in place-stop mode they are draggable Markers so the admin
            can grab any stop and pop it where they want; in draw-route mode
            every stop is clickable to toggle it in the route order. */}
        {stops.map((s) => {
          const order = routeStopOrder?.[s.id] ?? null;
          if (mode === 'place-stop') {
            return (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={stopIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => onStopDrag?.(s.id, e.target.getLatLng()),
                }}
              >
                <Tooltip>{s.name} — drag to reposition</Tooltip>
              </Marker>
            );
          }
          return (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lng]}
              radius={order ? 9 : highlightStopId === s.id ? 10 : 6}
              pathOptions={
                order
                  ? { color: '#0d9488', weight: 3, fillColor: '#0d9488', fillOpacity: 1 }
                  : { color: '#c9a227', weight: 2, fillColor: '#fff', fillOpacity: 1 }
              }
              eventHandlers={{
                click: (e) => {
                  // Don't let the click bubble to the map (that would also draw
                  // a route point when drawing a route).
                  L.DomEvent.stopPropagation(e.originalEvent);
                  onStopClick?.(s);
                },
              }}
            >
              <Tooltip>
                {order ? `${order}. ${s.name} — click to remove` : s.name}
              </Tooltip>
              <Popup>
                <div className="text-sm">
                  <div className="font-bold">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.code}</div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* numbered badges for stops already in the route order (draw-route) */}
        {mode === 'draw-route' &&
          routeStopOrder &&
          stops
            .filter((s) => routeStopOrder[s.id])
            .map((s) => (
              <Marker
                key={`order-${s.id}`}
                position={[s.lat, s.lng]}
                icon={stopNumIcon(routeStopOrder[s.id])}
                interactive={false}
                zIndexOffset={1000}
              />
            ))}

        {/* in-progress route drawing */}
        {routePoints.length > 0 && (
          <>
            <Polyline
              positions={routePoints.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: '#c9a227', weight: 4, dashArray: '6 6' }}
            />
            {routePoints.map((p, i) => (
              <Marker key={i} position={[p.lat, p.lng]} icon={rpIcon} />
            ))}
          </>
        )}

        {/* pending stop placement — draggable so the admin can fine-tune */}
        {draftPoint && (
          <Marker
            position={[draftPoint.lat, draftPoint.lng]}
            icon={draftIcon}
            draggable
            eventHandlers={{
              dragend: (e) => onDraftDragEnd?.(e.target.getLatLng()),
            }}
          />
        )}

        {/* live buses */}
        {busList.map((bus) =>
          bus.lat == null ? null : (
            <Marker
              key={bus.busId}
              position={[bus.lat, bus.lng]}
              icon={busIcon(bus, selectedBusId === bus.busId)}
              eventHandlers={{ click: () => onBusClick?.(bus) }}
            />
          )
        )}
      </MapContainer>
    </div>
  );
}
