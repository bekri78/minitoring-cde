export function formatDate(d: string | number): string {
  if (!d || String(d).length < 8) return '';
  try {
    const s = String(d).replace('T', ' ').replace('Z', '');
    return s.substring(0, 16);
  } catch {
    return String(d);
  }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
