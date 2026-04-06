import { useEffect, useRef, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Event } from '../types/event';
import type { LaunchPad } from '../types/launch';
import type { DecayObject } from '../types/decay';
import type { TipObject } from '../types/tip';
import type { Quake } from '../types/earthquake';
import type { Track } from '../types/track';
import { buildGeoJSON } from '../utils/geo';
import { getColor, getCategoryColor, getCategoryLabel, getSeverityLabel } from '../utils/classify';
import { formatDate, escapeHtml } from '../utils/format';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

interface Props {
  events:        Event[];
  loading:       boolean;
  pads?:         LaunchPad[];
  decayObjects?: DecayObject[];
  tipObjects?:   TipObject[];
  quakes?:       Quake[];
  airTracks?:    Track[];
  seaTracks?:    Track[];
  launches?:     import('../types/launch').Launch[];
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

function buildAirTracksGeoJSON(tracks: Track[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks.map(t => ({
      type:     'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] },
      properties: {
        id:           t.id,
        name:         t.name,
        callsign:     t.callsign,
        country:      t.country,
        color:        t.color,
        alt:          t.alt,
        altFt:        t.altFt,
        speed:        t.speed,
        track:        t.heading,
        milTier:      t.milTier,
        milScore:     t.milScore,
        milReasons:   JSON.stringify(t.milReasons || []),
        nearbyEvents: JSON.stringify((t as any).nearbyEvents || []),
        isHelicopter: t.isHelicopter ?? false,
      },
    })),
  };
}

function buildSeaTracksGeoJSON(tracks: Track[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks.map(t => ({
      type:     'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] },
      properties: {
        id:           t.id,
        name:         t.name,
        callsign:     t.callsign,
        country:      t.country,
        color:        t.color,
        cog:          t.cog,
        sog:          t.sog,
        heading:      t.heading,
        milTier:      t.milTier,
        milScore:     t.milScore,
        milReasons:   JSON.stringify(t.milReasons || []),
        nearbyEvents: JSON.stringify((t as any).nearbyEvents || []),
      },
    })),
  };
}

export function WorldMap({ events, loading, pads = [], decayObjects = [], tipObjects = [], quakes = [], airTracks = [], seaTracks = [], launches = [] }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<maplibregl.Map | null>(null);
  const popupRef      = useRef<maplibregl.Popup | null>(null);
  const mapLoadedRef  = useRef(false);
  const eventsRef     = useRef<Event[]>(events);
  const padsRef       = useRef<LaunchPad[]>(pads);
  const decayRef      = useRef<DecayObject[]>(decayObjects);
  const tipRef        = useRef<TipObject[]>(tipObjects);
  const quakesRef     = useRef<Quake[]>(quakes);
  const airTracksRef  = useRef<Track[]>(airTracks);
  const seaTracksRef  = useRef<Track[]>(seaTracks);
  const launchesRef   = useRef<import('../types/launch').Launch[]>(launches);

  // Keep refs current so the load handler can access latest data
  useEffect(() => { eventsRef.current = events;             }, [events]);
  useEffect(() => { padsRef.current   = pads;               }, [pads]);
  useEffect(() => { decayRef.current  = decayObjects;       }, [decayObjects]);
  useEffect(() => { tipRef.current    = tipObjects;         }, [tipObjects]);
  useEffect(() => { quakesRef.current = quakes;             }, [quakes]);
  useEffect(() => { airTracksRef.current = airTracks; }, [airTracks]);
  useEffect(() => { seaTracksRef.current = seaTracks; }, [seaTracks]);
  useEffect(() => { launchesRef.current    = launches;      }, [launches]);

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


      map.addSource('mil-aircraft', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource('mil-ships', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // FA Solid icons → canvas SDF (async car SVG blob → Image)
      // Phosphor fill icons — airplane-tilt pointe NE → -45°, boat symétrique → 0°, rocket → -45°
      Promise.all([
        phosphorToMapImage(map, 'aircraft-icon',   airplaneSvgRaw,   48, -45),
        phosphorToMapImage(map, 'helicopter-icon', helicopterSvgRaw, 48,   0),
        phosphorToMapImage(map, 'ship-icon',       boatSvgRaw,       48, -90, 242, 242),
        phosphorToMapImage(map, 'rocket-icon',     rocketSvgRaw,     40, -45),
      ]).then(() => {
        addLayers(map);
        bindEvents(map, popupRef.current!, launchesRef);
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
        if (airTracksRef.current.length > 0) {
          (map.getSource('mil-aircraft') as maplibregl.GeoJSONSource)
            .setData(buildAirTracksGeoJSON(airTracksRef.current));
        }
        if (seaTracksRef.current.length > 0) {
          (map.getSource('mil-ships') as maplibregl.GeoJSONSource)
            .setData(buildSeaTracksGeoJSON(seaTracksRef.current));
        }
      });
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

  // Update military aircraft layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    (map.getSource('mil-aircraft') as maplibregl.GeoJSONSource | undefined)?.setData(buildAirTracksGeoJSON(airTracks));
  }, [airTracks]);

  // Update sea tracks layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    (map.getSource('mil-ships') as maplibregl.GeoJSONSource | undefined)?.setData(buildSeaTracksGeoJSON(seaTracks));
  }, [seaTracks]);

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

