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

// 8. Edición de forma: cada lote por separado (sin mover vecinos)
const st = JSON.parse(JSON.stringify(data));
let g = S.cloneGeom(st);
const l15 = g.lots.find(l => l.num === 15), shared = l15.poly[1];
const before = g.lots.filter(l => l.num !== 15 && l.poly.some(q => G.dist(q, shared) < 0.6)).map(l => l.num);
ok(before.length >= 1, `el vértice es compartido con los lotes ${before}`);
const to = [shared[0] + 3, shared[1] - 2];
const polysBefore = JSON.stringify(g.lots.filter(l => l.num !== 15).map(l => l.poly));
g = S.moveVertex(g, 15, shared, to);
ok(G.dist(g.lots.find(l => l.num === 15).poly[1], to) < 1e-6, 'el lote 15 mueve su vértice');
ok(JSON.stringify(g.lots.filter(l => l.num !== 15).map(l => l.poly)) === polysBefore, 'los lotes vecinos NO se mueven');
ok(JSON.stringify(g.outline) === JSON.stringify(data.outline), 'el contorno no cambia');
ok(g.lots.find(l => l.num === 15).subs.every(s => s.poly.every(q => G.dist(q, shared) > 0.6)), 'las subdivisiones del mismo lote acompañan');
const n16 = g.lots.find(l => l.num === 16).poly.length;
const ins = S.insertVertex(g, 16, 0); g = ins.geom;
ok(g.lots.find(l => l.num === 16).poly.length === n16 + 1, 'agrega vértice');
ok(g.lots.filter(l => l.num !== 16).every((l, i) => l.poly.length === data.lots.find(x => x.num === l.num).poly.length), 'los vecinos no reciben el vértice');
const rem = S.removeVertex(g, 16, ins.point); ok(!rem.error && rem.geom.lots.find(l => l.num === 16).poly.length === n16, 'quita vértice');
ok(S.removeVertex(S.cloneGeom({ lots: [{ num: 10, poly: [[0, 0], [1, 0], [0, 1]], subs: [] }], outline: [[5, 5], [6, 5], [5, 6], [6, 6]] }), 10, [0, 0]).error, 'no deja lotes con menos de 3 vértices');
st.silos = [{ id: 'RB15001', lote: 15, map: shared, t: 0, ang: 0 }];
const ch = S.buildShapeChange(st, g, geo);
ok(ch.lots.length === 2 && ch.silos.length === 1 && G.snapToBorder(ch.silos[0].map, g.lots.find(l => l.num === 15).poly).dist < 0.01, 'solo se guardan los lotes editados y los silos se reubican sobre el nuevo borde');
ok(ch.lots.every(l => G.pointInPoly(l.label, l.poly)), 'etiquetas recalculadas dentro del lote');
const r = S.restoreLot(g, { ...data.lots.find(l => l.num === 15), poly0: data.lots.find(l => l.num === 15).poly });
ok(G.dist(r.lots.find(l => l.num === 15).poly[1], shared) < 1e-6, 'restablece la forma original');
ok(S.isLocked(data.outline[0], [data.outline[0]]), 'punto de control bloqueado');
console.log(`geo: ${n} comprobaciones OK`);

// 9. Proyecciones de GeoTIFF (comparadas con PROJ/pyproj)
const { toLatLng } = await import('../src/proj.js');
const cases = JSON.parse((await import('fs')).readFileSync(new URL('./proj-cases.json', import.meta.url)));
let worstP = 0;
let worstP07 = 0;
cases.forEach(c => { const [la, lo] = toLatLng(c.code, c.x, c.y), d = G.metersBetween([la, lo], [c.lat, c.lng]); if (c.code >= 5343 && c.code <= 5349) worstP07 = Math.max(worstP07, d); else worstP = Math.max(worstP, d); });
ok(worstP < 0.05, `UTM / POSGAR 98 / 3857 / 4326 con error < 5 cm (máx ${(worstP * 100).toFixed(2)} cm)`);
ok(worstP07 < 1, `POSGAR 2007 dentro de 1 m (diferencia de marco con WGS84: ${worstP07.toFixed(2)} m)`);
let threw = false; try { toLatLng(22195, 0, 0); } catch { threw = true; }
ok(threw, 'sistema no soportado avisa');

