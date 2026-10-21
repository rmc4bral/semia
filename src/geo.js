// SemIA · utilidades geométricas (coordenadas del mapa: x → este, y → sur)

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

// Georreferencia: devuelve transformaciones o null si faltan puntos
export function buildGeo(georef) {
  const pts = (georef?.points || []).filter(p => isFinite(p.lat) && isFinite(p.lng) && p.lat !== null && p.lng !== null);
  if (pts.length < 4) return null;
  const src = pts.map(p => p.map), dst = pts.map(p => [p.lng, p.lat]);
  const H = homography(src, dst); if (!H) return null;
  const Hi = invert3(H); if (!Hi) return null;
  return {
    toLatLng: p => { const [lng, lat] = applyH(H, p); return [lat, lng]; },
    toMap: (lat, lng) => applyH(Hi, [lng, lat]),
  };
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
