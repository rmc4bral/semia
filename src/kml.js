// SemIA · lotes desde KML / KMZ (Google Earth, QGIS, Pix4Dfields…)
// Los lotes quedan en coordenadas reales: el mapa usa una proyección local exacta
// (x → este, y → sur) escalada para que el campo mida ~900 unidades.
import { signedArea, pointInPoly, poleLabel, snapToBorder, kmlGeo } from './geo.js';
export { kmlGeo };

const R = 6371008.8, RAD = Math.PI / 180;
export const MAP_SPAN = 900;

/* ---------- KMZ: lector zip mínimo (deflate con DecompressionStream) ---------- */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede abrir KMZ. Exportá el archivo como KML.');
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
export async function unzipFirstKml(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El KMZ está dañado (no es un zip válido)');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.push({ name, method, csize, off });
    p += 46 + nlen + elen + clen;
  }
  const kmls = entries.filter(e => /\.kml$/i.test(e.name)).sort((a, b) => (/(^|\/)doc\.kml$/i.test(b.name) ? 1 : 0) - (/(^|\/)doc\.kml$/i.test(a.name) ? 1 : 0));
  if (!kmls.length) throw new Error('El KMZ no contiene ningún archivo KML');
  const e = kmls[0];
  const ln = dv.getUint16(e.off + 26, true), le = dv.getUint16(e.off + 28, true);
  const data = u8.subarray(e.off + 30 + ln + le, e.off + 30 + ln + le + e.csize);
  const raw = e.method === 0 ? data : e.method === 8 ? await inflateRaw(data) : null;
  if (!raw) throw new Error('Compresión del KMZ no soportada');
  return new TextDecoder().decode(raw);
}

export async function readKmlFile(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
  return isZip ? unzipFirstKml(buf) : new TextDecoder().decode(u8);
}

/* ---------- Parser ---------- */
const arr = nl => Array.from({ length: nl?.length || 0 }, (_, i) => nl[i]);
const kids = (el, name) => (el ? arr(el.getElementsByTagName('*')).filter(x => x.localName === name) : []);
const child = (el, name) => (el ? arr(el.childNodes).find(x => x.nodeType === 1 && x.localName === name) : null);
const txt = el => (el?.textContent || '').trim();

function parseCoords(s) {
  const out = [];
  s.trim().split(/\s+/).forEach(t => {
    const [lng, lat] = t.split(',').map(Number);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push([lat, lng]);
  });
  if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (a[0] === b[0] && a[1] === b[1]) out.pop(); }
  return out;
}

function extData(pm) {
  const o = {};
  kids(pm, 'Data').forEach(d => { o[(d.getAttribute('name') || '').trim()] = txt(child(d, 'value')); });
  kids(pm, 'SimpleData').forEach(d => { o[(d.getAttribute('name') || '').trim()] = txt(d); });
  // descripción en tabla HTML (exportación de QGIS/ArcGIS): <td>campo</td><td>valor</td>
  const desc = txt(child(pm, 'description'));
  const re = /<t[dh][^>]*>\s*([^<]{1,40}?)\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<]{0,80}?)\s*<\/t[dh]>/gi;
  let m; while ((m = re.exec(desc))) if (!(m[1] in o)) o[m[1]] = m[2];
  return o;
}
const pick = (o, re) => { const k = Object.keys(o).find(x => re.test(x.trim())); return k ? o[k] : null; };
const toNum = v => {
  if (v == null) return null;
  let t = String(v).trim().replace(/[^\d.,-]/g, '');
  t = /,\d{1,3}$/.test(t) && !/\.\d{1,3}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = parseFloat(t); return isFinite(n) ? n : null;
};

export function geodesicHa(ring) { // ring: [[lat,lng]]
  const lat0 = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const m = ring.map(([la, lo]) => [lo * RAD * R * Math.cos(lat0 * RAD), la * RAD * R]);
  return Math.abs(signedArea(m)) / 10000;
}

const OUTLINE_RE = /\b(campo|estancia|per[ií]metro|contorno|l[ií]mite|establecimiento)\b/i;

