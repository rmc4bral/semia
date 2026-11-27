// Navegación GPS en el campo (en vehículo o a pie): distancias, rumbos y silos cercanos (plano local en metros)
const R = 6371008.8, rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;

// lat/lng → metros en un plano local centrado en lat0 (suficiente para distancias de campo)
const xy = (p, lat0) => [rad(p[1]) * R * Math.cos(rad(lat0)), rad(p[0]) * R];

export function meters(a, b) { const l0 = (a[0] + b[0]) / 2, p = xy(a, l0), q = xy(b, l0); return Math.hypot(p[0] - q[0], p[1] - q[1]); }

// rumbo de a hacia b en grados (0 = norte, 90 = este)
export function bearing(a, b) {
  const f1 = rad(a[0]), f2 = rad(b[0]), dl = rad(b[1] - a[1]);
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const DIRS = ['al norte', 'al noreste', 'al este', 'al sureste', 'al sur', 'al suroeste', 'al oeste', 'al noroeste'];
export const dirName = b => DIRS[Math.round(b / 45) % 8];

// punto más cercano de un segmento a-b (la bolsa) a p; devuelve [lat, lng]
export function nearestOnSeg(p, a, b) {
  if (!b) return a;
  const l0 = p[0], P = xy(p, l0), A = xy(a, l0), B = xy(b, l0);
  const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// posición de un silo en lat/lng: cabecera (A) y cola (B) si existen
export function siloLL(s, geo) {
  const a = s.latlng || (geo && s.map ? geo.toLatLng(s.map) : null);
  const b = s.latlng2 || (geo && s.map2 ? geo.toLatLng(s.map2) : null);
  return a ? { a, b } : null;
}

// silos ordenados por distancia a p (al punto más cercano de cada bolsa)
export function nearestSilos(p, silos, geo, n = 3, skipId = null) {
  if (!p) return [];
  const out = [];
  for (const s of silos) {
    if (s.id === skipId) continue;
    const ll = siloLL(s, geo); if (!ll) continue;
    const q = nearestOnSeg(p, ll.a, ll.b);
    out.push({ id: s.id, s, at: q, d: meters(p, q) });
  }
  return out.sort((x, y) => x.d - y.d).slice(0, n);
}

export const fmtDist = d => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1).replace('.', ',')} km`);
// (ya no se muestra: el recorrido suele hacerse en vehículo) a pie por el campo: ~1,2 m/s
export const fmtWalk = d => { const m = Math.round(d / 1.2 / 60); return m < 1 ? 'menos de 1 min' : `${m} min a pie`; };

export function trailLength(tr) { let t = 0; for (let i = 1; i < tr.length; i++) t += meters(tr[i - 1], tr[i]); return t; }

// saludo según la hora
export function greeting(name, d = new Date()) {
  const h = d.getHours();
  const g = h >= 5 && h < 12 ? 'Buenos días' : h >= 12 && h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const full = String(name || '').trim(), w = full.split(/\s+/)[0] || '';
  const first = w.replace(/\.$/, '').length <= 2 ? full : w; // «R. Maldonado» → nombre completo
  return { g, first };
}
