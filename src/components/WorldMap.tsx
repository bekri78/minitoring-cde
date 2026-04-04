import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Event } from '../types/event';
import type { LaunchPad } from '../types/launch';
import type { DecayObject } from '../types/decay';
import type { TipObject } from '../types/tip';
import type { Quake } from '../types/earthquake';
import type { MilAircraft } from '../types/aircraft';
import { buildGeoJSON } from '../utils/geo';
import { getColor, getCategoryColor, getCategoryLabel, getSeverityLabel } from '../utils/classify';
import { formatDate, escapeHtml } from '../utils/format';

interface Props {
  events:        Event[];
  loading:       boolean;
  pads?:         LaunchPad[];
  decayObjects?: DecayObject[];
  tipObjects?:   TipObject[];
  quakes?:       Quake[];
  milAircraft?:  MilAircraft[];
}

function buildDecayGeoJSON(objects: DecayObject[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: objects.map(o => ({
      type:     'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [o.lon, o.lat] },
      properties: {
        id:          o.id,
        name:        o.name,
        objectId:    o.objectId,
        decayEpoch:  o.decayEpoch,
        window:      o.window,
        inclination: o.inclination,
        apogee:      o.apogee,
        perigee:     o.perigee,
        country:     o.country,
        daysLeft:    o.daysLeft,
        color:       o.color,
      },
    })),
  };
}

function buildTipGeoJSON(objects: TipObject[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: objects.map(o => ({
      type:     'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [o.lon, o.lat] },
      properties: {
        id:          o.id,
        name:        o.name,
        objectId:    o.objectId,
        objectType:  o.objectType,
        decayEpoch:  o.decayEpoch,
        window:      o.window,
        inclination: o.inclination,
        direction:   o.direction,
        country:     o.country,
        highInterest: o.highInterest,
        hoursLeft:   o.hoursLeft,
        color:       o.color,
      },
    })),
  };
}

const QUAKE_MIN_MAG = 5.5; // afficher uniquement M5.5+ sur la carte

function buildQuakeGeoJSON(quakes: Quake[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: quakes
      .filter(q => q.mag >= QUAKE_MIN_MAG)
      .map(q => ({
        type:     'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [q.lon, q.lat] },
        properties: {
          id:      q.id,
          mag:     q.mag,
          place:   q.place,
          time:    q.time,
          depth:   q.depth,
          tsunami: q.tsunami,
          alert:   q.alert,
          url:     q.url,
          color:   q.color,
        },
      })),
  };
}

function buildPadsGeoJSON(pads: LaunchPad[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pads
      .filter(p => p.lat && p.lon)
      .map(p => ({
        type:     'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: {
          name:        p.name,
          country:     p.country,
          hasUpcoming: p.hasUpcoming,
        },
      })),
  };
}

function buildMilTrailsGeoJSON(aircraft: MilAircraft[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: aircraft
      .filter(a => a.trail.length >= 2)
      .map(a => ({
        type:     'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: a.trail },
        properties: { id: a.id, color: a.color },
      })),
  };
}

function buildMilPointsGeoJSON(aircraft: MilAircraft[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: aircraft.map(a => ({
      type:     'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [a.lon, a.lat] },
      properties: {
        id:       a.id,
        callsign: a.callsign,
        country:  a.country,
        color:    a.color,
        alt:      a.alt,
        altFt:    a.altFt,
        speed:    a.speed,
        track:    a.track,
      },
    })),
  };
}

