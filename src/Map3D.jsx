import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Icon, fmtKg } from './ui.jsx';
import { snapToBorder, borderPath, inwardNormal, locateLot } from './geo.js';

const LIFT_HOVER = 20, LIFT_SEL = 13, SLAB = 9;
const rad = d => (d * Math.PI) / 180;
const pts = arr => arr.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

function bbox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  poly.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Cámara: rotación (yaw) + inclinación (tilt) + escala + desplazamiento
function makeCam(view, W, H, center, outline) {
  const c = Math.cos(rad(view.yaw)), s = Math.sin(rad(view.yaw));
  const ct = Math.cos(rad(view.tilt)), st = Math.sin(rad(view.tilt));
  const rot = (x, y) => { const dx = x - center[0], dy = y - center[1]; return [dx * c - dy * s, dx * s + dy * c]; };
  // ajuste a pantalla
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  outline.forEach(([x, y]) => {
    const [xr, yr] = rot(x, y);
    [0, -SLAB].forEach(z => { const sy = yr * ct - z * st; x0 = Math.min(x0, xr); x1 = Math.max(x1, xr); y0 = Math.min(y0, sy - LIFT_HOVER * st); y1 = Math.max(y1, sy); });
  });
  const pad = W < 600 ? 18 : 40;
  const fit = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1));
  const S = fit * view.zoom, bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
  const ox = W / 2 + view.pan[0], oy = H / 2 + view.pan[1];
  return {
    S, ox, oy, rot,
    proj(x, y, z = 0) { const [xr, yr] = rot(x, y); return [(xr - bcx) * S + ox, (yr * ct - z * st - bcy) * S + oy]; },
    unproj(X, Y, z = 0) {
      const xr = (X - ox) / S + bcx, sy = (Y - oy) / S + bcy, yr = (sy + z * st) / (ct || 1e-6);
      return [xr * c + yr * s + center[0], -xr * s + yr * c + center[1]];
    },
    depth(x, y) { return rot(x, y)[1]; },
  };
}

// Paredes laterales visibles de un prisma
function walls(poly, z0, z1, cam, sa) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ra = cam.rot(a[0], a[1]), rb = cam.rot(b[0], b[1]);
    const ex = rb[0] - ra[0], ey = rb[1] - ra[1];
    const n = sa > 0 ? [ey, -ex] : [-ey, ex];
    if (n[1] <= 0.0001) continue;
    const len = Math.hypot(n[0], n[1]) || 1;
    out.push({
      d: (ra[1] + rb[1]) / 2,
      shade: n[0] / len,
      p: [cam.proj(a[0], a[1], z0), cam.proj(b[0], b[1], z0), cam.proj(b[0], b[1], z1), cam.proj(a[0], a[1], z1)],
    });
  }
  return out.sort((u, v) => u.d - v.d);
}

function siloShape(silo, lot, cam, z) {
  const a = silo.ang || 0, u = [Math.cos(a), Math.sin(a)], n = inwardNormal(lot.poly, a);
  const c = [silo.map[0] + n[0] * 3.4, silo.map[1] + n[1] * 3.4], L = 6.5, Wd = 2.4;
  const ring = [];
  for (let k = 0; k <= 6; k++) { // extremo 1
    const th = -Math.PI / 2 + (Math.PI * k) / 6;
    ring.push([c[0] + u[0] * (L + Math.cos(th) * Wd) + n[0] * Math.sin(th) * Wd, c[1] + u[1] * (L + Math.cos(th) * Wd) + n[1] * Math.sin(th) * Wd]);
  }
  for (let k = 0; k <= 6; k++) { // extremo 2
    const th = Math.PI / 2 + (Math.PI * k) / 6;
    ring.push([c[0] + u[0] * (-L + Math.cos(th) * Wd) + n[0] * Math.sin(th) * Wd, c[1] + u[1] * (-L + Math.cos(th) * Wd) + n[1] * Math.sin(th) * Wd]);
  }
  return { ring: ring.map(p => cam.proj(p[0], p[1], z)), center: cam.proj(c[0], c[1], z) };
}

