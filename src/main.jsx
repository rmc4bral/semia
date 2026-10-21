import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo, Icon, Button, Field, TextInput, Segmented, Select, ToastProvider, useToast, fmtNum } from './ui.jsx';
import { detectMode, createStore, resolvePhoto } from './store.js';
import { fmtFecha } from './maplayers.js';
import { buildGeo, locateLot, controlPoints } from './geo.js';
import { cloneGeom, moveVertex, insertVertex, removeVertex, restoreLot, buildShapeChange, isLocked } from './shapes.js';
import Map3D from './Map3D.jsx';
import SatMap from './SatMap.jsx';
import { SiloModal, LotModal, UploadMapModal, EditMapModal } from './modals.jsx';
import { Kpis, LotPanel, RecentPanel, SilosScreen, LotsScreen, SettingsScreen } from './screens.jsx';

const pref = {
  get(k, d) { try { return localStorage.getItem('semia.' + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('semia.' + k, v); } catch { /* */ } },
};

/* ---------- GPS en tiempo real ---------- */
function useGps(enabled) {
  const [fix, setFix] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) { setErr('Este dispositivo no tiene GPS disponible'); return; }
    const id = navigator.geolocation.watchPosition(
      p => { const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }; lastLiveFix = f; setFix(f); setErr(null); },
      e => setErr(e.code === 1 ? 'Permiso de ubicación denegado' : 'Sin señal GPS'),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 25000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, err };
}
// Toma un punto: mejor precisión durante unos segundos (usa también la última lectura en vivo si es reciente)
let lastLiveFix = null;
function captureFix(ms = 7000) {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('GPS no disponible en este dispositivo'));
    let best = lastLiveFix && Date.now() - lastLiveFix.ts < 15000 ? { ...lastLiveFix } : null, over = false;
    const take = p => {
      const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      if (!best || f.acc < best.acc) best = f;
      if (f.acc <= 3) done();
    };
    const fail = e => { if (e.code === 1) { finish(); rej(new Error('Permiso de ubicación denegado')); } };
    const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: ms };
    const id = navigator.geolocation.watchPosition(take, fail, opts);
    navigator.geolocation.getCurrentPosition(take, fail, opts);
    const tm = setTimeout(() => done(), ms);
    function finish() { if (over) return false; over = true; navigator.geolocation.clearWatch(id); clearTimeout(tm); return true; }
    function done() { if (!finish()) return; best ? res(best) : rej(new Error('No se obtuvo señal GPS. Reintentá al aire libre.')); }
  });
}

