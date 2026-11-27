// acopia · utilidades geométricas (coordenadas del mapa: x → este, y → sur)

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function pointInPoly(p, poly) {
  const [x, y] = p; let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Perímetro acumulado
export function perimeter(poly) {
  const cum = [0];
  for (let i = 0; i < poly.length; i++) cum.push(cum[i] + dist(poly[i], poly[(i + 1) % poly.length]));
  return cum; // cum[n] = largo total
}

// Punto del borde a una distancia t (recorrido horario del polígono)
export function pointAt(poly, t) {
  const cum = perimeter(poly), L = cum[poly.length];
  t = ((t % L) + L) % L;
  let i = 0;
  while (i < poly.length - 1 && cum[i + 1] < t) i++;
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const seg = cum[i + 1] - cum[i] || 1, k = (t - cum[i]) / seg;
  return { point: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], seg: i, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

// Proyección de un punto sobre el borde más cercano del polígono
export function snapToBorder(p, poly) {
  const cum = perimeter(poly);
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    const q = [a[0] + dx * k, a[1] + dy * k], d = dist(p, q);
    if (!best || d < best.dist) best = { point: q, dist: d, seg: i, t: cum[i] + Math.sqrt(L2) * k, angle: Math.atan2(dy, dx) };
  }
  return best;
}

// Recorrido por el borde entre dos posiciones t (camino más corto)
export function borderPath(poly, t1, t2) {
  const cum = perimeter(poly), L = cum[poly.length];
  let fwd = (((t2 - t1) % L) + L) % L;
  const dir = fwd <= L / 2 ? 1 : -1, len = dir > 0 ? fwd : L - fwd;
  const pts = [pointAt(poly, t1).point];
  // vértices intermedios
  const verts = [];
  for (let i = 0; i < poly.length; i++) {
    let d = dir > 0 ? (((cum[i] - t1) % L) + L) % L : (((t1 - cum[i]) % L) + L) % L;
    if (d > 1e-6 && d < len - 1e-6) verts.push([d, poly[i]]);
  }
  verts.sort((a, b) => a[0] - b[0]).forEach(v => pts.push(v[1]));
  pts.push(pointAt(poly, t2).point);
  return pts;
}

// Normal hacia el interior del polígono para un ángulo de borde
export function inwardNormal(poly, angle) {
  const s = Math.sign(signedArea(poly)) || 1; // y hacia abajo: área>0 = horario en pantalla
  return [-Math.sin(angle) * s, Math.cos(angle) * s];
}

export function centroid(poly) {
  let x = 0, y = 0;
  poly.forEach(p => { x += p[0]; y += p[1]; });
  return [x / poly.length, y / poly.length];
}

/* ---------- Homografía (4 puntos del mapa ↔ lat/lng) ---------- */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]] : null;
}

export function applyH(H, p) {
  const w = H[2][0] * p[0] + H[2][1] * p[1] + H[2][2];
  return [(H[0][0] * p[0] + H[0][1] * p[1] + H[0][2]) / w, (H[1][0] * p[0] + H[1][1] * p[1] + H[1][2]) / w];
}

