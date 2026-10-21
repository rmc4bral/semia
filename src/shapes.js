// SemIA · edición manual de la forma de los lotes
// Los vértices compartidos (mismas coordenadas) entre lotes, subdivisiones y contorno se mueven juntos.
import { dist, snapToBorder, poleLabel } from './geo.js';

export const EPS = 0.6; // unidades del plano (≈ 6–7 m)

export function cloneGeom(state) {
  return {
    lots: state.lots.map(l => ({ num: l.num, poly: l.poly.map(p => [...p]), subs: (l.subs || []).map(s => ({ id: s.id, poly: s.poly.map(p => [...p]) })) })),
    outline: state.outline.map(p => [...p]),
  };
}

// Todas las referencias a un vértice en la misma posición
function refsAt(geom, pt) {
  const out = [];
  geom.lots.forEach(l => {
    l.poly.forEach((q, i) => dist(q, pt) < EPS && out.push(q));
    l.subs.forEach(s => s.poly.forEach(q => dist(q, pt) < EPS && out.push(q)));
  });
  geom.outline.forEach(q => dist(q, pt) < EPS && out.push(q));
  return out;
}
const copy = g => ({ lots: g.lots.map(l => ({ ...l, poly: l.poly.map(p => [...p]), subs: l.subs.map(s => ({ ...s, poly: s.poly.map(p => [...p]) })) })), outline: g.outline.map(p => [...p]) });

export const isLocked = (pt, locked) => locked.some(q => dist(q, pt) < EPS);

export function moveVertex(geom, from, to) {
  const g = copy(geom);
  refsAt(g, from).forEach(q => { q[0] = Math.round(to[0] * 100) / 100; q[1] = Math.round(to[1] * 100) / 100; });
  return g;
}

// Inserta el punto medio del tramo i del lote (y en todo polígono que comparta ese tramo)
export function insertVertex(geom, lotNum, i) {
  const g = copy(geom);
  const lot = g.lots.find(l => l.num === lotNum);
  const a = lot.poly[i], b = lot.poly[(i + 1) % lot.poly.length];
  const m = [Math.round(((a[0] + b[0]) / 2) * 100) / 100, Math.round(((a[1] + b[1]) / 2) * 100) / 100];
  // se divide todo tramo (de lotes, subdivisiones o contorno) que pase por el punto medio
  const fix = poly => {
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      if (dist(m, p) > EPS && dist(m, q) > EPS && onSegment(m, p, q)) { poly.splice(k + 1, 0, [...m]); return; }
    }
  };
  g.lots.forEach(l => { fix(l.poly); l.subs.forEach(s => fix(s.poly)); });
  fix(g.outline);
  return { geom: g, point: m };
}
function onSegment(p, a, b) {
  const s = snapToBorder(p, [a, b]);
  return s.dist < EPS * 0.5;
}

// Quita un vértice de todos los polígonos que lo usan (cada uno debe conservar 3 o más)
export function removeVertex(geom, pt) {
  const g = copy(geom);
  const polys = [];
  g.lots.forEach(l => { polys.push(l.poly); l.subs.forEach(s => polys.push(s.poly)); });
  polys.push(g.outline);
  for (const poly of polys) {
    const i = poly.findIndex(q => dist(q, pt) < EPS);
    if (i >= 0 && poly.length <= 3) return { error: 'Un lote no puede quedar con menos de 3 vértices' };
  }
  polys.forEach(poly => { const i = poly.findIndex(q => dist(q, pt) < EPS); if (i >= 0) poly.splice(i, 1); });
  return { geom: g };
}

export function restoreLot(geom, lot) {
  if (!lot.poly0) return geom;
  let g = copy(geom);
  const cur = g.lots.find(l => l.num === lot.num);
  // cada vértice actual vuelve a su posición original si tiene par en el original (mismo índice)
  if (cur.poly.length === lot.poly0.length) {
    cur.poly.forEach((p, i) => { g = moveVertex(g, g.lots.find(l => l.num === lot.num).poly[i], lot.poly0[i]); });
  } else {
    const c = g.lots.find(l => l.num === lot.num); c.poly = lot.poly0.map(p => [...p]);
  }
  const c = g.lots.find(l => l.num === lot.num);
  (lot.subs || []).forEach(s => { if (s.poly0) { const cs = c.subs.find(x => x.id === s.id); if (cs) cs.poly = s.poly0.map(p => [...p]); } });
  return g;
}

const same = (a, b) => a.length === b.length && a.every((p, i) => dist(p, b[i]) < 1e-6);

// Arma el cambio a guardar: lotes modificados, etiquetas nuevas y silos re-ajustados al borde
export function buildShapeChange(state, geom, geo) {
  const changed = geom.lots.filter(l => {
    const o = state.lots.find(x => x.num === l.num);
    return !same(o.poly, l.poly) || l.subs.some(s => !same(o.subs.find(x => x.id === s.id).poly, s.poly));
  });
  const lots = changed.map(l => ({
    num: l.num, poly: l.poly, label: poleLabel(l.poly),
    subs: l.subs.map(s => ({ id: s.id, poly: s.poly, label: poleLabel(s.poly) })),
  }));
  const nums = new Set(changed.map(l => l.num));
  const silos = state.silos.filter(s => nums.has(s.lote) && s.map).map(s => {
    const poly = geom.lots.find(l => l.num === s.lote).poly;
    const sn = snapToBorder(s.map, poly);
    const map = sn.point.map(v => Math.round(v * 100) / 100);
    return { id: s.id, map, t: Math.round(sn.t * 100) / 100, ang: Math.round(sn.angle * 1e4) / 1e4, latlng: geo ? geo.toLatLng(map).map(v => +v.toFixed(7)) : s.latlng || null };
  });
  return { lots, outline: same(state.outline, geom.outline) ? null : geom.outline, silos };
}
