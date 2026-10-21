import assert from 'assert';
import * as G from '../src/geo.js';
import * as S from '../src/shapes.js';
import data from '../public_html/data.seed.json' with { type: 'json' };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// 1. Todos los lotes válidos, sin solaparse groseramente y etiquetas dentro
ok(data.lots.length === 25, '25 lotes');
const nums = data.lots.map(l => l.num).sort((a, b) => a - b);
ok(nums.join() === Array.from({ length: 25 }, (_, i) => i + 1).join(), 'lotes 1..25');
data.lots.forEach(l => {
  ok(G.pointInPoly(l.label, l.poly), `etiqueta dentro del lote ${l.num}`);
  l.subs.forEach(s => ok(G.pointInPoly(s.label, l.poly), `sublote ${l.num}${s.id} dentro`));
  if (l.subs.length) ok(Math.abs(l.subs.reduce((a, s) => a + s.ha, 0) - l.ha) < 1, `subs suman ${l.num}`);
  data.lots.forEach(o => { if (o !== l) ok(!G.pointInPoly(l.label, o.poly), `etiqueta ${l.num} no cae en ${o.num}`); });
});
// área total de lotes ≈ contorno (sin huecos ni superposición)
const sumA = data.lots.reduce((a, l) => a + Math.abs(G.signedArea(l.poly)), 0), outA = Math.abs(G.signedArea(data.outline));
ok(Math.abs(sumA - outA) / outA < 0.02, `lotes cubren el contorno (${(sumA / outA * 100).toFixed(2)}%)`);

// 2. Homografía: ida y vuelta con 4 esquinas
const corners = { NO: [-35.9, -60.42], NE: [-35.9025, -60.33], SE: [-35.995, -60.333], SO: [-35.992, -60.425] };
const ck = ['NO', 'NE', 'SE', 'SO'];
const georef = { points: data.georef.points.map((p, i) => ({ ...p, key: ck[i], lat: corners[ck[i]][0], lng: corners[ck[i]][1] })) };
const geo = G.buildGeo(georef);
ok(geo, 'georef construida');
georef.points.forEach(p => { const ll = geo.toLatLng(p.map); ok(Math.abs(ll[0] - corners[p.key][0]) < 1e-9 && Math.abs(ll[1] - corners[p.key][1]) < 1e-9, 'esquina exacta ' + p.key); });
for (let i = 0; i < 50; i++) { const m = [Math.random() * 700 + 10, Math.random() * 850 + 10]; const [la, lo] = geo.toLatLng(m); const b = geo.toMap(la, lo); ok(G.dist(m, b) < 1e-6, 'ida y vuelta'); }
ok(G.buildGeo({ points: data.georef.points }) === null, 'sin coordenadas → null');
const ha = data.lots.reduce((a, l) => a + G.areaHa(l.poly, geo), 0);
ok(ha > 5000 && ha < 12000, `área georref plausible ${ha.toFixed(0)} ha`);

// 3. GPS dentro del lote 16 → borde del lote 16
const l16 = data.lots.find(l => l.num === 16);
const [la, lo] = geo.toLatLng(l16.label);
const loc = G.locateLot(geo.toMap(la + 0.0001, lo), data.lots);
ok(loc.lot.num === 16 && loc.inside, 'ubicación cae en el lote 16');
ok(loc.snap.dist >= 0 && G.dist(loc.snap.point, G.pointAt(l16.poly, loc.snap.t).point) < 1e-6, 'snap coherente con t');
const outside = G.locateLot([-50, 400], data.lots); ok(!outside.inside && outside.lot, 'fuera del campo → borde más cercano');

// 4. Recorrido por el borde
const L = G.perimeter(l16.poly).at(-1);
const path = G.borderPath(l16.poly, 5, L - 5);
const plen = path.slice(1).reduce((a, p, i) => a + G.dist(path[i], p), 0);
ok(Math.abs(plen - 10) < 1e-6, 'camino más corto por el borde (cruza el vértice)');