/* ---------- Login ---------- */
function Login({ store, onLogged, mode }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [show, setShow] = useState(false);
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onLogged(await store.login(u, p)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <div className="login-art" aria-hidden="true"><svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M-20 ${60 + i * 38} Q 200 ${20 + i * 38} 420 ${80 + i * 38}`} />)}
      </svg></div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><Logo size={48} /><div><h1>SemIA</h1><p className="muted">Registro de silobolsas</p></div></div>
        <Field label="Usuario"><TextInput value={u} onChange={setU} autoCapitalize="none" autoComplete="username" placeholder="usuario" /></Field>
        <Field label="Contraseña">
          <div className="input-ic right">
            <TextInput type={show ? 'text' : 'password'} value={p} onChange={setP} autoComplete="current-password" placeholder="••••••••" />
            <button type="button" className="input-btn" onClick={() => setShow(s => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}><Icon name={show ? 'eyeoff' : 'eye'} size={18} /></button>
          </div>
        </Field>
        {err && <div className="form-err"><Icon name="alert" size={16} />{err}</div>}
        <Button variant="primary" className="block" disabled={busy || !u || !p} onClick={submit} type="submit">{busy ? 'Ingresando…' : 'Ingresar'}</Button>
        <p className="muted small center">Est. Rincón de Baguales · {mode === 'local' ? 'modo local' : 'conectado al servidor'}</p>
      </form>
    </div>
  );
}

/* ---------- Aplicación ---------- */
function Shell({ store, me, state, setState, onLogout, theme, setTheme }) {
  const toast = useToast();
  const isAdmin = me.rol === 'admin';
  const [tab, setTab] = useState('mapa');
  const [view, setViewRaw] = useState(pref.get('view', '3d'));
  const setView = v => { setViewRaw(v); pref.set('view', v); if (v !== 'sat') { setShape(null); setMapEdit(null); } };
  const [selLot, setSelLot] = useState(null), [selSilo, setSelSilo] = useState(null);
  const [pick, setPick] = useState(null), [moving, setMoving] = useState(null);
  const [draft, setDraft] = useState(null), [lotEdit, setLotEdit] = useState(null);
  const [shape, setShape] = useState(null); // { lot, geom, hist, sel, locked }
  // mapas propios
  const [mapFilter, setMapFilterRaw] = useState(pref.get('mapFilter', 'all'));
  const setMapFilter = v => { setMapFilterRaw(v); pref.set('mapFilter', v); };
  const [mapOpacity, setMapOpacityRaw] = useState(+pref.get('mapOpacity', '1'));
  const setMapOpacity = v => { setMapOpacityRaw(v); pref.set('mapOpacity', String(v)); };
  const [mapUrls, setMapUrls] = useState({});
  const [mapUpload, setMapUpload] = useState(null), [mapEditMeta, setMapEditMeta] = useState(null), [mapEdit, setMapEdit] = useState(null);
  const { fix, err: gpsErr } = useGps(true);
  const geo = useMemo(() => buildGeo(state.georef), [state.georef]);
  const gpsMap = useMemo(() => (geo && fix ? geo.toMap(fix.lat, fix.lng) : null), [geo, fix]);
  const lots = state.lots;
  const maps = state.maps || [];
  useEffect(() => {
    let on = true;
    Promise.all(maps.map(async m => [m.id, await resolvePhoto(m.src)])).then(r => on && setMapUrls(Object.fromEntries(r)));
    return () => { on = false; };
  }, [maps.map(m => m.id + m.src).join()]); // eslint-disable-line
  const filterOk = mapFilter === 'all' || mapFilter === 'none' || maps.some(m => m.id === mapFilter);
  const effFilter = filterOk ? mapFilter : 'all';
  const overlays = useMemo(() => (effFilter === 'none' ? [] : [...maps]
    .filter(m => effFilter === 'all' || m.id === effFilter)
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''))) // el más nuevo arriba
    .map(m => ({ id: m.id, url: mapUrls[m.id], corners: m.corners }))), [maps, effFilter, mapUrls]);
  const defaultCenter = useMemo(() => {
    if (geo) { const ll = state.outline.map(p => geo.toLatLng(p)); return [ll.reduce((a, p) => a + p[0], 0) / ll.length, ll.reduce((a, p) => a + p[1], 0) / ll.length]; }
    return fix ? [fix.lat, fix.lng] : null;
  }, [geo, fix, state.outline]);
  function startMapEdit(id) {
    const m = maps.find(x => x.id === id); if (!m) return;
    setShape(null); setPick(null); setMoving(null); setSelSilo(null);
    setTab('mapa'); setView('sat'); setMapEdit({ id, corners: m.corners.map(c => [...c]), orig: m.corners });
  }
  async function saveMapEdit() {
    const m = maps.find(x => x.id === mapEdit.id);
    try { setState(await store.saveMap({ ...m, corners: mapEdit.corners }, me)); toast(`«${m.nombre}» ubicado`, 'ok'); setMapEdit(null); }
    catch (e) { toast(e.message, 'error'); }
  }

  const openSilo = useCallback(id => {
    const s = state.silos.find(x => x.id === id); if (!s) return;
    setDraft({ ...s, prevId: s.id }); setSelSilo(id);
  }, [state.silos]);

  function draftFromPoint(pt, extra) {
    const loc = locateLot(pt, lots);
    return { ...extra, lote: loc.lot.num, map: loc.snap.point, t: loc.snap.t, ang: loc.snap.angle, rawMap: pt };
  }
  function onAdd() {
    setSelSilo(null);
    if (geo && fix && Date.now() - fix.ts < 60000) {
      const m = geo.toMap(fix.lat, fix.lng);
      setDraft(draftFromPoint(m, { origen: 'gps', gps: { lat: +fix.lat.toFixed(7), lng: +fix.lng.toFixed(7), acc: Math.round(fix.acc), at: new Date().toISOString() } }));
      return;
    }
    if (view === 'sat' && !geo) setView('3d');
    setPick({ purpose: 'new' });
    toast(!geo ? 'Mapa sin georreferencia: tocá el borde del lote donde está el silo' : 'Sin señal GPS: tocá el borde del lote donde está el silo', 'info', 4500);
  }
  function onPick(pt) {
    const base = pick?.purpose === 'relocate' ? pick.form : {};
    setPick(null);
    setDraft(draftFromPoint(pt, { ...base, origen: 'mapa', gps: null }));
  }
  function startMove(id) {
    const s = state.silos.find(x => x.id === id); if (!s) return;
    setDraft(null); setTab('mapa'); setView('3d'); setSelSilo(id);
    setMoving({ id, lote: s.lote, map: s.map, t: s.t, ang: s.ang });
  }
  async function saveMove() {
    const s = state.silos.find(x => x.id === moving.id);
    try {
      const st = await store.saveSilo({ ...s, map: moving.map.map(v => Math.round(v * 100) / 100), t: Math.round(moving.t * 100) / 100, ang: Math.round(moving.ang * 1e4) / 1e4, latlng: geo ? geo.toLatLng(moving.map).map(v => +v.toFixed(7)) : s.latlng }, me, s.id);
      setState(st); toast(`Ubicación de ${s.id} corregida`, 'ok'); setMoving(null);
    } catch (e) { toast(e.message, 'error'); }
  }
  /* ---------- Ajuste manual de forma ---------- */
  function startShape(num) {
    if (!geo) { toast('Primero cargá al menos 4 puntos de control en Ajustes', 'error'); setTab('ajustes'); return; }
    setLotEdit(null); setDraft(null); setSelSilo(null); setMoving(null); setPick(null);
    setTab('mapa'); setView('sat'); setSelLot(num);
    setShape({ lot: num, geom: cloneGeom(state), hist: [], sel: null, locked: controlPoints(state.georef).map(p => p.map) });
  }
  const pushGeom = (g, extra = {}) => setShape(sh => ({ ...sh, geom: g, hist: [...sh.hist.slice(-40), sh.geom], ...extra }));
  function onVertexMove(from, to) {
    if (isLocked(from, shape.locked)) return;
    pushGeom(moveVertex(shape.geom, from, to), { sel: to });
  }
  function onInsertVertex(num, i) { const r = insertVertex(shape.geom, num, i); pushGeom(r.geom, { sel: r.point }); }
  function onRemoveVertex() {
    const r = removeVertex(shape.geom, shape.sel);
    if (r.error) return toast(r.error, 'error');
    pushGeom(r.geom, { sel: null });
  }
  function onRestoreShape() {
    const lot = lots.find(l => l.num === shape.lot);
    if (!lot.poly0) return toast('Este lote conserva su forma original', 'info');
    pushGeom(restoreLot(shape.geom, lot), { sel: null });
  }
  async function saveShape() {
    const change = buildShapeChange(state, shape.geom, geo);
    if (!change.lots.length && !change.outline) { setShape(null); return; }
    try {
      setState(await store.saveShapes(change, me));
      toast(`Forma guardada (${change.lots.length} lote${change.lots.length === 1 ? '' : 's'}${change.silos.length ? `, ${change.silos.length} silos reubicados en el borde` : ''})`, 'ok');
      setShape(null);
    } catch (e) { toast(e.message, 'error'); }
  }

  function exportCsv() {
    const head = ['ID', 'Lote', 'Kg', 'Grano', 'Observacion', 'Latitud', 'Longitud', 'Precision_m', 'Origen', 'Registrado_por', 'Fecha'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = state.silos.map(s => [s.id, s.lote, s.kg, s.grano, s.obs, s.latlng?.[0], s.latlng?.[1], s.gps?.acc, s.origen, s.creadoPor, s.creadoEn].map(q).join(';'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + [head.join(';'), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `silobolsas-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  const tabs = [
    { k: 'mapa', label: 'Mapa', icon: 'map' }, { k: 'silos', label: 'Silos', icon: 'silo' },
    { k: 'lotes', label: 'Lotes', icon: 'lots' }, { k: 'ajustes', label: 'Ajustes', icon: 'gear' },
  ];
  const lot = lots.find(l => l.num === selLot);
  const gpsLabel = gpsErr ? gpsErr : fix ? `GPS ±${fmtNum(fix.acc)} m` : 'Buscando GPS…';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo size={30} /><div className="brand-txt"><b>SemIA</b><span>{state.estancia.nombre}</span></div></div>
        <div className="top-act">
          <span className={`gps-chip ${fix && !gpsErr ? (fix.acc <= 10 ? 'is-good' : 'is-mid') : 'is-off'}`} title={gpsLabel}><Icon name="gps" size={16} /><span>{gpsLabel}</span></span>
          <Button variant="ghost" icon={theme === 'dark' ? 'sun' : 'moon'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema" />
          <span className="avatar" title={`${me.nombre} (${me.rol})`}>{(me.nombre || me.user).slice(0, 1).toUpperCase()}</span>
        </div>
      </header>

      <nav className="nav">
        {tabs.map(t => (
          <button type="button" key={t.k} className={tab === t.k ? 'is-on' : ''} onClick={() => { setTab(t.k); setPick(null); if (t.k !== 'mapa') { setShape(null); setMapEdit(null); } }}>
            <Icon name={t.icon} size={20} /><span>{t.label}</span>
          </button>
        ))}
        <div className="nav-foot"><button type="button" onClick={onLogout}><Icon name="logout" size={20} /><span>Salir</span></button></div>
      </nav>

      <main className="main">
        {tab === 'mapa' && (
          <div className="dash">
            <Kpis state={state} />
            <div className="dash-body">
              <div className="card map-card">
                {!shape && !mapEdit && <div className="map-top">
                  <Segmented size="sm" value={view} onChange={setView} options={[{ value: '3d', label: 'Plano 3D', icon: 'cube' }, { value: 'sat', label: 'Satélite', icon: 'sat' }]} />
                  {view === 'sat' && maps.length > 0 && (
                    <div className="map-layers">
                      <Field label="Mapa a mostrar" className="map-filter"><Select value={effFilter} onChange={setMapFilter} options={[
                        { value: 'all', label: `Todos los mapas (${maps.length})` },
                        ...[...maps].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))).map(m => ({ value: m.id, label: m.nombre, meta: m.fecha ? fmtFecha(m.fecha) : '' })),
                        { value: 'none', label: 'Solo satélite' },
                      ]} /></Field>
                      {effFilter !== 'none' && <Field label="Opacidad" className="map-op"><Segmented size="sm" value={mapOpacity} onChange={setMapOpacity} options={[{ value: 0.5, label: '50%' }, { value: 0.75, label: '75%' }, { value: 1, label: '100%' }]} /></Field>}
                    </div>
                  )}
                </div>}
                {view === '3d' ? (
                  <Map3D data={state} silos={state.silos} selectedLot={selLot} onSelectLot={setSelLot} selectedSilo={selSilo} onSelectSilo={setSelSilo}
                    pickMode={!!pick} onPick={onPick} moving={moving} onMoveDraft={sn => setMoving(m => ({ ...m, map: sn.point, t: sn.t, ang: sn.angle }))}
                    gpsMap={gpsMap} isAdmin={isAdmin} onEditLot={setLotEdit} onOpenSilo={openSilo} onStartMove={startMove} />
                ) : (
                  <SatMap data={state} silos={state.silos} geo={geo} selectedLot={selLot} onSelectLot={setSelLot} selectedSilo={selSilo}
                    onSelectSilo={id => { setSelSilo(id); }} pickMode={!!pick} onPick={onPick} gps={fix} onNeedGeoref={() => setTab('ajustes')}
                    editing={shape} overlays={mapEdit ? [{ id: mapEdit.id, url: mapUrls[mapEdit.id], corners: mapEdit.corners }] : overlays} overlayOpacity={mapOpacity} mapEdit={mapEdit} onMapCorners={cs => setMapEdit(me_ => ({ ...me_, corners: cs }))} onVertexMove={onVertexMove} onInsertVertex={onInsertVertex} onSelectVertex={pt => setShape(sh => ({ ...sh, sel: pt }))} />
                )}
                {shape && (
                  <div className="map-banner edit-bar">
                    <div className="edit-bar-txt"><Icon name="edit" size={18} /><span><b>Ajustando lote {shape.lot}</b> · arrastrá los vértices; <b>+</b> agrega uno. Los vértices compartidos mueven también al lote vecino.{shape.locked.length ? ' Los puntos GPS quedan fijos.' : ''}</span></div>
                    <div className="edit-bar-act">
                      <Button size="sm" variant="ghost" icon="rotl" disabled={!shape.hist.length} onClick={() => setShape(sh => ({ ...sh, geom: sh.hist[sh.hist.length - 1], hist: sh.hist.slice(0, -1), sel: null }))}>Deshacer</Button>
                      <Button size="sm" variant="ghost" icon="trash" disabled={!shape.sel} onClick={onRemoveVertex}>Quitar vértice</Button>
                      <Button size="sm" variant="ghost" onClick={onRestoreShape}>Original</Button>
                      <Button size="sm" onClick={() => setShape(null)}>Cancelar</Button>
                      <Button size="sm" variant="primary" icon="check" onClick={saveShape}>Guardar</Button>
                    </div>
                  </div>
                )}
                {mapEdit && (
                  <div className="map-banner edit-bar">
                    <div className="edit-bar-txt"><Icon name="move" size={18} /><span><b>Ubicando «{maps.find(m => m.id === mapEdit.id)?.nombre}»</b> · arrastrá las esquinas NO, NE, SE, SO hasta que coincidan con el satélite, o el centro ✥ para moverlo completo.</span></div>
                    <div className="edit-bar-act">
                      <Button size="sm" variant="ghost" onClick={() => setMapEdit(m => ({ ...m, corners: m.orig.map(c => [...c]) }))}>Deshacer cambios</Button>
                      <Button size="sm" onClick={() => setMapEdit(null)}>Cancelar</Button>
                      <Button size="sm" variant="primary" icon="check" onClick={saveMapEdit}>Guardar</Button>
                    </div>
                  </div>
                )}
                {pick && <div className="map-banner"><Icon name="pin" size={18} /><span>Tocá el borde del lote donde está el silo</span><Button size="sm" onClick={() => setPick(null)}>Cancelar</Button></div>}
                {moving && <div className="map-banner"><Icon name="move" size={18} /><span>Arrastrá <b className="mono">{moving.id}</b> por el borde del lote {moving.lote}</span><Button size="sm" onClick={() => setMoving(null)}>Cancelar</Button><Button size="sm" variant="primary" onClick={saveMove}>Guardar</Button></div>}
                {view === 'sat' && selSilo && !moving && !shape && !mapEdit && (() => { const s = state.silos.find(x => x.id === selSilo); return s ? (
                  <div className="lot-bar"><div className="lot-bar-main"><b className="mono">{s.id}</b><span className="muted">{fmtNum(s.kg)} kg · lote {s.lote}</span></div><Button size="sm" onClick={() => openSilo(s.id)}>Detalle</Button></div>) : null; })()}
                {lot && !moving && !pick && !shape && !mapEdit && !(view === 'sat' && selSilo) && <div className="only-mobile"><LotPanel lot={lot} state={state} geo={geo} onEdit={setLotEdit} onShape={isAdmin && view === 'sat' && geo ? startShape : null} compact /></div>}
                {!moving && !pick && !shape && !mapEdit && <button type="button" className="fab" onClick={onAdd} aria-label="Agregar silobolsa"><Icon name="plus" size={26} /></button>}
              </div>
              <aside className="side-panel">
                {lot ? <LotPanel lot={lot} state={state} geo={geo} onEdit={setLotEdit} onShape={isAdmin ? startShape : null} onSelectSilo={id => setSelSilo(id)} /> : <RecentPanel state={state} onSelectSilo={id => { const s = state.silos.find(x => x.id === id); if (s) { setSelLot(s.lote); setSelSilo(id); } }} />}
              </aside>
            </div>
          </div>
        )}
        {tab === 'silos' && <SilosScreen state={state} onOpenSilo={openSilo} onExportCsv={exportCsv} />}
        {tab === 'lotes' && <LotsScreen state={state} onEditLot={setLotEdit} onShowLot={n => { setSelLot(n); setSelSilo(null); setTab('mapa'); }} />}
        {tab === 'ajustes' && <SettingsScreen state={state} me={me} store={store} geo={geo} gps={fix} captureFix={captureFix} theme={theme} setTheme={setTheme} onState={setState} onLogout={onLogout} mode={store.mode}
          onUploadMapFile={setMapUpload} onShowMap={id => { setMapFilter(id); setTab('mapa'); setView('sat'); }} onAdjustMap={startMapEdit} onEditMap={setMapEditMeta} />}
      </main>

      {draft && <SiloModal draft={draft} state={state} me={me} geo={geo} store={store} onClose={() => setDraft(null)}
        onSaved={(st, id) => { setState(st); setDraft(null); setSelSilo(id); if (id) { const s = st.silos.find(x => x.id === id); if (s) setSelLot(s.lote); } }}
        onRelocate={form => { setDraft(null); setTab('mapa'); if (view === 'sat' && !geo) setView('3d'); setPick({ purpose: 'relocate', form: { kg: form.kg, grano: form.grano, obs: form.obs, fotoData: form.fotoData } }); }}
        onStartMove={startMove} />}
      {mapUpload && <UploadMapModal file={mapUpload} me={me} store={store} defaultCenter={defaultCenter} onClose={() => setMapUpload(null)}
        onDone={(st, id, needsPlacement) => { setState(st); setMapUpload(null); setMapFilter(id); if (needsPlacement) { const m = st.maps.find(x => x.id === id); setTab('mapa'); setView('sat'); setMapEdit({ id, corners: m.corners.map(c => [...c]), orig: m.corners }); } }} />}
      {mapEditMeta && maps.find(m => m.id === mapEditMeta) && <EditMapModal map={maps.find(m => m.id === mapEditMeta)} me={me} store={store} onClose={() => setMapEditMeta(null)} onSaved={st => { setState(st); setMapEditMeta(null); }} />}
      {lotEdit != null && lots.find(l => l.num === lotEdit) && <LotModal lot={lots.find(l => l.num === lotEdit)} state={state} me={me} geo={geo} store={store} onClose={() => setLotEdit(null)} onShape={startShape}
        onSaved={(st, num) => { setState(st); setLotEdit(null); setSelLot(num); }} />}
    </div>
  );
}