// ── Icônes custom — silhouettes top-down style tracker AIS/ADS-B ─────────────
// Plane_icon.svg (Wikimedia Commons) — centré dans 256×256, pointe NE → pré-rotation -45°
const airplaneSvgRaw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g transform="translate(8.77 13.875)"><path fill="currentColor" fill-rule="evenodd" d="M194.67321 0 70.641958 53.625c-10.38227-6.92107-34.20058-21.27539-38.90545-23.44898-39.4400301-18.22079-36.9454001 14.73107-20.34925 24.6052 4.53917 2.70065 27.72352 17.17823 43.47345 26.37502l17.90625 133.9375 22.21875 13.15625 11.531252-120.9375 71.53125 36.6875 3.84375 39.21875 14.53125 8.625 11.09375-42.40625.125.0625 30.8125-31.53125-14.875-8-35.625 16.90625-68.28125-42.4375L217.36071 12.25 194.67321 0z"/></g></svg>`;
// ship-with-cargo-on-sea-svgrepo-com.svg — pointe vers la droite → pré-rotation -90°
const boatSvgRaw     = `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 484.966 484.966"><g><path style="fill:#010002;" d="M56.838,367.456c15.444-3.78,31.498-6.397,47.95-6.397c7.234,0,14.396,0.512,21.305,1.528c11.445,1.674,22.671,3.772,33.53,5.804c22.963,4.308,44.658,8.372,67.15,8.372c11.266,0,21.785-1.016,32.148-3.113c10.705-2.17,21.484-5.072,32.888-8.145c27.06-7.299,55.307-14.892,83.472-12.274c22.784,2.105,44.276,6.974,64.622,12.981l27.206-92.666c2.227-8.698-3.243-15.753-12.225-15.753h-42H78.265H40.329c-8.982,0-15.152,7.194-13.786,16.07L56.838,367.456z"/><rect x="136.515" y="209.119" style="fill:#010002;" width="59.607" height="35.563"/><rect x="209.672" y="209.119" style="fill:#010002;" width="59.607" height="35.563"/><rect x="63.358" y="209.119" style="fill:#010002;" width="59.607" height="35.563"/><rect x="136.515" y="160.348" style="fill:#010002;" width="59.607" height="35.563"/><rect x="63.358" y="160.348" style="fill:#010002;" width="59.607" height="35.563"/><rect x="209.672" y="160.348" style="fill:#010002;" width="59.607" height="35.563"/><rect x="136.515" y="111.576" style="fill:#010002;" width="59.607" height="35.563"/><rect x="63.358" y="111.576" style="fill:#010002;" width="59.607" height="35.563"/><path style="fill:#010002;" d="M312.637,200.991h29.807h8.129v8.129v35.563h89.414V158.99h18.289v-20.321h-18.289V102.09h-36.579V46.548h-18.964v55.543h-71.808v36.579h-18.289v20.321h18.289V200.991z M326.862,130.54v-12.193c0-2.243,1.829-4.064,4.064-4.064h12.193c2.235,0,4.064,1.821,4.064,4.064v12.193c0,2.243-1.829,4.064-4.064,4.064h-12.193C328.69,134.605,326.862,132.784,326.862,130.54z M408.147,130.54v-12.193c0-2.243,1.829-4.064,4.064-4.064h12.193c2.235,0,4.064,1.821,4.064,4.064v12.193c0,2.243-1.829,4.064-4.064,4.064h-12.193C409.976,134.605,408.147,132.784,408.147,130.54z M367.504,130.54v-12.193c0-2.243,1.829-4.064,4.064-4.064h12.193c0.244,0,0.447,0.098,0.675,0.138c1.902,0.333,3.39,1.926,3.39,3.926v12.193c0,2-1.479,3.593-3.39,3.926c-0.228,0.041-0.439,0.138-0.675,0.138h-12.193C369.333,134.605,367.504,132.784,367.504,130.54z"/><polygon style="fill:#010002;" points="342.444,244.682 342.444,209.119 312.637,209.119 282.829,209.119 282.829,244.682 312.637,244.682"/><path style="fill:#010002;" d="M17,438.418c2.17,0,4.495-0.423,6.909-1.252c28.702-9.892,54.803-18.086,83.684-18.086c10.234,0,20.143,1.016,30.303,3.097c32.571,6.69,65.963,13.55,102.062,11.144c27.385-1.845,54.868-8.95,81.448-15.81c6.617-1.707,13.233-3.422,19.834-5.048c8.031-1.983,16.623-2.991,25.54-2.991c29.369,0,59.022,10.787,85.179,20.305l9.291,3.365c2.471,0.878,4.837,1.333,7.039,1.333c9.307,0,14.892-8.202,16.306-16.33c1.488-8.535-1.211-20.094-13.697-24.556c-11.461-4.105-23.321-8.137-35.571-11.754c-19.5-5.755-39.993-10.413-61.533-12.404c-25.54-2.333-52.015,4.845-77.734,11.786c-11.152,3.008-22.679,6.121-33.904,8.389c-11.437,2.317-23.012,3.438-35.367,3.438c-24.004,0-47.471-4.398-70.158-8.649c-10.689-2.008-21.76-4.072-32.88-5.698c-6.129-0.894-12.51-1.357-18.956-1.357c-14.485,0-28.889,2.317-42.919,5.682c-16.655,3.991-32.774,9.486-47.788,14.664c-12.412,4.276-15.168,15.647-13.754,24.085C1.71,430.046,7.409,438.418,17,438.418z"/></g></svg>`;
import rocketSvgRaw   from '@phosphor-icons/core/assets/fill/rocket-launch-fill.svg?raw';