// 5. IDs RB + lote + bolsa
ok(G.nextSiloId('RB', 16, []) === 'RB16001', 'primer ID');
ok(G.nextSiloId('RB', 16, [{ id: 'RB16001' }, { id: 'RB16003' }, { id: 'RB05001' }]) === 'RB16004', 'siguiente ID');
ok(G.nextSiloId('RB', 5, [{ id: 'RB16001' }]) === 'RB05001', 'lote de 1 dígito');
ok(JSON.stringify(G.parseSiloId('RB16001')) === '{"sigla":"RB","lote":16,"num":1}', 'parse ID');
// 6. Más de 4 puntos: mínimos cuadrados y desvíos
const extra = [data.lots.find(l => l.num === 16).poly[0], data.lots.find(l => l.num === 13).poly[2]];
const pts6 = [...georef.points, ...extra.map((m, i) => { const [la, lo] = geo.toLatLng(m); return { key: 'x' + i, map: m, lat: la + (i ? 0.00002 : -0.00002), lng: lo }; })];
const geo6 = G.buildGeo({ points: pts6 });
ok(geo6 && geo6.count === 6 && geo6.residuals.length === 6, 'ajuste con 6 puntos');
ok(geo6.residuals.every(r => r.m < 5), `desvíos chicos con ruido de 2 m (${geo6.residuals.map(r => r.m.toFixed(2)).join(', ')})`);
const bad = pts6.map((p, i) => (i === 5 ? { ...p, lat: p.lat + 0.001 } : p));
const geoBad = G.buildGeo({ points: bad });
ok(geoBad.residuals.reduce((a, r) => (r.m > a.m ? r : a)).key === 'x1', 'detecta el punto mal tomado');

// 7. Esquinas por orientación
const c21 = G.lotCorners(data.lots.find(l => l.num === 21));
ok(c21.find(c => c.vi === 0).sector === 'NO', 'lote 21: vértice 0 al NO');
const c6 = G.lotCorners(data.lots.find(l => l.num === 6));
ok(c6.find(c => c.vi === 2).sector === 'SE' && new Set(c6.map(c => c.label)).size === c6.length, 'lote 6: SE y etiquetas únicas');
data.lots.forEach(l => { const c = G.lotCorners(l); ok(new Set(c.map(x => x.label)).size === c.length, `etiquetas únicas lote ${l.num}`); });
const mig = G.migrateGeoref({ points: [{ key: 'NO', map: data.outline[0], lat: 1, lng: 2 }] }, data.lots);
ok(mig.points[0].lote === 21 && mig.points[0].vi === 0 && mig.points[0].lat === 1, 'migra puntos antiguos');

// 8. Edición de forma: vértice compartido entre lotes 15/16/17/18
const st = JSON.parse(JSON.stringify(data));
let g = S.cloneGeom(st);
const l15 = g.lots.find(l => l.num === 15), shared = l15.poly[1];
const before = g.lots.filter(l => l.poly.some(q => G.dist(q, shared) < 0.6)).map(l => l.num);
ok(before.length >= 2, `vértice compartido por lotes ${before}`);
const to = [shared[0] + 3, shared[1] - 2];
g = S.moveVertex(g, shared, to);
ok(before.every(num => g.lots.find(l => l.num === num).poly.some(q => G.dist(q, to) < 1e-6)), 'los lotes vecinos se mueven juntos');
ok(g.lots.find(l => l.num === 15).subs.some(s => s.poly.some(q => G.dist(q, to) < 1e-6)), 'las subdivisiones acompañan');
const n16 = g.lots.find(l => l.num === 16).poly.length;
const ins = S.insertVertex(g, 16, 0); g = ins.geom;
ok(g.lots.find(l => l.num === 16).poly.length === n16 + 1, 'agrega vértice');
const neigh = g.lots.filter(l => l.num !== 16 && l.poly.some(q => G.dist(q, ins.point) < 1e-6)).map(l => l.num);
ok(neigh.length >= 1, `el lote vecino también recibe el vértice (${neigh})`);
const rem = S.removeVertex(g, ins.point); ok(!rem.error && rem.geom.lots.find(l => l.num === 16).poly.length === n16, 'quita vértice');
ok(S.removeVertex(S.cloneGeom({ lots: [{ num: 10, poly: [[0, 0], [1, 0], [0, 1]], subs: [] }], outline: [[5, 5], [6, 5], [5, 6], [6, 6]] }), [0, 0]).error, 'no deja lotes con menos de 3 vértices');
st.silos = [{ id: 'RB15001', lote: 15, map: shared, t: 0, ang: 0 }];
const ch = S.buildShapeChange(st, g, geo);
ok(ch.lots.length >= 2 && ch.silos.length === 1 && G.snapToBorder(ch.silos[0].map, g.lots.find(l => l.num === 15).poly).dist < 0.01, 'silos reubicados sobre el nuevo borde');
ok(ch.lots.every(l => G.pointInPoly(l.label, l.poly)), 'etiquetas recalculadas dentro del lote');
const r = S.restoreLot(g, { ...data.lots.find(l => l.num === 15), poly0: data.lots.find(l => l.num === 15).poly });
ok(G.dist(r.lots.find(l => l.num === 15).poly[1], shared) < 1e-6, 'restablece la forma original');
ok(S.isLocked(data.outline[0], [data.outline[0]]), 'punto de control bloqueado');
console.log(`geo: ${n} comprobaciones OK`);
