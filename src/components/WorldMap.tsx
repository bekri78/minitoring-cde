import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { Event } from '../types/event';
import type { LaunchPad, Launch } from '../types/launch';
import type { DecayObject } from '../types/decay';
import type { TipObject } from '../types/tip';
import type { Quake } from '../types/earthquake';
import type { Track } from '../types/track';
import { buildGeoJSON } from '../utils/geo';
import { getColor, getCategoryColor, getCategoryLabel, getSeverityLabel } from '../utils/classify';
import { formatDate, escapeHtml } from '../utils/format';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';
const QUAKE_MIN_MAG = 5.5;

interface Props {
  events:        Event[];
  loading:       boolean;
  pads?:         LaunchPad[];
  decayObjects?: DecayObject[];
  tipObjects?:   TipObject[];
  quakes?:       Quake[];
  airTracks?:    Track[];
  seaTracks?:    Track[];
  launches?:     Launch[];
}

// ── SVG icons ────────────────────────────────────────────────────────────────
const airplaneSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g transform="translate(8.77 13.875)"><path fill="COLOR" fill-rule="evenodd" d="M194.67321 0 70.641958 53.625c-10.38227-6.92107-34.20058-21.27539-38.90545-23.44898-39.4400301-18.22079-36.9454001 14.73107-20.34925 24.6052 4.53917 2.70065 27.72352 17.17823 43.47345 26.37502l17.90625 133.9375 22.21875 13.15625 11.531252-120.9375 71.53125 36.6875 3.84375 39.21875 14.53125 8.625 11.09375-42.40625.125.0625 30.8125-31.53125-14.875-8-35.625 16.90625-68.28125-42.4375L217.36071 12.25 194.67321 0z"/></g></svg>`;

const helicopterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="COLOR" d="M128,38 C110,38 96,56 96,90 L96,188 C96,200 110,212 128,212 C146,212 160,200 160,188 L160,90 C160,56 146,38 128,38 Z"/><rect fill="COLOR" x="8" y="106" width="240" height="18" rx="9"/><circle fill="COLOR" cx="128" cy="115" r="14"/><rect fill="COLOR" x="121" y="208" width="14" height="36" rx="5"/><rect fill="COLOR" x="100" y="234" width="56" height="12" rx="6"/></svg>`;

const shipSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160"><path fill="COLOR" d="M50 5 L80 60 L80 130 Q80 145 50 155 Q20 145 20 130 L20 60 Z"/><rect fill="COLOR" x="35" y="55" width="30" height="8" rx="2"/><rect fill="COLOR" x="35" y="40" width="30" height="12" rx="2"/></svg>`;

const rocketSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="COLOR" d="M128 24 C128 24 96 56 96 128 L96 176 L128 200 L160 176 L160 128 C160 56 128 24 128 24 Z"/><path fill="COLOR" d="M96 144 L64 168 L96 176 Z"/><path fill="COLOR" d="M160 144 L192 168 L160 176 Z"/><circle fill="COLOR" cx="128" cy="100" r="16"/></svg>`;

function makeSvgIcon(
  svgTemplate: string,
  color: string,
  size: number,
  rotateDeg = 0,
): L.DivIcon {
  const svg = svgTemplate
    .replace(/COLOR/g, color)
    .replace('<svg ', `<svg width="${size}" height="${size}" `);

  // pointer-events:none sur le SVG → le div externe intercepte le clic Leaflet
  const svgNoEvents = svg.replace('<svg ', '<svg style="pointer-events:none;" ');
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;transform:rotate(${rotateDeg}deg);transform-origin:center;filter:drop-shadow(0 0 2px rgba(0,0,0,0.8));cursor:pointer;">${svgNoEvents}</div>`,
    className: '',
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ── Popup HTML helpers ────────────────────────────────────────────────────────
function tierLabel(tier: string): string {
  const m: Record<string, string> = {
    confirmed_military: '⬛ CONFIRMED MIL',
    likely_military:    '▪ LIKELY MIL',
    possible_state:     '◦ POSSIBLE STATE',
    unknown:            '? UNKNOWN',
  };
  return m[tier] || tier;
}

