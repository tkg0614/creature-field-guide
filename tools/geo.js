// 地図の数字はAIに書かせない: 地名を OpenStreetMap（Nominatim）で緯度経度にし、地域の枠・名前の位置・道（edges）はコードで決める。
'use strict';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function geocode(q, cc) {
  await sleep(1100); // Nominatim の決まり: 1秒に1回まで
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1${cc ? `&countrycodes=${cc}` : ''}&q=${encodeURIComponent(q)}`, { headers: { 'user-agent': 'creature-field-guide/0.1 (github.com/tkg0614/creature-field-guide)' } });
  const j = await r.json().catch(() => []);
  return j[0] ? { lat: +(+j[0].lat).toFixed(3), lon: +(+j[0].lon).toFixed(3) } : null;
}
// places: [{id, ja, geo?(地名)}] に lat/lon を付け、region と edges を作る
async function layout(sh, locale) {
  // 日本語の地名を先に、国を絞って引く（2026-10-20: 「Tama Hills」がフィリピンに当たった）
  const cc = locale.country || sh.country || null;
  const center = (await geocode(locale.ja, cc)) || (await geocode(locale.geo || locale.ja, cc)) || (cc ? null : await geocode(locale.geo || locale.ja));
  if (!center) throw new Error(`地名が見つからない: ${locale.geo || locale.ja}`);
  const P = sh.places, n = P.length, R = locale.scale === 'regional' ? 3 : 0.04; // 里山なら半径4km ほど・海や大陸なら数百km
  for (const [i, p] of P.entries()) {
    const g = p.geo && locale.scale === 'regional' ? await geocode(p.geo) : null; // 海や大陸を渡る種は国で絞らない
    if (g) Object.assign(p, g);
    else if (i === 0) Object.assign(p, center); // 生まれた場所を真ん中に
    else { const a = (2 * Math.PI * (i - 1)) / (n - 1), r = R * (0.6 + 0.4 * ((i * 7) % 3) / 2); p.lat = +(center.lat + r * Math.sin(a) * 0.8).toFixed(3); p.lon = +(center.lon + r * Math.cos(a)).toFixed(3); }
    delete p.geo;
  }
  const lats = P.map((p) => p.lat), lons = P.map((p) => p.lon), m = Math.max(0.01, (Math.max(...lons) - Math.min(...lons)) * 0.18);
  const lon0 = +(Math.min(...lons) - m).toFixed(3), lon1 = +(Math.max(...lons) + m).toFixed(3), lat0 = +(Math.max(...lats) + m).toFixed(3), lat1 = +(Math.min(...lats) - m).toFixed(3);
  sh.region = { ja: locale.ja, lon0, lon1, lat0, lat1, k: Math.round(500 / (lon1 - lon0)), labels: [[lat0 - (lat0 - lat1) * 0.06, (lon0 + lon1) / 2, locale.ja]] };
  // 道: それぞれ近い2か所とつなぐ（つながらなければ一番近い組を足す）
  const d = (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon), E = new Set(), key = (a, b) => [a, b].sort().join('|');
  for (const p of P) P.filter((q) => q !== p).sort((a, b) => d(p, a) - d(p, b)).slice(0, 2).forEach((q) => E.add(key(p.id, q.id)));
  const edges = () => [...E].map((k) => k.split('|'));
  for (;;) {
    const seen = new Set([P[0].id]); let g = true; while (g) { g = false; for (const [a, b] of edges()) { if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); g = true; } } }
    if (seen.size === n) break;
    let best = null; for (const a of P.filter((p) => seen.has(p.id))) for (const b of P.filter((p) => !seen.has(p.id))) if (!best || d(a, b) < best[2]) best = [a.id, b.id, d(a, b)];
    E.add(key(best[0], best[1]));
  }
  sh.edges = edges();
}
module.exports = { geocode, layout };
