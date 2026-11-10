/**
 * config.js — Vitrine publique OGMA (GitHub Pages)
 * Aucune clé ni adresse interne : les données sont lues dans data/snapshot.json,
 * publié toutes les 30 minutes par la GitHub Action « vitrine ».
 */

var APP = window.APP || {};

APP.CONFIG = {
  VITRINE: true,

  SYNC: {
    SNAPSHOT_URL:     'data/snapshot.json',
    POLL_INTERVAL_MS: 5 * 60 * 1000,      // relecture du fichier publié
    STALE_AFTER_MS:   90 * 60 * 1000      // date orange au-delà (publication toutes les 30 min)
  },

  // Fond de carte public sombre (OpenStreetMap / CARTO)
  BASEMAP: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }
};
