'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(process.env.CACHE_DIR || '/data', 'maritime-anomalies.json');
const GFW_BASE_URL = 'https://gateway.api.globalfishingwatch.org/v3';
const SOURCE_TOKEN = String(process.env.GFW_API_TOKEN || process.env.MARITIME_ANOMALY_TOKEN || '').trim();
const SOURCE_NAME = 'GlobalFishingWatch';
const DEFAULT_DATASETS = ['public-global-presence:latest', 'public-global-sar-presence:latest'];
const DEFAULT_TILES = [
  { z: 1, x: 0, y: 0, label: 'nw' },
  { z: 1, x: 1, y: 0, label: 'ne' },
  { z: 1, x: 0, y: 1, label: 'sw' },
  { z: 1, x: 1, y: 1, label: 'se' },
];
const MAX_CELLS_PER_TILE = Number(process.env.GFW_HEATMAP_MAX_CELLS || 200);

function readJsonEnv(name, fallback) {
  try {
    const raw = String(process.env[name] || '').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function configuredDatasets() {
  const raw = String(process.env.GFW_DATASETS || '').trim();
  if (!raw) return DEFAULT_DATASETS;
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function configuredTiles() {
  const tiles = readJsonEnv('GFW_HEATMAP_TILES', DEFAULT_TILES);
  return Array.isArray(tiles) && tiles.length ? tiles : DEFAULT_TILES;
}

function configuredQueryParams() {
  return readJsonEnv('GFW_HEATMAP_QUERY', {});
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return `${start.toISOString().slice(0, 10)},${end.toISOString().slice(0, 10)}`;
}

let cache = {
  anomalies: [],
  lastUpdate: null,
  status: SOURCE_TOKEN ? 'initializing' : 'not_configured',
  source: SOURCE_NAME,
  error: null,
  meta: null,
};

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(raw?.anomalies)) {
      cache = {
        anomalies: raw.anomalies,
        lastUpdate: raw.lastUpdate || null,
        status: raw.status || (SOURCE_TOKEN ? 'ok' : 'not_configured'),
        source: raw.source || SOURCE_NAME,
        error: null,
        meta: raw.meta || null,
      };
    }
  } catch {}
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

function tile2lon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function tile2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function cellCenterFromTile(tile, row, col, rows, cols) {
  const west = tile2lon(tile.x, tile.z);
  const east = tile2lon(tile.x + 1, tile.z);
  const north = tile2lat(tile.y, tile.z);
  const south = tile2lat(tile.y + 1, tile.z);
  const lon = west + ((col + 0.5) / cols) * (east - west);
  const lat = north - ((row + 0.5) / rows) * (north - south);
  return { lat, lon };
}

function buildHeatmapUrl(tile, datasets) {
  const url = new URL(`${GFW_BASE_URL}/4wings/tile/heatmap/${tile.z}/${tile.x}/${tile.y}`);
  datasets.forEach((dataset, index) => {
    url.searchParams.append(`datasets[${index}]`, dataset);
  });

  const extraParams = {
    'date-range': defaultDateRange(),
    format: 'INTARRAY',
    interval: 'DAY',
    ...configuredQueryParams(),
  };
  for (const [key, value] of Object.entries(extraParams || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach(item => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function deriveTypeFromDataset(dataset) {
  if (dataset.includes('sar')) return 'sar_presence';
  return 'ais_presence';
}

function normalizeHeatmapCell(cell, context = {}, index = 0) {
  const lat = Number(cell.lat ?? cell.latitude ?? cell.center?.lat ?? cell?.geometry?.coordinates?.[1]);
  const lon = Number(cell.lon ?? cell.longitude ?? cell.center?.lon ?? cell?.geometry?.coordinates?.[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const rawValue = Number(cell.value ?? cell.intensity ?? cell.count ?? cell.weight ?? 0);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;

  const normalized = context.maxValue > 0 ? rawValue / context.maxValue : 0;
  const confidenceScore = Math.max(10, Math.min(95, Math.round(35 + normalized * 60)));
  const type = deriveTypeFromDataset(context.dataset || '');

  return {
    id: `${type}-${context.dataset || 'dataset'}-${context.tile?.z}-${context.tile?.x}-${context.tile?.y}-${index}`,
    type,
    lat,
    lon,
    timestamp: new Date().toISOString(),
    confidenceScore,
    source: SOURCE_NAME,
    vesselId: null,
    details: {
      dataset: context.dataset,
      tile: context.tile,
      rawValue,
      normalizedValue: Number(normalized.toFixed(4)),
      format: context.format || 'heatmap',
    },
  };
}

function normalizeAnomaly(item, index = 0) {
  const lat = Number(item.lat ?? item.latitude ?? item?.geometry?.coordinates?.[1]);
  const lon = Number(item.lon ?? item.longitude ?? item?.geometry?.coordinates?.[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const type = String(item.type || item.eventType || item.behavior || item.category || 'maritime_anomaly');
  const timestamp = item.timestamp || item.detectedAt || item.start || item.startTime || new Date().toISOString();
  const confidenceScore = Math.max(0, Math.min(100, Number(item.confidenceScore ?? item.score ?? item.confidence ?? 55)));

  return {
    id: String(item.id || `${type}-${timestamp}-${index}`),
    type,
    lat,
    lon,
    timestamp,
    confidenceScore,
    source: String(item.source || SOURCE_NAME),
    vesselId: item.vesselId || item.mmsi || null,
    details: item.details || item.properties || null,
  };
}

function parsePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.anomalies)) return payload.anomalies;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    return payload.features.map(feature => ({
      ...feature.properties,
      geometry: feature.geometry,
    }));
  }
  return [];
}

function parseHeatmapCells(payload, tile, dataset) {
  if (Array.isArray(payload)) {
    const maxValue = payload.reduce((max, item) => Math.max(max, Number(item.value ?? item.count ?? item.intensity ?? 0) || 0), 0);
    return payload
      .map((item, index) => normalizeHeatmapCell(item, { tile, dataset, maxValue, format: 'array' }, index))
      .filter(Boolean)
      .sort((a, b) => b.details.rawValue - a.details.rawValue)
      .slice(0, MAX_CELLS_PER_TILE);
  }

  if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    const features = payload.features.map(feature => ({
      ...feature.properties,
      geometry: feature.geometry,
    }));
    const maxValue = features.reduce((max, item) => Math.max(max, Number(item.value ?? item.count ?? item.intensity ?? 0) || 0), 0);
    return features
      .map((item, index) => normalizeHeatmapCell(item, { tile, dataset, maxValue, format: 'geojson' }, index))
      .filter(Boolean)
      .sort((a, b) => b.details.rawValue - a.details.rawValue)
      .slice(0, MAX_CELLS_PER_TILE);
  }

  const matrix = payload?.grid || payload?.cells || payload?.data;
  if (Array.isArray(matrix) && Array.isArray(matrix[0])) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    let maxValue = 0;
    for (const row of matrix) {
      for (const value of row) {
        const numeric = Number(value || 0);
        if (numeric > maxValue) maxValue = numeric;
      }
    }

    const cells = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      for (let colIndex = 0; colIndex < cols; colIndex++) {
        const rawValue = Number(matrix[rowIndex][colIndex] || 0);
        if (!Number.isFinite(rawValue) || rawValue <= 0) continue;
        const center = cellCenterFromTile(tile, rowIndex, colIndex, rows, cols);
        const normalized = normalizeHeatmapCell({ ...center, value: rawValue }, { tile, dataset, maxValue, format: 'matrix' }, `${rowIndex}-${colIndex}`);
        if (normalized) cells.push(normalized);
      }
    }

    return cells
      .sort((a, b) => b.details.rawValue - a.details.rawValue)
      .slice(0, MAX_CELLS_PER_TILE);
  }

  return parsePayload(payload)
    .map((item, index) => normalizeAnomaly({ ...item, source: SOURCE_NAME }, index))
    .filter(Boolean)
    .slice(0, MAX_CELLS_PER_TILE);
}

function dedupeAnomalies(anomalies) {
  const byKey = new Map();
  for (const anomaly of anomalies) {
    const key = [
      anomaly.type,
      anomaly.details?.dataset || 'dataset',
      Math.round(anomaly.lat * 10) / 10,
      Math.round(anomaly.lon * 10) / 10,
    ].join(':');
    const existing = byKey.get(key);
    if (!existing || anomaly.confidenceScore > existing.confidenceScore) {
      byKey.set(key, anomaly);
    }
  }
  return [...byKey.values()];
}

async function fetchHeatmapTile(tile, datasets) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${SOURCE_TOKEN}`,
  };
  const resp = await fetch(buildHeatmapUrl(tile, datasets), { headers, method: 'GET' });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GFW ${resp.status} ${body.slice(0, 160)}`.trim());
  }

  const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('json')) {
    throw new Error(`GFW returned unsupported content-type: ${contentType || 'unknown'}`);
  }

  const payload = await resp.json();
  return parseHeatmapCells(payload, tile, datasets.join(','));
}

