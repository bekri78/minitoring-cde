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
import type { NavalEvent } from '../types/maritime';
import type { NewsEvent } from '../types/news';
import { buildGeoJSON } from '../utils/geo';
import { getCategoryColor, getCategoryLabel } from '../utils/classify';
import { formatDate, escapeHtml } from '../utils/format';
import { useFilterStore } from '../store/filterStore';
import helicopterSvgRaw from '../assets/helicoptere.svg?raw';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';
const QUAKE_MIN_MAG = 5.5;
const HELICOPTER_COLOR = '#ffb000';

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
  navalEvents?:  NavalEvent[];
  newsEvents?:   NewsEvent[];
}

// ── SVG icons ────────────────────────────────────────────────────────────────
const airplaneSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g transform="translate(8.77 13.875)"><path fill="COLOR" fill-rule="evenodd" d="M194.67321 0 70.641958 53.625c-10.38227-6.92107-34.20058-21.27539-38.90545-23.44898-39.4400301-18.22079-36.9454001 14.73107-20.34925 24.6052 4.53917 2.70065 27.72352 17.17823 43.47345 26.37502l17.90625 133.9375 22.21875 13.15625 11.531252-120.9375 71.53125 36.6875 3.84375 39.21875 14.53125 8.625 11.09375-42.40625.125.0625 30.8125-31.53125-14.875-8-35.625 16.90625-68.28125-42.4375L217.36071 12.25 194.67321 0z"/></g></svg>`;

const helicopterSvg = helicopterSvgRaw
  .replace(/<\?xml[\s\S]*?\?>/g, '')
  .replace(/<!DOCTYPE[\s\S]*?>/g, '')
  .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
  .replace(/fill="[^"]*"/g, 'fill="COLOR"');

const shipSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 612" fill="COLOR"><g><path d="M612,342.869l-72.243,150.559c-9.036,17.516-27.098,28.521-46.808,28.521H66.974c-7.85,0-12.942-8.277-9.402-15.285l0.179-0.355c5.778-11.439,2.35-25.383-8.074-32.836l-0.589-0.422c-24.197-17.305-38.554-45.225-38.554-74.973v-34.141h379.228v-0.211c0-11.52,9.338-20.857,20.856-20.857H612L612,342.869z M368.693,216.46h-73.738c-5.818,0-10.534,4.716-10.534,10.534v115.875c0,5.818,4.716,10.535,10.534,10.535h73.738c5.817,0,10.534-4.717,10.534-10.535V226.994C379.228,221.176,374.511,216.46,368.693,216.46z M495.102,258.596h-84.272c-5.817,0-10.534,4.716-10.534,10.534v42.135c0,5.818,4.717,10.535,10.534,10.535h84.272c5.818,0,10.534-4.717,10.534-10.535V269.13C505.636,263.312,500.92,258.596,495.102,258.596z M168.545,353.402h84.272c5.818,0,10.534-4.717,10.534-10.533v-84.273c0-5.818-4.716-10.534-10.534-10.534h-84.272c-5.818,0-10.534,4.716-10.534,10.534v84.273C158.012,348.686,162.728,353.402,168.545,353.402z M163.155,195.391l-26.211,21.069v136.942H31.602V216.46H0v-21.069h73.738v-30.546H46.506v-12.296h27.232V90.051h10.534v62.498h27.233v12.296H84.272v30.546H163.155z M117.913,282.062h-34.28v31.457h34.28V282.062z M117.913,231.651h-34.28v31.458h34.28V231.651z"/></g></svg>`;

const rocketSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="COLOR" d="M128 24 C128 24 96 56 96 128 L96 176 L128 200 L160 176 L160 128 C160 56 128 24 128 24 Z"/><path fill="COLOR" d="M96 144 L64 168 L96 176 Z"/><path fill="COLOR" d="M160 144 L192 168 L160 176 Z"/><circle fill="COLOR" cx="128" cy="100" r="16"/></svg>`;

const anchorSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>`;

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
// Naval activity type → color & label (GDELT-based)
const NAVAL_STYLE: Record<string, { color: string; label: string }> = {
  naval_exercise:     { color: '#ffdd55', label: 'EXERCICE NAVAL' },
  fleet_deployment:   { color: '#ff8800', label: 'DÉPLOIEMENT' },
  maritime_incident:  { color: '#ff2244', label: 'INCIDENT' },
  chokepoint_tension: { color: '#ff4466', label: 'DÉTROIT' },
  logistics_operation:{ color: '#4a9eff', label: 'LOGISTIQUE' },
  port_call:          { color: '#60ddff', label: 'ESCALE' },
  maritime_activity:  { color: '#cc44ff', label: 'ACTIVITÉ NAVALE' },
};

export function WorldMap({
  events, loading,
  pads = [], decayObjects = [], tipObjects = [], quakes = [],
  airTracks = [], seaTracks = [], launches = [],
  navalEvents = [],
  newsEvents  = [],
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
  const maritimeLayerRef  = useRef<L.LayerGroup | null>(null);
  const airOsintLayerRef   = useRef<L.LayerGroup | null>(null);
  const seaOsintLayerRef   = useRef<L.LayerGroup | null>(null);
  const spaceOsintLayerRef = useRef<L.LayerGroup | null>(null);
  const newsLayerRef        = useRef<L.LayerGroup | null>(null);

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
      maxClusterRadius: (zoom: number) => {
        if (zoom <= 3) return 60;
        if (zoom <= 5) return 25;
        if (zoom <= 6) return 10;
        return 5;
      },
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom:   true,
      spiderfyDistanceMultiplier: 2,
      animate:             true,
      animateAddingMarkers: false,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const size  = 36;
        return L.divIcon({
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#ff440033;border:1px solid #ff4400;display:flex;align-items:center;justify-content:center;font-family:'Share Tech Mono',monospace;font-size:12px;color:#ff8800;">${count}</div>`,
          className: '',
          iconSize:   [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    const aircraftLayer  = L.layerGroup();
    const shipsLayer     = L.layerGroup();
    const padsLayer      = L.layerGroup();
    const decayLayer     = L.layerGroup();
    const tipLayer       = L.layerGroup();
    const quakesLayer    = L.layerGroup();
    const maritimeLayer  = L.layerGroup();
    const airOsintLayer   = L.layerGroup();
    const seaOsintLayer   = L.layerGroup();
    const spaceOsintLayer = L.layerGroup();
    const newsLayer       = L.layerGroup();

    eventsCluster.addTo(map);
    maritimeLayer.addTo(map);
    quakesLayer.addTo(map);
    decayLayer.addTo(map);
    tipLayer.addTo(map);
    padsLayer.addTo(map);
    shipsLayer.addTo(map);
    aircraftLayer.addTo(map);
    airOsintLayer.addTo(map);
    seaOsintLayer.addTo(map);
    spaceOsintLayer.addTo(map);
    newsLayer.addTo(map);

    eventsClusterRef.current = eventsCluster;
    aircraftLayerRef.current  = aircraftLayer;
    shipsLayerRef.current     = shipsLayer;
    padsLayerRef.current      = padsLayer;
    decayLayerRef.current     = decayLayer;
    tipLayerRef.current       = tipLayer;
    quakesLayerRef.current    = quakesLayer;
    maritimeLayerRef.current  = maritimeLayer;
    airOsintLayerRef.current   = airOsintLayer;
    seaOsintLayerRef.current   = seaOsintLayer;
    spaceOsintLayerRef.current = spaceOsintLayer;
    newsLayerRef.current        = newsLayer;

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
      maritimeLayerRef.current = null;
      airOsintLayerRef.current = null;
      seaOsintLayerRef.current = null;
      spaceOsintLayerRef.current = null;
    };
  }, []);

  // ── Update GDELT events ───────────────────────────────────────────────────
  useEffect(() => {
    const cluster = eventsClusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    airOsintLayerRef.current?.clearLayers();
    seaOsintLayerRef.current?.clearLayers();
    spaceOsintLayerRef.current?.clearLayers();

    const geoJSON = buildGeoJSON(events) as GeoJSON.FeatureCollection;
    (geoJSON.features || []).forEach(f => {
      const p = (f as GeoJSON.Feature<GeoJSON.Point>).properties || {};
      const [lon, lat] = (f as GeoJSON.Feature<GeoJSON.Point>).geometry.coordinates;
      const catColor  = p.categoryColor || getCategoryColor(p.category || 'incident');
      const tone      = Number(p.tone);
      const score     = Number(p.score || 0);
      // Rayon basé sur le score : 5 à 12px
      const radius    = Math.max(5, Math.min(12, 5 + score / 20));
      // Couleur par catégorie : military=rouge, protest=jaune, incident=bleu
      const dotColor  = catColor;

      const marker = L.circleMarker([lat, lon], {
        radius,
        color:       dotColor,
        fillColor:   dotColor,
        fillOpacity: 0.75,
        weight:      1,
      });

      const catLabel  = getCategoryLabel(p.category || 'incident');
      const domain    = escapeHtml(p.domain || '');
      const dateStr   = escapeHtml(formatDate(p.date));
      const osintD    = (p.osintDomain || '').toLowerCase();
      const domainBadge = osintD === 'aviation' ? { icon: '✈', label: 'AIR', color: '#00bfff' }
                        : osintD === 'maritime' ? { icon: '⚓', label: 'SEA', color: '#00cca3' }
                        : osintD === 'spatial'  ? { icon: '🚀', label: 'SPACE', color: '#b580ff' }
                        : null;
      const rawTitle  = p.title || p.domain || '';
      const rawTitleFr = p.titleFr || '';
      const popId = `ev-${p.id || Math.random().toString(36).slice(2)}`;

      // Titre stocké en data-attribute pour éviter les problèmes d'échappement dans onclick
      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <button id="${popId}-btn"
            data-title="${escapeHtml(rawTitle)}"
            data-title-fr="${escapeHtml(rawTitleFr)}"
            data-url="${escapeHtml(p.url || '')}"
            data-domain="${escapeHtml(p.domain || '')}"
            data-country="${escapeHtml(p.country || '')}"
            data-category="${escapeHtml(p.category || 'incident')}"
            data-event-code="${escapeHtml(p.eventCode || '')}"
            data-root-code="${escapeHtml(p.rootCode || '')}"
            data-sub-event-type="${escapeHtml(p.subEventType || p.subType || '')}"
            onclick="(function(){
              var btn=document.getElementById('${popId}-btn');
              var box=document.getElementById('${popId}-title');
              if(!btn||!box)return;
              var cached=btn.getAttribute('data-title-fr')||'';
              if(cached){box.textContent=cached;btn.textContent='✓ FR';return;}
              var q=btn.getAttribute('data-title')||'';
              btn.textContent='...';btn.disabled=true;
              fetch('${RAILWAY_URL}/translate-title',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                  id:'${escapeHtml(String(p.id || ''))}',
                  title:q,
                  url:btn.getAttribute('data-url')||'',
                  domain:btn.getAttribute('data-domain')||'',
                  country:btn.getAttribute('data-country')||'',
                  category:btn.getAttribute('data-category')||'incident',
                  eventCode:btn.getAttribute('data-event-code')||'',
                  rootCode:btn.getAttribute('data-root-code')||'',
                  subEventType:btn.getAttribute('data-sub-event-type')||''
                })
              })
                .then(function(r){
                  return r.json().then(function(d){
                    if(!r.ok)throw new Error((d&&d.error)||'translation_failed');
                    return d;
                  });
                })
                .then(function(d){
                  var tr=d&&(d.title||d.fr);
                  if(tr){box.textContent=tr;btn.textContent='✓ FR';}
                  else{btn.textContent='NO FR';btn.disabled=false;}
                })
                .catch(function(err){btn.textContent=String(err&&err.message||'ERR').indexOf('API')>=0?'API':'ERR';btn.disabled=false;});
            })()"
            style="padding:1px 6px;font-size:9px;background:#1a2a3a;color:#00d4ff;border:1px solid #1a4a5a;cursor:pointer;font-family:inherit;flex-shrink:0;">FR</button>
          <span style="padding:1px 6px;font-size:9px;background:${catColor}22;color:${catColor};border:1px solid ${catColor}55;">${catLabel}</span>
          ${domainBadge ? `<span style="padding:1px 6px;font-size:9px;background:${domainBadge.color}18;color:${domainBadge.color};border:1px solid ${domainBadge.color}55;">${domainBadge.icon} ${domainBadge.label}</span>` : ''}
          <span style="font-size:9px;color:#4a6a7a;margin-left:auto;white-space:nowrap;">${dateStr}</span>
        </div>
        <p id="${popId}-title" style="margin:0 0 8px 0;font-size:11px;line-height:1.5;color:#e8f4ff;">${escapeHtml(rawTitle)}</p>
        <div style="font-size:9px;border-top:1px solid #0e1a24;padding-top:6px;">
          ${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" style="color:#2a5a6a;text-decoration:none;">↗ ${domain}</a>` : `<span style="color:#2a4a5a;">${domain}</span>`}
        </div>
      `), { maxWidth: 340 });

      // Route aviation/maritime/spatial OSINT events to dedicated layers
      const osintDomain = (p.osintDomain || '').toLowerCase();
      if (osintDomain === 'aviation' && airOsintLayerRef.current) {
        airOsintLayerRef.current.addLayer(marker);
      } else if (osintDomain === 'maritime' && seaOsintLayerRef.current) {
        cluster.addLayer(marker);
      } else if (osintDomain === 'spatial' && spaceOsintLayerRef.current) {
        cluster.addLayer(marker);
      } else {
        cluster.addLayer(marker);
      }
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
      const icon   = isHeli
        ? makeSvgIcon(helicopterSvg, HELICOPTER_COLOR, 30, t.heading ?? 0)
        : makeSvgIcon(airplaneSvg, t.color || '#4a9eff', 28, t.heading ?? 0);

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
      const icon   = makeSvgIcon(shipSvg, t.color || '#60ddff', 20, 0); // vue de profil — pas de rotation
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

  // ── Update naval activity (GDELT + GFW fusion) ───────────────────────────
  useEffect(() => {
    const layer = maritimeLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    navalEvents.forEach(ev => {
      if (!ev.latitude || !ev.longitude) return;
      const style = NAVAL_STYLE[ev.type] || NAVAL_STYLE.maritime_activity;
      const categoryColor = getCategoryColor(ev.category || 'incident');
      const categoryLabel = getCategoryLabel(ev.category || 'incident');
      // Probable → rouge vif, possible → couleur du type, weak → atténué
      const color = ev.activityClass === 'probable_naval_activity'
        ? '#ff2244'
        : ev.activityClass === 'possible_naval_activity'
          ? style.color
          : '#4a6a7a';
      const radius = ev.confidenceScore >= 75 ? 8 : ev.confidenceScore >= 55 ? 6 : 4;

      const marker = L.circleMarker([ev.latitude, ev.longitude], {
        radius,
        color,
        weight:      1.5,
        fillColor:   color,
        fillOpacity: ev.activityClass === 'weak_signal' ? 0.35 : 0.7,
      });

      const title   = ev.titleFr || ev.title || '-';
      const timestampMs = ev.timestamp ? Date.parse(ev.timestamp) : Number.NaN;
      const dateStr = Number.isFinite(timestampMs)
        ? new Date(timestampMs).toUTCString().replace(' GMT', ' UTC').slice(0, 22)
        : '-';

      const tagsHtml = [style.label, ...ev.tags].map(t =>
        `<span style="padding:1px 6px;font-size:8px;background:${color}18;color:${color};border:1px solid ${color}44;">${escapeHtml(t.replace(/_/g, ' ').toUpperCase())}</span>`
      ).join(' ');

      const zoneInfo = [
        ev.context?.nearestBase       ? `Base: ${escapeHtml(ev.context.nearestBase.name)} (${ev.context.nearestBase.distanceKm}km)` : '',
        ev.context?.nearestChokepoint ? `Detroit: ${escapeHtml(ev.context.nearestChokepoint.name)} (${ev.context.nearestChokepoint.distanceKm}km)` : '',
        ev.context?.strategicZone     ? `Zone: ${escapeHtml(ev.context.strategicZone.name)} (${ev.context.strategicZone.distanceKm}km)` : '',
        ev.context?.nearestPort       ? `Port: ${escapeHtml(ev.context.nearestPort.name)} (${ev.context.nearestPort.distanceKm}km)` : '',
      ].filter(Boolean).join('<br>');

      const anomalyBadge = ev.provenance?.anomalyCount
        ? `<span style="font-size:8px;color:#ff8800;">GFW ${ev.provenance.anomalyCount} anomalie(s)</span>`
        : '';

      const titleHtml = ev.rawEvent?.url
        ? `<a href="${escapeHtml(ev.rawEvent.url)}" target="_blank" rel="noopener" style="color:#e8f4ff;text-decoration:none;">${escapeHtml(title)}</a>`
        : escapeHtml(title);

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
          ${tagsHtml}
          <span style="padding:1px 6px;font-size:8px;background:${categoryColor}22;color:${categoryColor};border:1px solid ${categoryColor}55;">${escapeHtml(categoryLabel)}</span>
          <span style="font-size:9px;color:#4a6a7a;margin-left:auto;">${ev.confidenceScore}%</span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 4px 0;font-size:12px;">${titleHtml}</p>
        <p style="color:#4a6a7a;margin:0 0 8px 0;font-size:9px;">${escapeHtml(ev.country || '-')} | GDELT ${anomalyBadge ? '| ' + anomalyBadge : ''}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">TYPE</span><br><span style="color:#c8d8e8;">${escapeHtml(style.label)}</span></div>
          <div><span style="color:#4a6a7a;">DATE</span><br><span style="color:#c8d8e8;">${escapeHtml(dateStr)}</span></div>
        </div>
        ${zoneInfo ? `<div style="margin-top:6px;font-size:9px;color:#6a8a9a;line-height:1.6;border-top:1px solid #1a2a3a;padding-top:6px;">${zoneInfo}</div>` : ''}
      `), { maxWidth: 360 });

      layer.addLayer(marker);
    });
  }, [navalEvents]);

  // ── Domain view (used for news filtering + layer visibility toggle) ───────
  const { domainView } = useFilterStore();

  // ── Update Google News events layer ───────────────────────────────────────
  useEffect(() => {
    const layer = newsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    // Filtrer par domainView pour n'afficher que les articles du domaine sélectionné
    const domainFilter: Record<string, string[]> = {
      air:   ['aviation'],
      sea:   ['naval'],
      space: ['spatial', 'missile'],
      osint: [],   // tout
      all:   [],   // tout
    };
    const allowed = domainFilter[domainView] || [];
    const filtered = allowed.length > 0
      ? newsEvents.filter(ev => allowed.includes(ev.domain))
      : newsEvents;

    filtered.forEach(ev => {
      if (!ev.lat || !ev.lon) return;
      const color  = ev.color || '#22d3ee';
      const radius = ev.confidence >= 75 ? 9 : ev.confidence >= 50 ? 7 : 5;

      // Jitter: disperser les marqueurs empilés sur le même point (centre pays)
      const jitter = () => (Math.random() - 0.5) * 1.8;
      const lat = ev.lat + jitter();
      const lon = ev.lon + jitter();

      const marker = L.circleMarker([lat, lon], {
        radius,
        color:       '#ffffff',
        weight:      2,
        fillColor:   color,
        fillOpacity: 0.85,
        pane:        'markerPane',     // above default overlayPane
      });

      const timestampMs = ev.date ? Date.parse(ev.date) : Number.NaN;
      const dateStr = Number.isFinite(timestampMs)
        ? new Date(timestampMs).toUTCString().replace(' GMT', ' UTC').slice(0, 22)
        : '-';

      const domainBadge = `<span style="padding:1px 6px;font-size:8px;background:${color}18;color:${color};border:1px solid ${color}44;">${escapeHtml(ev.label || ev.domain.toUpperCase())}</span>`;
      const sourceBadge = `<span style="padding:1px 6px;font-size:8px;background:#ffffff10;color:#8899aa;border:1px solid #334455;">${escapeHtml(ev.source)}</span>`;
      const confBadge   = `<span style="font-size:9px;color:#4a6a7a;margin-left:auto;">${ev.confidence}%</span>`;

      const titleHtml = ev.url
        ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" style="color:#e8f4ff;text-decoration:none;">${escapeHtml(ev.title)}</a>`
        : escapeHtml(ev.title);

      marker.bindPopup(mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
          ${domainBadge} ${sourceBadge} ${confBadge}
        </div>
        <p style="color:#e8f4ff;margin:0 0 4px 0;font-size:12px;">${titleHtml}</p>
        <p style="color:#4a6a7a;margin:0 0 8px 0;font-size:9px;">${escapeHtml(ev.location || '-')} | Google News RSS</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
          <div><span style="color:#4a6a7a;">TYPE</span><br><span style="color:#c8d8e8;">${escapeHtml(ev.eventType || ev.domain)}</span></div>
          <div><span style="color:#4a6a7a;">DATE</span><br><span style="color:#c8d8e8;">${escapeHtml(dateStr)}</span></div>
        </div>
      `), { maxWidth: 360 });

      layer.addLayer(marker);
    });
  }, [newsEvents, domainView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const show = (layer: L.LayerGroup | L.MarkerClusterGroup | null) => {
      if (layer && !map.hasLayer(layer)) map.addLayer(layer);
    };
    const hide = (layer: L.LayerGroup | L.MarkerClusterGroup | null) => {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    };

    // Events GDELT (OSINT) cluster
    const evCluster  = eventsClusterRef.current;
    // Air
    const airLayer   = aircraftLayerRef.current;
    const airOsint   = airOsintLayerRef.current;
    // Sea
    const seaLayer   = shipsLayerRef.current;
    const navLayer   = maritimeLayerRef.current;
    const seaOsint   = seaOsintLayerRef.current;
    // Space
    const padLayer   = padsLayerRef.current;
    const decLayer   = decayLayerRef.current;
    const tipLayer   = tipLayerRef.current;
    const spOsint    = spaceOsintLayerRef.current;
    // Other
    const qLayer     = quakesLayerRef.current;
    const newsLayer  = newsLayerRef.current;

    switch (domainView) {
      case 'air':
        show(airLayer); show(airOsint); show(newsLayer);
        hide(evCluster); hide(seaLayer); hide(navLayer); hide(seaOsint);
        hide(padLayer); hide(decLayer); hide(tipLayer); hide(spOsint); hide(qLayer);
        break;
      case 'sea':
        show(seaLayer); show(navLayer); show(newsLayer);
        hide(evCluster); hide(airLayer); hide(airOsint);
        hide(seaOsint); hide(padLayer); hide(decLayer); hide(tipLayer); hide(spOsint); hide(qLayer);
        break;
      case 'space':
        show(padLayer); show(decLayer); show(tipLayer); show(newsLayer);
        hide(evCluster); hide(airLayer); hide(airOsint); hide(spOsint);
        hide(seaLayer); hide(navLayer); hide(seaOsint); hide(qLayer);
        break;
      case 'osint':
        show(evCluster); show(qLayer); show(airOsint); show(newsLayer);
        show(padLayer); show(decLayer); show(tipLayer);
        hide(seaLayer); hide(navLayer); hide(seaOsint); hide(spOsint); hide(airLayer);
        break;
      case 'all':
      default:
        show(evCluster); show(airLayer); show(seaLayer); show(navLayer);
        show(padLayer); show(decLayer); show(tipLayer); show(qLayer);
        show(airOsint); show(newsLayer);
        hide(seaOsint); hide(spOsint);
        break;
    }
  }, [domainView]);

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
