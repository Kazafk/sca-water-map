export function normalizeSearchQuery(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ᪰-᫿᷀-᷿]/g, '')
    .trim();
}

export function searchLocalCities(worldCities, query, limit = 8) {
  const q = normalizeSearchQuery(query);
  if (q.length < 2) return [];
  return worldCities
    .filter(c =>
      normalizeSearchQuery(c.name).includes(q) ||
      normalizeSearchQuery(c.country_name).includes(q)
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

export async function searchNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=fr`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'SCA-Water-Map/1.0 (github.com/kazafk/sca-water-map)' },
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) {
      console.warn(`Nominatim ${r.status}:`, r.statusText);
      return [];
    }
    return await r.json();
  } catch (e) {
    console.error('Nominatim fetch failed:', e.message);
    return [];
  }
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