// ── Icône hélicoptère top-down (silhouette, pointe vers le nord / haut) ──────
// Nez en haut, pale de rotor principal horizontal, rotor de queue en bas.
const helicopterSvgRaw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <path fill="currentColor" d="
    M128,38 C110,38 96,56 96,90 L96,188 C96,200 110,212 128,212
             C146,212 160,200 160,188 L160,90 C160,56 146,38 128,38 Z
  "/>
  <rect fill="currentColor" x="8" y="106" width="240" height="18" rx="9"/>
  <circle fill="currentColor" cx="128" cy="115" r="14"/>
  <rect fill="currentColor" x="121" y="208" width="14" height="36" rx="5"/>
  <rect fill="currentColor" x="100" y="234" width="56" height="12" rx="6"/>
</svg>`;

// Rend un SVG Phosphor (fill="currentColor") sur canvas et l'enregistre comme SDF MapLibre.
// rotateDeg : pré-rotation pour orienter l'icône "nord = haut" (base de icon-rotate).
function phosphorToMapImage(
  map: maplibregl.Map,
  name: string,
  svgRaw: string,
  size: number,
  rotateDeg = 0,
  cx = 128,
  cy = 128,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Remplace currentColor et style="fill:..." par white, ajoute dimensions
    let svg = svgRaw
      .replace(/fill="currentColor"/g, 'fill="white"')
      .replace(/style="fill:[^"]*"/g, 'fill="white"')
      .replace('<svg ', `<svg width="${size}" height="${size}" `);
    // Applique la pré-rotation autour du centre du viewBox
    if (rotateDeg !== 0) {
      svg = svg.replace(/<svg([^>]*)>/, `<svg$1><g transform="rotate(${rotateDeg} ${cx} ${cy})">`).replace('</svg>', '</g></svg>');
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image(size, size);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const imgData = ctx.getImageData(0, 0, size, size);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; }
      }
      map.addImage(name, { width: size, height: size, data: new Uint8Array(d.buffer) }, { sdf: true });
      resolve();
    };
    img.onerror = reject;
    img.src = url;
  });
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


  // Military ships — silhouette navire SDF orientée selon le COG
  map.addLayer({
    id: 'mil-ships', type: 'symbol', source: 'mil-ships',
    layout: {
      'icon-image':              'ship-icon',
      'icon-size':               0.38,
      'icon-rotate':             ['-', ['get', 'cog'], ['*', ['floor', ['/', ['get', 'cog'], 180]], 180]],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap':      true,
      'icon-ignore-placement':   true,
    },
    paint: {
      'icon-color':   ['get', 'color'],
      'icon-opacity': 0.95,
      'icon-halo-color': 'rgba(0,0,0,0.65)',
      'icon-halo-width': 1.5,
    },
  });

  // Military ships — label nom (zoom 5+)
  map.addLayer({
    id: 'mil-ships-labels', type: 'symbol', source: 'mil-ships',
    minzoom: 5,
    layout: {
      'text-field':            ['get', 'name'],
      'text-font':             ['Noto Sans Regular'],
      'text-size':             9,
      'text-offset':           [0, 1.8],
      'text-anchor':           'top',
      'text-allow-overlap':    false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color':      ['get', 'color'],
      'text-opacity':    0.8,
      'text-halo-color': 'rgba(0,0,0,0.6)',
      'text-halo-width': 1,
    },
  });

  // Military aircraft — silhouette avion ou hélico selon isHelicopter
  map.addLayer({
    id: 'mil-aircraft', type: 'symbol', source: 'mil-aircraft',
    layout: {
      'icon-image': ['case', ['==', ['get', 'isHelicopter'], true], 'helicopter-icon', 'aircraft-icon'],
      'icon-size':               0.45,
      'icon-rotate':             ['get', 'track'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap':      true,
      'icon-ignore-placement':   true,
    },
    paint: {
      'icon-color':       ['get', 'color'],
      'icon-opacity':     0.95,
      'icon-halo-color':  'rgba(0,0,0,0.65)',
      'icon-halo-width':  1.5,
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

  // Launch pad — halo
  map.addLayer({
    id: 'pads-glow', type: 'circle', source: 'launch-pads',
    paint: {
      'circle-color':   ['case', ['get', 'hasUpcoming'], '#00d4ff', '#1a3a4a'],
      'circle-radius':  14,
      'circle-opacity': 0.12,
    },
  });

  // Launch pad — icône fusée
  map.addLayer({
    id: 'pads-icon', type: 'symbol', source: 'launch-pads',
    layout: {
      'icon-image':            'rocket-icon',
      'icon-size':             0.45,
      'icon-allow-overlap':    true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-color':      ['case', ['get', 'hasUpcoming'], '#00d4ff', '#2a5a7a'],
      'icon-opacity':    0.9,
      'icon-halo-color': 'rgba(0,0,0,0.6)',
      'icon-halo-width': 1.5,
    },
  });
}

function bindEvents(map: maplibregl.Map, popup: maplibregl.Popup, launchesRef: MutableRefObject<import('../types/launch').Launch[]>) {
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
  map.on('click', 'pads-icon', e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const color  = p.hasUpcoming ? '#00d4ff' : '#2a4a5a';

    // Retrouver le lancement correspondant à ce pad (par coordonnées)
    const padLon = coords[0];
    const padLat = coords[1];
    const launch = launchesRef.current
      .find(l => Math.abs(l.pad.lon - padLon) < 0.05 && Math.abs(l.pad.lat - padLat) < 0.05);

    // Countdown
    function countdown(net: string | null): string {
      if (!net) return '—';
      const diff = new Date(net).getTime() - Date.now();
      if (diff <= 0) return 'LAUNCHED';
      const d = Math.floor(diff / 86_400_000);
      const h = Math.floor((diff % 86_400_000) / 3_600_000);
      const m = Math.floor((diff % 3_600_000)  / 60_000);
      const hms = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      return d > 0 ? `T− ${d}J ${hms}` : `T− ${hms}`;
    }

    const missionBlock = launch ? `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid #0e1a24;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
          <span style="padding:2px 8px;font-size:9px;background:${launch.status.color}18;color:${launch.status.color};border:1px solid ${launch.status.color}44;">${launch.status.label}</span>
          ${launch.webcastLive ? '<span style="font-size:9px;color:#ff2244">● LIVE</span>' : ''}
          <span style="font-size:9px;color:${launch.status.color};margin-left:auto;">${countdown(launch.net)}</span>
        </div>
        <div style="color:#c8d8e8;font-size:10px;margin-bottom:4px;">${escapeHtml(launch.name)}</div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:2px;">
          ${escapeHtml(launch.rocket)}
          ${launch.mission.type    ? ' · ' + escapeHtml(launch.mission.type)  : ''}
          ${launch.mission.orbit   ? ' · ' + escapeHtml(launch.mission.orbit) : ''}
        </div>
        <div style="color:#4a6a7a;font-size:9px;">${escapeHtml(launch.provider)}</div>
        ${launch.mission.desc ? `<div style="margin-top:6px;color:#6a8a9a;font-size:9px;line-height:1.6;">${escapeHtml(launch.mission.desc.slice(0, 220))}${launch.mission.desc.length > 220 ? '…' : ''}</div>` : ''}
      </div>` : '';

    popup.setLngLat(coords).setHTML(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:240px;max-width:320px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">
            ${p.hasUpcoming ? 'LANCEMENT PRÉVU' : 'PAD ACTIF'}
          </span>
        </div>
        <p style="color:#c8d8e8;margin:0 0 4px 0;">${escapeHtml(p.name)}</p>
        <div style="font-size:9px;color:#4a6a7a;">◈ ${escapeHtml(p.country)}</div>
        ${missionBlock}
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
  map.on('mouseenter', 'pads-icon',    () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'pads-icon',    () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'decay-circles',   () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'decay-circles',   () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'tip-circles',     () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'tip-circles',     () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'quake-circles',   () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'quake-circles',   () => { map.getCanvas().style.cursor = ''; });

  // ── Helpers popup ────────────────────────────────────────────────────────
  function tierLabel(tier: string) {
    const map: Record<string, string> = {
      confirmed_military: '⬛ CONFIRMED MIL', likely_military: '▪ LIKELY MIL',
      possible_state: '◦ POSSIBLE STATE', unknown: '? UNKNOWN',
    };
    return map[tier] || tier;
  }
  function tierColor(tier: string) {
    return { confirmed_military: '#ff2244', likely_military: '#ff8800', possible_state: '#ffdd55', unknown: '#4a6a7a' }[tier] || '#4a6a7a';
  }
  // Military aircraft click
  map.on('click', 'mil-aircraft', async e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const tc     = tierColor(p.milTier);
    const altStr = p.altFt != null ? `${Number(p.altFt).toLocaleString()} ft` : '—';
    const spdStr = p.speed != null ? `${p.speed} kt` : '—';
    const capStr = p.track != null ? `${Math.round(p.track)}°` : '—';

    // Affichage immédiat avec placeholder photo
    popup.setLngLat(coords).setHTML(`
      <div id="ac-popup-${p.id}" style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:290px;max-width:340px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${tc}22;color:${tc};border:1px solid ${tc}55;">${tierLabel(p.milTier)}</span>
          <span style="padding:2px 8px;font-size:9px;background:#1a2a3a;color:#c8d8e8;border:1px solid #2a3a4a;">${escapeHtml(p.country)}</span>
          <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${p.milScore ?? ''}%</span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 6px 0;font-size:13px;letter-spacing:2px;">${escapeHtml(p.callsign || p.name)}</p>
        <div id="ac-photo-${p.id}" style="margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">ALTITUDE</span><br><span style="color:#c8d8e8;">${altStr}</span></div>
          <div><span style="color:#4a6a7a;">VITESSE</span><br><span style="color:#c8d8e8;">${spdStr}</span></div>
          <div><span style="color:#4a6a7a;">CAP</span><br><span style="color:#c8d8e8;">${capStr}</span></div>
        </div>
        <div style="margin-top:6px;font-size:9px;color:#4a6a7a;">${Number(coords[1]).toFixed(3)}°, ${Number(coords[0]).toFixed(3)}° — ICAO ${escapeHtml(p.id)}</div>
      </div>
    `).addTo(map);

    // Fetch photo async
    try {
      const resp = await fetch(`${RAILWAY_URL}/flights/aircraft?icao24=${p.id}`);
      const photo = await resp.json();
      const el = document.getElementById(`ac-photo-${p.id}`);
      if (el && photo?.thumbnail) {
        el.innerHTML = `<a href="${escapeHtml(photo.photoLink || '#')}" target="_blank" rel="noopener">
          <img src="${escapeHtml(photo.thumbnail)}" style="width:100%;border-radius:3px;border:1px solid #1a2a3a;" alt="photo"/>
          <div style="font-size:8px;color:#4a6a7a;margin-top:2px;">${escapeHtml(photo.aircraftType || '')} · ${escapeHtml(photo.registration || '')} · © ${escapeHtml(photo.photographer || '')}</div>
        </a>`;
      }
    } catch { /* photo non dispo */ }
  });

  map.on('mouseenter', 'mil-aircraft', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'mil-aircraft', () => { map.getCanvas().style.cursor = ''; });

  // Military ships click
  map.on('click', 'mil-ships', async e => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p      = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const tc     = tierColor(p.milTier);
    const sogStr = p.sog     != null ? `${Number(p.sog).toFixed(1)} kt` : '—';
    const cogStr = p.cog     != null ? `${Math.round(p.cog)}°` : '—';
    const hdgStr = p.heading != null ? `${Math.round(p.heading)}°` : '—';

    popup.setLngLat(coords).setHTML(`
      <div id="sh-popup-${p.id}" style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:290px;max-width:340px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${tc}22;color:${tc};border:1px solid ${tc}55;">${tierLabel(p.milTier)}</span>
          <span style="padding:2px 8px;font-size:9px;background:#1a2a3a;color:#c8d8e8;border:1px solid #2a3a4a;">${escapeHtml(p.country)}</span>
          <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${p.milScore ?? ''}%</span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 4px 0;font-size:13px;letter-spacing:1px;">${escapeHtml(p.name)}</p>
        ${p.callsign ? `<p style="color:#8ab4c8;margin:0 0 8px 0;font-size:10px;">MMSI ${escapeHtml(p.id)} · ${escapeHtml(p.callsign)}</p>` : `<p style="color:#4a6a7a;margin:0 0 8px 0;font-size:9px;">MMSI ${escapeHtml(p.id)}</p>`}
        <div id="sh-photo-${p.id}" style="margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">VITESSE</span><br><span style="color:#c8d8e8;">${sogStr}</span></div>
          <div><span style="color:#4a6a7a;">ROUTE</span><br><span style="color:#c8d8e8;">${cogStr}</span></div>
          <div><span style="color:#4a6a7a;">CAP VRAI</span><br><span style="color:#c8d8e8;">${hdgStr}</span></div>
        </div>
        <div style="margin-top:6px;font-size:9px;color:#4a6a7a;">${Number(coords[1]).toFixed(3)}°, ${Number(coords[0]).toFixed(3)}°</div>
      </div>
    `).addTo(map);

    // Fetch photo async (MarineTraffic avec fallback drapeau)
    try {
      const resp = await fetch(`${RAILWAY_URL}/ships/vessel?mmsi=${p.id}&country=${p.country || ''}`);
      const info = await resp.json();
      const el = document.getElementById(`sh-photo-${p.id}`);
      if (el && (info?.thumbnail || info?.flagUrl)) {
        const imgSrc   = info.thumbnail || info.flagUrl;
        const fallback = info.flagUrl || '';
        el.innerHTML = `<a href="${escapeHtml(info.photoLink || '#')}" target="_blank" rel="noopener">
          <img src="${escapeHtml(imgSrc)}"
               onerror="this.onerror=null;this.src='${escapeHtml(fallback)}';this.style.height='40px';this.style.width='auto';"
               style="width:100%;border-radius:3px;border:1px solid #1a2a3a;" alt="vessel"/>
          <div style="font-size:8px;color:#4a6a7a;margin-top:2px;">📷 MarineTraffic</div>
        </a>`;
      }
    } catch { /* photo non dispo */ }
  });

  map.on('mouseenter', 'mil-ships', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'mil-ships', () => { map.getCanvas().style.cursor = ''; });
}
