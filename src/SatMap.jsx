import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fmtKg } from './ui.jsx';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function SatMap({ data, silos, geo, selectedLot, onSelectLot, selectedSilo, onSelectSilo, pickMode, onPick, gps, onNeedGeoref }) {
  const el = useRef(null), map = useRef(null), layers = useRef({}), fitted = useRef(false);
  const cb = useRef({}); cb.current = { onSelectLot, onSelectSilo, onPick, pickMode, geo, selectedLot };

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, center: [-36.5, -60.5], zoom: 6 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
    }).addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    layers.current = { lots: L.layerGroup().addTo(m), silos: L.layerGroup().addTo(m), gps: L.layerGroup().addTo(m) };
    m.on('click', e => {
      const c = cb.current;
      if (c.pickMode && c.geo) c.onPick(c.geo.toMap(e.latlng.lat, e.latlng.lng));
      else { c.onSelectSilo(null); }
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  // Lotes
  useEffect(() => {
    const g = layers.current.lots; g.clearLayers();
    if (!geo) return;
    const all = [];
    data.lots.forEach(l => {
      const ll = l.poly.map(p => geo.toLatLng(p)); all.push(...ll);
      const sel = l.num === selectedLot;
      const pg = L.polygon(ll, { className: `sat-lot ${sel ? 'is-sel' : ''}`, weight: sel ? 3 : 1.5, fillOpacity: sel ? 0.28 : 0.08 });
      pg.on('click', e => { L.DomEvent.stopPropagation(e); const c = cb.current; if (c.pickMode) c.onPick(c.geo.toMap(e.latlng.lat, e.latlng.lng)); else c.onSelectLot(c.selectedLot === l.num ? null : l.num); });
      pg.bindTooltip(`<b>${l.num}</b> · ${l.ha} ha`, { permanent: true, direction: 'center', className: 'sat-label' });
      g.addLayer(pg);
      l.subs?.forEach(s => g.addLayer(L.polygon(s.poly.map(p => geo.toLatLng(p)), { className: 'sat-sub', weight: 1, fill: false, interactive: false, dashArray: '4 4' })));
    });
    if (!fitted.current && all.length) { map.current.fitBounds(L.latLngBounds(all), { padding: [20, 20] }); fitted.current = true; }
  }, [geo, data.lots, selectedLot]);

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
      {!geo && (
        <div className="sat-note">
          <b>Mapa sin georreferenciar</b>
          <span>Cargá los 4 puntos de esquina en Ajustes para superponer los lotes sobre la imagen satelital.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNeedGeoref}>Ir a georreferencia</button>
        </div>
      )}
    </div>
  );
}
