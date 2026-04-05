'use strict';

// ICAO aircraft type designators known to be primarily military.
// Source: ICAO Doc 8643 cross-referenced with known military operators.
// Used by the scoring engine to boost confidence when type data is available.
const MILITARY_TYPE_CODES = new Set([
  // Strategic bombers
  'B52','B1','B2','TU95','TU160','TU22','H6','B21',
  // Fighters / multirole
  'F15','F16','F18','F22','F35','F14','F117',
  'SU27','SU30','SU33','SU34','SU35','SU57',
  'MIG29','MIG31','MIG35',
  'J10','J11','J15','J16','J20','J31','JH7',
  'EF','EUFI',        // Eurofighter Typhoon
  'TYFN',             // Typhoon (older code)
  'GRIF',             // Gripen
  'RAFA',             // Rafale
  'TOR','MIG','SU',   // catch-all prefixes handled via startsWith in rule
  // Strategic / heavy transport
  'C130','C17','C5','C141','C160',
  'AN12','AN22','AN26','AN32','AN72','AN124','AN225',
  'IL76','IL96',
  // Aerial refuelling
  'KC135','KC10','KC46','IL78','A310','MRTT',
  // Multi-mission transport
  'A400',
  // AWACS / ISR / Maritime patrol
  'E3','E8','B737','RC135','EP3',
  'P8','P3','P1',     // P-1 (JMSDF), P-3 Orion, P-8 Poseidon
  'S3','ES3',
  'E2','E767','E737', // AEW variants
  'U2','TR1',
  // Helicopters (military-specific types)
  'AH1','AH64','H1','UH60','MH60','SH60',
  'CH47','CH53','MH47','MH53',
  'NH90','TIGR','EC665',
  'KA27','KA28','KA52','MI8','MI14','MI17','MI24','MI26','MI28','MI35',
  'Z10','Z19','Z20',
  // Close air support / light attack
  'A10','OV10','EMB314','T6','PC9','PC21',
  // UAV (state-operated)
  'RQ4','MQ9','MQ1','MQ4','WJ600','TB001',
  // Trainers that double as light combat
  'T38','T45','L159','M346','HAWK','BAE',
  // Maritime fixed-wing
  'ATR','CN235','C295',
  // Others
  'SR71','U2',
]);

/**
 * Returns true if the given ICAO type code matches a known military type.
 * Also catches common prefix families (MIG*, SU*, J*, etc.).
 */
function isMilitaryType(typeCode) {
  if (!typeCode) return false;
  const t = typeCode.toUpperCase().trim();
  if (MILITARY_TYPE_CODES.has(t)) return true;
  // Prefix families
  if (t.startsWith('MIG') || t.startsWith('SU2') || t.startsWith('SU3') ||
      t.startsWith('KA') || t.startsWith('MI') || t.startsWith('MQ') ||
      t.startsWith('RQ') || t.startsWith('J1') || t.startsWith('J2')) return true;
  return false;
}

module.exports = { MILITARY_TYPE_CODES, isMilitaryType };
