import { CATEGORY_MAP } from '../constants/categories';

export function getColor(tone: number): string {
  if (isNaN(tone)) return '#4a6a7a';
  if (tone <= -7) return '#ff2244';
  if (tone <= -5) return '#ff5533';
  if (tone < -2)  return '#ffaa00';
  if (tone < 0)   return '#ffdd55';
  return '#00d4ff';
}

export function getSeverityLabel(tone: number): string {
  if (tone <= -7) return 'CRITICAL';
  if (tone <= -5) return 'SEVERE';
  if (tone <= -2) return 'HIGH';
  if (tone < 0)   return 'MODERATE';
  return 'LOW';
}

export function getSeverityKey(tone: number): string {
  if (tone <= -7) return 'critical';
  if (tone <= -5) return 'severe';
  if (tone <= -2) return 'high';
  if (tone < 0)   return 'moderate';
  return 'low';
}

export function getCategoryColor(category: string): string {
  return CATEGORY_MAP[category]?.color || '#4a6a7a';
}

export function getCategoryLabel(category: string): string {
  return CATEGORY_MAP[category]?.label || 'INCIDENT';
}