export function WorldMap({ events, loading, pads = [], decayObjects = [], tipObjects = [], quakes = [], milAircraft = [] }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<maplibregl.Map | null>(null);
  const popupRef      = useRef<maplibregl.Popup | null>(null);
  const mapLoadedRef  = useRef(false);
  const eventsRef     = useRef<Event[]>(events);
  const padsRef       = useRef<LaunchPad[]>(pads);
  const decayRef      = useRef<DecayObject[]>(decayObjects);
  const tipRef        = useRef<TipObject[]>(tipObjects);
  const quakesRef     = useRef<Quake[]>(quakes);
  const milAircraftRef = useRef<MilAircraft[]>(milAircraft);

  // Keep refs current so the load handler can access latest data
  useEffect(() => { eventsRef.current = events;             }, [events]);
  useEffect(() => { padsRef.current   = pads;               }, [pads]);
  useEffect(() => { decayRef.current  = decayObjects;       }, [decayObjects]);
  useEffect(() => { tipRef.current    = tipObjects;         }, [tipObjects]);
  useEffect(() => { quakesRef.current = quakes;             }, [quakes]);
  useEffect(() => { milAircraftRef.current = milAircraft;   }, [milAircraft]);

  // Initialize MapLibre once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© CartoDB',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
      },
      center:  [20, 20],
      zoom:    2,
      minZoom: 1.5,
      maxZoom: 16,
    });

    mapRef.current   = map;
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '380px' });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');

    map.on('load', () => {
      map.addSource('events', {
        type:          'geojson',
        data:          { type: 'FeatureCollection', features: [] },
        cluster:       true,
        clusterMaxZoom: 7,
        clusterRadius:  25,
      });

      map.addSource('launch-pads', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource('decay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource('tip', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource('earthquakes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource('mil-trails', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource('mil-aircraft', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      addLayers(map);
      bindEvents(map, popupRef.current!);
      mapLoadedRef.current = true;

      // Render data that already loaded before map was ready
      if (eventsRef.current.length > 0) {
        (map.getSource('events') as maplibregl.GeoJSONSource)
          .setData(buildGeoJSON(eventsRef.current) as Parameters<maplibregl.GeoJSONSource['setData']>[0]);
      }
      if (padsRef.current.length > 0) {
        (map.getSource('launch-pads') as maplibregl.GeoJSONSource)
          .setData(buildPadsGeoJSON(padsRef.current));
      }
      if (decayRef.current.length > 0) {
        (map.getSource('decay') as maplibregl.GeoJSONSource)
          .setData(buildDecayGeoJSON(decayRef.current));
      }
      if (tipRef.current.length > 0) {
        (map.getSource('tip') as maplibregl.GeoJSONSource)
          .setData(buildTipGeoJSON(tipRef.current));
      }
      if (quakesRef.current.length > 0) {
        (map.getSource('earthquakes') as maplibregl.GeoJSONSource)
          .setData(buildQuakeGeoJSON(quakesRef.current));
      }
      if (milAircraftRef.current.length > 0) {
        (map.getSource('mil-trails') as maplibregl.GeoJSONSource)
          .setData(buildMilTrailsGeoJSON(milAircraftRef.current));
        (map.getSource('mil-aircraft') as maplibregl.GeoJSONSource)
          .setData(buildMilPointsGeoJSON(milAircraftRef.current));
      }
    });

    return () => {
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update events layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const source = map.getSource('events') as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildGeoJSON(events) as Parameters<maplibregl.GeoJSONSource['setData']>[0]);
  }, [events]);

  // Update launch pads layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !pads.length) return;
    const source = map.getSource('launch-pads') as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildPadsGeoJSON(pads));
  }, [pads]);

  // Update decay layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const source = map.getSource('decay') as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildDecayGeoJSON(decayObjects));
  }, [decayObjects]);

  // Update TIP layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const source = map.getSource('tip') as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildTipGeoJSON(tipObjects));
  }, [tipObjects]);

  // Update earthquakes layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const source = map.getSource('earthquakes') as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildQuakeGeoJSON(quakes));
  }, [quakes]);

  // Update military aircraft layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    (map.getSource('mil-trails')   as maplibregl.GeoJSONSource | undefined)?.setData(buildMilTrailsGeoJSON(milAircraft));
    (map.getSource('mil-aircraft') as maplibregl.GeoJSONSource | undefined)?.setData(buildMilPointsGeoJSON(milAircraft));
  }, [milAircraft]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={{
          position:      'absolute',
          top:           '50%',
          left:          '50%',
          transform:     'translate(-50%, -50%)',
          fontFamily:    "'Share Tech Mono', monospace",
          fontSize:      '13px',
          color:         '#00d4ff',
          letterSpacing: '3px',
          animation:     'blink 1s infinite',
          pointerEvents: 'none',
        }}>
          LOADING INTEL FEED...
        </div>
      )}
    </div>
  );
}