function App() {
  const [boot, setBoot] = useState({ phase: 'loading' });
  const [theme, setThemeRaw] = useState(pref.get('theme', 'dark'));
  const setTheme = t => { setThemeRaw(t); pref.set('theme', t); };
  useEffect(() => { document.documentElement.dataset.theme = theme; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0F2420' : '#EDE6D9'); }, [theme]);
  useEffect(() => {
    (async () => {
      const mode = await detectMode(); const store = createStore(mode);
      const s = await store.session();
      setBoot({ phase: 'ready', store, me: s?.me || null, state: s?.state || null });
    })();
  }, []);
  if (boot.phase === 'loading') return <div className="splash"><Logo size={56} /><span className="muted">Cargando SemIA…</span></div>;
  const { store } = boot;
  if (!boot.me) return <Login store={store} mode={store.mode} onLogged={({ me, state }) => setBoot(b => ({ ...b, me, state }))} />;
  return <Shell store={store} me={boot.me} state={boot.state} theme={theme} setTheme={setTheme}
    setState={st => setBoot(b => ({ ...b, state: st }))}
    onLogout={async () => { await store.logout(); setBoot(b => ({ ...b, me: null, state: null })); }} />;
}

createRoot(document.getElementById('root')).render(<ToastProvider><App /></ToastProvider>);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
