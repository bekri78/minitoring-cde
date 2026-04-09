'use strict';

const NAVAL_BASES = [
  { id: 'norfolk', name: 'Naval Station Norfolk', country: 'USA', lat: 36.9461, lon: -76.3302, kind: 'naval_base' },
  { id: 'rfa-toulon', name: 'Base navale de Toulon', country: 'FRA', lat: 43.1182, lon: 5.9306, kind: 'naval_base' },
  { id: 'portsmouth', name: 'HMNB Portsmouth', country: 'GBR', lat: 50.7996, lon: -1.1097, kind: 'naval_base' },
  { id: 'severomorsk', name: 'Severomorsk Naval Base', country: 'RUS', lat: 69.0765, lon: 33.4162, kind: 'naval_base' },
  { id: 'qingdao', name: 'Qingdao Naval Base', country: 'CHN', lat: 36.068, lon: 120.3826, kind: 'naval_base' },
  { id: 'yulin', name: 'Yulin Naval Base', country: 'CHN', lat: 18.2184, lon: 109.6893, kind: 'naval_base' },
  { id: 'guam', name: 'Naval Base Guam', country: 'USA', lat: 13.4443, lon: 144.6572, kind: 'naval_base' },
  { id: 'bahrain', name: 'NSA Bahrain', country: 'USA', lat: 26.2235, lon: 50.5876, kind: 'naval_base' },
  { id: 'rota', name: 'Naval Station Rota', country: 'ESP', lat: 36.6401, lon: -6.3496, kind: 'naval_base' },
  { id: 'haifa', name: 'Haifa Naval Base', country: 'ISR', lat: 32.8304, lon: 35.0003, kind: 'naval_base' },
];

const STRATEGIC_CHOKEPOINTS = [
  { id: 'gibraltar', name: 'Détroit de Gibraltar', lat: 35.9672, lon: -5.6068, kind: 'chokepoint' },
  { id: 'suez', name: 'Canal de Suez', lat: 30.4256, lon: 32.3492, kind: 'chokepoint' },
  { id: 'bab-el-mandeb', name: 'Bab-el-Mandeb', lat: 12.585, lon: 43.3319, kind: 'chokepoint' },
  { id: 'hormuz', name: 'Détroit d\'Ormuz', lat: 26.5667, lon: 56.25, kind: 'chokepoint' },
  { id: 'malacca', name: 'Détroit de Malacca', lat: 2.5489, lon: 101.0656, kind: 'chokepoint' },
  { id: 'bosporus', name: 'Bosphore', lat: 41.1579, lon: 29.1035, kind: 'chokepoint' },
  { id: 'taiwan', name: 'Détroit de Taiwan', lat: 24.0, lon: 119.8, kind: 'chokepoint' },
  { id: 'skagerrak', name: 'Skagerrak', lat: 57.8965, lon: 10.6574, kind: 'chokepoint' },
];

const MAJOR_PORTS = [
  { id: 'singapore', name: 'Port de Singapour', country: 'SGP', lat: 1.2644, lon: 103.8405, kind: 'major_port' },
  { id: 'rotterdam', name: 'Port de Rotterdam', country: 'NLD', lat: 51.9475, lon: 4.1389, kind: 'major_port' },
  { id: 'shanghai', name: 'Port de Shanghai', country: 'CHN', lat: 31.2304, lon: 121.4737, kind: 'major_port' },
  { id: 'jebel-ali', name: 'Jebel Ali', country: 'ARE', lat: 25.0136, lon: 55.0615, kind: 'major_port' },
  { id: 'long-beach', name: 'Port of Long Beach', country: 'USA', lat: 33.7542, lon: -118.2167, kind: 'major_port' },
  { id: 'piraeus', name: 'Port du Pirée', country: 'GRC', lat: 37.942, lon: 23.6465, kind: 'major_port' },
  { id: 'colombo', name: 'Port de Colombo', country: 'LKA', lat: 6.9608, lon: 79.846, kind: 'major_port' },
  { id: 'busan', name: 'Port of Busan', country: 'KOR', lat: 35.1028, lon: 129.0403, kind: 'major_port' },
];

const STRATEGIC_ZONES = [
  { id: 'red-sea', name: 'Mer Rouge', lat: 18.5, lon: 40.2, radiusKm: 650, kind: 'strategic_zone' },
  { id: 'black-sea', name: 'Mer Noire', lat: 43.2, lon: 34.3, radiusKm: 520, kind: 'strategic_zone' },
  { id: 'baltic-sea', name: 'Mer Baltique', lat: 57.8, lon: 19.4, radiusKm: 520, kind: 'strategic_zone' },
  { id: 'south-china-sea', name: 'Mer de Chine méridionale', lat: 12.0, lon: 114.0, radiusKm: 1350, kind: 'strategic_zone' },
  { id: 'east-med', name: 'Méditerranée orientale', lat: 33.8, lon: 31.2, radiusKm: 700, kind: 'strategic_zone' },
  { id: 'persian-gulf', name: 'Golfe Persique', lat: 27.2, lon: 51.7, radiusKm: 420, kind: 'strategic_zone' },
  { id: 'north-sea', name: 'Mer du Nord', lat: 56.2, lon: 3.5, radiusKm: 680, kind: 'strategic_zone' },
];

const MAJOR_SEA_LANES = [
  { id: 'suez-singapore', name: 'Route Suez-Singapour', lat: 12.5, lon: 67.0, kind: 'sea_lane' },
  { id: 'gibraltar-suez', name: 'Route Gibraltar-Suez', lat: 35.0, lon: 14.5, kind: 'sea_lane' },
  { id: 'malacca-northeast-asia', name: 'Route Malacca-Asie du Nord-Est', lat: 18.0, lon: 118.0, kind: 'sea_lane' },
  { id: 'atlantic-europe', name: 'Route Atlantique-Europe', lat: 45.0, lon: -18.0, kind: 'sea_lane' },
  { id: 'med-bosphorus', name: 'Route Méditerranée-Bosphore', lat: 38.8, lon: 22.0, kind: 'sea_lane' },
];

module.exports = {
  NAVAL_BASES,
  STRATEGIC_CHOKEPOINTS,
  MAJOR_PORTS,
  STRATEGIC_ZONES,
  MAJOR_SEA_LANES,
};