function addLayers(map: maplibregl.Map) {
  map.addLayer({
    id: 'clusters-glow', type: 'circle', source: 'events',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color':  ['step', ['get', 'point_count'], 'rgba(255,170,0,0.12)', 3, 'rgba(255,100,0,0.12)', 10, 'rgba(255,60,0,0.12)', 30, 'rgba(255,34,68,0.12)'],
      'circle-radius': ['step', ['get', 'point_count'], 24, 3, 32, 10, 42, 30, 56],
      'circle-opacity': 1, 'circle-stroke-width': 0,
    },
  });

  map.addLayer({
    id: 'clusters', type: 'circle', source: 'events',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color':        ['step', ['get', 'point_count'], 'rgba(255,170,0,0.92)', 3, 'rgba(255,100,0,0.92)', 10, 'rgba(255,60,0,0.92)', 30, 'rgba(255,34,68,0.92)'],
      'circle-radius':       ['step', ['get', 'point_count'], 14, 3, 18, 10, 24, 30, 32],
      'circle-opacity':       1,
      'circle-stroke-width':  1,
      'circle-stroke-color': ['step', ['get', 'point_count'], 'rgba(255,170,0,0.4)', 3, 'rgba(255,100,0,0.4)', 10, 'rgba(255,60,0,0.4)', 30, 'rgba(255,34,68,0.4)'],
    },
  });

  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'events',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font':  ['Noto Sans Regular'],
      'text-size':  ['step', ['get', 'point_count'], 10, 10, 12, 30, 14],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  });

  map.addLayer({
    id: 'events-glow', type: 'circle', source: 'events',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color':        ['get', 'categoryColor'],
      'circle-radius':       ['*', ['get', 'size'], 2],
      'circle-opacity':       0.12,
      'circle-stroke-width':  0,
    },
  });

  map.addLayer({
    id: 'events-circles', type: 'circle', source: 'events',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color':        ['get', 'categoryColor'],
      'circle-radius':       ['get', 'size'],
      'circle-opacity':       0.92,
      'circle-stroke-width':  0,
    },
  });

  // Decay — halo de danger (pulsation visuelle via opacité forte)
  map.addLayer({
    id: 'decay-glow', type: 'circle', source: 'decay',
    paint: {
      'circle-color':   ['get', 'color'],
      'circle-radius':  14,
      'circle-opacity': 0.18,
      'circle-stroke-width': 0,
    },
  });

  // Decay — marker principal (triangle simulé via cercle + stroke)
  map.addLayer({
    id: 'decay-circles', type: 'circle', source: 'decay',
    paint: {
      'circle-color':        ['get', 'color'],
      'circle-radius':       6,
      'circle-opacity':      0.95,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.3,
    },
  });

  // Decay — label "⚠" affiché au-dessus du marker
  map.addLayer({
    id: 'decay-labels', type: 'symbol', source: 'decay',
    layout: {
      'text-field':             '⚠',
      'text-font':              ['Noto Sans Regular'],
      'text-size':              10,
      'text-offset':            [0, -1.4],
      'text-allow-overlap':     true,
      'text-ignore-placement':  true,
    },
    paint: { 'text-color': ['get', 'color'], 'text-opacity': 0.9 },
  });

  // TIP — halo large (position orbitale réelle de rentrée)
  map.addLayer({
    id: 'tip-glow', type: 'circle', source: 'tip',
    paint: {
      'circle-color':   ['get', 'color'],
      'circle-radius':  20,
      'circle-opacity': 0.12,
      'circle-stroke-width': 0,
    },
  });

  // TIP — anneau extérieur (crosshair visuel)
  map.addLayer({
    id: 'tip-ring', type: 'circle', source: 'tip',
    paint: {
      'circle-color':        'rgba(0,0,0,0)',
      'circle-radius':       10,
      'circle-stroke-width': 2,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-opacity': 0.7,
    },
  });

  // TIP — point central
  map.addLayer({
    id: 'tip-circles', type: 'circle', source: 'tip',
    paint: {
      'circle-color':        ['get', 'color'],
      'circle-radius':       4,
      'circle-opacity':      1,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.5,
    },
  });

  // TIP — label "◎" (cible)
  map.addLayer({
    id: 'tip-labels', type: 'symbol', source: 'tip',
    layout: {
      'text-field':            '◎',
      'text-font':             ['Noto Sans Regular'],
      'text-size':             12,
      'text-offset':           [0, -1.8],
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': ['get', 'color'], 'text-opacity': 0.9 },
  });

  // Earthquakes — halo sismique (radius proportionnel à la magnitude)
  map.addLayer({
    id: 'quake-glow', type: 'circle', source: 'earthquakes',
    paint: {
      'circle-color':        ['get', 'color'],
      'circle-radius':       ['interpolate', ['linear'], ['get', 'mag'], 5.5, 12, 6.5, 22, 7.5, 38],
      'circle-opacity':      0.10,
      'circle-stroke-width': 0,
    },
  });

  // Earthquakes — triangle ▲ (distinct des cercles d'événements)
  map.addLayer({
    id: 'quake-circles', type: 'symbol', source: 'earthquakes',
    layout: {
      'text-field':            '▲',
      'text-font':             ['Noto Sans Regular'],
      'text-size':             ['interpolate', ['linear'], ['get', 'mag'], 5.5, 12, 6.5, 18, 7.5, 26],
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color':   ['get', 'color'],
      'text-opacity': 0.92,
      'text-halo-color': 'rgba(0,0,0,0.55)',
      'text-halo-width': 1,
    },
  });

  // Earthquakes — label magnitude (M6.5+)
  map.addLayer({
    id: 'quake-labels', type: 'symbol', source: 'earthquakes',
    filter: ['>=', ['get', 'mag'], 6.5],
    layout: {
      'text-field':            ['concat', 'M', ['number-format', ['get', 'mag'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }]],
      'text-font':             ['Noto Sans Regular'],
      'text-size':             9,
      'text-offset':           [0, -2.2],
      'text-allow-overlap':    false,
      'text-ignore-placement': false,
    },
    paint: { 'text-color': ['get', 'color'], 'text-opacity': 0.9 },
  });

  // Military aircraft — traînée de positions
  map.addLayer({
    id: 'mil-trail-lines', type: 'line', source: 'mil-trails',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color':   ['get', 'color'],
      'line-opacity': 0.35,
      'line-width':   1.5,
    },
  });

  // Military aircraft — icône ✈ orientée selon le cap
  map.addLayer({
    id: 'mil-aircraft', type: 'symbol', source: 'mil-aircraft',
    layout: {
      'text-field':            '✈',
      'text-font':             ['Noto Sans Regular'],
      'text-size':             13,
      'text-rotate':           ['get', 'track'],
      'text-rotation-alignment': 'map',
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color':       ['get', 'color'],
      'text-opacity':     0.95,
      'text-halo-color':  'rgba(0,0,0,0.7)',
      'text-halo-width':  1,
    },
  });

  // Military aircraft — label callsign (zoom 5+)
  map.addLayer({
    id: 'mil-aircraft-labels', type: 'symbol', source: 'mil-aircraft',
    minzoom: 5,
    layout: {
      'text-field':            ['get', 'callsign'],
      'text-font':             ['Noto Sans Regular'],
      'text-size':             9,
      'text-offset':           [0, 1.6],
      'text-anchor':           'top',
      'text-allow-overlap':    false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color':       ['get', 'color'],
      'text-opacity':     0.75,
      'text-halo-color':  'rgba(0,0,0,0.6)',
      'text-halo-width':  1,
    },
  });

  // Launch pad — glow ring
  map.addLayer({
    id: 'pads-glow', type: 'circle', source: 'launch-pads',
    paint: {
      'circle-color':   ['case', ['get', 'hasUpcoming'], '#00d4ff', '#1a3a4a'],
      'circle-radius':  8,
      'circle-opacity': 0.15,
    },
  });

  // Launch pad — marker
  map.addLayer({
    id: 'pads-circles', type: 'circle', source: 'launch-pads',
    paint: {
      'circle-color':        ['case', ['get', 'hasUpcoming'], 'rgba(0,212,255,0.85)', 'rgba(26,58,74,0.85)'],
      'circle-radius':       4,
      'circle-stroke-width': 1,
      'circle-stroke-color': ['case', ['get', 'hasUpcoming'], '#00d4ff', '#2a4a5a'],
    },
  });
}