async function fetchMaritimeAnomalies() {
  if (!SOURCE_TOKEN) {
    cache.status = 'not_configured';
    cache.error = null;
    cache.meta = {
      provider: SOURCE_NAME,
      configured: false,
      datasets: configuredDatasets(),
      tiles: configuredTiles(),
    };
    return cache;
  }

  cache.status = 'refreshing';
  cache.error = null;

  try {
    const datasets = configuredDatasets();
    const tiles = configuredTiles();
    const collected = [];

    for (const tile of tiles) {
      const anomalies = await fetchHeatmapTile(tile, datasets);
      collected.push(...anomalies);
    }

    const anomalies = dedupeAnomalies(collected);

    cache = {
      anomalies,
      lastUpdate: new Date().toISOString(),
      status: 'ok',
      source: SOURCE_NAME,
      error: null,
      meta: {
        provider: SOURCE_NAME,
        configured: true,
        baseUrl: GFW_BASE_URL,
        endpoint: '/4wings/tile/heatmap/{z}/{x}/{y}',
        datasets,
        tiles,
        count: anomalies.length,
      },
    };
    saveCache();
  } catch (err) {
    cache.status = cache.anomalies.length ? 'degraded' : 'error';
    cache.error = err.message;
    cache.meta = {
      ...(cache.meta || {}),
      provider: SOURCE_NAME,
      baseUrl: GFW_BASE_URL,
      endpoint: '/4wings/tile/heatmap/{z}/{x}/{y}',
      datasets: configuredDatasets(),
      tiles: configuredTiles(),
      configured: true,
    };
  }

  return cache;
}

function getMaritimeAnomaliesCache() {
  return cache;
}

loadCache();

module.exports = {
  fetchMaritimeAnomalies,
  getMaritimeAnomaliesCache,
};