// SemIA · edición manual de la forma de los lotes
// Cada lote se ajusta por separado (hay caminos y cortinas entre lotes): no se mueven los vecinos.
import { dist, snapToBorder, poleLabel, lotIdOf } from './geo.js';

// Busca un lote por su id (o por número, en datos sin id)
const findLot = (g, key) => g.lots.find(l => l.id === String(key)) || g.lots.find(l => l.num === key);

export const EPS = 0.6; // unidades del plano (≈ 6–7 m)

export function cloneGeom(state) {
  return {
    lots: state.lots.map(l => ({ id: lotIdOf(l), num: l.num, poly: l.poly.map(p => [...p]), subs: (l.subs || []).map(s => ({ id: s.id, poly: s.poly.map(p => [...p]) })) })),
    outline: state.outline.map(p => [...p]),
  };
}

const copy = g => ({ lots: g.lots.map(l => ({ ...l, poly: l.poly.map(p => [...p]), subs: l.subs.map(s => ({ ...s, poly: s.poly.map(p => [...p]) })) })), outline: g.outline.map(p => [...p]) });
const r2 = v => Math.round(v * 100) / 100;

export const isLocked = (pt, locked) => locked.some(q => dist(q, pt) < EPS);

// Cada lote se edita por separado: los vecinos y el contorno no se tocan.
// Solo acompañan al vértice las subdivisiones del MISMO lote que lo comparten.
function idxNear(poly, pt) {
  let bi = -1, bd = EPS;
  poly.forEach((q, i) => { const d = dist(q, pt); if (d < bd) { bd = d; bi = i; } });
  return bi;
}

export function moveVertex(geom, lotNum, from, to) {
  const g = copy(geom);
  const lot = findLot(g, lotNum);
  const i = idxNear(lot.poly, from);
  if (i < 0) return g;
  const old = [...lot.poly[i]];
  lot.poly[i] = [r2(to[0]), r2(to[1])];
  lot.subs.forEach(s => s.poly.forEach(q => { if (dist(q, old) < EPS) { q[0] = r2(to[0]); q[1] = r2(to[1]); } }));
  return g;
}

// Inserta el punto medio del tramo i del lote (y en sus propias subdivisiones si comparten ese tramo)
export function insertVertex(geom, lotNum, i) {
  const g = copy(geom);
  const lot = findLot(g, lotNum);
  const a = lot.poly[i], b = lot.poly[(i + 1) % lot.poly.length];
  const m = [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)];
  lot.poly.splice(i + 1, 0, m);
  lot.subs.forEach(sub => {
    const poly = sub.poly;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      if (dist(m, p) > EPS && dist(m, q) > EPS && snapToBorder(m, [p, q]).dist < EPS * 0.5) { poly.splice(k + 1, 0, [...m]); break; }
    }
  });
  return { geom: g, point: m };
}

// Quita un vértice del lote (debe conservar 3 o más)
export function removeVertex(geom, lotNum, pt) {
  const g = copy(geom);
  const lot = findLot(g, lotNum);
  const i = idxNear(lot.poly, pt);
  if (i < 0) return { geom: g };
  if (lot.poly.length <= 3) return { error: 'Un lote no puede quedar con menos de 3 vértices' };
  const old = lot.poly[i];
  lot.poly.splice(i, 1);
  lot.subs.forEach(s => { const k = s.poly.findIndex(q => dist(q, old) < EPS); if (k >= 0 && s.poly.length > 3) s.poly.splice(k, 1); });
  return { geom: g };
}

export function restoreLot(geom, lot) {
  if (!lot.poly0) return geom;
  const g = copy(geom);
  const c = findLot(g, lotIdOf(lot));
  c.poly = lot.poly0.map(p => [...p]);
  (lot.subs || []).forEach(s => { if (s.poly0) { const cs = c.subs.find(x => x.id === s.id); if (cs) cs.poly = s.poly0.map(p => [...p]); } });
  return g;
}

const same = (a, b) => a.length === b.length && a.every((p, i) => dist(p, b[i]) < 1e-6);

// Arma el cambio a guardar: lotes modificados, etiquetas nuevas y silos re-ajustados al borde
export function buildShapeChange(state, geom0, geo) {
  const geom = { ...geom0, lots: geom0.lots.map(l => ({ ...l, id: l.id ?? lotIdOf(l) })) };
  const changed = geom.lots.filter(l => {
    const o = state.lots.find(x => lotIdOf(x) === l.id);
    return !same(o.poly, l.poly) || l.subs.some(s => !same(o.subs.find(x => x.id === s.id).poly, s.poly));
  });
  const lots = changed.map(l => ({
    id: l.id, num: l.num, poly: l.poly, label: poleLabel(l.poly),
    subs: l.subs.map(s => ({ id: s.id, poly: s.poly, label: poleLabel(s.poly) })),
  }));
  const ids = new Set(changed.map(l => l.id));
  const silLot = s => s.lot || (state.lots.find(l => l.num === s.lote) ? lotIdOf(state.lots.find(l => l.num === s.lote)) : null);
  // los silos ubicados por GPS (punto libre o inicio/fin) quedan donde se midieron
  const silos = state.silos.filter(s => ids.has(silLot(s)) && s.map && !s.map2 && s.t !== null && s.t !== undefined && isFinite(s.t)).map(s => {
    const poly = geom.lots.find(l => l.id === silLot(s)).poly;
    const sn = snapToBorder(s.map, poly);
    const map = sn.point.map(v => Math.round(v * 100) / 100);
    return { id: s.id, map, t: Math.round(sn.t * 100) / 100, ang: Math.round(sn.angle * 1e4) / 1e4, latlng: geo ? geo.toLatLng(map).map(v => +v.toFixed(7)) : s.latlng || null };
  });
  return { lots, outline: same(state.outline, geom.outline) ? null : geom.outline, silos };
}
