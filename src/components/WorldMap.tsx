import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Event } from '../types/event';
import { buildGeoJSON } from '../utils/geo';
import { getColor, getCategoryColor, getCategoryLabel, getSeverityLabel } from '../utils/classify';
import { formatDate, escapeHtml } from '../utils/format';

interface Props {
  events:  Event[];
  loading: boolean;
}

export function WorldMap({ events, loading }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<maplibregl.Map | null>(null);
  const popupRef      = useRef<maplibregl.Popup | null>(null);
  const mapLoadedRef  = useRef(false);
  const eventsRef     = useRef<Event[]>(events);

  // Keep events ref current so the load handler can access latest data
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

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

      addLayers(map);
      bindEvents(map, popupRef.current!);
      mapLoadedRef.current = true;

      // Render events that already loaded before map was ready
      if (eventsRef.current.length > 0) {
        (map.getSource('events') as maplibregl.GeoJSONSource)
          .setData(buildGeoJSON(eventsRef.current) as Parameters<maplibregl.GeoJSONSource['setData']>[0]);
      }
    });

    return () => {
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update data when events change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const source = map.getSource('events') as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildGeoJSON(events) as Parameters<maplibregl.GeoJSONSource['setData']>[0]);
  }, [events]);

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

  map.on('mouseenter', 'events-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'events-circles', () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'clusters',       () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters',       () => { map.getCanvas().style.cursor = ''; });
}