export default function Map3D({
  data, silos, selectedLot, onSelectLot, selectedSilo, onSelectSilo, pickMode, onPick,
  moving, onMoveDraft, gpsMap, isAdmin, onEditLot, onOpenSilo, onStartMove,
}) {
  const wrap = useRef(null), svgRef = useRef(null);
  const [size, setSize] = useState({ W: 800, H: 600 });
  const [view, setView] = useState({ yaw: 0, tilt: 50, zoom: 1, pan: [0, 0] });
  const [hover, setHover] = useState(null);
  const heights = useRef({});
  const [, setTick] = useState(0);
  const ptrs = useRef(new Map()), gest = useRef(null);

  const { lots, outline, decor } = data;
  const center = useMemo(() => { const b = bbox(outline); return [b.cx, b.cy]; }, [outline]);
  const areaSign = useMemo(() => {
    const o = {}; const sa = poly => { let s = 0; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; }); return s; };
    lots.forEach(l => { o[l.num] = sa(l.poly); }); o.__outline = sa(outline); return o;
  }, [lots, outline]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => { const r = e.contentRect; if (r.width > 0 && r.height > 0) setSize({ W: r.width, H: r.height }); });
    ro.observe(wrap.current); return () => ro.disconnect();
  }, []);

  const cam = useMemo(() => makeCam(view, size.W, size.H, center, outline), [view, size, center, outline]);

  // Animación de elevación de lotes
  const target = useCallback(num => (num === hover ? LIFT_HOVER : num === selectedLot ? LIFT_SEL : 0), [hover, selectedLot]);
  useEffect(() => {
    let raf;
    const step = () => {
      let moving = false;
      lots.forEach(l => {
        const h = heights.current[l.num] || 0, t = target(l.num);
        if (Math.abs(h - t) > 0.05) { heights.current[l.num] = h + (t - h) * 0.22; moving = true; } else heights.current[l.num] = t;
      });
      setTick(t => t + 1);
      if (moving) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, lots]);
  const hOf = num => heights.current[num] || 0;

  // Zoom con rueda
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function zoomAt(X, Y, f) {
    setView(v => {
      const z = Math.max(0.6, Math.min(9, v.zoom * f)), k = z / v.zoom;
      const ox = size.W / 2 + v.pan[0], oy = size.H / 2 + v.pan[1];
      return { ...v, zoom: z, pan: [v.pan[0] + (X - ox) * (1 - k), v.pan[1] + (Y - oy) * (1 - k)] };
    });
  }

  const local = e => { const r = svgRef.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function onDown(e) {
    if (e.button === 2) e.preventDefault();
    svgRef.current.setPointerCapture(e.pointerId);
    const p = local(e);
    ptrs.current.set(e.pointerId, p);
    const siloEl = e.target.closest?.('[data-silo]');
    if (moving && siloEl && siloEl.dataset.silo === moving.id) { gest.current = { type: 'silo' }; return; }
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gest.current = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), ang: Math.atan2(b[1] - a[1], b[0] - a[0]), moved: true };
    } else {
      gest.current = { type: e.button === 2 || e.shiftKey ? 'orbit' : 'pan', start: p, last: p, moved: false, target: e.target };
    }
  }
  function onMove(e) {
    if (!ptrs.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') { const l = e.target.closest?.('[data-lot]'); setHover(l ? +l.dataset.lot : null); }
      return;
    }
    const p = local(e); ptrs.current.set(e.pointerId, p);
    const g = gest.current; if (!g) return;
    if (g.type === 'silo') {
      const lot = lots.find(l => l.num === moving.lote); if (!lot) return;
      const m = cam.unproj(p[0], p[1], hOf(lot.num));
      onMoveDraft(snapToBorder(m, lot.poly));
      return;
    }
    if (g.type === 'pinch' && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / (g.d || d));
      const dAng = ((ang - g.ang) * 180) / Math.PI;
      if (Math.abs(dAng) < 30) setView(v => ({ ...v, yaw: v.yaw + dAng }));
      g.d = d; g.ang = ang; return;
    }
    const dx = p[0] - g.last[0], dy = p[1] - g.last[1];
    if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) > 5) g.moved = true;
    g.last = p;
    if (!g.moved) return;
    if (g.type === 'orbit') setView(v => ({ ...v, yaw: v.yaw + dx * 0.35, tilt: Math.max(0, Math.min(68, v.tilt - dy * 0.25)) }));
    else setView(v => ({ ...v, pan: [v.pan[0] + dx, v.pan[1] + dy] }));
  }
  function onUp(e) {
    const g = gest.current; const p = local(e);
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) gest.current = null;
    if (!g || g.moved || g.type === 'silo' || g.type === 'pinch') return;
    // Toque
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (pickMode) { onPick(cam.unproj(p[0], p[1], 0)); return; }
    const s = el?.closest?.('[data-silo]');
    if (s) { onSelectSilo(s.dataset.silo); return; }
    const l = el?.closest?.('[data-lot]');
    if (l) { const n = +l.dataset.lot; onSelectSilo(null); onSelectLot(n === selectedLot ? null : n); return; }
    onSelectSilo(null); onSelectLot(null);
  }

  /* ---------- Construcción de la escena ---------- */
  const maxKg = useMemo(() => {
    const m = {}; silos.forEach(s => { m[s.lote] = (m[s.lote] || 0) + (+s.kg || 0); });
    return { per: m, max: Math.max(1, ...Object.values(m)) };
  }, [silos]);

  const flat = [], lifted = [];
  lots.forEach(l => (hOf(l.num) > 0.3 ? lifted : flat).push(l));
  lifted.sort((a, b) => hOf(a.num) - hOf(b.num));
  const slabWalls = walls(outline, -SLAB, 0, cam, areaSign.__outline);
  const showSubs = view.zoom > 1.5;
  const fs = Math.max(10, Math.min(18, 11 * Math.sqrt(view.zoom)));

  const lotBody = (l, z) => {
    const top = l.poly.map(p => cam.proj(p[0], p[1], z));
    const kg = maxKg.per[l.num] || 0;
    return (
      <g key={'b' + l.num} data-lot={l.num} className={`lot ${l.num === selectedLot ? 'is-sel' : ''} ${l.num === hover ? 'is-hover' : ''}`}>
        <polygon points={pts(top)} className="lot-top" />
        {kg > 0 && <polygon points={pts(top)} className="lot-heat" style={{ opacity: 0.1 + 0.32 * (kg / maxKg.max) }} />}
        {l.subs?.map(s => <polygon key={s.id} points={pts(s.poly.map(p => cam.proj(p[0], p[1], z)))} className="lot-sub" />)}
      </g>
    );
  };
  const lotLabel = (l, z) => {
    const [x, y] = cam.proj(l.label[0], l.label[1], z);
    return (
      <g key={'t' + l.num} className="lot-label" pointerEvents="none">
        <text x={x} y={y - 2} fontSize={fs} className="lot-num">{l.num}</text>
        <text x={x} y={y + fs * 0.85} fontSize={fs * 0.68} className="lot-ha">{l.ha} ha</text>
        {showSubs && l.subs?.map(s => {
          const [sx, sy] = cam.proj(s.label[0], s.label[1], z);
          return <text key={s.id} x={sx} y={sy + 3} fontSize={fs * 0.66} className="lot-subtxt">{s.id} · {s.ha}</text>;
        })}
      </g>
    );
  };

  const lotsByNum = useMemo(() => Object.fromEntries(lots.map(l => [l.num, l])), [lots]);
  const tracks = useMemo(() => {
    const g = {};
    silos.forEach(s => { if (lotsByNum[s.lote] && isFinite(s.t)) (g[s.lote] = g[s.lote] || []).push(s); });
    return Object.entries(g).filter(([, a]) => a.length > 1).map(([num, a]) => {
      a.sort((x, y) => String(x.creadoEn || '').localeCompare(String(y.creadoEn || '')) || x.id.localeCompare(y.id));
      const poly = lotsByNum[num].poly; const path = [];
      for (let i = 1; i < a.length; i++) path.push(...borderPath(poly, a[i - 1].t, a[i].t));
      return { num: +num, path };
    });
  }, [silos, lotsByNum]);

  const shownSilos = silos.map(s => (moving && s.id === moving.id ? { ...s, map: moving.map, t: moving.t, ang: moving.ang } : s));
  const selSilo = shownSilos.find(s => s.id === selectedSilo);
  const selLot = lotsByNum[selectedLot];
  const gearPos = selLot ? cam.proj(selLot.label[0], selLot.label[1], hOf(selLot.num)) : null;
  let pop = null;
  if (selSilo && lotsByNum[selSilo.lote]) {
    const c = siloShape(selSilo, lotsByNum[selSilo.lote], cam, hOf(selSilo.lote)).center;
    pop = { x: Math.max(110, Math.min(size.W - 110, c[0])), y: c[1], below: c[1] < 130 };
  }

  return (
    <div className={`map3d ${pickMode ? 'is-picking' : ''}`} ref={wrap} onContextMenu={e => e.preventDefault()}>
      <svg ref={svgRef} width={size.W} height={size.H} className="map3d-svg"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={e => { if (e.pointerType === 'mouse' && !ptrs.current.size) setHover(null); }}>
        <defs>
          <filter id="lift" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#000" floodOpacity="0.35" /></filter>
        </defs>
        {/* base del campo */}
        {slabWalls.map((w, i) => <polygon key={'sw' + i} points={pts(w.p)} className="slab-wall" style={{ opacity: 0.75 + w.shade * 0.25 }} />)}
        {flat.map(l => lotBody(l, 0))}
        {lifted.map(l => <polygon key={'k' + l.num} points={pts(l.poly.map(p => cam.proj(p[0], p[1], 0)))} className="lot-socket" />)}
        {/* hidrografía y monte */}
        <g pointerEvents="none">
          {decor.monte?.map((m, i) => <polygon key={'m' + i} points={pts(m.map(p => cam.proj(p[0], p[1], 0)))} className="monte" />)}
          {decor.lagoons?.map((g, i) => {
            const ring = Array.from({ length: 20 }, (_, k) => { const a = (k / 20) * Math.PI * 2; return cam.proj(g.c[0] + Math.cos(a) * g.r[0], g.c[1] + Math.sin(a) * g.r[1], 0); });
            return <polygon key={'g' + i} points={pts(ring)} className="lagoon" />;
          })}
          {decor.rivers?.map((r, i) => <polyline key={'r' + i} points={pts(r.map(p => cam.proj(p[0], p[1], 0)))} className="river" strokeWidth={Math.max(1.2, 1.6 * Math.sqrt(view.zoom))} />)}
        </g>
        <polygon points={pts(outline.map(p => cam.proj(p[0], p[1], 0)))} className="outline" pointerEvents="none" />
        {flat.map(l => lotLabel(l, 0))}
        {/* lotes elevados */}
        {lifted.map(l => {
          const h = hOf(l.num);
          return (
            <g key={'L' + l.num} filter="url(#lift)">
              {walls(l.poly, 0, h, cam, areaSign[l.num]).map((w, i) => <polygon key={i} points={pts(w.p)} className="lot-wall" data-lot={l.num} style={{ opacity: 0.72 + w.shade * 0.28 }} />)}
              {lotBody(l, h)}
            </g>
          );
        })}
        {lifted.map(l => lotLabel(l, hOf(l.num)))}
        {/* recorrido por el borde */}
        {tracks.map(t => <polyline key={'tr' + t.num} points={pts(t.path.map(p => cam.proj(p[0], p[1], hOf(t.num))))} className="track" />)}
        {/* silobolsas */}
        {shownSilos.map(s => {
          const lot = lotsByNum[s.lote]; if (!lot || !s.map) return null;
          const sh = siloShape(s, lot, cam, hOf(lot.num));
          const isMov = moving && moving.id === s.id;
          return (
            <g key={s.id} data-silo={s.id} className={`silo ${s.id === selectedSilo ? 'is-sel' : ''} ${isMov ? 'is-moving' : ''}`}>
              <circle cx={sh.center[0]} cy={sh.center[1]} r={isMov ? 22 : 13} className="silo-hit" />
              <polygon points={pts(sh.ring)} className="silo-bag" />
            </g>
          );
        })}
        {gpsMap && (() => { const [x, y] = cam.proj(gpsMap[0], gpsMap[1], 0); return (
          <g className="gps" pointerEvents="none"><circle cx={x} cy={y} r="14" className="gps-pulse" /><circle cx={x} cy={y} r="6" className="gps-dot" /></g>); })()}
      </svg>

      {gearPos && !moving && !pickMode && (
        <button type="button" className="lot-gear" style={{ left: gearPos[0], top: gearPos[1] - fs * 2.6 }} onClick={() => onEditLot(selLot.num)} aria-label={`Configurar lote ${selLot.num}`}>
          <Icon name="gear" size={16} />
        </button>
      )}

      {pop && !moving && (
        <div className={`silo-pop ${pop.below ? 'is-below' : ''}`} style={{ left: pop.x, top: pop.y }}>
          <div className="silo-pop-id">{selSilo.id}</div>
          <div className="silo-pop-kg"><b>{fmtKg(selSilo.kg)}</b> kg{selSilo.grano ? ` · ${selSilo.grano}` : ''}</div>
          <div className="silo-pop-act">
            <button type="button" onClick={() => onOpenSilo(selSilo.id)}>Detalle</button>
            {isAdmin && <button type="button" onClick={() => onStartMove(selSilo.id)}>Mover</button>}
          </div>
        </div>
      )}

      <div className="map-ctrls">
        <button type="button" onClick={() => zoomAt(size.W / 2, size.H / 2, 1.35)} aria-label="Acercar"><Icon name="zin" size={18} /></button>
        <button type="button" onClick={() => zoomAt(size.W / 2, size.H / 2, 1 / 1.35)} aria-label="Alejar"><Icon name="zout" size={18} /></button>
        <button type="button" onClick={() => setView(v => ({ ...v, yaw: v.yaw - 15 }))} aria-label="Girar a la izquierda"><Icon name="rotl" size={18} /></button>
        <button type="button" onClick={() => setView(v => ({ ...v, yaw: v.yaw + 15 }))} aria-label="Girar a la derecha"><Icon name="rotr" size={18} /></button>
        <button type="button" className={view.tilt > 5 ? 'is-on' : ''} onClick={() => setView(v => ({ ...v, tilt: v.tilt > 5 ? 0 : 50 }))} aria-label="Vista 2D o 3D"><b>{view.tilt > 5 ? '3D' : '2D'}</b></button>
        <button type="button" onClick={() => setView({ yaw: 0, tilt: 50, zoom: 1, pan: [0, 0] })} aria-label="Centrar"><Icon name="target" size={18} /></button>
      </div>
    </div>
  );
}

// Exportado para pruebas
export { makeCam, locateLot };