// Devuelve { features: [{ key, name, folder, num, nombre, ha, haKml, ring, isOutline, warn }], lines, points }
export function parseKml(text, Parser = globalThis.DOMParser) {
  const doc = new Parser().parseFromString(text, 'application/xml');
  if (!doc?.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un KML válido');
  const features = [], lines = [];
  kids(doc, 'Placemark').forEach((pm, idx) => {
    const name = txt(child(pm, 'name'));
    const folder = (() => { let p = pm.parentNode; while (p && p.localName !== 'Folder' && p.localName !== 'Document') p = p.parentNode; return p ? txt(child(p, 'name')) : ''; })();
    const ext = extData(pm);
    const polys = kids(pm, 'Polygon').map(pg => parseCoords(txt(kids(kids(pg, 'outerBoundaryIs')[0], 'coordinates')[0]))).filter(r => r.length >= 3);
    kids(pm, 'LineString').forEach(ls => { const c = parseCoords(txt(kids(ls, 'coordinates')[0])); if (c.length >= 2) lines.push({ name, ring: c }); });
    if (!polys.length) return;
    const ring = polys.sort((a, b) => geodesicHa(b) - geodesicHa(a))[0];
    // número de lote: campo de datos o primer número del nombre
    const fieldNum = toNum(pick(ext, /^(lote|n[uú]m(ero)?|nro|n°|id_?lote|cod(igo)?)$/i));
    const m = /(\d{1,3})/.exec(name);
    const num = fieldNum && fieldNum > 0 ? Math.round(fieldNum) : m ? +m[1] : null;
    const nombre = (pick(ext, /^(nombre|name|denominaci[oó]n)$/i) || name.replace(/^\s*(lote|lt|l)?\s*\.?\s*\d{1,3}\s*[-–:·.]?\s*/i, '')).trim().slice(0, 60);
    const haKml = toNum(pick(ext, /^(ha|has|hect[aá]reas?|sup(erficie)?(_ha)?|area_?ha)$/i));
    const isOutline = !num && OUTLINE_RE.test(`${name} ${folder}`);
    features.push({
      key: `f${idx}`, name: name || `Polígono ${idx + 1}`, folder, num: isOutline ? null : num, nombre: nombre === name ? '' : nombre,
      haKml, ha: +geodesicHa(ring).toFixed(1), ring, isOutline, multi: polys.length > 1,
    });
  });
  if (!features.length) throw new Error('El KML no tiene polígonos. Los lotes tienen que estar dibujados como polígonos.');
  return { features, lines };
}

/* ---------- Proyección local exacta ---------- */
export function makeProjection(rings) {
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  rings.flat().forEach(([la, lo]) => { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); });
  const lat0 = (la0 + la1) / 2, lng0 = (lo0 + lo1) / 2;
  const wM = (lo1 - lo0) * RAD * R * Math.cos(lat0 * RAD), hM = (la1 - la0) * RAD * R;
  const s = MAP_SPAN / Math.max(wM, hM, 1); // unidades de mapa por metro
  const kx = s * R * Math.cos(lat0 * RAD) * RAD, ky = s * R * RAD;
  const ox = 10 + (wM * s) / 2, oy = 10 + (hM * s) / 2;
  return { mode: 'kml', lat0: +lat0.toFixed(8), lng0: +lng0.toFixed(8), s: +s.toPrecision(10), ox: +ox.toFixed(3), oy: +oy.toFixed(3), kx, ky };
}
// Simplificación Douglas–Peucker (tolerancia en unidades de mapa)
function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = true; stack.push([a, mi], [mi, b]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  p.forEach(q => { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
  [...p].reverse().forEach(q => { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); });
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

const r2 = v => Math.round(v * 100) / 100;

/**
 * Arma el cambio completo para el servidor a partir de los polígonos elegidos.
 * rows: [{ key, num, nombre, include }] (decisiones del usuario sobre parseKml().features)
 * Los silos existentes se reubican por sus coordenadas reales (latlng); si no tienen, quedan en su lote.
 */
export function buildKmlImport(parsed, rows, state, oldGeo, meta = {}) {
  const byKey = Object.fromEntries(parsed.features.map(f => [f.key, f]));
  const chosen = rows.filter(r => r.include && byKey[r.key] && !byKey[r.key].isOutline);
  const nums = chosen.map(r => +r.num);
  if (!chosen.length) throw new Error('Elegí al menos un polígono como lote');
  if (nums.some(n => !(n >= 1 && n <= 99 && Number.isInteger(n)))) throw new Error('Cada lote necesita un número entre 1 y 99');
  const dup = nums.find((n, i) => nums.indexOf(n) !== i);
  if (dup) throw new Error(`El número de lote ${dup} está repetido`);
  const outlineF = parsed.features.find(f => f.isOutline && rows.find(r => r.key === f.key)?.include !== false);
  const proj = makeProjection(chosen.map(r => byKey[r.key].ring).concat(outlineF ? [outlineF.ring] : []));
  const geo = kmlGeo(proj);
  const tol = 0.8 * proj.s; // ~0,8 m
  const toPoly = ring => {
    let poly = simplify(ring.map(([la, lo]) => geo.toMap(la, lo)).map(p => [r2(p[0]), r2(p[1])]), tol);
    if (signedArea(poly) < 0) poly = poly.reverse(); // horario en pantalla (y hacia el sur)
    return poly;
  };
  const prevLots = Object.fromEntries((state.lots || []).map(l => [l.num, l]));
  const lots = chosen.map(r => {
    const f = byKey[r.key], poly = toPoly(f.ring), prev = prevLots[+r.num];
    return {
      num: +r.num, ha: f.haKml ?? f.ha, nombre: (r.nombre ?? f.nombre ?? '').slice(0, 60) || prev?.nombre || '', obs: prev?.obs || '',
      poly, subs: [], label: poleLabel(poly),
    };
  }).sort((a, b) => a.num - b.num);
  const outline = outlineF ? toPoly(outlineF.ring) : convexHull(lots.flatMap(l => l.poly)).map(p => [r2(p[0]), r2(p[1])]);

  // silos: reproyectar
  const silos = []; let sinCoord = 0;
  (state.silos || []).forEach(s => {
    const ll = s.latlng || (oldGeo && s.map ? oldGeo.toLatLng(s.map) : null);
    let map = ll ? geo.toMap(ll[0], ll[1]).map(r2) : null;
    const ll2 = s.latlng2 || (oldGeo && s.map2 ? oldGeo.toLatLng(s.map2) : null);
    const map2 = ll2 ? geo.toMap(ll2[0], ll2[1]).map(r2) : null;
    let lot = lots.find(l => l.num === s.lote) || null;
    if (map) { const inside = lots.find(l => pointInPoly(map, l.poly)); if (inside && (!lot || !pointInPoly(map, lot.poly))) lot = inside; }
    if (!lot) lot = lots[0];
    if (!map) { map = [...lot.label]; sinCoord++; }
    const u = { id: s.id, lote: lot.num, map, map2: map2 || null, t: null, ang: null, latlng: ll ? ll.map(v => +(+v).toFixed(7)) : geo.toLatLng(map).map(v => +v.toFixed(7)), latlng2: ll2 ? ll2.map(v => +(+v).toFixed(7)) : null };
    if (isFinite(s.t) && s.t !== null && !s.map2) { const sn = snapToBorder(map, lot.poly); u.map = sn.point.map(r2); u.t = r2(sn.t); u.ang = +sn.angle.toFixed(4); }
    silos.push(u);
  });
  const { kx, ky, ...georefCore } = proj;
  return {
    lots, outline, silos, sinCoord,
    georef: { ...georefCore, points: [], kml: { archivo: (meta.archivo || '').slice(0, 120), fecha: new Date().toISOString(), lotes: lots.length } },
    lines: parsed.lines.slice(0, 200).map(l => ({ name: l.name.slice(0, 60), pts: simplify(l.ring.map(([la, lo]) => geo.toMap(la, lo)).map(p => [r2(p[0]), r2(p[1])]), tol) })),
  };
}

/* ---------- Exportar KML (lotes + silobolsas) ---------- */
const xesc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const kc = ll => `${(+ll[1]).toFixed(7)},${(+ll[0]).toFixed(7)},0`;
export function exportKml(state, geo) {
  const lots = geo ? state.lots.map(l => `<Placemark><name>Lote ${l.num}${l.nombre ? ` - ${xesc(l.nombre)}` : ''}</name><styleUrl>#lote</styleUrl>
<ExtendedData><Data name="lote"><value>${l.num}</value></Data><Data name="ha"><value>${l.ha}</value></Data></ExtendedData>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${[...l.poly, l.poly[0]].map(p => kc(geo.toLatLng(p))).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`).join('\n') : '';
  const silos = state.silos.map(s => {
    const a = s.latlng || (geo && s.map ? geo.toLatLng(s.map) : null); if (!a) return '';
    const b = s.latlng2 || (geo && s.map2 ? geo.toLatLng(s.map2) : null);
    const data = [['id', s.id], ['lote', s.lote], ['kg', s.kg], ['grano', s.grano], ['largo_m', s.largo], ['obs', s.obs]].filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `<Data name="${k}"><value>${xesc(v)}</value></Data>`).join('');
    const geom = b ? `<LineString><tessellate>1</tessellate><coordinates>${kc(a)} ${kc(b)}</coordinates></LineString>` : `<Point><coordinates>${kc(a)}</coordinates></Point>`;
    return `<Placemark><name>${xesc(s.id)}</name><description>${xesc(`${s.kg ?? ''} kg ${s.grano || ''}`.trim())}</description><styleUrl>#silo</styleUrl><ExtendedData>${data}</ExtendedData>${geom}</Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>SemIA · ${xesc(state.estancia?.nombre)}</name>
<Style id="lote"><LineStyle><color>ff00ffcc</color><width>2</width></LineStyle><PolyStyle><color>2200ffcc</color></PolyStyle></Style>
<Style id="silo"><LineStyle><color>ffffffff</color><width>6</width></LineStyle><IconStyle><color>ff00ffcc</color></IconStyle></Style>
<Folder><name>Lotes</name>
${lots}
</Folder><Folder><name>Silobolsas</name>
${silos}
</Folder></Document></kml>`;
}