function tierColor(tier: string): string {
  const m: Record<string, string> = {
    confirmed_military: '#ff2244',
    likely_military:    '#ff8800',
    possible_state:     '#ffdd55',
    unknown:            '#4a6a7a',
  };
  return m[tier] || '#4a6a7a';
}

function countdown(net: string | null): string {
  if (!net) return '—';
  const diff = new Date(net).getTime() - Date.now();
  if (diff <= 0) return 'LAUNCHED';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return d > 0 ? `T− ${d}J ${hms}` : `T− ${hms}`;
}

function mono(content: string): string {
  return `<div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:280px;max-width:340px;">${content}</div>`;
}

// ── Main component ────────────────────────────────────────────────────────────
export function WorldMap({
  events, loading,
  pads = [], decayObjects = [], tipObjects = [], quakes = [],
  airTracks = [], seaTracks = [], launches = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);

  // Layer groups
  const eventsClusterRef  = useRef<L.MarkerClusterGroup | null>(null);
  const aircraftLayerRef  = useRef<L.LayerGroup | null>(null);
  const shipsLayerRef     = useRef<L.LayerGroup | null>(null);
  const padsLayerRef      = useRef<L.LayerGroup | null>(null);
  const decayLayerRef     = useRef<L.LayerGroup | null>(null);
  const tipLayerRef       = useRef<L.LayerGroup | null>(null);
  const quakesLayerRef    = useRef<L.LayerGroup | null>(null);

  // Track currently open popup so we can re-open after layer refresh
  const openAircraftIdRef = useRef<string | null>(null);
  const openShipIdRef     = useRef<string | null>(null);

  // ── Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:           [20, 20],
      zoom:             2,
      minZoom:          2,
      maxZoom:          16,
      zoomControl:      false,
      doubleClickZoom:  false,
      closePopupOnClick: false, // empêche la map de fermer le popup au clic
    });

    L.tileLayer('https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      attribution: '© CartoDB',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // ── Layer groups ───────────────────────────────────────────────────────
    const eventsCluster = (L as any).markerClusterGroup({
      // Rayon réduit agressivement par zoom → dispersion rapide dès zoom 4-5
      maxClusterRadius: (zoom: number) => {
        if (zoom <= 2)  return 60;
        if (zoom <= 3)  return 40;
        if (zoom <= 4)  return 25;
        if (zoom <= 5)  return 15;
        if (zoom <= 6)  return 10;
        return 5;
      },
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom:   true,
      spiderfyDistanceMultiplier: 2,   // markers plus espacés au spiderfy
      animate:             true,
      animateAddingMarkers: false,     // pas d'animation à l'ajout → plus rapide
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        // Taille proportionnelle au count : 18px (2) → 36px (50+)
        const size  = count >= 50 ? 36 : count >= 20 ? 30 : count >= 10 ? 26 : count >= 3 ? 22 : 18;
        const color = count >= 30 ? '#ff2244' : count >= 10 ? '#ff6600' : count >= 3 ? '#ff8800' : '#ffaa00';
        const fs    = size <= 20 ? 9 : size <= 26 ? 10 : 12;
        return L.divIcon({
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color}cc;border:1px solid ${color};display:flex;align-items:center;justify-content:center;font-family:'Share Tech Mono',monospace;font-size:${fs}px;color:#fff;box-shadow:0 0 6px ${color}55;">${count}</div>`,
          className: '',
          iconSize:   [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    const aircraftLayer = L.layerGroup();
    const shipsLayer    = L.layerGroup();
    const padsLayer     = L.layerGroup();
    const decayLayer    = L.layerGroup();
    const tipLayer      = L.layerGroup();
    const quakesLayer   = L.layerGroup();

    eventsCluster.addTo(map);
    quakesLayer.addTo(map);
    decayLayer.addTo(map);
    tipLayer.addTo(map);
    padsLayer.addTo(map);
    shipsLayer.addTo(map);
    aircraftLayer.addTo(map);

    eventsClusterRef.current = eventsCluster;
    aircraftLayerRef.current  = aircraftLayer;
    shipsLayerRef.current     = shipsLayer;
    padsLayerRef.current      = padsLayer;
    decayLayerRef.current     = decayLayer;
    tipLayerRef.current       = tipLayer;
    quakesLayerRef.current    = quakesLayer;

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      eventsClusterRef.current = null;
      aircraftLayerRef.current = null;
      shipsLayerRef.current = null;
      padsLayerRef.current = null;
      decayLayerRef.current = null;
      tipLayerRef.current = null;
      quakesLayerRef.current = null;
    };
  }, []);

  // ── Update GDELT events ───────────────────────────────────────────────────
  useEffect(() => {
    const cluster = eventsClusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();

    const geoJSON = buildGeoJSON(events) as GeoJSON.FeatureCollection;
    (geoJSON.features || []).forEach(f => {
      const p = (f as GeoJSON.Feature<GeoJSON.Point>).properties || {};
      const [lon, lat] = (f as GeoJSON.Feature<GeoJSON.Point>).geometry.coordinates;
      const catColor = p.categoryColor || getCategoryColor(p.category || 'incident');
      const size     = Math.max(6, Math.min(p.size || 6, 16));

      const marker = L.circleMarker([lat, lon], {
        radius:      size,
        color:       catColor,
        fillColor:   catColor,
        fillOpacity: 0.88,
        weight:      0,
      });

      const tone      = Number(p.tone);
      const sevColor  = getColor(tone);
      const isAcled   = p.dataSource === 'acled';
      const sourceTag = isAcled
        ? `<span style="padding:2px 8px;font-size:9px;background:rgba(0,255,136,0.12);color:#00ff88;border:1px solid rgba(0,255,136,0.3);">ACLED</span>` : '';
      const fatalTag = isAcled && Number(p.fatalities) > 0
        ? `<span style="padding:2px 8px;font-size:9px;background:rgba(255,34,68,0.12);color:#ff2244;border:1px solid rgba(255,34,68,0.3);">☠ ${escapeHtml(String(p.fatalities))}</span>` : '';
      const actorsLine = isAcled && p.actor1
        ? `<div style="color:#4a6a7a;font-size:9px;margin-bottom:5px;">⚔ ${escapeHtml(p.actor1)}${p.actor2 ? ' <span style="color:#2a3a4a">vs</span> ' + escapeHtml(p.actor2) : ''}</div>` : '';
      const titleBlock = p.url
        ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" style="color:#e8f4ff;text-decoration:none;border-bottom:1px dotted #2a4a5a;">${escapeHtml(p.title || p.domain)}</a>`
        : `<span style="color:#c8d8e8;">${escapeHtml(p.title || p.domain)}</span>`;

      marker.bindPopup(mono(`
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;">
          ${sourceTag}
          <span style="padding:2px 8px;font-size:9px;background:${catColor}22;color:${catColor};border:1px solid ${catColor}55;">${getCategoryLabel(p.category || 'incident')}</span>
          <span style="padding:2px 8px;font-size:9px;background:${sevColor}22;color:${sevColor};border:1px solid ${sevColor}55;">${getSeverityLabel(tone)}</span>
          ${fatalTag}
        </div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">📍 ${escapeHtml(p.country)}</div>
        ${actorsLine}
        <p style="color:#c8d8e8;line-height:1.5;margin:0 0 8px 0;font-size:11px;">${titleBlock}</p>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
          ${escapeHtml(formatDate(p.date))} &nbsp;·&nbsp; ${escapeHtml(p.domain)}
        </div>
      `), { maxWidth: 360 });

      cluster.addLayer(marker);
    });
  }, [events]);

  // ── Update military aircraft ──────────────────────────────────────────────
  useEffect(() => {
    const layer = aircraftLayerRef.current;
    if (!layer) return;

    // Sauvegarder l'ID du popup ouvert avant de vider la couche
    const wasOpenId = openAircraftIdRef.current;
    layer.clearLayers();

    const markerById = new Map<string, L.Marker>();

    airTracks.forEach(t => {
      if (t.lat == null || t.lon == null) return;
      const isHeli = (t as any).isHelicopter;
      const svg    = isHeli ? helicopterSvg : airplaneSvg;
      const icon   = makeSvgIcon(svg, t.color || '#4a9eff', 28, t.heading ?? 0);

      const marker = L.marker([t.lat, t.lon], { icon, zIndexOffset: 500 });

      const tc     = tierColor(t.milTier || '');
      const altStr = t.altFt != null ? `${Number(t.altFt).toLocaleString()} ft` : '—';
      const spdStr = t.speed != null ? `${t.speed} kt` : '—';
      const capStr = t.heading != null ? `${Math.round(t.heading)}°` : '—';
      const popId  = `ac-${t.id}`;

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${tc}22;color:${tc};border:1px solid ${tc}55;">${tierLabel(t.milTier || '')}</span>
          <span style="padding:2px 8px;font-size:9px;background:#1a2a3a;color:#c8d8e8;border:1px solid #2a3a4a;">${escapeHtml(t.country || '')}</span>
          <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${(t as any).milScore ?? ''}%</span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 6px 0;font-size:13px;letter-spacing:2px;">${escapeHtml(t.callsign || t.name || t.id)}</p>
        <div id="${popId}-photo" style="margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">ALTITUDE</span><br><span style="color:#c8d8e8;">${altStr}</span></div>
          <div><span style="color:#4a6a7a;">VITESSE</span><br><span style="color:#c8d8e8;">${spdStr}</span></div>
          <div><span style="color:#4a6a7a;">CAP</span><br><span style="color:#c8d8e8;">${capStr}</span></div>
        </div>
        <div style="margin-top:6px;font-size:9px;color:#4a6a7a;">${t.lat.toFixed(3)}°, ${t.lon.toFixed(3)}° — ICAO ${escapeHtml(t.id)}</div>
      `), { maxWidth: 360 });

      // Suivre quel popup est ouvert pour le ré-ouvrir après refresh
      marker.on('popupopen', async () => {
        openAircraftIdRef.current = t.id;
        try {
          const res   = await fetch(`${RAILWAY_URL}/flights/aircraft?icao24=${t.id}`);
          const photo = await res.json();
          const el    = document.getElementById(`${popId}-photo`);
          if (el && photo?.thumbnail) {
            el.innerHTML = `<a href="${escapeHtml(photo.photoLink || '#')}" target="_blank" rel="noopener">
              <img src="${escapeHtml(photo.thumbnail)}" style="width:100%;max-height:110px;object-fit:cover;border-radius:3px;border:1px solid #1a2a3a;" alt="photo"/>
              <div style="font-size:8px;color:#4a6a7a;margin-top:2px;">${escapeHtml(photo.aircraftType || '')} · ${escapeHtml(photo.registration || '')} · © ${escapeHtml(photo.photographer || '')}</div>
            </a>`;
          }
        } catch { /* pas de photo */ }
      });
      marker.on('popupclose', () => { openAircraftIdRef.current = null; });

      layer.addLayer(marker);
      markerById.set(t.id, marker);
    });

    // Ré-ouvrir le popup si la couche a été vidée pendant qu'il était ouvert
    if (wasOpenId) {
      const m = markerById.get(wasOpenId);
      if (m) setTimeout(() => m.openPopup(), 0);
    }
  }, [airTracks]);

  // ── Update military ships ─────────────────────────────────────────────────
  useEffect(() => {
    const layer = shipsLayerRef.current;
    if (!layer) return;

    const wasOpenId = openShipIdRef.current;
    layer.clearLayers();

    const markerById = new Map<string, L.Marker>();

    seaTracks.forEach(t => {
      if (t.lat == null || t.lon == null) return;
      const icon   = makeSvgIcon(shipSvg, t.color || '#60ddff', 26, t.cog ?? t.heading ?? 0);
      const marker = L.marker([t.lat, t.lon], { icon, zIndexOffset: 400 });

      const tc     = tierColor(t.milTier || '');
      const sogStr = t.sog     != null ? `${Number(t.sog).toFixed(1)} kt` : '—';
      const cogStr = t.cog     != null ? `${Math.round(t.cog)}°` : '—';
      const hdgStr = t.heading != null ? `${Math.round(t.heading)}°` : '—';
      const popId  = `sh-${t.id}`;

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${tc}22;color:${tc};border:1px solid ${tc}55;">${tierLabel(t.milTier || '')}</span>
          <span style="padding:2px 8px;font-size:9px;background:#1a2a3a;color:#c8d8e8;border:1px solid #2a3a4a;">${escapeHtml(t.country || '')}</span>
          <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${(t as any).milScore ?? ''}%</span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 4px 0;font-size:13px;letter-spacing:1px;">${escapeHtml(t.name || t.id)}</p>
        ${t.callsign ? `<p style="color:#8ab4c8;margin:0 0 8px 0;font-size:10px;">MMSI ${escapeHtml(t.id)} · ${escapeHtml(t.callsign)}</p>` : `<p style="color:#4a6a7a;margin:0 0 8px 0;font-size:9px;">MMSI ${escapeHtml(t.id)}</p>`}
        <div id="${popId}-photo" style="margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">VITESSE</span><br><span style="color:#c8d8e8;">${sogStr}</span></div>
          <div><span style="color:#4a6a7a;">ROUTE</span><br><span style="color:#c8d8e8;">${cogStr}</span></div>
          <div><span style="color:#4a6a7a;">CAP VRAI</span><br><span style="color:#c8d8e8;">${hdgStr}</span></div>
        </div>
        <div style="margin-top:6px;font-size:9px;color:#4a6a7a;">${t.lat.toFixed(3)}°, ${t.lon.toFixed(3)}°</div>
      `), { maxWidth: 360 });

      marker.on('popupopen', async () => {
        openShipIdRef.current = t.id;
        try {
          const res  = await fetch(`${RAILWAY_URL}/ships/vessel?mmsi=${t.id}&country=${t.country || ''}`);
          const info = await res.json();
          const el   = document.getElementById(`${popId}-photo`);
          if (el && (info?.thumbnail || info?.flagUrl)) {
            const imgSrc = info.thumbnail || info.flagUrl;
            el.innerHTML = `<a href="${escapeHtml(info.photoLink || '#')}" target="_blank" rel="noopener">
              <img src="${escapeHtml(imgSrc)}" style="width:100%;max-height:110px;object-fit:cover;border-radius:3px;border:1px solid #1a2a3a;" alt="navire"/>
              ${info.vesselName ? `<div style="font-size:8px;color:#4a6a7a;margin-top:2px;">${escapeHtml(info.vesselName)} · ${escapeHtml(info.flag || '')}</div>` : ''}
            </a>`;
          }
        } catch { /* pas de photo */ }
      });
      marker.on('popupclose', () => { openShipIdRef.current = null; });

      layer.addLayer(marker);
      markerById.set(t.id, marker);
    });

    if (wasOpenId) {
      const m = markerById.get(wasOpenId);
      if (m) setTimeout(() => m.openPopup(), 0);
    }
  }, [seaTracks]);

  // ── Update launch pads ────────────────────────────────────────────────────
  useEffect(() => {
    const layer = padsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    pads.filter(p => p.lat && p.lon).forEach(p => {
      const color = p.hasUpcoming ? '#00d4ff' : '#2a5a7a';
      const icon  = makeSvgIcon(rocketSvg, color, 22);
      const marker = L.marker([p.lat, p.lon], { icon, zIndexOffset: 300 });

      const launch = launches.find(l =>
        Math.abs(l.pad.lon - p.lon) < 0.05 && Math.abs(l.pad.lat - p.lat) < 0.05
      );

      const missionBlock = launch ? `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #0e1a24;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
            <span style="padding:2px 8px;font-size:9px;background:${launch.status.color}18;color:${launch.status.color};border:1px solid ${launch.status.color}44;">${launch.status.label}</span>
            ${launch.webcastLive ? '<span style="font-size:9px;color:#ff2244">● LIVE</span>' : ''}
            <span style="font-size:9px;color:${launch.status.color};margin-left:auto;">${countdown(launch.net)}</span>
          </div>
          ${launch.image ? `<img src="${escapeHtml(launch.image)}" style="width:100%;max-height:110px;object-fit:cover;border-radius:3px;margin-bottom:6px;border:1px solid #1a2a3a;" onerror="this.style.display='none'"/>` : ''}
          <div style="color:#c8d8e8;font-size:10px;margin-bottom:4px;">${escapeHtml(launch.name)}</div>
          <div style="color:#4a6a7a;font-size:9px;">${escapeHtml(launch.rocket)}${launch.mission.type ? ' · ' + escapeHtml(launch.mission.type) : ''}${launch.mission.orbit ? ' · ' + escapeHtml(launch.mission.orbit) : ''}</div>
          ${launch.mission.desc ? `<div style="margin-top:6px;color:#6a8a9a;font-size:9px;line-height:1.6;">${escapeHtml(launch.mission.desc.slice(0, 220))}${launch.mission.desc.length > 220 ? '…' : ''}</div>` : ''}
        </div>` : '';

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">
            ${p.hasUpcoming ? 'LANCEMENT PRÉVU' : 'PAD ACTIF'}
          </span>
        </div>
        <p style="color:#c8d8e8;margin:0 0 4px 0;">${escapeHtml(p.name)}</p>
        <div style="font-size:9px;color:#4a6a7a;">◈ ${escapeHtml(p.country)}</div>
        ${missionBlock}
      `), { maxWidth: 360 });

      layer.addLayer(marker);
    });
  }, [pads, launches]);

  // ── Update decay objects ──────────────────────────────────────────────────
  useEffect(() => {
    const layer = decayLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    decayObjects.forEach(o => {
      if (!o.lat || !o.lon) return;
      const color = o.color || '#ffaa00';
      const daysLabel = o.daysLeft != null
        ? o.daysLeft < 1 ? '< 24H' : `${o.daysLeft.toFixed(1)}J`
        : '—';

      const marker = L.circleMarker([o.lat, o.lon], {
        radius:      6,
        color:       '#ffffff',
        weight:      1,
        fillColor:   color,
        fillOpacity: 0.95,
      });

      const epoch = o.decayEpoch
        ? new Date(o.decayEpoch).toUTCString().replace(' GMT', ' UTC') : '—';

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">RENTRÉE ATMOSPHÉRIQUE</span>
          <span style="margin-left:auto;font-size:12px;color:${color};">${daysLabel}</span>
        </div>
        <p style="color:#c8d8e8;margin:0 0 6px 0;font-size:12px;">${escapeHtml(o.name)}</p>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:8px;">${escapeHtml(o.objectId)} · ${escapeHtml(o.country)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">INCLINAISON</span><br><span style="color:#c8d8e8;">${o.inclination}°</span></div>
          <div><span style="color:#4a6a7a;">FENÊTRE</span><br><span style="color:#c8d8e8;">±${o.window}h</span></div>
          <div><span style="color:#4a6a7a;">APOGÉE</span><br><span style="color:#c8d8e8;">${o.apogee} km</span></div>
          <div><span style="color:#4a6a7a;">PÉRIGÉE</span><br><span style="color:#c8d8e8;">${o.perigee} km</span></div>
        </div>
        <div style="margin-top:8px;font-size:9px;color:#4a6a7a;">Rentrée prévue : <span style="color:#8aabbb;">${escapeHtml(epoch)}</span></div>
      `), { maxWidth: 340 });

      layer.addLayer(marker);
    });
  }, [decayObjects]);

  // ── Update TIP objects ────────────────────────────────────────────────────
  useEffect(() => {
    const layer = tipLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    tipObjects.forEach(o => {
      if (!o.lat || !o.lon) return;
      const color      = o.color || '#ffaa00';
      const hoursLabel = o.hoursLeft != null
        ? o.hoursLeft < 1 ? '< 1H' : `${o.hoursLeft.toFixed(1)}H`
        : '—';

      // Outer ring + inner dot via two overlaid circleMarkers
      L.circleMarker([o.lat, o.lon], {
        radius: 10, color, weight: 2, fillColor: 'transparent', fillOpacity: 0,
      }).addTo(layer);

      const marker = L.circleMarker([o.lat, o.lon], {
        radius: 4, color: '#ffffff', weight: 1, fillColor: color, fillOpacity: 1,
      });

      const epoch  = o.decayEpoch
        ? new Date(o.decayEpoch).toUTCString().replace(' GMT', ' UTC') : '—';
      const hiTag  = o.highInterest
        ? `<span style="padding:2px 8px;font-size:9px;background:rgba(255,34,68,0.15);color:#ff2244;border:1px solid rgba(255,34,68,0.4);">⚠ HIGH INTEREST</span>` : '';

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">TIP — RENTRÉE IMMINENTE</span>
          <span style="margin-left:auto;font-size:12px;color:${color};">${hoursLabel}</span>
          ${hiTag}
        </div>
        <p style="color:#c8d8e8;margin:0 0 4px 0;font-size:12px;">${escapeHtml(o.name)}</p>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:8px;">${escapeHtml(o.objectId)} · ${escapeHtml(o.objectType)} · ${escapeHtml(o.country)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">INCLINAISON</span><br><span style="color:#c8d8e8;">${o.inclination}°</span></div>
          <div><span style="color:#4a6a7a;">FENÊTRE</span><br><span style="color:#c8d8e8;">±${o.window} min</span></div>
        </div>
        <div style="margin-top:8px;font-size:9px;color:#4a6a7a;">Rentrée prévue : <span style="color:#8aabbb;">${escapeHtml(epoch)}</span></div>
      `), { maxWidth: 340 });

      layer.addLayer(marker);
    });
  }, [tipObjects]);

  // ── Update earthquakes ────────────────────────────────────────────────────
  useEffect(() => {
    const layer = quakesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    quakes.filter(q => q.mag >= QUAKE_MIN_MAG).forEach(q => {
      const color  = q.color || '#ffaa00';
      const radius = q.mag >= 7.5 ? 22 : q.mag >= 6.5 ? 14 : 8;

      const marker = L.circleMarker([q.lat, q.lon], {
        radius,
        color:       color,
        weight:      1,
        fillColor:   color,
        fillOpacity: 0.18,
      });

      const alertTag   = q.alert && q.alert !== 'green'
        ? `<span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">PAGER ${q.alert.toUpperCase()}</span>` : '';
      const tsunamiTag = q.tsunami
        ? `<span style="padding:2px 8px;font-size:9px;background:rgba(0,212,255,0.12);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);">🌊 TSUNAMI</span>` : '';
      const titleBlock = q.url
        ? `<a href="${escapeHtml(q.url)}" target="_blank" rel="noopener" style="color:#e8f4ff;text-decoration:none;border-bottom:1px dotted #2a4a5a;">${escapeHtml(q.place)}</a>`
        : `<span style="color:#c8d8e8;">${escapeHtml(q.place)}</span>`;
      const epoch = q.time ? new Date(q.time).toUTCString().replace(' GMT', ' UTC') : '—';

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="padding:2px 8px;font-size:9px;background:${color}18;color:${color};border:1px solid ${color}44;">SÉISME M${q.mag.toFixed(1)}</span>
          ${alertTag}${tsunamiTag}
        </div>
        <p style="color:#c8d8e8;margin:0 0 8px 0;font-size:11px;">${titleBlock}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">PROFONDEUR</span><br><span style="color:#c8d8e8;">${q.depth} km</span></div>
          <div><span style="color:#4a6a7a;">COORDONNÉES</span><br><span style="color:#c8d8e8;">${q.lat.toFixed(2)}°, ${q.lon.toFixed(2)}°</span></div>
        </div>
        <div style="margin-top:8px;font-size:9px;color:#4a6a7a;">${escapeHtml(epoch)}</div>
      `), { maxWidth: 340 });

      layer.addLayer(marker);
    });
  }, [quakes]);

  // ── Render ────────────────────────────────────────────────────────────────
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
          pointerEvents: 'none',
        }}>
          LOADING INTEL FEED...
        </div>
      )}
    </div>
  );
}
