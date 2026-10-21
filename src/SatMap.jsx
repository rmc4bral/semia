import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fmtKg } from './ui.jsx';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function SatMap({ data, silos, geo, selectedLot, onSelectLot, selectedSilo, onSelectSilo, pickMode, onPick, gps, onNeedGeoref, editing, onVertexMove, onInsertVertex, onSelectVertex }) {
  const el = useRef(null), map = useRef(null), layers = useRef({}), fitted = useRef(false), editFit = useRef(null);
  const cb = useRef({}); cb.current = { onSelectLot, onSelectSilo, onPick, pickMode, geo, selectedLot, editing, onVertexMove, onInsertVertex, onSelectVertex };

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, center: [-36.5, -60.5], zoom: 6 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
    }).addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    layers.current = { lots: L.layerGroup().addTo(m), silos: L.layerGroup().addTo(m), gps: L.layerGroup().addTo(m), edit: L.layerGroup().addTo(m) };
    m.on('click', e => {
      const c = cb.current;
      if (c.editing) return;
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
    if (!geo) return;
    const all = [];
    const src = editing ? editing.geom.lots.map(gl => ({ ...data.lots.find(l => l.num === gl.num), poly: gl.poly, subs: gl.subs.map(s => ({ ...data.lots.find(l => l.num === gl.num).subs.find(x => x.id === s.id), poly: s.poly })) })) : data.lots;
    src.forEach(l => {
      const ll = l.poly.map(p => geo.toLatLng(p)); all.push(...ll);
      const sel = editing ? l.num === editing.lot : l.num === selectedLot;
      const pg = L.polygon(ll, { className: `sat-lot ${sel ? 'is-sel' : ''} ${editing && !sel ? 'is-dim' : ''}`, weight: sel ? 3 : 1.5, fillOpacity: sel ? (editing ? 0.12 : 0.28) : 0.08, interactive: !editing });
      if (!editing) {
        pg.on('click', e => { L.DomEvent.stopPropagation(e); const c = cb.current; if (c.pickMode) c.onPick(c.geo.toMap(e.latlng.lat, e.latlng.lng)); else c.onSelectLot(c.selectedLot === l.num ? null : l.num); });
        pg.bindTooltip(`<b>${l.num}</b> · ${l.ha} ha`, { permanent: true, direction: 'center', className: 'sat-label' });
      }
      g.addLayer(pg);
      if (sel && editing) layers.current.editPoly = pg;
      l.subs?.forEach(s => g.addLayer(L.polygon(s.poly.map(p => geo.toLatLng(p)), { className: 'sat-sub', weight: 1, fill: false, interactive: false, dashArray: '4 4' })));
    });
    if (!fitted.current && all.length) { map.current.fitBounds(L.latLngBounds(all), { padding: [20, 20] }); fitted.current = true; }
  }, [geo, data.lots, selectedLot, editing]);

  // Manijas de edición: vértices (arrastrables) y puntos medios (agregar vértice)
  useEffect(() => {
    const g = layers.current.edit; g.clearLayers();
    if (!editing) editFit.current = null;
    if (!geo || !editing) return;
    const lot = editing.geom.lots.find(l => l.num === editing.lot); if (!lot) return;
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

  // Silos
  useEffect(() => {
    const g = layers.current.silos; g.clearLayers();
    if (!geo) return;
    silos.forEach(s => {
      if (!s.map) return;
      const ll = geo.toLatLng(s.map), sel = s.id === selectedSilo;
      const mk = L.marker(ll, { icon: L.divIcon({ className: `sat-silo ${sel ? 'is-sel' : ''}`, iconSize: [18, 18], html: '<span></span>' }) });
      mk.on('click', e => { L.DomEvent.stopPropagation(e); cb.current.onSelectSilo(s.id); });
      mk.bindTooltip(`<b>${esc(s.id)}</b><br>${fmtKg(s.kg)} kg`, { direction: 'top', offset: [0, -10], className: 'sat-tip', permanent: sel });
      g.addLayer(mk);
    });
  }, [geo, silos, selectedSilo]);

  // Ubicación en vivo
  useEffect(() => {
    const g = layers.current.gps; g.clearLayers();
    if (!gps) return;
    g.addLayer(L.circle([gps.lat, gps.lng], { radius: gps.acc || 10, className: 'sat-acc', weight: 1 }));
    g.addLayer(L.circleMarker([gps.lat, gps.lng], { radius: 6, className: 'sat-gps', weight: 2, fillOpacity: 1 }));
    if (!geo && !fitted.current) { map.current.setView([gps.lat, gps.lng], 15); fitted.current = true; }
  }, [gps, geo]);

  return (
    <div className={`satmap ${pickMode ? 'is-picking' : ''}`}>
      <div ref={el} className="satmap-el" />
      {!geo && !editing && (
        <div className="sat-note">
          <b>Mapa sin georreferenciar</b>
          <span>Cargá los 4 puntos de esquina en Ajustes para superponer los lotes sobre la imagen satelital.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNeedGeoref}>Ir a georreferencia</button>
        </div>
      )}
    </div>
  );
}