function bindEvents(map: maplibregl.Map, popup: maplibregl.Popup) {
  map.on('click', 'events-circles', e => {
    const feature = e.features?.[0];
    if (!feature) return;

    const p     = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const tone   = Number(p.tone);
    const sevColor = getColor(tone);
    const catColor = p.categoryColor || getCategoryColor(p.category || 'incident');
    const isAcled  = p.dataSource === 'acled';

    const sourceTag = isAcled
      ? `<span style="padding:2px 8px;font-size:9px;background:rgba(0,255,136,0.12);color:#00ff88;border:1px solid rgba(0,255,136,0.3);">ACLED</span>`
      : '';

    const fatalitiesTag = isAcled && Number(p.fatalities) > 0
      ? `<span style="padding:2px 8px;font-size:9px;background:rgba(255,34,68,0.12);color:#ff2244;border:1px solid rgba(255,34,68,0.3);">☠ ${escapeHtml(p.fatalities)}</span>`
      : '';

    const actorsLine = isAcled && p.actor1
      ? `<div style="color:#4a6a7a;font-size:9px;margin-bottom:5px;">⚔ ${escapeHtml(p.actor1)}${p.actor2 ? ' <span style="color:#2a3a4a">vs</span> ' + escapeHtml(p.actor2) : ''}</div>`
      : '';

    const titleBlock = p.url
      ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="color:#e8f4ff;text-decoration:none;border-bottom:1px dotted #2a4a5a;">${escapeHtml(p.title || p.domain)}</a>`
      : `<span style="color:#c8d8e8;">${escapeHtml(p.title || p.domain)}</span>`;

    popup.setLngLat(coords).setHTML(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:290px;max-width:340px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;">
          ${sourceTag}
          <span style="padding:2px 8px;font-size:9px;background:${catColor}22;color:${catColor};border:1px solid ${catColor}55;">${getCategoryLabel(p.category || 'incident')}</span>
          <span style="padding:2px 8px;font-size:9px;background:${sevColor}22;color:${sevColor};border:1px solid ${sevColor}55;">${getSeverityLabel(tone)}</span>
          ${fatalitiesTag}
        </div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">📍 ${escapeHtml(p.country)}</div>
        ${actorsLine}
        <p style="color:#c8d8e8;line-height:1.5;margin:0 0 8px 0;font-size:11px;">${titleBlock}</p>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
          ${escapeHtml(formatDate(p.date))} &nbsp;·&nbsp; ${escapeHtml(p.domain)}
        </div>
      </div>
    `).addTo(map);
  });

  map.on('click', 'clusters', e => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
    if (!features.length) return;
    const clusterId = features[0].properties?.cluster_id as number;
    const source    = map.getSource('events') as maplibregl.GeoJSONSource;
    if (!source) return;
    (source.getClusterExpansionZoom(clusterId) as unknown as Promise<number>)
      .then((zoom: number) => {
        map.easeTo({
          center:   (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
          zoom:     Math.max(zoom, 8),
          duration: 400,
        });
      })
      .catch(() => {});
  });

  // Decay click
  map.on('click', 'decay-circles', e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const color  = p.color || '#ffaa00';

    const daysLabel = p.daysLeft != null
      ? p.daysLeft < 1
        ? `<span style="color:${color};font-weight:bold;">< 24H</span>`
        : `<span style="color:${color};">${Number(p.daysLeft).toFixed(1)}J</span>`
      : '—';

    const epoch = p.decayEpoch
      ? new Date(p.decayEpoch).toUTCString().replace(' GMT', ' UTC')
      : '—';

    popup.setLngLat(coords).setHTML(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:280px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;letter-spacing:1px;">
            RENTRÉE ATMOSPHÉRIQUE
          </span>
          <span style="margin-left:auto;font-size:12px;">${daysLabel}</span>
        </div>
        <p style="color:#c8d8e8;margin:0 0 6px 0;font-size:12px;">${escapeHtml(p.name)}</p>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:8px;">${escapeHtml(p.objectId)} &nbsp;·&nbsp; ${escapeHtml(p.country)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">INCLINAISON</span><br><span style="color:#c8d8e8;">${p.inclination}°</span></div>
          <div><span style="color:#4a6a7a;">FENÊTRE</span><br><span style="color:#c8d8e8;">±${p.window}h</span></div>
          <div><span style="color:#4a6a7a;">APOGÉE</span><br><span style="color:#c8d8e8;">${p.apogee} km</span></div>
          <div><span style="color:#4a6a7a;">PÉRIGÉE</span><br><span style="color:#c8d8e8;">${p.perigee} km</span></div>
        </div>
        <div style="margin-top:8px;font-size:9px;color:#4a6a7a;">
          Rentrée prévue : <span style="color:#8aabbb;">${escapeHtml(epoch)}</span>
        </div>
        <div style="margin-top:4px;font-size:8px;color:#2a4a5a;">
          ◈ Position indicative — pays de lancement (${escapeHtml(p.country)})
        </div>
      </div>
    `).addTo(map);
  });

  // TIP click
  map.on('click', 'tip-circles', e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const color  = p.color || '#ffaa00';

    const hoursLabel = p.hoursLeft != null
      ? p.hoursLeft < 1
        ? `<span style="color:${color};font-weight:bold;">< 1H</span>`
        : `<span style="color:${color};">${Number(p.hoursLeft).toFixed(1)}H</span>`
      : '—';

    const epoch = p.decayEpoch
      ? new Date(p.decayEpoch).toUTCString().replace(' GMT', ' UTC')
      : '—';

    const hiTag = p.highInterest
      ? `<span style="padding:2px 8px;font-size:9px;background:rgba(255,34,68,0.15);color:#ff2244;border:1px solid rgba(255,34,68,0.4);">⚠ HIGH INTEREST</span>`
      : '';

    popup.setLngLat(coords).setHTML(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:290px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;letter-spacing:1px;">
            TIP — RENTRÉE IMMINENTE
          </span>
          <span style="margin-left:auto;font-size:12px;">${hoursLabel}</span>
          ${hiTag}
        </div>
        <p style="color:#c8d8e8;margin:0 0 4px 0;font-size:12px;">${escapeHtml(p.name)}</p>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:8px;">
          ${escapeHtml(p.objectId)} &nbsp;·&nbsp; ${escapeHtml(p.objectType)} &nbsp;·&nbsp; ${escapeHtml(p.country)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">INCLINAISON</span><br><span style="color:#c8d8e8;">${p.inclination}°</span></div>
          <div><span style="color:#4a6a7a;">FENÊTRE</span><br><span style="color:#c8d8e8;">±${p.window} min</span></div>
          <div><span style="color:#4a6a7a;">DIRECTION</span><br><span style="color:#c8d8e8;">${escapeHtml(p.direction) || '—'}</span></div>
          <div><span style="color:#4a6a7a;">POSITION</span><br><span style="color:#c8d8e8;">${Number(p.lat ?? coords[1]).toFixed(2)}°, ${Number(p.lon ?? coords[0]).toFixed(2)}°</span></div>
        </div>
        <div style="margin-top:8px;font-size:9px;color:#4a6a7a;">
          Rentrée prévue : <span style="color:#8aabbb;">${escapeHtml(epoch)}</span>
        </div>
        <div style="margin-top:4px;font-size:8px;color:#2a4a5a;">
          ◎ Position orbitale au moment de la rentrée (Space-Track TIP)
        </div>
      </div>
    `).addTo(map);
  });

  // Launch pad click
  map.on('click', 'pads-circles', e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const color  = p.hasUpcoming ? '#00d4ff' : '#2a4a5a';
    popup.setLngLat(coords).setHTML(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:200px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">
            ${p.hasUpcoming ? 'LANCEMENT PRÉVU' : 'PAD ACTIF'}
          </span>
        </div>
        <p style="color:#c8d8e8;margin:0 0 6px 0;">${escapeHtml(p.name)}</p>
        <div style="font-size:9px;color:#4a6a7a;">◈ ${escapeHtml(p.country)}</div>
      </div>
    `).addTo(map);
  });

  // Earthquake click
  map.on('click', 'quake-circles', e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const color  = p.color || '#ffaa00';
    const mag    = Number(p.mag);

    const alertTag = p.alert && p.alert !== 'green'
      ? `<span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">PAGER ${p.alert.toUpperCase()}</span>`
      : '';

    const tsunamiTag = p.tsunami
      ? `<span style="padding:2px 8px;font-size:9px;background:rgba(0,212,255,0.12);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);">🌊 TSUNAMI</span>`
      : '';

    const titleBlock = p.url
      ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="color:#e8f4ff;text-decoration:none;border-bottom:1px dotted #2a4a5a;">${escapeHtml(p.place)}</a>`
      : `<span style="color:#c8d8e8;">${escapeHtml(p.place)}</span>`;

    const epoch = p.time ? new Date(p.time).toUTCString().replace(' GMT', ' UTC') : '—';

    popup.setLngLat(coords).setHTML(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:280px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;letter-spacing:1px;">
            SÉISME M${mag.toFixed(1)}
          </span>
          ${alertTag}${tsunamiTag}
        </div>
        <p style="color:#c8d8e8;margin:0 0 8px 0;font-size:11px;">${titleBlock}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">PROFONDEUR</span><br><span style="color:#c8d8e8;">${p.depth} km</span></div>
          <div><span style="color:#4a6a7a;">COORDONNÉES</span><br><span style="color:#c8d8e8;">${Number(coords[1]).toFixed(2)}°, ${Number(coords[0]).toFixed(2)}°</span></div>
        </div>
        <div style="margin-top:8px;font-size:9px;color:#4a6a7a;">
          ${escapeHtml(epoch)}
        </div>
      </div>
    `).addTo(map);
  });

  map.on('mouseenter', 'events-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'events-circles', () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'clusters',       () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters',       () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'pads-circles',    () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'pads-circles',    () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'decay-circles',   () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'decay-circles',   () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'tip-circles',     () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'tip-circles',     () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'quake-circles',   () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'quake-circles',   () => { map.getCanvas().style.cursor = ''; });

  // Military aircraft click
  map.on('click', 'mil-aircraft', e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const color  = p.color || '#4a9eff';
    const altStr = p.altFt  != null ? `${Number(p.altFt).toLocaleString()} ft` : '—';
    const spdStr = p.speed  != null ? `${p.speed} kt` : '—';
    const capStr = p.track  != null ? `${Math.round(p.track)}°` : '—';
    popup.setLngLat(coords).setHTML(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:260px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;letter-spacing:1px;">
            ✈ MILITAIRE
          </span>
          <span style="padding:2px 8px;font-size:9px;background:#1a2a3a;color:#c8d8e8;border:1px solid #2a3a4a;">
            ${escapeHtml(p.country)}
          </span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 10px 0;font-size:13px;letter-spacing:2px;">${escapeHtml(p.callsign)}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">ALTITUDE</span><br><span style="color:#c8d8e8;">${altStr}</span></div>
          <div><span style="color:#4a6a7a;">VITESSE</span><br><span style="color:#c8d8e8;">${spdStr}</span></div>
          <div><span style="color:#4a6a7a;">CAP</span><br><span style="color:#c8d8e8;">${capStr}</span></div>
        </div>
        <div style="margin-top:8px;font-size:9px;color:#4a6a7a;">
          ${Number(coords[1]).toFixed(3)}°, ${Number(coords[0]).toFixed(3)}° — ICAO ${escapeHtml(p.id)}
        </div>
      </div>
    `).addTo(map);
  });

  map.on('mouseenter', 'mil-aircraft', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'mil-aircraft', () => { map.getCanvas().style.cursor = ''; });
}