export function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// Homografía por mínimos cuadrados (4 o más puntos), con normalización de Hartley
function normT(pts) {
  const n = pts.length, cx = pts.reduce((a, p) => a + p[0], 0) / n, cy = pts.reduce((a, p) => a + p[1], 0) / n;
  const d = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1, k = Math.SQRT2 / d;
  return [[k, 0, -k * cx], [0, k, -k * cy], [0, 0, 1]];
}
const mul3 = (A, B) => A.map((r, i) => B[0].map((_, j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export function homographyLSQ(src, dst) {
  if (src.length < 4) return null;
  const Ts = normT(src), Td = normT(dst);
  const s = src.map(p => applyH(Ts, p)), d = dst.map(p => applyH(Td, p));
  const N = Array.from({ length: 8 }, () => Array(8).fill(0)), v = Array(8).fill(0);
  const add = (row, b) => { for (let i = 0; i < 8; i++) { v[i] += row[i] * b; for (let j = 0; j < 8; j++) N[i][j] += row[i] * row[j]; } };
  s.forEach(([x, y], i) => {
    const [u, w] = d[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -w * x, -w * y], w);
  });
  const h = solve(N, v); if (!h) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const Tdi = invert3(Td); if (!Tdi) return null;
  const H = mul3(mul3(Tdi, Hn), Ts);
  return H.map(r => r.map(x => x / H[2][2]));
}

// Georreferencia: devuelve transformaciones o null si faltan puntos (mínimo 4)
export function controlPoints(georef) {
  return (georef?.points || []).filter(p => p.map && p.lat !== null && p.lng !== null && p.lat !== '' && p.lng !== '' && isFinite(p.lat) && isFinite(p.lng));
}
// Lotes cargados desde KML: proyección local exacta (sin puntos de control)
const RT = 6371008.8, RAD = Math.PI / 180;
export function kmlGeo(g) {
  const kx = g.s * RT * Math.cos(g.lat0 * RAD) * RAD, ky = g.s * RT * RAD;
  return {
    toMap: (lat, lng) => [g.ox + (lng - g.lng0) * kx, g.oy - (lat - g.lat0) * ky],
    toLatLng: p => [g.lat0 - (p[1] - g.oy) / ky, g.lng0 + (p[0] - g.ox) / kx],
    metersPerUnit: 1 / g.s, kml: true, count: 0, residuals: [],
  };
}
export function buildGeo(georef) {
  if (georef?.mode === 'kml' && isFinite(georef.s) && georef.s > 0) return kmlGeo(georef);
  const pts = controlPoints(georef);
  if (pts.length < 4) return null;
  const src = pts.map(p => p.map), dst = pts.map(p => [+p.lng, +p.lat]);
  const H = pts.length === 4 ? homography(src, dst) : homographyLSQ(src, dst);
  if (!H) return null;
  const Hi = invert3(H); if (!Hi) return null;
  const geo = {
    toLatLng: p => { const [lng, lat] = applyH(H, p); return [lat, lng]; },
    toMap: (lat, lng) => applyH(Hi, [lng, lat]),
    count: pts.length,
  };
  geo.metersPerUnit = metersBetween(geo.toLatLng(src[0]), geo.toLatLng([src[0][0] + 10, src[0][1]])) / 10;
  // desvío de cada punto (metros) entre lo medido y lo que ubica el ajuste
  geo.residuals = pts.map(p => ({ key: p.key, m: metersBetween([+p.lat, +p.lng], geo.toLatLng(p.map)) }));
  return isFinite(geo.toLatLng(src[0])[0]) ? geo : null;
}

/* ---------- Esquinas de lotes con orientación (N, NE, E, SE, S, SO, O, NO) ---------- */
const SECT = ['E', 'NE', 'N', 'NO', 'O', 'SO', 'S', 'SE'];
export function sectorOf(dx, dy) { // y del mapa crece hacia el sur
  const a = Math.atan2(-dy, dx), k = Math.round(a / (Math.PI / 4));
  return SECT[(k + 8) % 8];
}
export function lotCorners(lot) {
  const c = centroid(lot.poly);
  const list = lot.poly.map((p, i) => ({ vi: i, map: p, sector: sectorOf(p[0] - c[0], p[1] - c[1]), ang: Math.atan2(-(p[1] - c[1]), p[0] - c[0]) }));
  const order = SECT;
  const groups = {};
  list.forEach(v => (groups[v.sector] = groups[v.sector] || []).push(v));
  Object.values(groups).forEach(g => {
    if (g.length < 2) { g[0].label = g[0].sector; return; }
    g.sort((a, b) => b.ang - a.ang).forEach((v, i) => { v.label = `${v.sector} ${i + 1}`; });
  });
  return list.sort((a, b) => order.indexOf(a.sector) - order.indexOf(b.sector) || a.label.localeCompare(b.label));
}
export const pointKey = (lote, vi) => `L${lote}-${vi}`;

// Convierte puntos antiguos (esquinas fijas) al formato lote + vértice
export function migrateGeoref(georef, lots) {
  return {
    points: (georef?.points || []).map(p => {
      if (p.lote) return p;
      for (const l of lots) {
        const vi = l.poly.findIndex(q => p.map && dist(q, p.map) < 0.6);
        if (vi >= 0) {
          const c = lotCorners(l).find(x => x.vi === vi);
          return { ...p, key: pointKey(l.num, vi), lote: l.num, vi, label: `Lote ${l.num} · ${c.label}` };
        }
      }
      return p;
    }),
  };
}

// Punto interior más alejado de los bordes (para etiquetas)
export function poleLabel(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  poly.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  let best = null; const n = 40;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = [x0 + ((x1 - x0) * (i + 0.5)) / n, y0 + ((y1 - y0) * (j + 0.5)) / n];
    if (!pointInPoly(p, poly)) continue;
    const d = snapToBorder(p, poly).dist;
    if (!best || d > best.d) best = { d, p };
  }
  return best ? best.p.map(v => Math.round(v * 10) / 10) : centroid(poly);
}

// Área real (ha) de un polígono del mapa usando la georreferencia
export function areaHa(poly, geo) {
  if (!geo) return null;
  const ll = poly.map(p => geo.toLatLng(p));
  const lat0 = ll.reduce((s, p) => s + p[0], 0) / ll.length;
  const R = 6371008.8, k = Math.PI / 180;
  const m = ll.map(([la, lo]) => [lo * k * R * Math.cos(lat0 * k), la * k * R]);
  return Math.abs(signedArea(m)) / 10000;
}

export function metersBetween(a, b) { // [lat,lng]
  const R = 6371008.8, k = Math.PI / 180;
  const dLat = (b[0] - a[0]) * k, dLng = (b[1] - a[1]) * k;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Lote que contiene el punto, o el de borde más cercano
export function locateLot(p, lots) {
  const inside = lots.find(l => pointInPoly(p, l.poly));
  if (inside) return { lot: inside, inside: true, snap: snapToBorder(p, inside.poly) };
  let best = null;
  lots.forEach(l => { const s = snapToBorder(p, l.poly); if (!best || s.dist < best.snap.dist) best = { lot: l, inside: false, snap: s }; });
  return best;
}

/* ---------- IDs de silobolsa: RB + lote(2) + número(3) ---------- */
export function parseSiloId(id) {
  const m = /^([A-Z]+)(\d{2})(\d{3})$/.exec(id || '');
  return m ? { sigla: m[1], lote: +m[2], num: +m[3] } : null;
}
export function nextSiloId(sigla, lotNum, silos, exceptId) {
  let max = 0;
  silos.forEach(s => {
    if (s.id === exceptId) return;
    const p = parseSiloId(s.id);
    if (p && p.lote === lotNum && p.sigla === sigla) max = Math.max(max, p.num);
  });
  return `${sigla}${String(lotNum).padStart(2, '0')}${String(max + 1).padStart(3, '0')}`;
}

/* ---------- Lotes: número (1–99, reciben silobolsas) o nombre con letras (ej. «Casco», sin silos) ---------- */
export const isSiloLot = l => typeof (l?.num ?? l) === 'number';
export const lotName = num => (typeof num === 'number' ? `Lote ${num}` : String(num));
// Convierte lo que escribe el usuario: «16» → 16 · «Casco» → 'Casco' · inválido → null
export function parseLotCode(v) {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (/^\d{1,2}$/.test(t)) { const n = +t; return n >= 1 && n <= 99 ? n : null; }
  return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ .-]{0,15}$/.test(t) ? t : null;
}
export const lotKey = num => (typeof num === 'number' ? `n${num}` : `s${String(num).toLowerCase()}`);
export const sortLots = (a, b) => (isSiloLot(a) && isSiloLot(b) ? a.num - b.num : isSiloLot(a) ? -1 : isSiloLot(b) ? 1 : String(a.num).localeCompare(String(b.num), 'es'));

/* ---------- Identidad de lotes y estancias ----------
   Un mismo número puede repetirse en estancias distintas (lote 31 de Baguales y de Los Gatos):
   cada lote tiene un id único («k…:31» si viene de un KML, «31» si es del plano) y cada silo guarda «lot» (ese id). */
export const lotIdOf = l => (l.id != null ? String(l.id) : l.kml ? `${l.kml}:${l.num}` : String(l.num));
export function siglaDe(nombre) {
  const w = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().match(/[A-Z]+/g) || [];
  const main = w.filter(x => !['DE', 'DEL', 'Y'].includes(x));
  return (main.length > 1 ? main.map(x => x[0]).join('') : (main[0] || w[0] || 'XX').slice(0, 2)).slice(0, 4);
}
// Completa ids, estancia de cada lote y lote de cada silo (datos guardados con versiones anteriores)
export function normalizeState(st) {
  if (!st) return st;
  const kmls = Array.isArray(st.georef?.kmls) ? st.georef.kmls : st.georef?.mode === 'kml' ? [{ id: 'k1', archivo: st.georef.kml?.archivo || 'KML', fecha: st.georef.kml?.fecha || null, lotes: (st.lots || []).map(l => l.num) }] : [];
  // la primera estancia de datos anteriores conserva la sigla general (RB) para no cambiar la numeración
  const ks = kmls.map((k, i) => { const nombre = k.nombre || String(k.archivo || 'Sección').replace(/\.km[lz]$/i, '').replace(/[_-]+/g, ' ').trim(); return { ...k, nombre, sigla: k.sigla || (i === 0 && st.estancia?.sigla) || siglaDe(nombre) }; });
  const lots = (st.lots || []).map(l => { const kml = l.kml || (ks.find(k => (k.lotes || []).includes(l.num))?.id ?? null); const x = { ...l, kml }; return { ...x, id: lotIdOf(x) }; });
  const byId = new Set(lots.map(l => l.id));
  const silos = (st.silos || []).map(s => (s.lot && byId.has(s.lot) ? s : { ...s, lot: (lots.find(l => l.num === s.lote) || {}).id || null }));
  return { ...st, lots, silos, georef: st.georef ? { ...st.georef, ...(ks.length ? { kmls: ks } : {}) } : st.georef };
}
export const siloLot = (s, lots) => lots.find(l => l.id === s.lot) || lots.find(l => l.num === s.lote) || null;
export function siglaOf(lot, state) {
  const k = lot?.kml && (state.georef?.kmls || []).find(x => x.id === lot.kml);
  return k?.sigla || state.estancia?.sigla || 'RB';
}
export function estanciaNombre(lot, state) {
  const k = lot?.kml && (state.georef?.kmls || []).find(x => x.id === lot.kml);
  return k?.nombre || '';
}
