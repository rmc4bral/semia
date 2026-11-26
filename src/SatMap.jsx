import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fmtKg } from './ui.jsx';
import { WarpLayer } from './maplayers.js';

// Recorta la capa a color con la forma de los lotes (coordenadas de capa: no cambian al desplazar el mapa)
function updClip(m, pane, polys) {
  if (!m || !pane) return;
  m.getContainer().classList.toggle('has-lots', polys.length > 0);
  if (!polys.length) { pane.style.clipPath = pane.style.webkitClipPath = ''; pane.style.display = 'none'; return; }
  let d = '';
  for (const ll of polys) d += ll.map((q, i) => { const p = m.latLngToLayerPoint(q); return `${i ? 'L' : 'M'}${Math.round(p.x)} ${Math.round(p.y)}`; }).join('') + 'Z';
  const cp = `path("${d}")`;
  pane.style.display = ''; pane.style.clipPath = cp; pane.style.webkitClipPath = cp;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function SatMap({ data, silos, geo, selectedLot, onSelectLot, selectedSilo, onSelectSilo, pickMode, onPick, gps, onNeedGeoref, editing, onVertexMove, onInsertVertex, onSelectVertex, overlays = [], overlayOpacity = 1, mapEdit, onMapCorners, capture, moving, onMoveDraft, fitKey = '' }) {
  const el = useRef(null), map = useRef(null), layers = useRef({}), fitted = useRef(false), editFit = useRef(null), lastFit = useRef(null);
  const cb = useRef({}); cb.current = { onSelectLot, onSelectSilo, onPick, pickMode, geo, selectedLot, editing, onVertexMove, onInsertVertex, onSelectVertex, onMapCorners, mapEdit, onMoveDraft };
  const warp = useRef({});
  const colorEl = useRef(null), lotLL = useRef([]);

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, center: [-36.5, -60.5], zoom: 6, zoomSnap: 0.25, zoomDelta: 0.5 });
    const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    L.tileLayer(SAT, { maxZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics', className: 'sat-base' }).addTo(m);
    // Los lotes van a color: la misma imagen (ya en caché del navegador) recortada con la forma de los lotes;
    // el fondo queda en blanco y negro, oscuro y desenfocado (ver .has-lots .sat-base)
    const colorPane = m.createPane('semiaColor'); colorPane.style.zIndex = 250; colorPane.style.pointerEvents = 'none';
    L.tileLayer(SAT, { maxZoom: 19, pane: 'semiaColor' }).addTo(m);
    colorEl.current = colorPane;
    L.control.zoom({ position: 'topright' }).addTo(m);
    const pane = m.createPane('semiaMaps'); pane.style.zIndex = 350; pane.style.pointerEvents = 'none';
    const upd = () => updClip(m, colorPane, lotLL.current);
    m.on('zoomend viewreset', upd);
    m.on('zoomstart', () => { colorPane.style.opacity = '0'; });
    m.on('zoomend', () => { colorPane.style.opacity = ''; });
    layers.current = { cap: L.layerGroup().addTo(m), lots: L.layerGroup().addTo(m), silos: L.layerGroup().addTo(m), gps: L.layerGroup().addTo(m), edit: L.layerGroup().addTo(m), maps: L.layerGroup().addTo(m), mapEdit: L.layerGroup().addTo(m) };
    m.on('click', e => {
      const c = cb.current;
      if (c.editing || c.mapEdit) return;
      if (c.pickMode && c.geo) c.onPick(c.geo.toMap(e.latlng.lat, e.latlng.lng));
      else { c.onSelectSilo(null); }
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  // Lotes (en edición se dibuja la geometría de trabajo)
  useEffect(() => {
    const g = layers.current.lots; g.clearLayers();
    if (!geo) { lotLL.current = []; updClip(map.current, colorEl.current, []); return; }
    const all = [];
    const src = editing ? editing.geom.lots.filter(gl => data.lots.some(l => l.id === gl.id)).map(gl => { const o = data.lots.find(l => l.id === gl.id); return { ...o, poly: gl.poly, subs: gl.subs.map(s => ({ ...(o.subs || []).find(x => x.id === s.id), poly: s.poly })) }; }) : data.lots;
    src.forEach(l => {
      const ll = l.poly.map(p => geo.toLatLng(p)); all.push(...ll);
      const sel = editing ? l.id === editing.lot : l.id === selectedLot;
      const pg = L.polygon(ll, { className: `sat-lot ${sel ? 'is-sel' : ''} ${editing && !sel ? 'is-dim' : ''} ${typeof l.num === 'string' ? 'is-casco' : ''}`, weight: sel ? 2 : 1, fillOpacity: sel ? (editing ? 0.1 : 0.16) : 0, interactive: !editing });
      if (!editing) {
        pg.on('click', e => { L.DomEvent.stopPropagation(e); const c = cb.current; if (c.pickMode) c.onPick(c.geo.toMap(e.latlng.lat, e.latlng.lng)); else c.onSelectLot(c.selectedLot === l.id ? null : l.id); });
        pg.bindTooltip(sel ? `<b>${esc(l.num)}</b><span> · ${esc(l.ha)} ha</span>` : `<b>${esc(l.num)}</b>`, { permanent: true, direction: 'center', className: `sat-label ${sel ? 'is-sel' : ''}` });
      }
      g.addLayer(pg);
      if (sel && editing) layers.current.editPoly = pg;
      l.subs?.forEach(s => g.addLayer(L.polygon(s.poly.map(p => geo.toLatLng(p)), { className: 'sat-sub', weight: 1, fill: false, interactive: false, dashArray: '4 4' })));
    });
    lotLL.current = src.map(l => l.poly.map(p => geo.toLatLng(p)));
    if ((!fitted.current || lastFit.current !== fitKey) && all.length && !editing) { map.current.fitBounds(L.latLngBounds(all), { padding: [14, 14] }); fitted.current = true; lastFit.current = fitKey; }
    updClip(map.current, colorEl.current, lotLL.current);
  }, [geo, data.lots, selectedLot, editing, fitKey]);

  // Manijas de edición: vértices (arrastrables) y puntos medios (agregar vértice)
  useEffect(() => {
    const g = layers.current.edit; g.clearLayers();
    if (!editing) editFit.current = null;
    if (!geo || !editing) return;
    const lot = editing.geom.lots.find(l => l.id === editing.lot); if (!lot) return;
    if (editFit.current !== editing.lot) { map.current.fitBounds(L.latLngBounds(lot.poly.map(p => geo.toLatLng(p))), { padding: [40, 40], maxZoom: 17 }); editFit.current = editing.lot; }
    lot.poly.forEach((p, i) => {
      const q = lot.poly[(i + 1) % lot.poly.length], mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const mk = L.marker(geo.toLatLng(mid), { icon: L.divIcon({ className: 'v-mid', iconSize: [22, 22], html: '<span>+</span>' }), title: 'Agregar vértice' });
      mk.on('click', e => { L.DomEvent.stopPropagation(e); cb.current.onInsertVertex(editing.lot, i); });
      g.addLayer(mk);
    });
    lot.poly.forEach((p, i) => {
      const locked = editing.locked.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.6);
      const sel = editing.sel && Math.hypot(editing.sel[0] - p[0], editing.sel[1] - p[1]) < 0.6;
      const mk = L.marker(geo.toLatLng(p), {
        draggable: !locked, autoPan: true,
        icon: L.divIcon({ className: `v-handle ${locked ? 'is-lock' : ''} ${sel ? 'is-sel' : ''}`, iconSize: [26, 26], html: '<span></span>' }),
        title: locked ? 'Punto de control GPS (fijo)' : 'Arrastrar vértice',
      });
      mk.on('click', e => { L.DomEvent.stopPropagation(e); cb.current.onSelectVertex(locked ? null : p); });
      mk.on('drag', e => {
        const pg = layers.current.editPoly; if (!pg) return;
        const ll = pg.getLatLngs()[0].slice(); ll[i] = e.target.getLatLng(); pg.setLatLngs(ll);
      });
      mk.on('dragend', e => { const ll = e.target.getLatLng(); cb.current.onVertexMove(p, cb.current.geo.toMap(ll.lat, ll.lng)); });
      g.addLayer(mk);
    });
  }, [geo, editing]);

  // Silos: línea inicio → fin (GPS) o marcador
  useEffect(() => {
    const g = layers.current.silos; g.clearLayers();
    if (!geo) return;
    silos.forEach(s0 => {
      const s = moving && moving.id === s0.id ? { ...s0, map: moving.map, map2: moving.map2, latlng: null, latlng2: null } : s0;
      if (!s.map) return;
      const sel = s.id === selectedSilo;
      const a = s.latlng2 && s.latlng ? s.latlng : geo.toLatLng(s.map);
      const b = s.map2 ? (s.latlng2 || geo.toLatLng(s.map2)) : null;
      const pick = e => { L.DomEvent.stopPropagation(e); cb.current.onSelectSilo(s.id); };
      const tip = `<b>${esc(s.id)}</b><br>${fmtKg(s.kg)} kg${s.largo ? ` · ${Math.round(s.largo)} m` : ''}`;
      if (b) {
        g.addLayer(L.polyline([a, b], { className: 'sat-bag-hit', weight: 22, opacity: 0.001 }).on('click', pick));
        const ln = L.polyline([a, b], { className: `sat-bag ${sel ? 'is-sel' : ''}`, weight: sel ? 9 : 7, lineCap: 'round' }).on('click', pick);
        ln.bindTooltip(tip, { direction: 'top', className: 'sat-tip', permanent: sel, sticky: !sel });
        g.addLayer(ln);
        return;
      }
      const mk = L.marker(a, { icon: L.divIcon({ className: `sat-silo ${sel ? 'is-sel' : ''}`, iconSize: [18, 18], html: '<span></span>' }) });
      mk.on('click', pick);
      mk.bindTooltip(tip, { direction: 'top', offset: [0, -10], className: 'sat-tip', permanent: sel });
      g.addLayer(mk);
    });
    // bolsa en movimiento: manija central arrastrable (traslada la bolsa completa)
    if (moving) {
      const a = moving.map, b = moving.map2, c = b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a;
      const h = L.marker(geo.toLatLng(c), { draggable: true, autoPan: true, icon: L.divIcon({ className: 'v-handle map-center move-handle', iconSize: [40, 40], html: '<span>✥</span>' }), title: 'Arrastrar la silobolsa' });
      h.on('dragend', e => { const p = e.target.getLatLng(); cb.current.onMoveDraft({ point: cb.current.geo.toMap(p.lat, p.lng), free: true }); });
      g.addLayer(h);
    }
  }, [geo, silos, selectedSilo, moving]);

  // Medición GPS en curso: A, B y línea hasta la posición actual
  useEffect(() => {
    const g = layers.current.cap; g.clearLayers();
    if (!capture?.a) return;
    const b = capture.b || (gps ? [gps.lat, gps.lng] : null);
    if (b) g.addLayer(L.polyline([capture.a, b], { className: `sat-cap ${capture.b ? 'is-done' : ''}`, weight: 4, dashArray: capture.b ? null : '6 6', interactive: false }));
    [['A', capture.a], ['B', capture.b]].forEach(([t, p]) => p && g.addLayer(L.marker(p, { interactive: false, icon: L.divIcon({ className: 'sat-cap-pt', iconSize: [26, 26], html: `<span>${t}</span>` }) })));
  }, [capture?.a?.join(), capture?.b?.join(), gps?.lat, gps?.lng]); // eslint-disable-line

  // Mapas propios (ortomosaicos): debajo de los lotes, encima del satélite
  useEffect(() => {
    const g = layers.current.maps; g.clearLayers(); warp.current = {};
    const list = mapEdit ? overlays.filter(o => o.id === mapEdit.id).map(o => ({ ...o, corners: mapEdit.corners })) : overlays;
    list.forEach(o => {
      if (!o.url) return;
      const ly = new WarpLayer(o.url, o.corners, { opacity: mapEdit ? Math.min(overlayOpacity, 0.8) : overlayOpacity });
      warp.current[o.id] = ly; g.addLayer(ly);
    });
    if (!mapEdit && String(editFit.current).startsWith('map:')) editFit.current = null;
    if (!geo && !fitted.current && list.length) { map.current.fitBounds(L.latLngBounds(list.flatMap(o => o.corners)), { padding: [20, 20] }); fitted.current = true; }
    if (mapEdit && list[0] && editFit.current !== 'map:' + mapEdit.id) { map.current.fitBounds(L.latLngBounds(list[0].corners), { padding: [30, 30] }); editFit.current = 'map:' + mapEdit.id; }
  }, [overlays, overlayOpacity, mapEdit?.id, mapEdit && JSON.stringify(mapEdit.corners)]); // eslint-disable-line

  // Manijas para ubicar un mapa: 4 esquinas y centro
  useEffect(() => {
    const g = layers.current.mapEdit; g.clearLayers();
    if (!mapEdit) return;
    const ly = () => warp.current[mapEdit.id];
    let cur = mapEdit.corners.map(c => [...c]);
    const names = ['NO', 'NE', 'SE', 'SO'];
    const handles = cur.map((c, i) => {
      const mk = L.marker(c, { draggable: true, autoPan: true, icon: L.divIcon({ className: 'v-handle map-corner', iconSize: [28, 28], html: `<span>${names[i]}</span>` }), title: `Esquina ${names[i]}` });
      mk.on('drag', e => { const p = e.target.getLatLng(); cur[i] = [p.lat, p.lng]; ly()?.setCorners(cur); center.setLatLng(mid(cur)); });
      mk.on('dragend', () => cb.current.onMapCorners(cur.map(c => [...c])));
      g.addLayer(mk); return mk;
    });
    const mid = cs => [cs.reduce((a, c) => a + c[0], 0) / 4, cs.reduce((a, c) => a + c[1], 0) / 4];
    let start = null;
    const center = L.marker(mid(cur), { draggable: true, icon: L.divIcon({ className: 'v-handle map-center', iconSize: [34, 34], html: '<span>✥</span>' }), title: 'Mover el mapa completo' });
    center.on('dragstart', e => { start = { p: e.target.getLatLng(), cs: cur.map(c => [...c]) }; });
    center.on('drag', e => {
      const p = e.target.getLatLng(), dLat = p.lat - start.p.lat, dLng = p.lng - start.p.lng;
      cur = start.cs.map(c => [c[0] + dLat, c[1] + dLng]); ly()?.setCorners(cur); handles.forEach((h, i) => h.setLatLng(cur[i]));
    });
    center.on('dragend', () => cb.current.onMapCorners(cur.map(c => [...c])));
    g.addLayer(center);
  }, [mapEdit?.id, mapEdit && JSON.stringify(mapEdit.corners)]); // eslint-disable-line

  // Ubicación en vivo
  useEffect(() => {
    const g = layers.current.gps; g.clearLayers();
    if (!gps) return;
    // no interactivos: el lote donde estás parado se sigue pudiendo tocar
    g.addLayer(L.circle([gps.lat, gps.lng], { radius: gps.acc || 10, className: 'sat-acc', weight: 1, interactive: false }));
    g.addLayer(L.circleMarker([gps.lat, gps.lng], { radius: 6, className: 'sat-gps', weight: 2, fillOpacity: 1, interactive: false }));
    if (!geo && !fitted.current) { map.current.setView([gps.lat, gps.lng], 15); fitted.current = true; }
  }, [gps, geo]);

  return (
    <div className={`satmap ${pickMode ? 'is-picking' : ''}`}>
      <div ref={el} className="satmap-el" />
      {!geo && !editing && !mapEdit && !overlays.length && (
        <div className="sat-note">
          <b>Todavía no hay lotes con coordenadas</b>
          <span>Cargá el KML (o KMZ) de los lotes en la pestaña Mapas para verlos sobre la imagen satelital y ubicar silobolsas con el GPS.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNeedGeoref}>Cargar KML</button>
        </div>
      )}
    </div>
  );
}
