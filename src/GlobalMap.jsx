// SemIA · mapa global: todos los mapas cargados sobre el satélite, con su contorno y los lotes
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { WarpLayer } from './maplayers.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function GlobalMap({ maps, urls, lots, geo, selected, onSelect, showImages, focus }) {
  const el = useRef(null), map = useRef(null), ly = useRef({}), fitted = useRef(false), cb = useRef({});
  cb.current = { onSelect };

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, center: [-36.5, -60.5], zoom: 6 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' }).addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    const pane = m.createPane('semiaMaps'); pane.style.zIndex = 350; pane.style.pointerEvents = 'none';
    ly.current = { imgs: L.layerGroup().addTo(m), lots: L.layerGroup().addTo(m), foot: L.layerGroup().addTo(m) };
    m.on('click', () => cb.current.onSelect(null));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  // imágenes (las más nuevas arriba)
  useEffect(() => {
    const g = ly.current.imgs; g.clearLayers();
    if (!showImages) return;
    [...maps].sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''))).forEach(m => {
      if (urls[m.id]) g.addLayer(new WarpLayer(urls[m.id], m.corners, { opacity: selected && selected !== m.id ? 0.45 : 1 }));
    });
  }, [maps, urls, showImages, selected]);

  // lotes como referencia
  useEffect(() => {
    const g = ly.current.lots; g.clearLayers();
    if (!geo) return;
    lots.forEach(l => g.addLayer(L.polygon(l.poly.map(p => geo.toLatLng(p)), { className: 'glob-lot', weight: 1, fill: false, interactive: false })));
  }, [lots, geo]);

  // contornos de cada mapa
  useEffect(() => {
    const g = ly.current.foot; g.clearLayers();
    maps.forEach(m => {
      const sel = m.id === selected;
      const pg = L.polygon(m.corners, { className: `glob-foot ${sel ? 'is-sel' : ''}`, weight: sel ? 3 : 2, fillOpacity: showImages ? 0 : sel ? 0.28 : 0.12 });
      pg.on('click', e => { L.DomEvent.stopPropagation(e); cb.current.onSelect(m.id); });
      pg.bindTooltip(esc(m.nombre), { permanent: sel, direction: 'center', className: 'sat-label' });
      g.addLayer(pg);
    });
    const all = maps.flatMap(m => m.corners).concat(geo ? lots.flatMap(l => l.poly.map(p => geo.toLatLng(p))) : []);
    if (!fitted.current && all.length) { map.current.fitBounds(L.latLngBounds(all), { padding: [24, 24] }); fitted.current = true; }
  }, [maps, selected, showImages, lots, geo]);

  // centrar en un mapa o en todo
  useEffect(() => {
    if (!focus || !map.current) return;
    const all = focus.id === 'all' ? maps.flatMap(m => m.corners).concat(geo ? lots.flatMap(l => l.poly.map(p => geo.toLatLng(p))) : []) : maps.find(m => m.id === focus.id)?.corners;
    if (all?.length) map.current.flyToBounds(L.latLngBounds(all), { padding: [30, 30], duration: 0.6, maxZoom: 17 });
  }, [focus]); // eslint-disable-line

  return <div className="glob-map"><div ref={el} className="satmap-el" /></div>;
}
