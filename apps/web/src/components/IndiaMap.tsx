'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type StyleSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type LngLatBoundsLike,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DesertCell } from '@/lib/desert/types';

export interface IndiaMapProps {
  cells: DesertCell[];
  selectedPincode: string | null;
  onSelect: (cell: DesertCell) => void;
}

const SOURCE_ID = 'desert-cells';
const CIRCLE_LAYER = 'desert-circles';
const SELECT_LAYER = 'desert-selected';

// CARTO Positron raster basemap — light, low-chrome, on-palette. A background layer
// underneath keeps the map on a soft blue if tiles ever fail to load.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#eaf2f8' } },
    { id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.95 } },
  ],
};

const INDIA_BOUNDS: LngLatBoundsLike = [
  [60, 4],
  [100, 40],
];

const DESERT_COLOR: (string | string[])[] = [
  'match',
  ['get', 'desert_state'],
  'covered', '#10b981',
  'medical_desert', '#f43f5e',
  'data_desert', '#94a3b8',
  '#94a3b8',
];

// Radius scales with facility density, clamped 4..14.
const RADIUS_EXPR: unknown[] = [
  'interpolate',
  ['linear'],
  ['get', 'facilities'],
  1, 4,
  10, 8,
  50, 14,
];

function toFeatureCollection(cells: DesertCell[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells
      .filter(c => c.lat != null && c.lng != null)
      .map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng as number, c.lat as number] },
        properties: {
          pincode: c.pincode,
          district: c.district ?? 'Unknown district',
          state: c.state ?? 'Unknown state',
          desert_state: c.desert_state,
          facilities: c.facilities_in_pin,
          yes: c.yes_count,
          trust: c.trust_weighted_yes,
        },
      })),
  };
}

const DESERT_LABELS: Record<string, string> = {
  covered: 'Covered',
  medical_desert: 'Medical desert',
  data_desert: 'Data desert',
};

/**
 * Frame the map on the queried region: fit to the bounding box of the cells that have
 * coordinates. Capped at maxZoom so a single-pincode region doesn't zoom absurdly far,
 * and padded so points never sit against the panel edge.
 */
function fitToCells(map: maplibregl.Map, cells: DesertCell[]) {
  const pts = cells.filter(c => c.lat != null && c.lng != null);
  if (pts.length === 0) return;
  const bounds = new maplibregl.LngLatBounds();
  pts.forEach(c => bounds.extend([c.lng as number, c.lat as number]));
  map.fitBounds(bounds, { padding: 56, maxZoom: 8.5, duration: 700 });
}

export default function IndiaMap({ cells, selectedPincode, onSelect }: IndiaMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  // Bumping this key forces the init effect to tear down and re-create the map (retry).
  const [reloadKey, setReloadKey] = useState(0);
  // Keep the latest cells/handler reachable from map event closures without re-binding.
  const cellsRef = useRef(cells);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    cellsRef.current = cells;
    onSelectRef.current = onSelect;
  });

  // Initialise the map once (re-runs on retry via reloadKey).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: MAP_STYLE,
        center: [79, 22.5],
        zoom: 4.2,
        minZoom: 3.2,
        maxZoom: 12,
        maxBounds: INDIA_BOUNDS,
        attributionControl: { compact: true },
        dragRotate: false,
      });
    } catch (err) {
      console.error('[IndiaMap] init failed', err);
      // Defer out of the effect body so we never setState synchronously during render/commit.
      queueMicrotask(() => setMapError('The map could not be created in this browser.'));
      return;
    }
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.scrollZoom.enable();
    map.touchZoomRotate.disableRotation();

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

    // Surface only hard failures that happen BEFORE the style finishes loading —
    // a blank white canvas. Transient tile 404s after load are ignored so a live
    // map is never torn down by a single missing tile.
    map.on('error', (e) => {
      if (!readyRef.current) {
        console.error('[IndiaMap] map error', e.error ?? e);
        setMapError('The map failed to load. Check your connection and retry.');
      }
    });

    map.on('load', () => {
      map.addSource(SOURCE_ID, { type: 'geojson', data: toFeatureCollection(cellsRef.current) });

      // Selected halo sits underneath the dots.
      map.addLayer({
        id: SELECT_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'pincode'], selectedPincode ?? ' '],
        paint: {
          'circle-radius': ['+', RADIUS_EXPR as never, 5],
          'circle-color': 'rgba(2,132,199,0)',
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 2.5,
        },
      });

      map.addLayer({
        id: CIRCLE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': RADIUS_EXPR as never,
          'circle-color': DESERT_COLOR as never,
          'circle-opacity': 0.7,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      });

      readyRef.current = true;
      setMapError(null);
      // A map created inside a deferred / animated / sticky panel can latch onto a
      // stale (or zero) drawing-buffer size. Force a resize once the style is live so
      // the WebGL canvas actually paints instead of staying blank white.
      map.resize();
      // Frame the region that was actually queried instead of the whole country.
      fitToCells(map, cellsRef.current);

      map.on('mouseenter', CIRCLE_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', CIRCLE_LAYER, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });

      map.on('mousemove', CIRCLE_LAYER, (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const p = f.properties as Record<string, unknown>;
        const label = DESERT_LABELS[String(p.desert_state)] ?? '—';
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-size:12px;line-height:1.5">
               <div style="font-weight:600;color:#0f172a">${p.pincode} · ${p.district}</div>
               <div style="color:#64748b">${p.state}</div>
               <div style="margin-top:4px;color:#334155">${label} · ${p.facilities} facilities · ${p.yes} confirmed</div>
             </div>`
          )
          .addTo(map);
      });

      map.on('click', CIRCLE_LAYER, (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const pincode = String((f.properties as Record<string, unknown>).pincode);
        const cell = cellsRef.current.find(c => c.pincode === pincode);
        if (cell) onSelectRef.current(cell);
      });
    });

    // Keep the drawing buffer in sync with the container. The panel is sticky and
    // fades in, so its final size can arrive a frame after the map is created.
    const ro = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.resize();
    });
    ro.observe(container);

    return () => {
      readyRef.current = false;
      ro.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // selectedPincode is intentionally captured at init only; a dedicated effect below
    // keeps the halo filter in sync afterwards.
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push new data into the existing source when cells change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (src) src.setData(toFeatureCollection(cells));
    fitToCells(map, cells);
  }, [cells]);

  // Update the selected halo filter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer(SELECT_LAYER)) return;
    map.setFilter(SELECT_LAYER, ['==', ['get', 'pincode'], selectedPincode ?? ' ']);
  }, [selectedPincode]);

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0 min-h-[380px]"
        aria-label="Map of pincode coverage across India"
        role="img"
      />
      {mapError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-50/95 backdrop-blur-sm p-6">
          <div className="max-w-xs text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">{mapError}</p>
            <button
              type="button"
              onClick={() => {
                setMapError(null);
                setReloadKey(k => k + 1);
              }}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </>
  );
}