console.log(`geo+proj: ${n} comprobaciones OK`);

// 9. Lotes desde KML / KMZ
{
  const { DOMParser } = await import('@xmldom/xmldom');
  const K = await import('../src/kml.js');
  const sq = (la, lo, d, w = d) => `${lo},${la},0 ${lo + w},${la},0 ${lo + w},${la - d},0 ${lo},${la - d},0 ${lo},${la},0`;
  const pm = (name, coords, ext = '') => `<Placemark><name>${name}</name>${ext}<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Lotes</name>
    ${pm('Lote 16 - La Loma', sq(-35.9, -60.42, 0.02), '<ExtendedData><Data name="ha"><value>311,5</value></Data></ExtendedData>')}
    ${pm('3', sq(-35.9, -60.40, 0.02))}
    ${pm('Potrero', sq(-35.92, -60.42, 0.01), '<ExtendedData><SchemaData><SimpleData name="LOTE">7</SimpleData></SchemaData></ExtendedData>')}
    ${pm('Perímetro estancia', sq(-35.899, -60.421, 0.042))}
    <Placemark><name>Camino</name><LineString><coordinates>-60.42,-35.91 -60.38,-35.91</coordinates></LineString></Placemark>
  </Folder></Document></kml>`;
  const p = K.parseKml(kml, DOMParser);
  const byName = Object.fromEntries(p.features.map(f => [f.name, f]));
  ok(p.features.length === 4 && p.lines.length === 1, 'KML: 4 polígonos y 1 línea');
  ok(byName['Lote 16 - La Loma'].num === 16 && byName['Lote 16 - La Loma'].nombre === 'La Loma', 'KML: número y nombre desde el título');
  ok(byName['Lote 16 - La Loma'].haKml === 311.5, 'KML: hectáreas del campo de datos (coma decimal)');
  ok(byName.Potrero.num === 7, 'KML: número desde SimpleData LOTE');
  ok(byName['Perímetro estancia'].isOutline && byName['Perímetro estancia'].num === null, 'KML: contorno del campo detectado');
  const ha = byName['3'].ha; ok(ha > 390 && ha < 410, `KML: superficie geodésica (${ha} ha)`);
  let bad = false; try { K.parseKml('<kml><Document></Document></kml>', DOMParser); } catch { bad = true; }
  ok(bad, 'KML sin polígonos avisa');

  const rows = p.features.map(f => ({ key: f.key, num: f.num, include: true }));
  const state = { lots: [{ num: 16, nombre: 'Viejo', obs: 'nota', poly: [[0, 0], [1, 0], [1, 1]] }], estancia: { nombre: 'X' },
    silos: [{ id: 'RB16001', lote: 16, kg: 1, latlng: [-35.905, -60.41], map: [0, 0], t: null }, { id: 'RB03001', lote: 3, kg: 2, latlng: [-35.905, -60.39], latlng2: [-35.906, -60.39], map: [0, 0], map2: [1, 1] }, { id: 'RB09001', lote: 9, kg: 3, map: [5, 5] }] };
  const out = K.buildKmlImport(p, rows, state, null, { archivo: 'campo.kml' });
  ok(out.lots.map(l => l.num).join() === '3,7,16', 'KML: lotes ordenados');
  ok(out.lots.find(l => l.num === 16).obs === 'nota', 'KML: conserva observaciones del lote con el mismo número');
  ok(out.lots.every(l => G.pointInPoly(l.label, l.poly) && G.signedArea(l.poly) > 0), 'KML: etiquetas dentro y orientación horaria');
  const geo = G.buildGeo(out.georef);
  ok(geo && geo.kml, 'KML: georreferencia exacta activa');
  const rt = geo.toLatLng(geo.toMap(-35.9123, -60.4111));
  ok(Math.abs(rt[0] + 35.9123) < 1e-9 && Math.abs(rt[1] + 60.4111) < 1e-9, 'KML: ida y vuelta exacta');
  const xs = out.outline.map(q => q[0]), ys = out.outline.map(q => q[1]);
  ok(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 880, 'KML: el campo ocupa ~900 unidades');
  const corner = geo.toMap(-35.9, -60.42), l16 = out.lots.find(l => l.num === 16);
  ok(l16.poly.some(q => G.dist(q, corner) < 0.05), 'KML: vértice en la coordenada real');
  ok(Math.abs(G.areaHa(l16.poly, geo) - 400.6) < 2, 'KML: superficie medida coincide');
  const s1 = out.silos.find(s => s.id === 'RB16001'), s3 = out.silos.find(s => s.id === 'RB03001'), s9 = out.silos.find(s => s.id === 'RB09001');
  ok(s1.lote === 16 && G.pointInPoly(s1.map, l16.poly), 'KML: silo reubicado por coordenadas dentro de su lote');
  ok(s3.map2 && G.metersBetween(geo.toLatLng(s3.map2), [-35.906, -60.39]) < 0.5, 'KML: silo con cabecera y cola reubicado');
  ok(s9.lote === 3 && out.sinCoord === 1, 'KML: silo sin coordenadas de un lote inexistente queda en un lote válido');
  ok(out.lines[0].pts.length >= 2, 'KML: caminos como líneas');
  let dupErr = null; try { K.buildKmlImport(p, rows.map(r => ({ ...r, num: 5 })), state, null); } catch (e) { dupErr = e.message; }
  ok(/repetido/.test(dupErr || '') || /número/.test(dupErr || ''), 'KML: número repetido avisa');
  const x = K.exportKml({ ...state, lots: out.lots, silos: out.silos.map(s => ({ ...s, kg: 5, latlng2: s.map2 ? geo.toLatLng(s.map2) : null })) }, geo);
  const re = K.parseKml(x, DOMParser);
  ok(re.features.length === 3 && re.features.every(f => f.num), 'KML exportado se vuelve a leer');
  ok((x.match(/<LineString>/g) || []).length === 1 && (x.match(/<Point>/g) || []).length === 2, 'KML exportado: bolsa con A-B como línea, el resto como punto');
  // Agregar un segundo KML sin tocar lo cargado
  const st1 = { ...state, lots: out.lots, outline: out.outline, georef: out.georef, decor: { lines: out.lines }, silos: [] };
  const kml2 = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${pm('Lote 30', sq(-36.05, -60.30, 0.01))}${pm('Lote 7', sq(-36.06, -60.30, 0.01))}</Document></kml>`;
  const p2 = K.parseKml(kml2, DOMParser), rows2 = p2.features.map(f => ({ key: f.key, num: f.num, include: true }));
  const add = K.buildKmlImport(p2, rows2, st1, geo, { mode: 'add', archivo: 'Los Gatos.kml' });
  ok(add.mode === 'add' && add.lots.length === 5 && add.added === 2, 'agregar KML: suma una estancia nueva');
  ok(add.lots.filter(l => l.num === 7).length === 2 && new Set(add.lots.map(l => l.id)).size === 5, 'agregar KML: el mismo número de lote en dos estancias, con id distinto');
  ok(add.estancia.nombre === 'Los Gatos' && add.estancia.sigla === 'LG', 'estancia: nombre del archivo y sigla LG');
  ok(JSON.stringify(add.lots.find(l => l.num === 16).poly) === JSON.stringify(l16.poly), 'agregar KML: los lotes cargados no cambian');
  ok(add.georef.s === out.georef.s && add.georef.lat0 === out.georef.lat0, 'agregar KML: misma proyección');
  const g2 = G.buildGeo(add.georef), c30 = g2.toMap(-36.05, -60.30);
  ok(add.lots.find(l => l.num === 30).poly.some(q => G.dist(q, c30) < 0.05), 'agregar KML: nuevo lote en su coordenada real');
  ok(add.georef.kmls.length === 2 && add.georef.kmls[1].archivo === 'Los Gatos.kml' && add.georef.kmls[1].lotes.join() === '30,7', 'agregar KML: listado de estancias');
  ok(add.lots.every(l => add.outline.length >= 3) && add.lines.length === 1, 'agregar KML: contorno y líneas conservadas');
  let sigErr = null; try { K.buildKmlImport(p2, rows2, { ...st1, lots: add.lots, georef: add.georef }, geo, { mode: 'add', nombre: 'Las Garzas', sigla: 'LG' }); } catch (e) { sigErr = e.message; }
  ok(/LG ya la usa/.test(sigErr || ''), 'estancia: sigla repetida avisa');
  const stE = G.normalizeState({ ...st1, lots: add.lots, georef: add.georef, silos: [] });
  const lg7 = stE.lots.find(l => l.num === 7 && l.kml === add.georef.kmls[1].id);
  ok(G.siglaOf(lg7, stE) === 'LG' && G.nextSiloId(G.siglaOf(lg7, stE), 7, [{ id: 'LG07001' }, { id: 'RB07004' }]) === 'LG07002', 'estancia: ID con la sigla de su estancia (LG07002)');
  const ren = K.buildKmlRename(stE, add.georef.kmls[1].id, { nombre: 'Los Gatos Norte', sigla: 'LGN' });
  ok(ren.georef.kmls[1].nombre === 'Los Gatos Norte' && ren.georef.kmls[1].sigla === 'LGN', 'estancia: renombrar con sigla');
  ok(K.estancias(stE).map(e => e.n).join() === '3,2', 'estancias: cantidad de lotes por estancia');
  const inLG = K.estanciaFilter(stE, add.georef.kmls[1].id);
  ok(stE.lots.filter(inLG).length === 2, 'estancias: filtro por estancia');
  const st2 = { ...st1, lots: add.lots, outline: add.outline, georef: add.georef, decor: { lines: add.lines } };
  const rm = K.buildKmlRemove(st2, add.georef.kmls[1].id);
  ok(rm.lots.length === 3 && rm.georef.kmls.length === 1, 'quitar KML: borra solo sus lotes');
  let blocked = null; try { K.buildKmlRemove({ ...st2, silos: [{ id: 'LG30001', lote: 30, lot: `${add.georef.kmls[1].id}:30` }] }, add.georef.kmls[1].id); } catch (e) { blocked = e.message; }
  ok(/silobolsa/.test(blocked || ''), 'quitar KML: no permite si sus lotes tienen silos');
  const legacy = K.kmlList({ georef: { mode: 'kml', kml: { archivo: 'Los Gatos.kml' } }, lots: [{ num: 1 }] })[0];
  ok(legacy.archivo === 'Los Gatos.kml' && legacy.nombre === 'Los Gatos' && legacy.sigla === 'LG', 'listado: migra el formato de un solo KML con nombre y sigla');
  const nl = G.normalizeState({ georef: { mode: 'kml', kml: { archivo: 'a.kml' } }, lots: [{ num: 31, poly: [] }], silos: [{ id: 'RB31001', lote: 31 }] });
  ok(nl.lots[0].id === 'k1:31' && nl.silos[0].lot === 'k1:31', 'normalizar: ids de lote y lote de cada silo');
  ok(['Los Gatos', 'Rincón de Baguales', 'La Esperanza', 'Baguales'].map(G.siglaDe).join() === 'LG,RB,LE,BA', 'sigla sugerida por iniciales');
  n += 0;
}

// 10. GPS: forma de la bolsa libre y recorrido sólo para silos de borde
ok(S.buildShapeChange({ lots: [{ num: 1, poly: [[0, 0], [10, 0], [10, 10], [0, 10]], subs: [] }], outline: [[0, 0], [10, 0], [10, 10]], silos: [{ id: 'A', lote: 1, map: [5, 5], map2: [6, 6], t: null }, { id: 'B', lote: 1, map: [3, 3], t: null }] },
  { lots: [{ num: 1, poly: [[0, 0], [12, 0], [12, 10], [0, 10]], subs: [] }], outline: [[0, 0], [10, 0], [10, 10]] }, null).silos.length === 0, 'ajustar forma no mueve silos ubicados por GPS');
console.log(`geo+kml: ${n} comprobaciones OK`);
