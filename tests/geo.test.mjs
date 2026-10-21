import assert from 'assert';
import * as G from '../src/geo.js';
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
const georef = { points: data.georef.points.map(p => ({ ...p, lat: corners[p.key][0], lng: corners[p.key][1] })) };
const geo = G.buildGeo(georef);
ok(geo, 'georef construida');
data.georef.points.forEach(p => { const ll = geo.toLatLng(p.map); ok(Math.abs(ll[0] - corners[p.key][0]) < 1e-9 && Math.abs(ll[1] - corners[p.key][1]) < 1e-9, 'esquina exacta ' + p.key); });
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
console.log(`geo: ${n} comprobaciones OK`);
